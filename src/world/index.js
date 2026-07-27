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
    this.mesh.frustumCulled = false;

    // instanceColor multiplies the geometry's per-face vertex colours, so white
    // leaves the three-tone read intact and a tint marks a cell without
    // introducing a second material or a second draw call. It is also how ink
    // density, the knockout marker and the misregistered plate are all paid for
    // out of the same buffer — see _applyRotation.
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(instances * 3).fill(1), 3);

    this._applyRotation();
    ctx.engine.scene.add(this.mesh);

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
    const startId = cellId(...this.level.start);
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
      const knock = (id === startId || id === goalId) ? INK.knockout : ONE;

      this.mesh.instanceColor.setXYZ(i, d * knock[0], d * knock[1], d * knock[2]);
      this.mesh.instanceColor.setXYZ(n + i,
        g * knock[0] * INK.ghost[0],
        g * knock[1] * INK.ghost[1],
        g * knock[2] * INK.ghost[2]);
    });

    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
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
