import * as THREE from 'three';
import { paintByNormal, PALETTE, INK, valueNoise3, TURN_RADIANS } from '../render/index.js';
import { Structure, rotateY, cellId } from '../geometry/index.js';
import { LEVELS, DEFAULT_LEVEL, ORDER } from './levels.js';

/**
 * Draws a level.
 *
 * This subsystem owns geometry placement and nothing else. It does not decide
 * what is visible or what connects — src/geometry does, from the level data, and
 * this reads the answer. Keeping that split means a level's solvability can be
 * checked (tools/analyze.mjs) without a renderer existing at all.
 */

const CELL = 1.0;

/**
 * Impressions per cell: the plate, then the misregistered second pass.
 *
 * Both live in the SAME InstancedMesh, so the off-register costs exactly zero
 * additional draw calls and zero additional programs — it is 16 more instances
 * on a buffer that was already there.
 */
const IMPRESSIONS = 2;

/** Neutral instance tint. Hoisted so _applyRotation allocates nothing. */
const ONE = [1, 1, 1];

/**
 * Scale of the misregistered second impression. Full height — the -Y drop is
 * what makes it show — but pulled in on x and z so its side faces are not
 * coplanar with the first impression's. See INK.ghostInset.
 */
const GHOST_SCALE = /* @__PURE__ */ new THREE.Vector3(
  1 - 2 * INK.ghostInset / CELL, 1, 1 - 2 * INK.ghostInset / CELL);

/**
 * The goal marker: a flat ring printed on the goal cell's floor.
 *
 * A LIGHTER TILE IS NOT A DESTINATION. The knockout on its own says "this block
 * printed differently"; it does not say "go here", and a player five moves into
 * level 3 with the HUD visible could not find it. This is a SHAPE, and shape is
 * the one channel the riso direction leaves free — the palette is fixed at
 * three structure inks, the avatar's green, and the paper.
 *
 * Green, because that is already the avatar's ink. The reading it buys is
 * immediate and needs no legend: green solid is you, green outline is where you
 * are going.
 *
 * Sized and placed to sit exactly where the avatar's feet would land, so it
 * reads as a footprint rather than as decoration on a nearby surface — src/player
 * translates its pawn to y = -0.5 for the same reason.
 */
const MARKER = {
  inner: 0.26,
  outer: 0.40,
  segments: 4,
  /** Riso Green, matching src/player's AVATAR.left/right exactly. */
  ink: 0x00a95c,
  /**
   * Clear of the floor by more than the depth buffer can confuse, and by far
   * less than a cell. src/render measures 24-bit depth over a 0.1..200 ortho
   * range at 1.19e-5 world units per step, so 0.01 is ~840 steps of headroom —
   * the same argument INK.ghostInset makes, and for the same reason: coplanar
   * surfaces z-fight and read as dirt.
   */
  lift: 0.01,
};

/**
 * A four-segment ring lying flat, coloured a single solid ink.
 *
 * The colour is baked into a vertex attribute rather than set on the material,
 * because MeshBasicMaterial{vertexColors} + InstancedMesh + instanceColor is the
 * exact parameter set the level kit and the avatar already use, and three.js
 * hands back the cached program instead of compiling a second one. A material
 * that declares vertexColors without supplying them renders BLACK — src/render's
 * paper quad documents the same trap.
 */
function markerGeometry() {
  const g = new THREE.RingGeometry(MARKER.inner, MARKER.outer, MARKER.segments);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI / 4);
  g.translate(0, -0.5 + MARKER.lift, 0);
  const c = new THREE.Color(MARKER.ink);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export default {
  name: 'world',

  async init(ctx) {
    this._ctx = ctx;
    /**
     * The campaign order, exposed for src/campaign to READ via ctx.peek.
     *
     * ARCHITECTURE.md §3.3 lets subsystems reach each other only through
     * ctx.peek for a read, so the sequencing subsystem cannot import
     * ./levels.js — that file lives inside this subsystem. The order is data,
     * so it lives with the level data and is published here.
     */
    this.order = ORDER;
    const name = ctx.config.level && LEVELS[ctx.config.level] ? ctx.config.level : DEFAULT_LEVEL;
    this._install(name, ctx);

    /**
     * Load a different level at runtime.
     *
     * A REQUEST event, not a direct call, for the same reason `world/rotate-request`
     * is: the asker (src/campaign) decides WHEN, this subsystem decides HOW, and
     * ARCHITECTURE.md §3.3 stays intact because neither imports the other.
     */
    ctx.on('level/load-request', (payload) =>
      this.loadLevel(typeof payload === 'string' ? payload : payload?.name, ctx));
  },

  /**
   * Swap in a level, disposing whatever was there.
   *
   * The InstancedMesh is sized to the level's cell count, so a level change is a
   * rebuild rather than a re-fill. That is the right trade: it happens once per
   * completed puzzle and never per frame, whereas sizing one buffer to the largest
   * level would make every level pay that cost in instances and in instanceColor
   * upload, forever.
   *
   * @returns {boolean} whether a level was loaded
   */
  loadLevel(name, ctx = this._ctx) {
    if (!name || !LEVELS[name]) return false;
    this._teardownMesh();
    this._install(name, ctx);
    return true;
  },

  /** Release the current mesh's GPU resources. Leaking here grows every level change. */
  _teardownMesh() {
    // The marker is disposed alongside the level kit, not conditionally on it —
    // loadLevel rebuilds both, and leaking either grows on every level change.
    if (this.marker) {
      this.marker.removeFromParent();
      this.marker.geometry.dispose();
      this.marker.material.dispose();
      this.marker = null;
    }
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh = null;
  },

  /** Build the mesh for `name` and announce it. Shared by init and loadLevel. */
  _install(name, ctx = this._ctx) {
    this.level = LEVELS[name];
    this.structure = new Structure(this.level.cells);
    this.turns = 0;

    const box = paintByNormal(new THREE.BoxGeometry(CELL, CELL, CELL));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });

    const instances = this.level.cells.length * IMPRESSIONS;
    this.mesh = new THREE.InstancedMesh(box, material, instances);
    // Named like src/player's 'avatar' and src/render's 'paper'. This one had no
    // name, which meant the leak guard in loadlevel.test.js could only count
    // instanced meshes rather than identify them — and a count is satisfied by
    // two kits and no marker just as happily as by one of each.
    this.mesh.name = 'level-kit';
    this.mesh.frustumCulled = false;

    // instanceColor multiplies the geometry's per-face vertex colours, so white
    // leaves the three-tone read intact and a tint marks a cell without
    // introducing a second material or a second draw call. It is also how ink
    // density, the knockout marker and the misregistered plate are all paid for
    // out of the same buffer — see _applyRotation.
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(instances * 3).fill(1), 3);

    // Same parameter set as the level kit and the avatar, so this shares their
    // compiled program. Count of 1 looks odd until you notice that dropping the
    // instancing or the instanceColor changes the program cache key.
    this.marker = new THREE.InstancedMesh(
      markerGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), 1);
    this.marker.name = 'goal-marker';
    this.marker.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
    this.marker.frustumCulled = false;

    this._applyRotation();
    ctx.engine.scene.add(this.mesh);
    ctx.engine.scene.add(this.marker);

    ctx.engine.level = this.level;
    ctx.engine.structure = this.structure;

    ctx.emit('level/loaded', this.level);
  },

  /**
   * Rebuild instance transforms for the current rotation.
   *
   * Rotation is a discrete state, not an animation — the geometry subsystem's
   * whole model is integer lattice positions, and interpolating between them
   * would put cells at non-integer coordinates where the screen-position
   * invariant does not hold. Animating the CAMERA between the four states is
   * the correct way to make this feel continuous, and src/render does.
   *
   * ================= THE TONE CONVENTION, RESOLVED HERE =================
   *
   * This function used to write `makeTranslation`. A world quarter turn
   * therefore moved every cell to its rotated position but left every cell's
   * NORMALS — and so its baked face tones — pointing the way they always had.
   * That is not a rigid rotation of the scene, and the camera-orbit ==
   * world-turn identity src/render rests on is a statement about a RIGID
   * rotation. So the orbit carried tone around with the geometry while the
   * commit did not, and the two disagreed on exactly one frame: measured at
   * 3.1891% of pixels, maxDelta 48, which is exactly |faceLeft.r-faceRight.r|.
   *
   * Composing the rotation into the instance matrix is the fix, and under this
   * art direction it is not a trade-off at all — it is the only convention that
   * means anything.
   *
   * THE ARGUMENT, WHICH IS ABOUT INK AND NOT ABOUT LIGHT
   *
   * The alternative convention is "the light is fixed to the screen": tone is
   * keyed to a screen-space direction, so the key light never moves however the
   * object turns. That is coherent, and for a lit, rendered object it is
   * arguably the nicer one — every static view is lit identically.
   *
   * But this direction prints; it does not light. A face is Federal Blue
   * because the blue drum laid ink on it, and ink is a property of the object,
   * not of where the viewer is standing. Screen-fixed tone would mean the ink
   * migrates across the paper when you turn the emblem, which is not a stylised
   * lighting model — it is a physically meaningless one. So the ±x plate stays
   * the ±x plate through every quarter turn, and turning the object to an odd
   * rotation genuinely exchanges which plate you are looking at. That exchange
   * IS the picture changing, honestly, rather than a defect at the commit.
   *
   * The convention also costs nothing structurally, which the other one cannot
   * match: screen-fixed tone through a 90-degree orbit needs either a per-frame
   * vertex-colour repaint or a second shader program, and both are exactly the
   * regressions ARCHITECTURE.md §6 and the upstream postmortem warn about. This
   * is one extra matrix op per instance, at rotation time only.
   *
   * MEASURED CONSEQUENCE: the commit-frame delta goes 3.1891% / 48 -> 0% / 0.
   * The end-swap is now provably pixel-clean, which is what src/render's note
   * said would happen once this landed.
   */
  _applyRotation() {
    const m = new THREE.Matrix4();
    const goalId = cellId(...this.level.goal);
    const n = this.level.cells.length;
    const angle = this.turns * TURN_RADIANS;

    this.level.cells.forEach((cell, i) => {
      const [x, y, z] = rotateY(cell, this.turns);
      // See the block comment above: composing the rotation is what makes a world
      // turn a TRUE rigid rotation, so the turn and the camera orbit are the same
      // transform and the commit frame is pixel-identical to the frame before it.
      //
      // makeRotationY(+90deg) maps (x,y,z) -> (z,y,-x), which is exactly what
      // src/geometry's rotateY does to the position, so the two stay in step.
      //
      // Independently re-measured on this branch before the merge:
      //   before  changedPct 3.1891, maxDelta 48, identical false
      //   after   changedPct 0,      maxDelta 0,  identical true
      // maxDelta 48 was exactly |faceLeft.r - faceRight.r| = |0xd9 - 0xa9|, so
      // the whole residual was provably this and nothing else.
      m.makeRotationY(angle);
      m.setPosition(x * CELL, y * CELL, z * CELL);
      this.mesh.setMatrixAt(i, m);

      // The misregistered second impression. Displaced along -Y ONLY: -Y is the
      // orbit axis, so this offset survives both the camera orbit and the world
      // turn unchanged — the off-register can never slide, parallax or pop
      // during a rotation, which a screen-space or view-axis offset would. -Y
      // is also uniformly further from the camera under depth = x+y+z, so the
      // second impression can only show where the first does not already cover
      // it. No render order, no depth state, no second material.
      //
      // The x/z inset is what stops the two impressions' side faces being
      // coplanar; see INK.ghostInset for why that is not optional.
      m.makeRotationY(angle);
      m.scale(GHOST_SCALE);
      m.setPosition(x * CELL, y * CELL - INK.ghostDropY, z * CELL);
      this.mesh.setMatrixAt(n + i, m);

      // Ink density varies ACROSS THE SHEET — sampled from a smooth field at
      // the cell, not drawn independently per block.
      //
      // This used to be hash01(i), i.e. uncorrelated between neighbours, so
      // every cube boundary carried the full amplitude as a step and the seams
      // landed exactly on geometry edges. Three critic lenses independently
      // reported that as a rendering defect; it was the art direction. See
      // INK.densityWavelength for what this fixes and what it cannot.
      //
      // SAMPLED AT THE UNROTATED CELL, never at the rotated position. That is
      // load-bearing and it is the same constraint the old index-keying met:
      // a quarter turn must not reshuffle density, or the commit frame stops
      // being pixel-identical and the tone convention is back where it started.
      // Guarded by test/ink-invariance.test.js, which reads instanceColor at
      // all four rotation states and asserts they agree.
      const [cx, cy, cz] = cell;
      const d = 1 + (valueNoise3(cx, cy, cz, INK.densityWavelength, 0x51ed) - 0.5) * 2 * INK.densityJitter;
      const g = 1 + (valueNoise3(cx, cy, cz, INK.densityWavelength, 0x9a2b) - 0.5) * 2 * INK.densityJitter;

      const id = cellId(...cell);
      /**
       * THE GOAL ONLY. The start used to get the identical treatment, and that
       * was a legibility defect rather than a decoration: two tiles printed
       * exactly the same lighter pass, with nothing to say which was which.
       *
       * Found by watching someone play. Asked what the point of the game was,
       * where the goal was, and what the green thing was — on level 3 of 7,
       * five moves in, with the HUD visible. The panels had been scoring
       * `communication` lowest of five lenses since P9 and none of them located
       * this, because a lens reports a score and a player reports confusion.
       *
       * The start needs no marker. The avatar is standing on it.
       */
      const knock = (id === goalId) ? INK.knockout : ONE;

      this.mesh.instanceColor.setXYZ(i, d * knock[0], d * knock[1], d * knock[2]);
      this.mesh.instanceColor.setXYZ(n + i,
        g * knock[0] * INK.ghost[0],
        g * knock[1] * INK.ghost[1],
        g * knock[2] * INK.ghost[2]);
    });

    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;

    // The marker is placed HERE rather than once at install, because it has to
    // move with the world exactly as the cells do. A quarter turn relocates the
    // goal on screen, and a marker left at the unrotated position would drift
    // off its own cell — visible immediately, but only after a rotation, which
    // is the kind of defect a static shot cannot catch.
    //
    // The ring is rotationally symmetric about Y at these segment counts, so it
    // takes the position without composing the rotation; there is no tone baked
    // into it that a turn could put on the wrong side.
    if (this.marker) {
      const [gx, gy, gz] = rotateY(this.level.goal, this.turns);
      const gm = new THREE.Matrix4();
      /**
       * THE + 1 IS NOT AN ADJUSTMENT, IT IS THE CONVENTION.
       *
       * A cell in `level.cells` is a SOLID block, and an occupant stands on top
       * of it — so src/player's `_restPosition` returns `y + 1` and then offsets
       * its geometry to -0.5, landing the feet at y + 0.5, the block's top face.
       *
       * Placed at plain `y` the first time, which put this ring at y - 0.5: the
       * BOTTOM face of a solid block, buried inside it. It rendered nothing at
       * all while the HUD confidently told the player to walk to a green ring.
       * Caught by opening the capture, not by the 197 tests that stayed green.
       *
       * Matching `_restPosition` exactly is also what keeps the marker and the
       * avatar in the same place when the pawn arrives, rather than nearly.
       */
      gm.setPosition(gx * CELL, (gy + 1) * CELL, gz * CELL);
      this.marker.setMatrixAt(0, gm);
      this.marker.instanceMatrix.needsUpdate = true;
    }
  },

  setRotation(turns, ctx = this._ctx) {
    const from = this.turns;
    this.turns = ((turns % 4) + 4) % 4;
    this._applyRotation();
    if (from !== this.turns) ctx?.emit('world/rotated', { from, to: this.turns });
    return this.turns;
  },

  update(ctx) {
    // Static. Any motion added here MUST be driven from ctx.time
    // (ARCHITECTURE.md §1) — a wall-clock rotation would make every capture in
    // this repository non-reproducible.
  },

  dispose() {
    this._teardownMesh();
  },
};

export { PALETTE };
