import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Engine } from './engine.js';

/**
 * The frame loop is the one place in the project where wall-clock time is
 * allowed to matter, and it is allowed to matter ONLY as pacing: which frames
 * get produced in a given second. Frame N's pixels must not depend on it, which
 * is why every assertion below is about step COUNTS and never about state.
 *
 * requestAnimationFrame does not exist in node, so these tests install a stub
 * that captures the scheduled callback and lets the test drive it with
 * synthetic timestamps. That is also the only way to simulate a 120 Hz display
 * or a thirty-second stall deterministically.
 */
function harness({ lockstep = false } = {}) {
  let pending = null;
  let scheduled = 0;
  globalThis.requestAnimationFrame = (fn) => { pending = fn; scheduled += 1; return scheduled; };
  globalThis.cancelAnimationFrame = () => { pending = null; };

  const engine = new Engine({ fixedDt: 1 / 60, seed: 'penrose', lockstep });
  return {
    engine,
    scheduled: () => scheduled,
    /** Drive one animation frame at wall-clock `now` milliseconds. */
    tick(now) {
      const fn = pending;
      pending = null;
      fn?.(now);
    },
    /** Drive `count` frames at `hz`, starting from t=0. */
    run(hz, count) {
      for (let i = 0; i <= count; i++) this.tick((i * 1000) / hz);
    },
  };
}

test('start() does nothing in lockstep — the gate rests on this', () => {
  const h = harness({ lockstep: true });
  h.engine.start();
  assert.equal(h.engine._running, false, 'lockstep must not start the loop');
  assert.equal(h.scheduled(), 0, 'lockstep must not schedule an animation frame');
  assert.equal(h.engine.time.frame, 0, 'lockstep must not advance the clock');
});

test('the engine reads no clock and no rng', () => {
  // Source-level, in the style of test/ui.test.js:108. rAF hands its callback a
  // DOMHighResTimeStamp, so the accumulator needs no clock call of its own --
  // which is what lets this ban be absolute rather than carved out.
  const src = readFileSync(new URL('./engine.js', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  for (const banned of ['performance.now', 'Date.now', 'new Date', 'Math.random']) {
    assert.ok(!src.includes(banned), `src/core/engine.js must not contain ${banned}`);
  }
});

test('a 120 Hz display advances the simulation at 60 Hz, not 120', () => {
  const h = harness();
  h.engine.start();
  h.run(120, 240);                      // two seconds of a 120 Hz panel
  assert.ok(Math.abs(h.engine.time.frame - 120) <= 1,
    `expected ~120 frames in two seconds, got ${h.engine.time.frame} — ` +
    'the loop is advancing once per animation frame instead of once per fixed step');
});

test('a 30 Hz display advances the simulation at 60 Hz, not 30', () => {
  const h = harness();
  h.engine.start();
  h.run(30, 60);                        // two seconds of a 30 Hz panel
  assert.ok(Math.abs(h.engine.time.frame - 120) <= 1,
    `expected ~120 frames in two seconds, got ${h.engine.time.frame}`);
});

test('a long stall falls behind permanently rather than catching up in a burst', () => {
  const h = harness();
  h.engine.start();
  h.tick(0);
  h.tick(30_000);                       // backgrounded tab returns after 30 s

  // EXACTLY MAX_STEPS, asserted rather than bounded. MAX_CATCHUP clamps the
  // delta to 0.25 s, which is fifteen fixed steps' worth, so MAX_STEPS is what
  // decides the answer. A `<= 5` bound is satisfied by one step per animation
  // frame and so cannot tell the old loop from the new one, and it would not
  // catch MAX_STEPS becoming Infinity either.
  assert.equal(h.engine.time.frame, 5,
    `a 30-second gap produced ${h.engine.time.frame} frames, expected exactly MAX_STEPS`);

  // And the residue must be DROPPED, not carried: the next ordinary frame runs
  // at most one step. Without that, the loop spends the next several frames
  // draining the accumulator, which is the burst the clamp exists to prevent.
  const after = h.engine.time.frame;
  h.tick(30_016);
  assert.ok(h.engine.time.frame - after <= 1,
    'the accumulator carried a backlog past the clamp');
});
