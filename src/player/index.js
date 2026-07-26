import * as THREE from 'three';
import {
  Structure, cellId, parseCell, screenKey, screenId, depth, rotateY, HORIZONTAL_STEPS,
} from '../geometry/index.js';

/**
 * The avatar and its traversal of the path graph.
 *
 * This subsystem CONSUMES src/geometry and does not reimplement any of it. Every
 * question about what connects to what is answered by `Structure.pathGraph()`,
 * every question about what is an illusion by `Structure.impossibleEdges()`, and
 * every question about what occludes what by `Structure.visibility()` — the same
 * calls tools/analyze.mjs makes. The avatar therefore cannot disagree with the
 * analyser about what the level is: there is only one implementation of the
 * rules, and this file is a reader of it.
 *
 * DETERMINISM (ARCHITECTURE.md §1). Movement animation here is the single most
 * likely place in this project for wall-clock time to leak in, so:
 *
 *   - the ONLY clock consulted is `ctx.time.dt`, once, in update();
 *   - there is no setTimeout/setInterval, no rAF, no Date/performance.now;
 *   - no randomness at all, so no rng stream is even forked;
 *   - the visual position is a pure function of (start cell, target cell,
 *     rotation, seconds accumulated from dt), and the accumulated seconds are a
 *     pure function of the frame index in lockstep.
 *
 * Same frame index, same pixels.
 */

// ---------------------------------------------------------------- constants

/** Seconds a single step takes. Multiplied by dt only — never by wall clock. */
const MOVE_SECONDS = 0.22;

/** Peak of the hop arc, in world units. Zero at both ends of the move. */
const HOP = 0.15;

/**
 * Depth margin, in x+y+z units, that the avatar must clear an occluder by.
 *
 * A unit cell's nearest corner sits 1.5 above its centre's depth; the avatar's
 * farthest corner sits ~1.18 below its own. 3 covers both with room to spare and
 * is exactly one lattice step along the view diagonal (see VIEW BIAS below).
 */
const CLEARANCE = 3;

/**
 * Pawn dimensions and its face tones — the fourth ink.
 *
 * The three structure plates are sunflower, bright red and federal blue; the
 * avatar prints on a drum of its own, Riso Green 00A95C, so it is never
 * confused with a face of the structure at any rotation.
 *
 * LEFT AND RIGHT ARE DELIBERATELY THE SAME INK, and that is load-bearing rather
 * than a simplification. The art direction fixes tone to the OBJECT: src/world
 * composes the quarter turn into its instance matrices so face tones rotate
 * with the geometry, which is what makes the rotation commit frame pixel-clean.
 * The avatar is a separate mesh whose orientation is not rotated, so a pawn
 * with distinct ±x and ±z tones would be the one thing left in the scene still
 * keyed to the screen — and it would put a tone swap back on the commit frame,
 * on the one object the eye is following. Two tones instead of three costs the
 * pawn nothing (it is 4-fold symmetric about Y, so it is now literally
 * invariant under a quarter turn) and it is more honest to a limited-ink print
 * anyway: a small mark gets one drum, not three.
 *
 * Deliberately NOT imported from src/render — ARCHITECTURE.md §3.3 forbids
 * subsystems importing each other, and src/geometry is the only permitted
 * direct reach.
 */
const AVATAR = {
  height: 0.8,
  radiusBottom: 0.34,
  radiusTop: 0.22,
  /** A lighter pass on the cap, so the pawn still reads as a solid. */
  top: 0x6fdfac,
  /** Riso Green, all four sides. */
  left: 0x00a95c,
  right: 0x00a95c,
};

// ---------------------------------------------------------------- mesh build

/** Paint vertex colours by face normal. Same three-tone read as the level kit. */
function paintByNormal(geometry, { top, left, right }) {
  const cTop = new THREE.Color(top);
  const cLeft = new THREE.Color(left);
  const cRight = new THREE.Color(right);

  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const nx = normal.getX(i), ny = normal.getY(i);
    const c = Math.abs(ny) > 0.5 ? cTop : Math.abs(nx) > 0.5 ? cRight : cLeft;
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * A tapered four-sided prism: a pawn.
 *
 * thetaStart = PI/4 puts the four side faces square onto ±x and ±z, so the
 * isometric view shows exactly one "left" face, one "right" face and the top —
 * the same three-tone read as the cubes, from the same rule. toNonIndexed() +
 * computeVertexNormals() gives flat facets; the default radial normals would
 * gouraud-blend the tones into mud at four segments.
 *
 * Translated so the feet sit at local y = -0.5, i.e. on the top face of the
 * platform below the avatar's cell.
 */
function pawnGeometry() {
  const g = new THREE.CylinderGeometry(
    AVATAR.radiusTop, AVATAR.radiusBottom, AVATAR.height, 4, 1, false, Math.PI / 4,
  ).toNonIndexed();
  g.computeVertexNormals();
  g.translate(0, AVATAR.height / 2 - 0.5, 0);
  return paintByNormal(g, AVATAR);
}

// ---------------------------------------------------------------- subsystem

export default {
  name: 'player',

  async init(ctx) {
    this.ctx = ctx;
    this.level = null;
    this.structure = null;
    this.cell = null;
    this.goalId = null;
    this.turns = 0;
    this.moves = 0;
    /** Quarter-turns the player has spent this level. Reported by level/solved. */
    this.rotations = 0;
    this.solved = false;

    // Derived-from-geometry caches, keyed by rotation. Pure functions of the
    // level, so caching them cannot change any answer — it only stops step()
    // rebuilding the graph on every keypress.
    this._graphs = new Map();
    this._visible = new Map();
    this._illusions = new Map();

    // Interpolation state. Seconds, never timestamps.
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._elapsed = 0;
    this._duration = 0;
    /** How far along (1,1,1) the mesh is currently pushed. See VIEW BIAS. */
    this._bias = 0;
    /** Whether a camera rotation orbit was in flight as of the last frame. */
    this._orbiting = false;

    // ONE draw call, and no new shader program: InstancedMesh + instanceColor +
    // MeshBasicMaterial{vertexColors} is the exact parameter set the level kit
    // already uses, so three.js hands back the cached program rather than
    // compiling a second one. A count-of-1 instanced mesh looks odd until you
    // notice that dropping either the instancing or the instanceColor changes
    // the program cache key and costs a compile stall (ARCHITECTURE.md §6).
    //
    // Built BEFORE the level/loaded subscription below, so there is no ordering
    // in which the avatar is placed by an event that arrives before it exists.
    this.mesh = new THREE.InstancedMesh(
      pawnGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), 1);
    this.mesh.name = 'avatar';
    this.mesh.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
    this.mesh.setMatrixAt(0, new THREE.Matrix4());
    this.mesh.instanceMatrix.needsUpdate = true;
    // The instance transform is identity and stays identity; the avatar moves as
    // an object, so its bounding sphere stays correct and culling stays honest.
    this.mesh.visible = false;
    ctx.engine.scene.add(this.mesh);

    ctx.on('level/loaded', (level) => {
      this.level = level;
      // Prefer the structure world already built, so both subsystems are
      // literally reading the same object; Structure is pure, so the fallback
      // is identical anyway.
      this.structure = ctx.peek('world')?.structure ?? new Structure(level.cells);
      this.turns = ctx.peek('world')?.turns ?? 0;
      this.cell = cellId(...level.start);
      this.goalId = cellId(...level.goal);
      this.moves = 0;
      this.rotations = 0;
      this.solved = false;
      this._graphs.clear();
      this._visible.clear();
      this._illusions.clear();
      this._cancelMove();
      if (this.mesh) {
        this.mesh.visible = true;
        this._settle();
        this._orientToWorld();
      }
    });

    ctx.on('world/rotated', ({ to }) => {
      this.turns = to;
      this.rotations += 1;
      // Rotation is a discrete state change, not an animation (src/world
      // explains why). Interpolating a cell across it would put the avatar at
      // coordinates where the screen-position invariant does not hold, so an
      // in-flight step is completed instantly instead.
      this._cancelMove();
      this._settle();
      this._orientToWorld();
    });
  },

  /**
   * Attempt a step in a screen-space direction.
   *
   * @param {[number,number]} screenDelta one of geometry's HORIZONTAL_STEPS
   * @returns {boolean} whether the move was legal
   *
   * The edge set comes from `pathGraph(turns)` and nothing else. The screen
   * delta only picks WHICH of the current cell's existing edges was asked for —
   * it never creates one. So a direction the analyser says is impassable is
   * impassable here, in every rotation, by construction.
   */
  step(screenDelta) {
    const to = this._resolve(screenDelta);
    if (to === null) {
      if (this.cell && Array.isArray(screenDelta)) {
        this.ctx.emit('player/blocked',
          { from: this.cell, direction: [screenDelta[0], screenDelta[1]] });
      }
      return false;
    }

    const from = this.cell;
    const viaIllusion = this._illusionSet().has(`${from}>${to}`);

    this.cell = to;
    this.moves += 1;
    this._beginMove(parseCell(from), parseCell(to));

    // viaIllusion is geometry's own classification of the edge (manhattan > 1),
    // not a second opinion computed here. The player just walked 14 units and it
    // looked like one step; this flag is the only channel that says so.
    this.ctx.emit('player/moved', { from, to, viaIllusion });

    if (!this.solved && to === this.goalId) {
      this.solved = true;
      this.ctx.emit('level/solved', { moves: this.moves, turns: this.rotations });
    }
    return true;
  },

  /**
   * Which of geometry's HORIZONTAL_STEPS currently lead somewhere. For the HUD
   * and for tests; resolves through the same graph as step() and emits nothing.
   */
  available() {
    return HORIZONTAL_STEPS.filter((d) => this._resolve(d) !== null).map(([a, b]) => [a, b]);
  },

  /**
   * Put the avatar on a cell INSTANTLY: no interpolation, no hop, no events,
   * no move counted, no solve check.
   *
   * This exists for src/dev/shots.js and for tests. A shot must be a pure
   * function of the scene — it may not start an animation, because the shutter
   * lands a fixed number of pumped frames later and an in-flight interpolation
   * would make the captured pixels depend on that count rather than on the
   * state the shot describes. `step()` starts an animation; this does not, so
   * the avatar can be captured resting on a cell other than the level's start.
   *
   * Refuses any cell that is not standable in the CURRENT rotation, so a shot
   * cannot park the avatar somewhere the rules say it cannot be.
   *
   * @param {string|[number,number,number]} cell cell id or coordinates
   * @returns {boolean} whether the avatar was placed
   */
  placeAt(cell) {
    if (!this.structure) return false;
    const id = Array.isArray(cell) ? cellId(...cell) : String(cell);
    if (!this._graph().has(id)) return false;
    this.cell = id;
    this._cancelMove();
    this._settle();
    return true;
  },

  /**
   * Turn the pawn with the world, so its face tones follow the same convention
   * the level kit does (LIGHT FIXED IN THE WORLD — see src/world/_applyRotation).
   *
   * Without this the avatar would be the last object in the scene still keyed to
   * the screen, and it alone would put a tone swap back on the commit frame that
   * the world fix just removed.
   *
   * The pawn is four-fold symmetric about Y (CylinderGeometry, 4 radial
   * segments, thetaStart PI/4), so a quarter turn leaves its silhouette
   * bit-identical and rotates only which tone faces where. That symmetry is why
   * this is free rather than a visible spin — and it is why the alternative fix,
   * flattening the two side tones to one ink, was not needed: the pawn keeps its
   * three-tone read.
   */
  _orientToWorld() {
    if (this.mesh) this.mesh.rotation.y = this.turns * Math.PI / 2;
  },

  /** Read-only state for the UI. Must contain nothing time-derived. */
  state() {
    return {
      cell: this.cell,
      moves: this.moves,
      solved: this.solved,
      level: this.level?.name ?? null,
    };
  },

  /**
   * Whether a step interpolation is in flight, and how far through it is.
   *
   * DELIBERATELY NOT PART OF state(). state() is the UI-facing snapshot and is
   * required to be time-invariant — `traversal.test.js` asserts that advancing
   * 120 frames changes nothing in it, which is what stops the HUD becoming
   * frame-dependent. `moving` flips true -> false as frames advance, so putting
   * it there breaks that guarantee for every consumer, not just the one that
   * wanted it.
   *
   * This mirrors render.transitionState() instead: a separate, explicitly
   * time-varying read for tools that need to know whether anything is animating.
   * tools/baseline.mjs uses it to refuse a shot that declared a settle count and
   * landed on a settled frame.
   */
  motionState() {
    return {
      moving: this._duration > 0,
      progress: this._duration > 0 ? Math.min(this._elapsed / this._duration, 1) : 0,
    };
  },

  update(ctx) {
    if (!this.mesh) return;

    // The view bias is only legitimate while the camera is ON the isometric
    // axis. src/render orbits it off that axis for the duration of a rotation
    // transition, so the bias is dropped for exactly that interval and restored
    // when the camera arrives. Polled through ctx.peek — a read, which is the
    // one direct reach ARCHITECTURE.md §3.3 allows — rather than subscribed to,
    // so it cannot drift out of agreement with the renderer.
    const orbiting = this._orbitActive();
    if (orbiting !== this._orbiting) {
      this._orbiting = orbiting;
      this._rebias();
    }

    if (this._duration <= 0) return;

    // ctx.time.dt is the ONLY clock in this subsystem. In lockstep it is exactly
    // 1/60 every frame, so the position below is a pure function of the frame
    // index — which is what the pixel gate rests on.
    this._elapsed += ctx.time.dt;

    const u = Math.min(this._elapsed / this._duration, 1);
    const eased = u * u * (3 - 2 * u);
    this.mesh.position.lerpVectors(this._from, this._to, eased);
    this.mesh.position.y += HOP * Math.sin(Math.PI * u);

    if (u >= 1) {
      this._duration = 0;
      this._elapsed = 0;
      this._settle();
    }
  },

  // -------------------------------------------------------------- internals

  /**
   * Resolve a screen direction to a destination cell id, or null.
   * Pure: no state change, no events.
   */
  _resolve(screenDelta) {
    if (!this.structure || !this.cell) return null;
    if (!Array.isArray(screenDelta) || screenDelta.length !== 2) return null;
    const [da, db] = screenDelta;
    if (!Number.isFinite(da) || !Number.isFinite(db)) return null;

    // The graph is the authority on which edges exist. If the current cell is
    // not standable in this rotation it has no entry, and every direction is
    // blocked — which is correct: rotate back to get out.
    const neighbours = this._graph().get(this.cell);
    if (!neighbours || neighbours.length === 0) return null;

    const [a, b] = screenKey(...rotateY(parseCell(this.cell), this.turns));
    for (const n of neighbours) {
      const [na, nb] = screenKey(...rotateY(parseCell(n), this.turns));
      if (na === a + da && nb === b + db) return n;
    }
    return null;
  },

  _graph() {
    let g = this._graphs.get(this.turns);
    if (!g) { g = this.structure.pathGraph(this.turns); this._graphs.set(this.turns, g); }
    return g;
  },

  _illusionSet() {
    let s = this._illusions.get(this.turns);
    if (!s) {
      s = new Set(this.structure.impossibleEdges(this.turns).map((e) => `${e.from}>${e.to}`));
      this._illusions.set(this.turns, s);
    }
    return s;
  },

  _visibility() {
    let v = this._visible.get(this.turns);
    if (!v) { v = this.structure.visibility(this.turns); this._visible.set(this.turns, v); }
    return v;
  },

  /**
   * VIEW BIAS — how many lattice steps along (1,1,1) the avatar must be pushed
   * to be seen at all.
   *
   * The avatar stands one cell above its platform, and that cell can be aliased
   * by solid geometry much closer to the camera: at loop-01's start the avatar's
   * cell (1,1,0) shares a screen position with the walkway block (5,5,4), which
   * is twelve units nearer. Rendered honestly the avatar is invisible on the
   * frame the level opens on.
   *
   * The fix is the subsystem's own central fact rather than a depth hack:
   * translating by t*(1,1,1) moves a point exactly nowhere on screen under this
   * projection. So the avatar is drawn at the FRONTMOST lattice point of its
   * screen position — the same rule Structure.visibility() uses to decide what
   * you see — and the pixels are identical to drawing it at its true position,
   * while the depth buffer now resolves in its favour. No material state is
   * touched, so depth testing among the avatar's own faces stays correct.
   *
   * It is zero whenever nothing occludes the avatar, which is the common case.
   * The one place this is observable is the deliberately off-axis shot, where
   * the projection no longer collapses the diagonal: there the avatar reads as
   * displaced along it. That is the same honesty the off-axis shot exists to
   * expose, and it is called out in the report rather than hidden.
   */
  /** True while src/render is orbiting the camera off the isometric axis. */
  _orbitActive() {
    return this.ctx?.peek?.('render')?.transitionState?.().active === true;
  },

  _biasFor(cell) {
    // OFF-AXIS THE BIAS IS A LIE, SO IT IS NOT TAKEN.
    //
    // t*(1,1,1) is a screen no-op only because the projection collapses the
    // view diagonal, which is true exactly when the camera is on it. During a
    // rotation orbit it is not, and a bias of 5 then reads as the avatar
    // sliding several units along the diagonal and snapping back at the commit
    // — measured before this guard: 3.32% of pixels changed on the commit
    // frame, maxDelta 228, and the avatar visibly crossed the screen.
    //
    // Dropping it costs the avatar being honestly occluded for the frames near
    // u=0 in the one case where the bias was nonzero (loop-01's start cell,
    // hidden behind a walkway 12 units nearer). That is the geometry's true
    // answer rather than a teleport, and it lasts only until the camera has
    // moved far enough off-axis to separate the two.
    if (this._orbitActive()) return 0;
    const [x, y, z] = rotateY(cell, this.turns);
    const front = this._visibility().get(screenId(x, y + 1, z));
    if (!front) return 0;
    const need = front.depth + CLEARANCE - depth(x, y + 1, z);
    return need > 0 ? Math.ceil(need / 3) : 0;
  },

  /** World position of the avatar at rest on `cell`, with the bias applied. */
  _restPosition(cell, bias, out = new THREE.Vector3()) {
    const [x, y, z] = rotateY(cell, this.turns);
    return out.set(x + bias, y + 1 + bias, z + bias);
  },

  _beginMove(fromCell, toCell) {
    if (!this.mesh) return;
    // One bias for the whole move, so nothing can duck behind geometry midway.
    // Raising it is a pure (1,1,1) shift of wherever the mesh currently is —
    // zero screen movement, including when this interrupts a move in flight.
    const bias = Math.max(this._biasFor(fromCell), this._biasFor(toCell));
    this._from.copy(this.mesh.position).addScalar(bias - this._bias);
    this._restPosition(toCell, bias, this._to);
    this._bias = bias;
    this._elapsed = 0;
    this._duration = MOVE_SECONDS;
  },

  _cancelMove() {
    this._duration = 0;
    this._elapsed = 0;
  },

  /**
   * Re-apply the bias for the current cell after the bias RULE changed (an
   * orbit started or finished) rather than after the cell changed.
   *
   * At rest this is just a settle. Mid-move it is a pure (1,1,1) shift of both
   * endpoints and of the current visual position, so the move continues from
   * exactly where it was — on-axis that shift is worth zero screen pixels, and
   * off-axis it is the correction being applied.
   */
  _rebias() {
    if (!this.mesh || !this.cell) return;
    if (this._duration <= 0) { this._settle(); return; }
    const want = this._biasFor(parseCell(this.cell));
    const d = want - this._bias;
    if (d === 0) return;
    this._from.addScalar(d);
    this._to.addScalar(d);
    this.mesh.position.addScalar(d);
    this._bias = want;
  },

  /** Snap to the resting position of the current cell. */
  _settle() {
    if (!this.mesh || !this.cell) return;
    const cell = parseCell(this.cell);
    this._bias = this._biasFor(cell);
    this._restPosition(cell, this._bias, this.mesh.position);
  },

  dispose() {
    this.mesh?.removeFromParent();
    this.mesh?.geometry?.dispose();
    this.mesh?.material?.dispose();
    this.mesh = null;
  },
};
