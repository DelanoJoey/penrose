import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { ORBIT_SECONDS } from '../src/render/index.js';
import { makeConfig } from '../src/core/config.js';
import player from '../src/player/index.js';
import { LEVELS } from '../src/world/levels.js';
import { SCREEN_DELTA } from '../src/geometry/index.js';

/**
 * The motion shots in src/dev/shots.js hardcode the frame they capture:
 * `orbitmid` at 14, `orbitlate` at 27, `stepmid` at 7. If the animation timings
 * change, those shots silently capture a DIFFERENT PHASE of the animation, and
 * the gate goes on passing against a picture nobody chose.
 *
 * tools/baseline.mjs is the end-to-end guard — it refuses any shot that declared
 * a settle count and is not in motion at the shutter, so a timing change large
 * enough to push a shot past the end of its animation already fails the capture.
 * These tests exist so that failure is LEGIBLE: a named test saying "re-pick the
 * motion shot frames" beats a capture error nobody can attribute.
 *
 * MEASURED at the time of pinning, fixedDt = 1/60:
 *
 *   orbit, rotate-request -> commit  : 28 frames in the REAL ENGINE
 *   step,  step() -> settled         : 14 frames
 *
 * Two numbers here are worth knowing before you change anything.
 *
 * 1. ceil(ORBIT_SECONDS / fixedDt) is 27, and the real engine commits at 28. A
 *    spec that trusted the arithmetic would have captured the frame BEFORE the
 *    commit and called it the commit. src/render/camera.test.js derives 27 from
 *    the same constants in isolation; the extra frame appears only when the
 *    whole engine is driven. Measure, do not compute.
 *
 * 2. `orbitlate` therefore sits at 27 — the last frame still IN FLIGHT — not at
 *    28, where the orbit has already committed and `orbiting` reports false.
 *
 * To re-measure after a timing change:
 *   node tools/commitframe.mjs --port=5701 --shot=hero --out=/tmp/cf
 */

const FRAME = 1 / 60;

test('ORBIT_SECONDS is what the motion shot frames were picked against', () => {
  assert.equal(ORBIT_SECONDS, 0.45,
    'ORBIT_SECONDS changed — re-measure the orbit frame count and re-pick `settle` '
    + 'on orbitmid/orbitlate in src/dev/shots.js');
});

test('the fixed timestep is what the frame counts were derived from', () => {
  assert.equal(makeConfig('').fixedDt, FRAME,
    'fixedDt changed — every motion shot frame count is now wrong');
});

test('a step still settles in exactly 14 frames', async () => {
  // Minimal harness: the avatar is a plain scene object, no WebGL or DOM.
  const listeners = new Map();
  const ctx = {
    config: { capture: false, lockstep: true, seed: 'penrose', fixedDt: FRAME },
    time: { frame: 0, dt: FRAME, raw: 0, elapsed: 0, scale: 1 },
    engine: { scene: new THREE.Scene() },
    peek: () => null,
    on: (e, fn) => { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(fn); },
    emit: (e, p) => { for (const fn of listeners.get(e) ?? []) fn(p, ctx); },
  };
  await player.init(ctx);
  ctx.emit('level/loaded', LEVELS['loop-01']);

  assert.equal(player.motionState().moving, false, 'expected to start at rest');
  assert.equal(player.step(SCREEN_DELTA['+x']), true, 'the fixture move must be legal');
  assert.equal(player.motionState().moving, true, 'step() must start an interpolation');

  let frames = 0;
  while (player.motionState().moving && frames < 600) {
    player.update(ctx);
    frames++;
  }

  assert.equal(frames, 14,
    'the step settle count changed — re-pick `settle` on stepmid in src/dev/shots.js');
});

test('stepmid captures a frame that is genuinely mid-step', async () => {
  // A settle of 7 must land strictly inside the interpolation, not at either
  // end. At 0 the pawn has not left; at 14 it has arrived and the shot would
  // be a static frame wearing a motion shot's name.
  const listeners = new Map();
  const ctx = {
    config: { capture: false, lockstep: true, seed: 'penrose', fixedDt: FRAME },
    time: { frame: 0, dt: FRAME, raw: 0, elapsed: 0, scale: 1 },
    engine: { scene: new THREE.Scene() },
    peek: () => null,
    on: (e, fn) => { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(fn); },
    emit: (e, p) => { for (const fn of listeners.get(e) ?? []) fn(p, ctx); },
  };
  await player.init(ctx);
  ctx.emit('level/loaded', LEVELS['loop-01']);
  player.step(SCREEN_DELTA['+x']);

  for (let i = 0; i < 7; i++) player.update(ctx);

  const m = player.motionState();
  assert.equal(m.moving, true, 'stepmid must still be in flight at frame 7');
  assert.ok(m.progress > 0 && m.progress < 1,
    `stepmid progress ${m.progress} is not strictly inside the interpolation`);
});
