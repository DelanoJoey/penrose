import * as THREE from 'three';

/**
 * Renderer + isometric camera rig.
 *
 * Deliberately flat-shaded: face colour comes from the face normal, not from a
 * light. There is no lighting term, no shadow pass, no temporal accumulation
 * and no tonemapping. That is a target choice, not a shortcut — see
 * METHODOLOGY.md. It removes the two things that most commonly break a pixel
 * gate (auto-exposure adaptation, TAA history) and the thing that most commonly
 * tanks frame rate (a cascaded shadow + AO + TAA stack).
 *
 * ART DIRECTION: TECHNICAL DRAFTING
 * ---------------------------------
 * The register is an engineering drawing, not an illustration. Three decisions
 * carry it, and they are one system rather than three preferences:
 *
 *   GROUND. A cool near-white drafting paper, and the object sits ON it: the
 *   top planes are LIGHTER than the paper, the two side planes DARKER. So the
 *   figure separates from the field by value in both directions rather than by
 *   hue, which is what lets the whole palette stay near-monochrome without the
 *   image going flat.
 *
 *   DELINEATION. Every face carries an inked border, baked into the cell
 *   geometry as real inset quads (`draftedBox`). It is not a wireframe pass, not
 *   a post outline, and not a second material — it is the SAME vertex-coloured
 *   triangles the fill is made of, in the same instanced draw call, compiled
 *   into the same single program. Measured cost: 0 extra draw calls, 0 extra
 *   programs, +48 triangles per cell. The line has real width in world units, so
 *   it is a drawn line on a drawing rather than a screen-space effect, and it
 *   scales with the plate the way ink on paper does.
 *
 *   ACCENT. Exactly one chromatic note, a drafting-red, and it is spent only on
 *   the two things the player has to find: the avatar and the goal cell. Nothing
 *   else in the scene is allowed to be a colour. That is the whole reason the
 *   ground is near-monochrome — an accent is only restrained if it has no
 *   competition.
 *
 * WHY THE INTERIOR LINES ARE HEAVIER THAN THE SILHOUETTE. Two coplanar
 * neighbouring faces each contribute their own border to the joint between them,
 * so a cell division reads at 2x edge width, while the outer silhouette gets one
 * face's border and reads at 1x. A drafting convention would want the reverse.
 * Getting it would cost an inverted-hull silhouette pass: a second draw call and
 * (with a flipped winding or BackSide) very likely a second program, to fix a
 * line-weight ratio. It is not worth the budget, and on a LIGHT ground it partly
 * corrects itself — the silhouette also carries a large value step against the
 * paper, while an interior joint separates grey from grey and needs the extra
 * ink to be seen at all. Stated rather than hidden.
 */

/**
 * Drafting palette. Cool near-monochrome, one accent.
 *
 * `bg` sits deliberately BETWEEN faceTop and faceLeft in value, so the paper is
 * darker than a lit top plane and lighter than any side plane.
 */
export const PALETTE = {
  bg:        0xe3e7ea,  // paper
  faceTop:   0xf5f7f8,  // top planes, lighter than the paper
  faceLeft:  0xbac3cb,  // +-z planes  (screen left)
  faceRight: 0x99a4ae,  // +-x planes  (screen right)
  ink:       0x1d2429,  // edge delineation
  accent:    0xc6482f,  // reserved: player + goal, nothing else
};

/**
 * Width of the inked border, in world units, on a 1.0 cell.
 *
 * This is a DRAWN width, not a pixel width: it foreshortens and scales with the
 * plate. At the hero plate (frustum ~7.7 over 1000px) it lands at ~1.4 px on the
 * silhouette and ~2.8 px on a cell division, which is the hairline register the
 * direction is after. Pushing it thinner makes the wide plate lose the line to
 * sub-pixel coverage; pushing it thicker turns the cell divisions into stripes.
 */
export const EDGE_WIDTH = 0.011;

/**
 * The three-tone rule, stated once: up-facing gets the light tone, the two
 * horizontal axes get the mid and dark tones. Zero lighting maths, and therefore
 * bit-identical output across runs.
 */
export function faceTone(nx, ny, nz, { top, left, right }) {
  return Math.abs(ny) > 0.5 ? top : Math.abs(nx) > 0.5 ? right : left;
}

/**
 * The six faces of a unit cell, each as an outward normal and a right-handed
 * tangent pair with `t1 x t2 === n`. Emitting a quad as
 * (-t1,-t2) (+t1,-t2) (+t1,+t2) (-t1,+t2) is then counter-clockwise seen from
 * outside, so the default FrontSide culling is correct on every face without a
 * per-face special case.
 */
const FACES = [
  { n: [1, 0, 0],  t1: [0, 0, -1], t2: [0, 1, 0] },
  { n: [-1, 0, 0], t1: [0, 0, 1],  t2: [0, 1, 0] },
  { n: [0, 1, 0],  t1: [1, 0, 0],  t2: [0, 0, -1] },
  { n: [0, -1, 0], t1: [1, 0, 0],  t2: [0, 0, 1] },
  { n: [0, 0, 1],  t1: [1, 0, 0],  t2: [0, 1, 0] },
  { n: [0, 0, -1], t1: [-1, 0, 0], t2: [0, 1, 0] },
];

/**
 * A unit cell drawn as a technical figure: each face is an inset tone panel
 * inside a frame of four ink rails.
 *
 * THE POINT OF DOING IT THIS WAY. The obvious way to get edge lines is a second
 * mesh — `EdgesGeometry` + `LineSegments`, or an inverted hull. Either costs a
 * draw call, and the line material costs a second shader program that compiles
 * the first time it is drawn: exactly the lazily-compiled-shader stall
 * ARCHITECTURE.md §6 exists to catch. Baking the lines into the cell geometry as
 * ordinary vertex-coloured triangles costs neither. The panel and the rails do
 * not overlap — the panel is the inset rectangle, the rails are the frame around
 * it — so there is no coplanar geometry and no z-fighting to tune away.
 *
 * Faces between two adjacent cells are never seen: each is exactly occluded by
 * the neighbour's own volume, and the neighbour's coincident back-face is culled.
 *
 * @returns {THREE.BufferGeometry} non-indexed, with position/normal/color.
 */
export function draftedBox({ size = 1, edge = EDGE_WIDTH, tones = PALETTE, ink } = {}) {
  const h = size / 2;
  // A rail wider than the half-cell would invert the panel. Clamped, not trusted.
  const e = Math.min(Math.max(edge, 0), h * 0.5);

  const cInk = new THREE.Color(ink ?? tones.ink ?? PALETTE.ink);
  const palette = {
    top:   new THREE.Color(tones.top   ?? tones.faceTop   ?? PALETTE.faceTop),
    left:  new THREE.Color(tones.left  ?? tones.faceLeft  ?? PALETTE.faceLeft),
    right: new THREE.Color(tones.right ?? tones.faceRight ?? PALETTE.faceRight),
  };

  const pos = [], nor = [], col = [];

  for (const f of FACES) {
    const tone = faceTone(f.n[0], f.n[1], f.n[2], palette);

    const corner = (u, v) => [
      f.n[0] * h + f.t1[0] * u + f.t2[0] * v,
      f.n[1] * h + f.t1[1] * u + f.t2[1] * v,
      f.n[2] * h + f.t1[2] * u + f.t2[2] * v,
    ];
    const quad = (u0, v0, u1, v1, c) => {
      const a = corner(u0, v0), b = corner(u1, v0), d = corner(u1, v1), g = corner(u0, v1);
      for (const p of [a, b, d, a, d, g]) {
        pos.push(p[0], p[1], p[2]);
        nor.push(f.n[0], f.n[1], f.n[2]);
        col.push(c.r, c.g, c.b);
      }
    };

    quad(-h + e, -h + e, h - e, h - e, tone);   // tone panel
    quad(-h, -h, h, -h + e, cInk);              // rail: bottom
    quad(-h, h - e, h, h, cInk);                // rail: top
    quad(-h, -h + e, -h + e, h - e, cInk);      // rail: left
    quad(h - e, -h + e, h, h - e, cInk);        // rail: right
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  return g;
}

// =====================================================================
//  ROTATION TRANSITIONS — orbit the camera, never interpolate the world
// =====================================================================
/**
 * THE CONSTRAINT THAT DECIDES THIS DESIGN
 *
 * World rotation is four discrete quarter-turn states. It cannot be
 * interpolated: src/geometry is built on integer lattice positions, and the
 * screen-position invariant
 *
 *     a = x - z        b = x + z - 2y
 *
 * is only a complete invariant for integers. A cell at a fractional coordinate
 * has no exact screen identity, so `visibility()` could not decide which of two
 * aliased cells is in front — the resolution would become a float comparison
 * with an epsilon, i.e. exactly the nondeterminism the project forbids. Halfway
 * through a rotation the illusion would not be "partly there"; it would be
 * undefined.
 *
 * So nothing in the world moves. The CAMERA moves.
 *
 * THE IDENTITY THIS RESTS ON
 *
 * src/geometry rotates a cell with `rotateY`, which is Ry(+90 deg) about the
 * world Y axis THROUGH THE ORIGIN:  (x,y,z) -> (z, y, -x).
 *
 * Rotating every point of a scene by R and rotating the camera pose by R^-1 are
 * the same transform of view space:
 *
 *     view = (R^-1 C)^-1 = C^-1 R      applied to p   ==    V0 (R p)
 *
 * So ONE world turn (+1) is EXACTLY a camera orbit of -90 deg about the same
 * axis. Same pixels, by construction, not by tuning. Two consequences:
 *
 *   - CAMERA_TURN_SIGN is -1, and it is derivable, not tasted. There is a unit
 *     test that projects a cell both ways and asserts the screen positions
 *     agree (src/render/camera.test.js).
 *   - The orbit pivot MUST be the axis `rotateY` uses — the world origin, not
 *     the structure's centroid. Orbiting about the centroid differs from the
 *     equivalent camera pose by the translation (C - R C), which is zero at the
 *     start of the sweep and 5 world units at the end: a 5-unit lateral pop at
 *     the exact moment the transition is supposed to disappear. `orbitPivot` is
 *     exposed so that if src/world ever rotates about something else, this
 *     moves with it. They must agree.
 *
 * WHERE THE DISCRETE SWAP HAPPENS: AT THE END. See the note on `_commit`.
 *
 * THE TONE CONVENTION — RESOLVED, AND THE NUMBERS THAT RESOLVED IT
 *
 * The history. Face tone is baked by world-facing direction, and src/world used
 * to write TRANSLATION-ONLY instance matrices. A world turn therefore left tone
 * fixed relative to the screen, while a camera orbit carried tone around with
 * the geometry. Both are internally coherent conventions; they simply disagree,
 * and the disagreement lands entirely on the frame the orbit commits.
 *
 * Measured HERE, 1600x1000, `hero`, one +1 transition, avatar visible, last
 * orbit frame vs commit frame, tools/imagediff.mjs strict:
 *
 *   BEFORE, translation-only instances .......  3.1891% changed, maxDelta 48
 *   AFTER,  rigid-rotation instances .........  0%,             maxDelta 0
 *
 * (48 was exactly |faceLeft.r - faceRight.r| in the previous palette, i.e. the
 * whole residual was the tone families exchanging sides and none of it was the
 * avatar, silhouette, depth resolution or rasterisation.)
 *
 * THE CHOICE: (A) LIGHT FIXED IN THE WORLD. src/world composes the exact
 * quarter turn into the instance matrix, so a world turn is a true rigid
 * rotation of a solid and its shading turns with it — which is what the camera
 * orbit already assumed. Three reasons, in order of weight:
 *
 *   1. IT IS WHAT THE DRAWING CLAIMS. The register here is a rigorous drawing of
 *      a solid, and the whole tension of the piece is that the solid cannot
 *      exist. The impossibility has to come from the PROJECTION and from nowhere
 *      else. If the shading slides across the object's own faces as the object
 *      turns, the object reads as a flat graphic being manipulated, and the
 *      viewer stops crediting the drawing as a depiction of a solid before the
 *      geometry ever gets a chance to lie to them. Spend the rigour on the
 *      solid; spend the impossibility on the projection.
 *   2. IT COSTS NOTHING. One line, no per-frame work, no repaint, no second
 *      program, no extra draw call. Convention (B) held THROUGH the orbit needs
 *      tone to be a function of the VIEW-space normal, which is either a
 *      per-frame CPU repaint of the colour buffer for every orbit frame or a lit
 *      material — and a lit material would also modulate the inked rails, so the
 *      line weight of the drawing would change from face to face. That is not a
 *      cost worth paying to keep a key light still.
 *   3. THE PALETTE PAYS DOWN ITS COST. (A)'s stated cost is that the apparent
 *      key-light direction differs between rotation states. Measured, same
 *      method, capturing rot1/rot2/rot3 under (A) and under (B) and diffing:
 *
 *        rot1 ...  6.9134% changed, maxDelta 58
 *        rot2 ...  0%,              maxDelta 0
 *        rot3 ...  7.0716% changed, maxDelta 54
 *
 *      Three things that says. Rotation 2 is FREE — a half turn maps +-x onto
 *      -+x and +-z onto -+z, so the tone families are preserved and the two
 *      conventions are bit-identical there. Only the odd states differ, and what
 *      differs is exactly the mid and dark side values exchanging sides: mean
 *      delta over the whole frame is 2.19, and 2.19/0.069 = 31.7 per changed
 *      pixel, against a faceLeft/faceRight step of 33/31/29 per channel. The
 *      maxDelta of 54-58 is 10 pixels out of 1.6 million, all of them
 *      antialiased ink/paper edge blends resolved in linear space. So the cost
 *      is a 12% value step swapping sides on two of four views — real, visible
 *      if you A/B it, and far below the threshold at which the drawing stops
 *      reading, because in this palette the form is carried by the inked
 *      delineation and by the top-vs-side value break, not by left-vs-right.
 *      A high-chroma or high-contrast side pair would have made (A) expensive.
 *      That is the coupling: the palette choice is what makes the tone-convention
 *      choice affordable, which is why they are one decision and not three.
 *
 * WHAT (A) COSTS THE AVATAR, AND WHAT WAS DONE ABOUT IT. The pawn is not carried
 * by the world turn, so under (A) a pawn with two distinct side values would be
 * lit from the opposite side to the cells around it in the odd rotation states.
 * Its two side tones are therefore EQUAL (src/player), which makes it
 * rotation-invariant and reads correctly for what it is — the marker on the
 * drawing, not another solid. Stated as a cost because it is one: the pawn has
 * two values where everything else has three.
 *
 * THE AVATAR VIEW BIAS residual (0.24%, max 228) was fixed earlier, in
 * src/player: it pushed the avatar t steps along world (1,1,1) to win the depth
 * test, which is a screen no-op only on-axis, so off-axis it read as a diagonal
 * displacement and snapped back at the commit. src/player now polls
 * `ctx.peek('render').transitionState().active` and takes a bias of 0 for the
 * duration of an orbit. Cost, measured: at loop-01's start cell the avatar is
 * honestly occluded for the first 6 frames of the orbit (100 ms); at the other 9
 * standable cells the bias was already 0 and nothing changes.
 *
 * With both resolved, the end-swap is not merely defensible, it is INVISIBLE:
 * changedPct 0, maxDelta 0 on the frame the illusion resolves.
 */

/** One quarter turn. */
export const TURN_RADIANS = Math.PI / 2;

/**
 * Camera azimuth per +1 world turn. Negative because the camera must apply the
 * INVERSE of the world's rotation to produce the same image. Verified by test,
 * not asserted.
 */
export const CAMERA_TURN_SIGN = -1;

/** Seconds one quarter-turn orbit takes. Multiplied by dt only. */
export const ORBIT_SECONDS = 0.45;

/**
 * Quarter turns that may sit in the queue behind the one in flight. Four turns
 * is the identity, so anything past three is a longer route than going the
 * other way and is dropped rather than buffered.
 */
export const MAX_QUEUED_TURNS = 3;

const ORBIT_AXIS = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);
const ORIGIN = /* @__PURE__ */ new THREE.Vector3(0, 0, 0);
const _q = /* @__PURE__ */ new THREE.Quaternion();

/**
 * Smootherstep, 6u^5 - 15u^4 + 10u^3. Zero first AND second derivative at both
 * ends. Over a 90 degree sweep, smoothstep's nonzero endpoint acceleration is
 * visible as a small kick on the frame the illusion resolves, which is the one
 * frame that has to look settled. Pure function of u — no state, no clock.
 */
export function smootherstep(u) {
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * One quarter-turn camera orbit.
 *
 * Deliberately DOM-free and renderer-free so it can be unit tested in node, and
 * deliberately absolute rather than incremental: every frame recomputes the
 * pose from the SAVED START POSE and the current progress. Accumulating a small
 * rotation onto the live camera each frame would drift, and drift means the
 * pose at u=1 is no longer bit-equal to the pose the swap restores.
 *
 * The only clock is the dt handed to `advance()`.
 */
export class CameraOrbit {
  constructor({ position, quaternion, delta = 1, fromTurns = 0, duration = ORBIT_SECONDS } = {}) {
    /** Pose the orbit started from. Restored verbatim when it completes. */
    this.startPosition = new THREE.Vector3().copy(position ?? ORIGIN);
    this.startQuaternion = new THREE.Quaternion().copy(quaternion ?? new THREE.Quaternion());
    /** Quarter turns this orbit commits, signed. */
    this.delta = Math.trunc(delta) || 1;
    /** World rotation state this orbit started from. The commit target is from+delta. */
    this.fromTurns = fromTurns | 0;
    this.duration = Number.isFinite(duration) && duration > 0 ? duration : ORBIT_SECONDS;
    /** Seconds accumulated from ctx.time.dt. Never a timestamp. */
    this.elapsed = 0;
  }

  /** Linear progress in [0,1]. */
  get progress() {
    return Math.min(this.elapsed / this.duration, 1);
  }

  get done() {
    return this.elapsed >= this.duration;
  }

  /** Signed camera azimuth, radians, at the current progress. */
  get angle() {
    return CAMERA_TURN_SIGN * this.delta * TURN_RADIANS * smootherstep(this.progress);
  }

  /** Advance by seconds. Non-finite or negative dt is ignored, never trusted. */
  advance(dt) {
    if (Number.isFinite(dt) && dt > 0) this.elapsed += dt;
    return this;
  }

  /**
   * Write the pose for the current progress onto a camera.
   *
   * At progress 0 this is bit-identical to the start pose: setFromAxisAngle(_,0)
   * is exactly the identity quaternion, and multiplying by it is exact in
   * floating point. So beginning an orbit moves no pixels on the frame it
   * begins.
   */
  applyTo(camera, pivot = ORIGIN) {
    _q.setFromAxisAngle(ORBIT_AXIS, this.angle);
    camera.position.copy(this.startPosition).sub(pivot).applyQuaternion(_q).add(pivot);
    camera.quaternion.copy(this.startQuaternion).premultiply(_q);
    return camera;
  }

  /** Put the camera back exactly where the orbit found it. */
  restore(camera) {
    camera.position.copy(this.startPosition);
    camera.quaternion.copy(this.startQuaternion);
    return camera;
  }

  /** Restart from phase zero without changing the destination. */
  rewind() {
    this.elapsed = 0;
    return this;
  }
}

export default {
  name: 'render',

  /**
   * The palette, exposed as a READ on the subsystem instance.
   *
   * ARCHITECTURE.md §3.3 permits exactly one direct reach between subsystems:
   * `ctx.peek(name)`. `src/world` is declared coupled with render and imports
   * PALETTE directly; `src/ui` is declared independent and must not, so it
   * reads this instead of duplicating the hexes or importing this module.
   */
  palette: PALETTE,

  async init(ctx) {
    const { config } = ctx;
    this._ctx = ctx;

    this.canvas = document.createElement('canvas');
    document.body.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      // Screenshots read a composited frame; preserving the buffer removes any
      // dependence on when the compositor happens to sample. Capture only —
      // it costs bandwidth we do not want to pay during a profile run.
      preserveDrawingBuffer: config.capture,
      powerPreference: 'high-performance',
    });

    // NEVER read devicePixelRatio in capture mode — the harness fixes the
    // device scale factor, and reading it here would make output depend on the
    // machine rather than on the frame index.
    this.renderer.setPixelRatio(config.capture ? 1 : Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.setClearColor(PALETTE.bg, 1);

    this.scene = new THREE.Scene();

    // True isometric: orthographic projection with the camera on the (1,1,1)
    // diagonal gives equal foreshortening on all three axes, which is the
    // precondition for the projection-collapse trick the geometry subsystem
    // will rely on.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.set(30, 30, 30);
    this.camera.lookAt(0, 0, 0);
    this.frustumSize = 26;

    this._initTransitions(ctx);

    this._resize();
    this._onResize = () => this._resize();
    globalThis.addEventListener('resize', this._onResize);

    ctx.engine.scene = this.scene;
    ctx.engine.camera = this.camera;
  },

  /**
   * Rotation-transition state and its event wiring.
   *
   * Split out of init() so it can be exercised with no WebGL context and no
   * DOM: src/render/camera.test.js builds a rig with Object.create(render), a
   * bare OrthographicCamera and a stub ctx, then calls this. The tests
   * therefore drive the SAME wiring the engine does rather than a copy of it.
   */
  _initTransitions(ctx) {
    this._ctx = ctx;

    /**
     * Vertical axis the camera orbits. MUST match the axis src/geometry's
     * rotateY uses, which is the world origin — see the note above.
     */
    this.orbitPivot = new THREE.Vector3(0, 0, 0);
    /** Seconds per quarter turn. Tunable; never read from a clock. */
    this.orbitSeconds = ORBIT_SECONDS;
    /** The orbit in flight, or null. */
    this._orbit = null;
    /** Signed quarter turns waiting behind it. */
    this._pending = 0;
    /** True only inside our own setRotation call, so we do not self-abort. */
    this._committing = false;

    /**
     * If anything else rotates the world while an orbit is in flight — a dev
     * shot, a level reset — the end-swap this orbit promised is stale. Abandon
     * it and put the camera back rather than committing a turn the world has
     * already taken.
     */
    ctx.on('world/rotated', () => {
      if (!this._committing) this.cancelTransition();
    });
    ctx.on('level/loaded', () => this.cancelTransition());
    /**
     * Preferred integration seam (ARCHITECTURE.md §3.3: subsystems talk through
     * events, never imports). Inert until something emits it; src/ui rotating
     * through this instead of calling world.setRotation directly is what turns
     * the snap into a transition. Payload: `{ delta }` or a bare integer.
     */
    ctx.on('world/rotate-request', (payload) =>
      this.requestRotation(typeof payload === 'number' ? payload : payload?.delta ?? 1));
  },

  _resize() {
    const w = globalThis.innerWidth, h = globalThis.innerHeight;
    const aspect = w / h;
    const s = this.frustumSize;
    this.camera.left = (-s * aspect) / 2;
    this.camera.right = (s * aspect) / 2;
    this.camera.top = s / 2;
    this.camera.bottom = -s / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  },

  // ------------------------------------------------------------ transitions

  /**
   * Ask for `delta` quarter turns of world rotation, as camera orbits.
   *
   * Each quarter turn is its own orbit that begins and ends on the isometric
   * axis, because every intermediate rotation state is a legal game state and
   * deserves to be seen resolved — sweeping 180 degrees in one go would skip
   * past a state the player may have wanted.
   *
   * Requests arriving during an orbit are queued rather than interrupting it.
   * Interrupting means either jumping to the target state (a visible pop of up
   * to 90 degrees) or unwinding a partly-committed turn; a 0.45 s wait is
   * better than both. Opposite-signed requests cancel queued ones, so Q then E
   * nets to nothing.
   *
   * @returns {boolean} whether the request changed anything.
   */
  requestRotation(delta = 1) {
    const n = Math.trunc(Number(delta));
    if (!Number.isFinite(n) || n === 0) return false;

    const before = this._pending;
    const want = this._pending + n;
    this._pending = Math.max(-MAX_QUEUED_TURNS, Math.min(MAX_QUEUED_TURNS, want));
    if (this._pending === before) return false;

    if (!this._orbit) this._drain();
    return true;
  },

  /** Abandon any orbit in flight, restore the camera, drop the queue. */
  cancelTransition() {
    this._pending = 0;
    if (!this._orbit) return false;
    this._orbit.restore(this.camera);
    this._orbit = null;
    return true;
  },

  /** Read-only transition state. Frame-derived only — nothing wall-clock. */
  transitionState() {
    const o = this._orbit;
    return {
      active: o !== null,
      delta: o ? o.delta : 0,
      from: o ? o.fromTurns : null,
      to: o ? (((o.fromTurns + o.delta) % 4) + 4) % 4 : null,
      progress: o ? o.progress : 0,
      queued: this._pending,
    };
  },

  /**
   * Per-frame. ctx.time.dt is the ONLY clock consulted in this subsystem.
   *
   * When no orbit is in flight this touches nothing — which is what keeps the
   * dev shots working: they set `camera.position` / `camera.lookAt` directly and
   * nothing here overwrites them.
   */
  update(ctx) {
    const orbit = this._orbit;
    if (!orbit) return;

    orbit.advance(ctx.time.dt);

    if (orbit.done) this._commit(ctx, orbit);
    else orbit.applyTo(this.camera, this.orbitPivot);
  },

  /**
   * THE SWAP HAPPENS AT THE END OF THE ORBIT. This is the whole argument:
   *
   * The camera arriving at start + (-90 deg) with the world still at T renders
   * the SAME image as the camera back at start with the world at T+1 — that is
   * the identity at the top of this section. So the discrete state change can
   * be applied at exactly the moment the camera completes the arc, together
   * with an exact restore of the saved start pose, and the picture does not
   * move. The frame this runs on is rendered once, in the destination state.
   *
   * The alternatives both put the discrete state ahead of the picture:
   *
   *   START. To keep the image continuous, swapping at the start also has to
   *   teleport the camera back by -delta. The pixels are then the same as the
   *   end-swap's, but for the entire orbit `world.turns` is T+1 while the frame
   *   the player is looking at is the T arrangement — and at u=0 that frame is
   *   ON-AXIS and fully resolved, so it reads as authoritative. Everything that
   *   consumes `world.turns` — pathGraph, visibility, the avatar's occlusion
   *   bias, the HUD pips — is answering questions about a configuration the
   *   player has not been shown. A step accepted at u=0.1 resolves against
   *   edges with no visual evidence. That is the damaging sense of "the
   *   illusion is broken": not a structure that visibly comes apart off-axis,
   *   which is honest, but an on-axis frame whose picture and whose rules
   *   disagree.
   *
   *   MIDPOINT. Strictly worse. Either the structure takes a hard 90-degree
   *   apparent cut at u=0.5, or you teleport the camera to hide it — which is
   *   all the work of the end-swap plus one more discontinuity to get right,
   *   and still leaves half a transition where logic leads picture. It does not
   *   even shorten the off-axis interval: peak deviation from the nearest
   *   isometric axis is 45 degrees either way.
   *
   *   The honest counter-argument, stated because it is real: while the face
   *   tones are baked to world axes (residual 1 above), the swap frame carries
   *   a visible tone exchange, and the end is the WORST place to put it —
   *   everything has just resolved, so the eye is on it. Mid-orbit, at peak
   *   disassembly, it would hide better. That is still not a reason to move the
   *   swap. It would buy a temporary cosmetic win by permanently desynchronising
   *   state from picture for half of every transition, to camouflage a defect
   *   that is one line from being fixed — and once fixed, the end-swap is
   *   provably clean, which the control capture above already demonstrates.
   *
   * The end-swap is also the fail-safe direction. An orbit abandoned partway
   * (level reload, a dev shot, an opposing rotate) has committed nothing: the
   * world is still at T and the camera restores to a pose that was always
   * valid. A start-swap that is abandoned must be UNDONE, which is a second
   * discrete write in the one place it must not go wrong.
   *
   * What the player does see broken is the interval u in (0,1), where the
   * camera is genuinely off the isometric axis and the aliased cells separate.
   * That is not a defect being hidden — it is the same thing the `offaxis` shot
   * exists to show, and it resolves exactly at both ends.
   */
  _commit(ctx, orbit) {
    // Restore and clear BEFORE the world write: setRotation emits
    // world/rotated, our own listener would otherwise cancel an orbit that has
    // already succeeded.
    orbit.restore(this.camera);
    this._orbit = null;

    this._committing = true;
    try {
      // setRotation normalises, so from+delta is safe for negative deltas.
      ctx.peek('world')?.setRotation?.(orbit.fromTurns + orbit.delta);
    } finally {
      this._committing = false;
    }

    this._drain();
  },

  /** Start the next queued quarter turn, if any. */
  _drain() {
    if (this._orbit || this._pending === 0) return false;
    const step = this._pending < 0 ? -1 : 1;
    this._pending -= step;

    const world = this._ctx?.peek?.('world');
    this._orbit = new CameraOrbit({
      position: this.camera.position,
      quaternion: this.camera.quaternion,
      delta: step,
      fromTurns: Number.isInteger(world?.turns) ? world.turns : 0,
      duration: this.orbitSeconds,
    });
    // Progress 0 reproduces the start pose exactly, so this moves nothing.
    this._orbit.applyTo(this.camera, this.orbitPivot);
    return true;
  },

  /**
   * Drop any temporal history so accumulation restarts from a known phase.
   * tools/baseline.mjs calls this before pumping.
   *
   * A camera orbit IS temporal history, so it is rewound to phase zero here —
   * not cancelled. Rewinding matches the documented contract ("restarts from a
   * known phase") and keeps a future mid-transition shot capturable: a shot may
   * request a rotation, and the captured frame is then a pure function of the
   * settle count. Cancelling would silently make such a shot impossible.
   *
   * There is still no TAA or exposure adaptation. When a post chain lands, ITS
   * HISTORY MUST BE DROPPED HERE TOO — a silent no-op would let history leak
   * between shots and quietly destroy gate reproducibility.
   */
  resetTemporal() {
    if (this._orbit) this._orbit.rewind().applyTo(this.camera, this.orbitPivot);
  },

  draw(ctx) {
    this.renderer.render(this.scene, this.camera);
  },

  info() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      programs: i.programs?.length ?? 0,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  },

  dispose() {
    globalThis.removeEventListener('resize', this._onResize);
    this._orbit = null;
    this._pending = 0;
    this.renderer.dispose();
    this.canvas.remove();
  },
};
