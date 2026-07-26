import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import render, {
  CameraOrbit, smootherstep, TURN_RADIANS, CAMERA_TURN_SIGN, ORBIT_SECONDS, MAX_QUEUED_TURNS,
} from './index.js';
import { rotateY } from '../geometry/index.js';
import { LEVELS } from '../world/levels.js';

/**
 * Camera rotation-transition tests.
 *
 * Lives in src/render because that is this subsystem's directory; `npm test`
 * globs test/*.test.js, so integration should either widen that glob or move
 * this file (src/player and src/audio have the same problem). Until then:
 *   node --test src/render/camera.test.js
 *
 * No WebGL and no DOM: the rig is built with Object.create(render) plus a bare
 * OrthographicCamera, and its transition wiring comes from the subsystem's own
 * _initTransitions(). The tests therefore drive the same code the engine does.
 */

const FRAME = 1 / 60;
const CELLS = LEVELS['loop-01'].cells;
const AXIS = new THREE.Vector3(0, 1, 0);

/** Frames a quarter turn takes at a fixed 1/60 dt. Derived, not assumed. */
const ORBIT_FRAMES = (() => {
  let e = 0, n = 0;
  while (e < ORBIT_SECONDS) { e += FRAME; n++; }
  return n;
})();

// ------------------------------------------------------------------ helpers

function makeCamera(position = [40, 40, 40], target = [2.5, 2.5, 2.5]) {
  const c = new THREE.OrthographicCamera(-12, 12, 7.5, -7.5, 0.1, 200);
  c.position.set(...position);
  c.lookAt(...target);
  c.updateMatrixWorld(true);
  return c;
}

/** Screen position of a cell, in NDC. */
function project(camera, cell) {
  camera.updateMatrixWorld(true);
  const v = new THREE.Vector3(cell[0], cell[1], cell[2]).project(camera);
  return [v.x, v.y];
}

/** Worst NDC discrepancy between two (camera, rotation) readings of a level. */
function worstScreenDelta(camA, turnsA, camB, turnsB, cells = CELLS) {
  let worst = 0;
  for (const cell of cells) {
    const a = project(camA, rotateY(cell, turnsA));
    const b = project(camB, rotateY(cell, turnsB));
    worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  }
  return worst;
}

function pose(camera) {
  return [
    camera.position.x, camera.position.y, camera.position.z,
    camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w,
  ];
}

/** A rig plus a stub world, with no renderer and no DOM. */
function harness({ turns = 0, position, target } = {}) {
  const listeners = new Map();
  const emitted = [];

  const emit = (event, payload) => {
    emitted.push({ event, payload });
    for (const fn of [...(listeners.get(event) ?? [])]) fn(payload, ctx);
  };

  const world = {
    name: 'world',
    turns,
    calls: [],
    setRotation(t) {
      this.calls.push(t);
      const from = this.turns;
      this.turns = ((t % 4) + 4) % 4;
      if (from !== this.turns) emit('world/rotated', { from, to: this.turns });
      return this.turns;
    },
  };

  const ctx = {
    config: { capture: false, lockstep: true, seed: 'penrose', fixedDt: FRAME },
    time: { frame: 0, dt: FRAME, raw: 0, elapsed: 0, scale: 1 },
    peek: (name) => (name === 'world' ? world : null),
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    emit,
  };

  const rig = Object.create(render);
  rig.camera = makeCamera(position, target);
  rig._initTransitions(ctx);

  const pump = (n = 1) => {
    for (let i = 0; i < n; i++) { ctx.time.frame += 1; rig.update(ctx); }
  };

  return { rig, ctx, world, emitted, pump };
}

// ================================================================ the identity

test('a camera orbit of CAMERA_TURN_SIGN * 90 deg equals one world turn', () => {
  for (const delta of [1, -1, 2]) {
    const rotated = makeCamera();                 // world turned, camera untouched
    const orbited = makeCamera();                 // world untouched, camera orbited
    const q = new THREE.Quaternion()
      .setFromAxisAngle(AXIS, CAMERA_TURN_SIGN * delta * TURN_RADIANS);
    orbited.position.applyQuaternion(q);
    orbited.quaternion.premultiply(q);

    const worst = worstScreenDelta(rotated, delta, orbited, 0);
    assert.ok(worst < 1e-12, `delta ${delta}: worst NDC delta ${worst}`);
  }
});

test('the opposite sign does NOT — the constant is load-bearing, not taste', () => {
  const rotated = makeCamera();
  const orbited = makeCamera();
  const q = new THREE.Quaternion().setFromAxisAngle(AXIS, -CAMERA_TURN_SIGN * TURN_RADIANS);
  orbited.position.applyQuaternion(q);
  orbited.quaternion.premultiply(q);
  assert.ok(worstScreenDelta(rotated, 1, orbited, 0) > 0.1);
});

test('the pivot must be the origin, the axis rotateY uses', () => {
  // Negative control for orbitPivot. rotateY turns the lattice about the world
  // origin; orbiting the camera about the structure centroid instead differs by
  // the translation (C - R C), which is exactly the pop the end-swap must not
  // have.
  const centroid = new THREE.Vector3(2.5, 0, 2.5);
  const rotated = makeCamera();
  const orbited = makeCamera();
  const q = new THREE.Quaternion().setFromAxisAngle(AXIS, CAMERA_TURN_SIGN * TURN_RADIANS);
  orbited.position.sub(centroid).applyQuaternion(q).add(centroid);
  orbited.quaternion.premultiply(q);
  assert.ok(worstScreenDelta(rotated, 1, orbited, 0) > 0.1);
});

// ==================================================================== easing

test('smootherstep pins both ends and is monotone', () => {
  assert.equal(smootherstep(0), 0);
  assert.equal(smootherstep(1), 1);
  assert.equal(smootherstep(-5), 0);
  assert.equal(smootherstep(5), 1);
  assert.equal(smootherstep(0.5), 0.5);
  let prev = -1;
  for (let i = 0; i <= 64; i++) {
    const v = smootherstep(i / 64);
    assert.ok(v >= prev, `not monotone at ${i / 64}`);
    prev = v;
  }
  // Velocity vanishes at both ends: no kick on the frame the illusion resolves.
  const h = 1e-4;
  assert.ok(smootherstep(h) / h < 1e-3);
  assert.ok((1 - smootherstep(1 - h)) / h < 1e-3);
});

// ================================================================ CameraOrbit

test('progress 0 reproduces the start pose bit-for-bit', () => {
  const cam = makeCamera();
  const before = pose(cam);
  const orbit = new CameraOrbit({ position: cam.position, quaternion: cam.quaternion, delta: 1 });
  orbit.applyTo(cam);
  assert.deepEqual(pose(cam), before);
});

test('restore() returns the exact saved pose', () => {
  const cam = makeCamera([44, 26, 30], [2.5, 2.5, 2.5]);   // the offaxis shot
  const before = pose(cam);
  const orbit = new CameraOrbit({ position: cam.position, quaternion: cam.quaternion, delta: -1 });
  orbit.advance(0.2).applyTo(cam);
  assert.notDeepEqual(pose(cam), before);
  orbit.restore(cam);
  assert.deepEqual(pose(cam), before);
});

test('the pose is a pure function of accumulated dt, not of call pattern', () => {
  const seed = makeCamera();
  const mk = () => new CameraOrbit({ position: seed.position, quaternion: seed.quaternion, delta: 1 });

  const a = mk(), b = mk();
  const camA = makeCamera(), camB = makeCamera();
  for (let i = 0; i < 11; i++) a.advance(FRAME);
  for (let i = 0; i < 11; i++) b.advance(FRAME);
  a.applyTo(camA);
  b.applyTo(camB);
  assert.deepEqual(pose(camA), pose(camB));

  // Zero and negative dt must not move anything — a frozen clock freezes.
  const frozen = mk();
  frozen.advance(0).advance(-1).advance(NaN).advance(undefined);
  assert.equal(frozen.elapsed, 0);
  assert.equal(frozen.progress, 0);
});

test('a quarter turn lands in a sane number of frames', () => {
  assert.ok(ORBIT_FRAMES >= 12 && ORBIT_FRAMES <= 60, `ORBIT_FRAMES ${ORBIT_FRAMES}`);
});

// ============================================================ the end-swap

test('nothing rotates until the orbit completes', () => {
  const { rig, world, pump } = harness();
  rig.requestRotation(1);

  for (let i = 0; i < ORBIT_FRAMES - 1; i++) {
    pump(1);
    assert.equal(world.turns, 0, `world moved early at frame ${i + 1}`);
    assert.deepEqual(world.calls, []);
    assert.equal(rig.transitionState().active, true);
  }
});

test('the swap lands on the SAME frame the camera arrives, not the next one', () => {
  const { rig, world, pump } = harness();
  const before = pose(rig.camera);

  rig.requestRotation(1);
  pump(ORBIT_FRAMES - 1);
  assert.equal(world.turns, 0);

  pump(1);
  assert.deepEqual(world.calls, [1]);
  assert.equal(world.turns, 1);
  assert.equal(rig.transitionState().active, false);
  // ...and the camera is back exactly where it started.
  assert.deepEqual(pose(rig.camera), before);
});

test('the swap moves no pixels: end-of-orbit pose == restored pose + turned world', () => {
  const { rig, pump } = harness();
  rig.requestRotation(1);
  pump(ORBIT_FRAMES - 1);

  // What the camera would show if the orbit ran to a full 90 deg with the world
  // still at 0 — i.e. the state the last rendered orbit frame is heading for.
  const arrived = makeCamera();
  const q = new THREE.Quaternion().setFromAxisAngle(AXIS, CAMERA_TURN_SIGN * TURN_RADIANS);
  arrived.position.applyQuaternion(q);
  arrived.quaternion.premultiply(q);

  pump(1);   // commit: camera restored, world at turns 1

  const worst = worstScreenDelta(arrived, 0, rig.camera, 1);
  assert.ok(worst < 1e-12, `swap displaced the picture by ${worst} NDC`);
});

test('a reverse turn commits turns-1, normalised', () => {
  const { rig, world, pump } = harness({ turns: 0 });
  rig.requestRotation(-1);
  pump(ORBIT_FRAMES);
  assert.deepEqual(world.calls, [-1]);
  assert.equal(world.turns, 3);
});

// ================================================================== queueing

test('requests during an orbit queue rather than interrupt', () => {
  const { rig, world, pump } = harness();
  rig.requestRotation(1);
  pump(3);
  rig.requestRotation(1);
  assert.equal(rig.transitionState().queued, 1);
  assert.equal(world.turns, 0);

  pump(ORBIT_FRAMES - 3);          // first commits, second begins same frame
  assert.equal(world.turns, 1);
  assert.equal(rig.transitionState().active, true);

  pump(ORBIT_FRAMES);
  assert.equal(world.turns, 2);
  assert.deepEqual(world.calls, [1, 2]);
  assert.equal(rig.transitionState().active, false);
});

test('an opposing request cancels a queued one', () => {
  const { rig, pump } = harness();
  rig.requestRotation(1);
  pump(2);
  rig.requestRotation(1);
  rig.requestRotation(-1);
  assert.equal(rig.transitionState().queued, 0);
});

test('the queue is capped and over-cap input is refused, not buffered', () => {
  const { rig } = harness();
  rig.requestRotation(1);                                   // in flight
  for (let i = 0; i < 10; i++) rig.requestRotation(1);
  assert.equal(rig.transitionState().queued, MAX_QUEUED_TURNS);
  assert.equal(rig.requestRotation(1), false);
});

test('zero and non-integer deltas are refused', () => {
  const { rig } = harness();
  assert.equal(rig.requestRotation(0), false);
  assert.equal(rig.requestRotation(0.4), false);
  assert.equal(rig.requestRotation(NaN), false);
  assert.equal(rig.requestRotation('x'), false);
  assert.equal(rig.transitionState().active, false);
});

test('the world/rotate-request event drives the same path', () => {
  const { rig, ctx, world, pump } = harness();
  ctx.emit('world/rotate-request', { delta: 1 });
  assert.equal(rig.transitionState().active, true);
  pump(ORBIT_FRAMES);
  assert.equal(world.turns, 1);
});

// ================================================================== aborting

test('an external rotation abandons the orbit and commits nothing of its own', () => {
  const { rig, world, pump } = harness();
  const before = pose(rig.camera);
  rig.requestRotation(1);
  pump(5);

  world.setRotation(2);            // a dev shot, or a level reset

  assert.equal(rig.transitionState().active, false);
  assert.deepEqual(pose(rig.camera), before);
  assert.deepEqual(world.calls, [2]);

  pump(ORBIT_FRAMES * 2);
  assert.deepEqual(world.calls, [2]);   // no stale commit arrives later
  assert.equal(world.turns, 2);
});

test('level/loaded and cancelTransition() both abort cleanly', () => {
  for (const abort of [
    (rig, ctx) => ctx.emit('level/loaded', LEVELS['loop-01']),
    (rig) => rig.cancelTransition(),
  ]) {
    const { rig, ctx, world, pump } = harness();
    const before = pose(rig.camera);
    rig.requestRotation(1);
    rig.requestRotation(1);
    pump(4);

    abort(rig, ctx);

    assert.deepEqual(pose(rig.camera), before);
    assert.equal(rig.transitionState().active, false);
    assert.equal(rig.transitionState().queued, 0);
    pump(ORBIT_FRAMES * 2);
    assert.deepEqual(world.calls, []);
    assert.equal(world.turns, 0);
  }
});

// ============================================================ shots still work

test('update() with no orbit never touches the camera', () => {
  // This is the property the dev shots rest on: they set camera.position and
  // camera.lookAt directly and nothing here may overwrite them.
  const { rig, ctx, pump } = harness();
  rig.camera.position.set(44, 26, 30);
  rig.camera.lookAt(2.5, 2.5, 2.5);
  const before = pose(rig.camera);
  pump(120);
  assert.deepEqual(pose(rig.camera), before);
  assert.equal(ctx.time.frame, 120);
});

test('resetTemporal() rewinds an orbit to phase zero rather than cancelling it', () => {
  const { rig, world, pump } = harness();
  const before = pose(rig.camera);
  rig.requestRotation(1);
  pump(9);
  assert.notDeepEqual(pose(rig.camera), before);

  rig.resetTemporal();
  assert.deepEqual(pose(rig.camera), before);
  assert.equal(rig.transitionState().active, true);
  assert.equal(rig.transitionState().progress, 0);

  pump(ORBIT_FRAMES);
  assert.equal(world.turns, 1);          // still reaches its destination
  assert.deepEqual(pose(rig.camera), before);
});

test('resetTemporal() is safe with no orbit in flight', () => {
  const { rig } = harness();
  const before = pose(rig.camera);
  rig.resetTemporal();
  assert.deepEqual(pose(rig.camera), before);
});

// ============================================================== determinism

test('the whole transition is a pure function of the frame index', () => {
  const run = () => {
    const { rig, world, pump } = harness();
    const poses = [];
    rig.requestRotation(1);
    for (let i = 0; i < ORBIT_FRAMES + 6; i++) { pump(1); poses.push(pose(rig.camera)); }
    return { poses, turns: world.turns, calls: world.calls };
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
});

test('no wall clock, no rng, no timer, no rAF in this subsystem', () => {
  // Mechanical restatement of ARCHITECTURE.md §1 against the module source.
  // Comment lines are stripped so this tests the code, not the prose.
  const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const banned of [
    'performance.now', 'Date.now', 'new Date', 'Math.random',
    'setTimeout', 'setInterval', 'requestAnimationFrame', 'document.timeline', 'fetch(',
  ]) {
    assert.ok(!code.includes(banned), `src/render/index.js uses ${banned}`);
  }
});
