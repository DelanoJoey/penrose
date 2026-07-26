import * as THREE from 'three';
import { draftedBox, PALETTE } from '../render/index.js';
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

export default {
  name: 'world',

  async init(ctx) {
    this._ctx = ctx;
    const name = ctx.config.level && LEVELS[ctx.config.level] ? ctx.config.level : DEFAULT_LEVEL;
    this.level = LEVELS[name];
    this.structure = new Structure(this.level.cells);
    this.turns = 0;

    // The cell kit. Tone panels and inked rails are one geometry, so the
    // delineation costs no second mesh, no second material and no second shader
    // program — see draftedBox in src/render.
    const box = draftedBox({ size: CELL });
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
   * the correct way to make this feel continuous, and src/render does.
   *
   * THE INSTANCE TRANSFORM IS A RIGID ROTATION, NOT A TRANSLATION. This is the
   * tone convention (A) decision — light fixed in the WORLD — and it is the one
   * line that resolves the swap on the rotation commit frame.
   *
   * Face tone is baked onto the cell's vertices by world-facing direction. If
   * the instance transform only translated, a world turn would move the cell but
   * leave its tones pointing at the same screen sides, while src/render's camera
   * orbit carries tone around with the geometry — the two disagree, and the
   * disagreement lands entirely on the frame the orbit commits (measured before
   * this change: 3.1891% of pixels, maxDelta 48 = |faceLeft.r - faceRight.r|).
   * Composing the quarter turn in makes a world turn a TRUE rigid rotation of a
   * solid: the object turns and its shading turns with it, exactly as the orbit
   * already assumed. The commit frame then agrees by construction, not by tuning.
   *
   * The rotation is written from exact integers rather than from
   * Matrix4.makeRotationY(turns * PI/2), whose cos(PI/2) is 6.1e-17 rather than
   * 0. The lattice is integer everywhere else; the transform that carries it has
   * no business introducing the project's first epsilon.
   */
  _applyRotation() {
    const m = new THREE.Matrix4();
    /**
     * THE ACCENT IS SPENT ON THE GOAL AND NOTHING ELSE.
     *
     * The start cell used to be tinted too. On a near-monochrome sheet with one
     * chromatic note, that put a second red mass on the plate — and a redundant
     * one, because the player's own marker is already standing on the start cell
     * in the same colour. Two adjacent red blocks at the figure's left tip read
     * as an area of colour rather than as an annotation. One cell, one pawn.
     */
    const goalId = cellId(...this.level.goal);
    const accent = new THREE.Color(PALETTE.accent);

    // Ry(t * 90deg), exactly. Matches src/geometry's rotateY: (x,y,z) -> (z,y,-x).
    const t = this.turns;
    const C = [1, 0, -1, 0][t];
    const S = [0, 1, 0, -1][t];

    this.level.cells.forEach((cell, i) => {
      const [x, y, z] = rotateY(cell, this.turns);
      m.set(
        C, 0, S, x * CELL,
        0, 1, 0, y * CELL,
        -S, 0, C, z * CELL,
        0, 0, 0, 1,
      );
      this.mesh.setMatrixAt(i, m);

      const tint = cellId(...cell) === goalId ? accent : null;
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
