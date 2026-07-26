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
   * the correct way to make this feel continuous, and belongs to P2.
   */
  _applyRotation() {
    const m = new THREE.Matrix4();
    const startId = cellId(...this.level.start);
    const goalId = cellId(...this.level.goal);
    const accent = new THREE.Color(PALETTE.accent);

    this.level.cells.forEach((cell, i) => {
      const [x, y, z] = rotateY(cell, this.turns);
      m.makeTranslation(x * CELL, y * CELL, z * CELL);
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
