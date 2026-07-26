import * as THREE from 'three';
import { paintByNormal, PALETTE } from '../render/index.js';
import { Structure, rotateY, cellId } from '../geometry/index.js';
import { LEVELS, DEFAULT_LEVEL } from './levels.js';

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
 * THE FOUR QUARTER-TURN MATRICES, WITH EXACT ENTRIES.
 *
 * src/geometry's rotateY sends (x,y,z) -> (z,y,-x), so the +1 matrix maps
 * e_x -> -e_z, e_y -> e_y, e_z -> +e_x. Written out longhand instead of built
 * with `makeRotationY(turns * PI/2)` for one reason: cos(PI/2) in IEEE-754 is
 * 6.123233995736766e-17, not 0. That residue is far below the precision of the
 * float32 instanceMatrix it would be written into and would round away — but
 * "it rounds away" is an argument, and an exact integer matrix is a proof. In a
 * project whose gate demands bit identity, prefer the proof.
 *
 * THIS IS THE TONE CONVENTION. Composing a rotation into the instance matrix is
 * what makes a world turn a true RIGID rotation instead of a re-translation:
 * the face tones paintByNormal baked onto the box's local normals now travel
 * with the cell, so "the light is fixed in the world" holds, and a world turn
 * becomes pixel-identical to the equivalent camera orbit. Before this, a turn
 * moved the cells but left the tones glued to the screen, and the two disagreed
 * on exactly the frame the orbit committed — 3.1891% of pixels, maxDelta 48,
 * which was precisely |faceLeft.r - faceRight.r|. It is now maxDelta 0. See the
 * long note in src/render for why (A) and not (B).
 */
export const TURN_MATRICES = /* @__PURE__ */ (() => {
  const step = new THREE.Matrix4().set(
    0, 0, 1, 0,
    0, 1, 0, 0,
    -1, 0, 0, 0,
    0, 0, 0, 1,
  );
  const out = [new THREE.Matrix4()];
  for (let t = 1; t < 4; t++) out.push(new THREE.Matrix4().multiplyMatrices(step, out[t - 1]));
  return out;
})();

export default {
  name: 'world',

  async init(ctx) {
    this._ctx = ctx;
    const name = ctx.config.level && LEVELS[ctx.config.level] ? ctx.config.level : DEFAULT_LEVEL;
    this.level = LEVELS[name];
    this.structure = new Structure(this.level.cells);
    this.turns = 0;

    const box = paintByNormal(new THREE.BoxGeometry(CELL, CELL, CELL));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });

    this.mesh = new THREE.InstancedMesh(box, material, this.level.cells.length);
    this.mesh.frustumCulled = false;

    // instanceColor multiplies the geometry's per-face vertex colours, so white
    // leaves the three-tone read intact and a tint marks a cell without
    // introducing a second material or a second draw call.
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.level.cells.length * 3).fill(1), 3);

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
   * the correct way to make this feel continuous, and src/render does that.
   *
   * The transform is ROTATE-then-TRANSLATE. The rotation is what carries the
   * baked face tones around with the cell (see TURN_MATRICES); the translation
   * places the rotated cell, and comes from src/geometry's rotateY so that the
   * drawn position can never disagree with the position the path graph and the
   * visibility test are computed from. Both halves are exact integers, so the
   * instance matrix is exact.
   */
  _applyRotation() {
    const m = new THREE.Matrix4();
    const startId = cellId(...this.level.start);
    const goalId = cellId(...this.level.goal);
    const accent = new THREE.Color(PALETTE.accent);

    this.level.cells.forEach((cell, i) => {
      const [x, y, z] = rotateY(cell, this.turns);
      m.copy(TURN_MATRICES[this.turns]);
      m.setPosition(x * CELL, y * CELL, z * CELL);
      this.mesh.setMatrixAt(i, m);

      const id = cellId(...cell);
      const tint = (id === startId || id === goalId) ? accent : null;
      this.mesh.instanceColor.setXYZ(i, tint ? tint.r : 1, tint ? tint.g : 1, tint ? tint.b : 1);
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
    this.mesh?.geometry.dispose();
    this.mesh?.material.dispose();
  },
};

export { PALETTE };
