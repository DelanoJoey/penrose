import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import world from '../src/world/index.js';
import { INK, valueNoise3 } from '../src/render/index.js';
import { LEVELS } from '../src/world/levels.js';

/**
 * INK DENSITY MUST NOT DEPEND ON ROTATION.
 *
 * `_applyRotation` samples a density field per cell and writes it to
 * `instanceColor`. Sampling it at the ROTATED position instead of the cell
 * would reshuffle every block's density on a quarter turn — the commit frame
 * would stop being pixel-identical and the tone convention would be straight
 * back where P2 found it.
 *
 * That invariant was asserted in a comment and covered by NOTHING until this
 * file. It is exactly the shape of defect this project keeps re-learning: the
 * silhouette is identical either way, every existing test still passes, and the
 * pixel gate cannot see it because the gate compares two captures of the SAME
 * tree and so proves identity, never correctness (issue #16).
 *
 * There is a second reason this file exists. Issue #16 asked for "a check that
 * could have failed" on a rendering property. A palette-membership assertion
 * cannot fail — every ink is a multiplicative transform of a palette entry, in
 * palette by construction. A face-interior uniformity assertion fails on
 * CORRECT output, because interiors are deliberately non-uniform. This can fail,
 * it is cheap, and it guards the thing that would actually break.
 */

/** Minimal ctx — enough to init src/world with no WebGL context and no DOM. */
function fakeCtx() {
  const listeners = new Map();
  const engine = { scene: new THREE.Scene() };
  const ctx = {
    config: { capture: true, lockstep: true, level: null, seed: 'test', quality: 'ultra' },
    time: { frame: 0, dt: 1 / 60, raw: 0, elapsed: 0, scale: 1 },
    rng: Object.assign(() => 0.5, { fork: () => Object.assign(() => 0.5, { fork: () => () => 0.5 }) }),
    engine,
    peek: (n) => (n === 'world' ? world : null),
    on: (e, fn) => { if (!listeners.has(e)) listeners.set(e, []); listeners.get(e).push(fn); },
    emit: (e, p) => (listeners.get(e) ?? []).forEach((fn) => fn(p, ctx)),
  };
  engine.ctx = ctx;
  return ctx;
}

const colorsAt = (turns, ctx) => {
  world.setRotation(turns, ctx);
  return Array.from(world.mesh.instanceColor.array);
};

test('instanceColor is identical at all four rotation states', async () => {
  const ctx = fakeCtx();
  await world.init(ctx);

  const at0 = colorsAt(0, ctx);
  assert.ok(at0.length > 0, 'no instance colours were written');

  for (const t of [1, 2, 3]) {
    const atT = colorsAt(t, ctx);
    assert.equal(atT.length, at0.length, `instance count changed at turn ${t}`);
    // Exact, not epsilon: both sides are the same pure function of the same
    // unrotated integer cell, so anything but bit-equality is a real regression.
    assert.deepEqual(
      atT, at0,
      `ink density changed at turn ${t} — the density field is being sampled at the ` +
      'ROTATED position instead of the cell. See src/world/_applyRotation.',
    );
  }

  // And returning to 0 must reproduce the original, not merely something stable.
  assert.deepEqual(colorsAt(0, ctx), at0, 'four quarter turns did not restore the original densities');

  world.dispose();
});

test('the density field is smooth: adjacent cells differ by a fraction of the amplitude', () => {
  /**
   * NEGATIVE CONTROL BUILT IN. The old keying — one independent draw per
   * instance — is reproduced here and asserted to be WORSE. Without it this
   * test would pass on any field at all, including a constant one, and would
   * therefore be measuring nothing.
   */
  const worst = { smooth: 0, perInstance: 0 };

  for (const level of Object.values(LEVELS)) {
    const cells = level.cells;
    const index = new Map(cells.map((c, i) => [c.join(','), i]));

    // A cheap stand-in for the old hash01(i) keying: uncorrelated per index.
    const perInstance = new Map(cells.map((c, i) => [i, valueNoise3(i * 977, 0, 0, 1, 0x51ed)]));

    for (const c of cells) {
      const i = index.get(c.join(','));
      for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const j = index.get([c[0] + d[0], c[1] + d[1], c[2] + d[2]].join(','));
        if (j === undefined) continue;
        const n = cells[j];

        const s = Math.abs(
          valueNoise3(c[0], c[1], c[2], INK.densityWavelength, 0x51ed) -
          valueNoise3(n[0], n[1], n[2], INK.densityWavelength, 0x51ed));
        if (s > worst.smooth) worst.smooth = s;

        const p = Math.abs(perInstance.get(i) - perInstance.get(j));
        if (p > worst.perInstance) worst.perInstance = p;
      }
    }
  }

  assert.ok(worst.perInstance > 0.4,
    `negative control did not reproduce a harsh field (worst step ${worst.perInstance.toFixed(3)}) — ` +
    'this test can no longer tell a smooth field from an uncorrelated one');

  assert.ok(worst.smooth < 0.25,
    `adjacent cells differ by ${worst.smooth.toFixed(3)} of full amplitude — the density field is ` +
    `no longer smooth at wavelength ${INK.densityWavelength}, so cube boundaries carry visible seams again`);

  assert.ok(worst.smooth < worst.perInstance,
    'the smooth field is not smoother than an uncorrelated one');
});

test('no ink multiplier drives a plate past full', () => {
  /**
   * The defect behind issue #16's "bright hairline slivers": ghost's red
   * channel was 1.15, which clamped faceTop and faceRight to 255 and turned the
   * second impression into a saturated primary.
   *
   * KNOCKOUT IS DELIBERATELY EXEMPT and that is the interesting half. It is
   * [1.60, 1.50, 1.35] and it clamps on purpose — a knockout is meant to blow
   * out, it marks start and goal. So this asserts the rule where the rule
   * applies rather than everywhere, which is why it is a check and not a lint.
   */
  const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const PLATES = { faceTop: 0xffb511, faceLeft: 0x00317f, faceRight: 0xf15060 };

  for (const [name, hex] of Object.entries(PLATES)) {
    const lin = [16, 8, 0].map((s) => srgbToLinear(((hex >> s) & 255) / 255));
    lin.forEach((c, i) => {
      const lifted = c * INK.ghost[i] * (1 + INK.densityJitter);
      assert.ok(
        lifted <= 1,
        `ghost drives ${name} channel ${i} to ${lifted.toFixed(3)} — above 1 it clamps, and the ` +
        'second impression reads as a saturated primary line instead of denser ink (issue #16)',
      );
    });
  }
});
