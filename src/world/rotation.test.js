import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { TURN_MATRICES } from './index.js';
import { rotateY } from '../geometry/index.js';
import { LEVELS } from './levels.js';

/**
 * The tone convention, asserted.
 *
 * src/world composes a quarter-turn rotation into every instance matrix so the
 * baked face tones travel with the cell — "the light is fixed in the world".
 * Two things have to hold for that to be a fix rather than a new bug:
 *
 *   1. the rotation must agree EXACTLY with src/geometry's rotateY, or the
 *      drawn cube and the cell the path graph reasons about are different
 *      objects;
 *   2. the entries must be exact, because makeRotationY(PI/2) puts 6.1e-17
 *      where a zero belongs and this project's gate demands bit identity.
 *
 *   node --test src/world/rotation.test.js
 */

const CELLS = LEVELS['loop-01'].cells;

test('there are exactly four, and the fourth power is the identity', () => {
  assert.equal(TURN_MATRICES.length, 4);
  assert.deepEqual(TURN_MATRICES[0].elements, new THREE.Matrix4().elements);

  const four = new THREE.Matrix4()
    .multiplyMatrices(TURN_MATRICES[1], TURN_MATRICES[3]);
  assert.deepEqual([...four.elements], [...new THREE.Matrix4().elements]);
});

test('every entry is exactly 0, 1 or -1 — no cos(PI/2) residue', () => {
  for (const [t, m] of TURN_MATRICES.entries()) {
    for (const [i, v] of m.elements.entries()) {
      assert.ok(Object.is(v, 0) || v === 1 || v === -1,
        `turn ${t} element ${i} is ${v}, which is not an exact lattice entry`);
    }
  }
});

test('the matrix agrees with geometry rotateY on every cell, exactly', () => {
  // Compared with === rather than assert.equal, which is Object.is in strict
  // mode and therefore distinguishes -0 from 0. rotateY writes `-cx`, so a cell
  // on the axis comes back as -0 where the matrix produces +0. IEEE-754 says
  // those are the same number and they rasterise identically; the SAME trap
  // already produced one false failure in this repo (METHODOLOGY, P1: the
  // lattice-parity assertion). Numeric equality is the claim, so test that.
  const v = new THREE.Vector3();
  for (let t = 0; t < 4; t++) {
    for (const cell of CELLS) {
      const [x, y, z] = rotateY(cell, t);
      v.set(cell[0], cell[1], cell[2]).applyMatrix4(TURN_MATRICES[t]);
      assert.ok(v.x === x, `turn ${t} cell ${cell}: x ${v.x} != ${x}`);
      assert.ok(v.y === y, `turn ${t} cell ${cell}: y ${v.y} != ${y}`);
      assert.ok(v.z === z, `turn ${t} cell ${cell}: z ${v.z} != ${z}`);
    }
  }
});

test('a unit cube maps exactly onto itself, so silhouettes cannot move', () => {
  // The rotation exists to carry the FACE TONES around. If it moved a vertex by
  // even an ULP it would also be moving the silhouette, and the commit frame
  // would stop being pixel-clean for a reason that has nothing to do with tone.
  const v = new THREE.Vector3();
  const corners = [];
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
    corners.push([x, y, z]);
  }
  for (let t = 1; t < 4; t++) {
    const mapped = corners.map((c) => {
      v.set(...c).applyMatrix4(TURN_MATRICES[t]);
      return `${v.x},${v.y},${v.z}`;
    }).sort();
    assert.deepEqual(mapped, corners.map((c) => c.join(',')).sort(),
      `turn ${t} does not permute the cube's corners exactly`);
  }
});

test('makeRotationY would NOT have been exact — the negative control', () => {
  // Why this file exists. Left as an assertion so nobody "simplifies" the
  // longhand matrices back into a trig call.
  const naive = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  assert.notEqual(naive.elements[0], 0);
  assert.ok(Math.abs(naive.elements[0]) > 0 && Math.abs(naive.elements[0]) < 1e-15);
});
