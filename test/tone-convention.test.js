import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import world from '../src/world/index.js';
import player from '../src/player/index.js';

/**
 * Regression guard for the tone convention (LIGHT FIXED IN THE WORLD).
 *
 * A world turn must be a TRUE RIGID ROTATION, not a translation. The cube's
 * silhouette is identical either way, so nothing visible in a static shot
 * distinguishes them — the difference only surfaces as a colour swap on the last
 * frame of a rotation, which was measured at 3.1891% of pixels / maxDelta 48
 * before the fix and 0/0 after.
 *
 * That is exactly the kind of defect that reverts silently: `makeTranslation` is
 * shorter, looks obviously correct, and no static test or pixel gate catches it.
 * Hence a mechanical assert on the matrix itself.
 */

/** Minimal ctx — enough to init a subsystem without a WebGL context. */
function fakeCtx() {
  const listeners = new Map();
  const engine = { scene: new THREE.Scene() };
  const ctx = {
    config: { capture: true, lockstep: true, level: null, seed: 'test', quality: 'ultra' },
    time: { frame: 0, dt: 1 / 60, raw: 0, elapsed: 0, scale: 1 },
    rng: Object.assign(() => 0.5, { fork: () => Object.assign(() => 0.5, { fork: () => () => 0.5 }) }),
    engine,
    peek: (n) => (n === 'world' ? world : n === 'player' ? player : null),
    on: (e, fn) => { if (!listeners.has(e)) listeners.set(e, []); listeners.get(e).push(fn); },
    emit: (e, p) => (listeners.get(e) ?? []).forEach((fn) => fn(p, ctx)),
  };
  engine.ctx = ctx;
  return ctx;
}

const basisOf = (m) => {
  const e = m.elements;
  return {
    x: new THREE.Vector3(e[0], e[1], e[2]),
    y: new THREE.Vector3(e[4], e[5], e[6]),
    z: new THREE.Vector3(e[8], e[9], e[10]),
  };
};

test('a world turn is a rigid rotation, not a translation', async () => {
  const ctx = fakeCtx();
  await world.init(ctx);

  const m0 = new THREE.Matrix4();
  world.setRotation(0, ctx);
  world.mesh.getMatrixAt(0, m0);
  const b0 = basisOf(m0);

  const m1 = new THREE.Matrix4();
  world.setRotation(1, ctx);
  world.mesh.getMatrixAt(0, m1);
  const b1 = basisOf(m1);

  // NEGATIVE CONTROL: under the old translation-only convention the upper 3x3
  // stayed identity at every rotation, so these two bases would be equal. If
  // this assertion ever fails, someone reverted to makeTranslation.
  assert.ok(
    b0.x.distanceTo(b1.x) > 0.5,
    'turn 1 left the basis unrotated — the tone convention has regressed to translation-only',
  );

  // And it must be a PROPER rotation: orthonormal, right-handed, det +1.
  for (const b of [b0, b1]) {
    assert.ok(Math.abs(b.x.length() - 1) < 1e-9, 'basis not unit length');
    assert.ok(Math.abs(b.y.length() - 1) < 1e-9, 'basis not unit length');
    assert.ok(Math.abs(b.z.length() - 1) < 1e-9, 'basis not unit length');
    assert.ok(Math.abs(b.x.dot(b.y)) < 1e-9, 'basis not orthogonal');
    assert.ok(Math.abs(b.x.dot(b.z)) < 1e-9, 'basis not orthogonal');
  }
  assert.ok(Math.abs(new THREE.Matrix4().extractRotation(m1).determinant() - 1) < 1e-9,
    'not a proper rotation (determinant must be +1)');

  world.dispose();
});

test('four quarter turns return to the identity orientation', async () => {
  const ctx = fakeCtx();
  await world.init(ctx);

  const read = (t) => {
    world.setRotation(t, ctx);
    const m = new THREE.Matrix4();
    world.mesh.getMatrixAt(0, m);
    return basisOf(m).x.clone();
  };

  const at0 = read(0);
  const at4 = read(4);
  assert.ok(at0.distanceTo(at4) < 1e-9, 'rotation is not order 4');
  world.dispose();
});

test('translation still tracks the rotated cell position', async () => {
  const ctx = fakeCtx();
  await world.init(ctx);

  world.setRotation(0, ctx);
  const m = new THREE.Matrix4();
  world.mesh.getMatrixAt(0, m);
  const p = new THREE.Vector3().setFromMatrixPosition(m);

  // level cells[0] of loop-01 is [0,0,0]; composing rotation must not have
  // clobbered the position component.
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  assert.equal(p.y, 0);
  world.dispose();
});

test('the avatar turns with the world, so it does not stay screen-keyed', async () => {
  const ctx = fakeCtx();
  await player.init(ctx);
  await world.init(ctx);

  assert.ok(player.mesh, 'avatar mesh should exist after init');
  const at0 = player.mesh.rotation.y;

  world.setRotation(1, ctx);
  const at1 = player.mesh.rotation.y;

  assert.ok(
    Math.abs(at1 - at0) > 1e-6,
    'the avatar did not rotate with the world — it would be the last object still ' +
    'keyed to the screen and would reintroduce a tone swap on the commit frame',
  );
  assert.ok(Math.abs(Math.abs(at1 - at0) - Math.PI / 2) < 1e-9, 'avatar turn is not a quarter turn');

  player.dispose();
  world.dispose();
});
