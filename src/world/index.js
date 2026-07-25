import * as THREE from 'three';
import { paintByNormal, PALETTE } from '../render/index.js';

/**
 * P0 stub scene.
 *
 * A rising staircase loop, built HONESTLY — it genuinely climbs, so the ends do
 * not meet. Making the ends meet in projection while staying disjoint in 3D is
 * the actual problem, and it belongs to src/geometry in P1. Faking it here
 * would hide the work rather than do it.
 *
 * The purpose of this scene is to give the pixel gate something non-trivial to
 * be identical about: instanced geometry, three-tone face colour, hard silhouette
 * edges against the clear colour, and MSAA on every one of those edges.
 */

const STEP = 1.0;      // horizontal run per step
const RISE = 0.42;     // vertical rise per step
const PER_SIDE = 7;    // steps per side of the loop

export default {
  name: 'world',

  async init(ctx) {
    const rng = ctx.rng.fork('world/stub');

    const box = paintByNormal(new THREE.BoxGeometry(STEP, RISE * 2.2, STEP));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });

    const placements = [];

    // --- rising loop -----------------------------------------------------
    // Four sides, turning left at each corner, climbing the whole way.
    const dirs = [
      [1, 0], [0, 1], [-1, 0], [0, -1],
    ];
    let x = -PER_SIDE / 2, z = -PER_SIDE / 2, y = 0;

    for (let side = 0; side < 4; side++) {
      const [dx, dz] = dirs[side];
      for (let i = 0; i < PER_SIDE; i++) {
        placements.push([x, y, z]);
        x += dx * STEP;
        z += dz * STEP;
        y += RISE;
      }
    }

    // --- base platform ---------------------------------------------------
    const half = PER_SIDE / 2 + 1;
    for (let px = -half; px <= half; px++) {
      for (let pz = -half; pz <= half; pz++) {
        placements.push([px * STEP, -RISE * 3, pz * STEP]);
      }
    }

    // --- floating accents ------------------------------------------------
    // Deterministic: every value comes from the forked stream, never Math.random.
    for (let i = 0; i < 9; i++) {
      placements.push([
        rng.range(-9, 9),
        rng.range(4, 11),
        rng.range(-9, 9),
      ]);
    }

    const mesh = new THREE.InstancedMesh(box, material, placements.length);
    const m = new THREE.Matrix4();
    placements.forEach(([px, py, pz], i) => {
      m.makeTranslation(px, py, pz);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;

    this.mesh = mesh;
    this.instanceCount = placements.length;
    ctx.engine.scene.add(mesh);
  },

  update(ctx) {
    // Intentionally static in P0. Any motion added here MUST be driven from
    // ctx.time (ARCHITECTURE.md §1) — a wall-clock rotation would make every
    // capture in this repository non-reproducible.
  },

  dispose() {
    this.mesh?.geometry.dispose();
    this.mesh?.material.dispose();
  },
};

export { PALETTE };
