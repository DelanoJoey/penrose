import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { fitView, ISO_VIEW_DIR, ORIGIN_DEPTH, FOG_NEAR, FOG_FAR, PALETTE } from './index.js';
import { rotateY } from '../geometry/index.js';
import { LEVELS } from '../world/levels.js';

/**
 * Composition tests.
 *
 * The art pass replaced eight hand-guessed camera positions with a solver, so
 * the claims that solver makes are asserted rather than eyeballed: the subject
 * lands where the composition asked, it never overflows the frame, the view
 * direction stays exactly isometric, and every shot sits at the same depth so
 * the haze band cannot drift between them.
 *
 * No WebGL and no DOM — fitView is pure by construction.
 *
 *   node --test src/render/framing.test.js
 */

const CELLS = LEVELS['loop-01'].cells;
const ASPECT = 1.6;

/** Screen position of a world point in the camera basis fitView solves for. */
function screenOf(fit, p, dir = ISO_VIEW_DIR) {
  const f = new THREE.Vector3(...dir).normalize();
  const z = f.clone().negate();
  const r = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z).normalize();
  const u = new THREE.Vector3().crossVectors(z, r);
  const P = new THREE.Vector3(...fit.position);
  const d = new THREE.Vector3(p[0], p[1], p[2]).sub(P);
  return [d.dot(r), d.dot(u)];
}

/** Normalised frame position, 0..1 left-to-right and top-to-bottom. */
function framePos(fit, p, dir = ISO_VIEW_DIR) {
  const [sx, sy] = screenOf(fit, p, dir);
  const W = fit.frustumSize * ASPECT;
  return [0.5 + sx / W, 0.5 - sy / fit.frustumSize];
}

function frameBox(fit, cells, dir = ISO_VIEW_DIR) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cells) {
    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        for (const sz of [-0.5, 0.5]) {
          const [fx, fy] = framePos(fit, [c[0] + sx, c[1] + sy, c[2] + sz], dir);
          if (fx < minX) minX = fx;
          if (fx > maxX) maxX = fx;
          if (fy < minY) minY = fy;
          if (fy > maxY) maxY = fy;
        }
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

// ============================================================ the solved pose

test('the view direction is exactly the isometric diagonal, not approximately', () => {
  const fit = fitView(CELLS, { aspect: ASPECT });
  const d = [
    fit.target[0] - fit.position[0],
    fit.target[1] - fit.position[1],
    fit.target[2] - fit.position[2],
  ];
  // All three components equal and negative: the projection collapse the whole
  // illusion rests on holds only on this axis.
  assert.equal(d[0], d[1]);
  assert.equal(d[1], d[2]);
  assert.ok(d[0] < 0);
});

test('every framing puts the world origin at the SAME depth — the haze band cannot drift', () => {
  const f = new THREE.Vector3(...ISO_VIEW_DIR).normalize();
  const variants = [
    { fill: 0.84 },
    { fill: 0.42, cx: 0.3, cy: 0.7 },
    { fill: 0.28, cx: 0.36 },
    { fill: 0.62, extent: 0.75 },
  ];
  for (const opts of variants) {
    const fit = fitView(CELLS, { aspect: ASPECT, ...opts });
    const P = new THREE.Vector3(...fit.position);
    const depth = P.clone().negate().dot(f);      // dot(origin - P, f)
    assert.ok(Math.abs(depth - ORIGIN_DEPTH) < 1e-9,
      `depth ${depth} != ORIGIN_DEPTH ${ORIGIN_DEPTH} for ${JSON.stringify(opts)}`);
  }
});

test('the haze band is derived from lattice depth, and loop-01 sits inside it', () => {
  // Near face of the nearest cell and far face of the deepest one, in view
  // depth. Both must land between FOG_NEAR and FOG_FAR, or the level is either
  // entirely unhazed or entirely dissolved.
  const sums = CELLS.map(([x, y, z]) => x + y + z);
  const front = ORIGIN_DEPTH - (Math.max(...sums) + 1.5) / Math.sqrt(3);
  const back = ORIGIN_DEPTH - (Math.min(...sums) - 1.5) / Math.sqrt(3);
  assert.ok(front >= FOG_NEAR - 0.5, `front ${front} well ahead of FOG_NEAR ${FOG_NEAR}`);
  assert.ok(back < FOG_FAR, `back ${back} past FOG_FAR ${FOG_FAR} — the far leg would dissolve`);

  const t = (back - FOG_NEAR) / (FOG_FAR - FOG_NEAR);
  const haze = t * t * (3 - 2 * t);      // three.js fog uses smoothstep
  assert.ok(haze > 0.2 && haze < 0.55, `deepest haze ${haze} is not a depth cue, it is weather`);
});

// ================================================================ composition

test('the subject lands where the composition asked it to', () => {
  for (const [cx, cy] of [[0.5, 0.5], [0.44, 0.52], [0.3, 0.7], [0.62, 0.4]]) {
    const fit = fitView(CELLS, { aspect: ASPECT, fill: 0.7, cx, cy });
    const box = frameBox(fit, CELLS);
    assert.ok(Math.abs((box.minX + box.maxX) / 2 - cx) < 1e-6, `cx ${cx}`);
    assert.ok(Math.abs((box.minY + box.maxY) / 2 - cy) < 1e-6, `cy ${cy}`);
  }
});

test('fill is a floor that is met on one axis and never overflows on either', () => {
  for (const turns of [0, 1, 2, 3]) {
    const cells = CELLS.map((c) => rotateY(c, turns));
    for (const fill of [0.4, 0.6, 0.84]) {
      const fit = fitView(cells, { aspect: ASPECT, fill });
      const box = frameBox(fit, cells);
      const w = box.maxX - box.minX;
      const h = box.maxY - box.minY;
      assert.ok(w <= fill + 1e-6 && h <= fill + 1e-6,
        `turns ${turns} fill ${fill}: overflowed at ${w} x ${h}`);
      assert.ok(Math.abs(Math.max(w, h) - fill) < 1e-6,
        `turns ${turns} fill ${fill}: tighter axis is ${Math.max(w, h)}, not ${fill}`);
    }
  }
});

test('the old hand-placed hero framing was as bad as the art pass claims', () => {
  // Negative control for the whole exercise. The previous shot was camera
  // (40,40,40), lookAt (2.5,2.5,2.5), frustum 16 — reconstructed here, and
  // measured against the same frame-space metric the solver is held to.
  const legacy = { position: [40, 40, 40], frustumSize: 16 };
  const box = frameBox(legacy, CELLS);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const cxOff = Math.abs((box.minX + box.maxX) / 2 - 0.5);

  assert.ok(h < 0.4, `legacy filled ${h} of the height; it was supposed to be tiny`);
  assert.ok(w < 0.25, `legacy filled ${w} of the width`);
  assert.ok(cxOff > 0.05, `legacy centre was ${cxOff} off, it was supposed to be off-centre`);

  const fit = fitView(CELLS, { aspect: ASPECT, fill: 0.84, cy: 0.53 });
  const now = frameBox(fit, CELLS);
  assert.ok((now.maxY - now.minY) > 2 * h, 'the art pass should more than double the subject');
  assert.ok(Math.abs((now.minX + now.maxX) / 2 - 0.5) < 1e-6, 'and centre it exactly');
});

test('degenerate input fails loudly rather than producing a NaN pose', () => {
  assert.throws(() => fitView([], { aspect: ASPECT }));
  assert.throws(() => fitView(null, { aspect: ASPECT }));
  assert.throws(() => fitView(CELLS, { aspect: ASPECT, dir: [0, -1, 0] }));
});

// ==================================================================== palette

test('the palette is a value ladder, not just a set of hues', () => {
  const luma = (hex) =>
    0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255);

  const ladder = ['faceTop', 'faceRight', 'faceLeft', 'haze', 'bg'].map((k) => luma(PALETTE[k]));
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i - 1] - ladder[i] > 15,
      `steps ${i - 1}->${i} are only ${ladder[i - 1] - ladder[i]} apart; form would stop reading`);
  }

  // The key is warmer than the shadow by a wide margin, in both directions:
  // more red than blue, against a shadow with more blue than red.
  const warm = (hex) => ((hex >> 16) & 255) - (hex & 255);
  assert.ok(warm(PALETTE.faceRight) > 100, 'the key is not warm enough to be a key');
  assert.ok(warm(PALETTE.faceLeft) < -30, 'the shadow is not cool');
  assert.ok(warm(PALETTE.bg) < -20, 'the sky is not cool');
});
