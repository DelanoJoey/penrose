import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveKey, SCREEN_DIR, KEY_ACTIONS } from '../src/ui/index.js';
import { HORIZONTAL_STEPS, SCREEN_DELTA } from '../src/geometry/index.js';

/**
 * Keymap contract for src/ui.
 *
 * src/ui/index.js touches no DOM at module scope, and resolveKey / SCREEN_DIR /
 * KEY_ACTIONS are pure, so the input mapping — the one part of the HUD that can
 * write to engine state — is testable in plain node with no browser.
 *
 * The pixel gate is BLIND to this subsystem by design: the HUD is inert in
 * capture mode, so an imagediff pass says nothing about it. These tests are the
 * only mechanical coverage the keymap has.
 */

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];

test('every screen direction is a real member of geometry HORIZONTAL_STEPS', () => {
  for (const [name, step] of Object.entries(SCREEN_DIR)) {
    assert.ok(step, `${name} resolved to nothing`);
    assert.ok(HORIZONTAL_STEPS.some((s) => same(s, step)),
      `${name} -> ${JSON.stringify(step)} is not one of HORIZONTAL_STEPS`);
  }
});

test('the four screen directions are distinct and cover all four steps', () => {
  const keys = Object.values(SCREEN_DIR).map((s) => `${s[0]},${s[1]}`);
  assert.equal(new Set(keys).size, 4);
  assert.equal(HORIZONTAL_STEPS.length, 4);
});

test('arrow keys map to the intended 3D axes', () => {
  // +a is right on screen and +b is down, so the arrow cross sits on the four
  // screen diagonals: Right/Left drive +x/-x and Down/Up drive +z/-z.
  assert.deepEqual(resolveKey('ArrowRight', 'ArrowRight').move, SCREEN_DELTA['+x']);
  assert.deepEqual(resolveKey('ArrowLeft', 'ArrowLeft').move, SCREEN_DELTA['-x']);
  assert.deepEqual(resolveKey('ArrowDown', 'ArrowDown').move, SCREEN_DELTA['+z']);
  assert.deepEqual(resolveKey('ArrowUp', 'ArrowUp').move, SCREEN_DELTA['-z']);
});

test('WASD agrees with the arrow cross', () => {
  assert.deepEqual(resolveKey('KeyD', 'd').move, resolveKey('ArrowRight', 'ArrowRight').move);
  assert.deepEqual(resolveKey('KeyA', 'a').move, resolveKey('ArrowLeft', 'ArrowLeft').move);
  assert.deepEqual(resolveKey('KeyS', 's').move, resolveKey('ArrowDown', 'ArrowDown').move);
  assert.deepEqual(resolveKey('KeyW', 'w').move, resolveKey('ArrowUp', 'ArrowUp').move);
});

test('physical key cluster wins over layout — AZERTY W still moves', () => {
  // On AZERTY the physical W key reports key 'z'. Keying on event.code keeps
  // the cluster in the same place on the keyboard.
  assert.deepEqual(resolveKey('KeyW', 'z').move, SCREEN_DELTA['-z']);
  assert.deepEqual(resolveKey('KeyQ', 'a').rotate, +1);
});

test('rotation keys are signed quarter turns, Q anticlockwise', () => {
  assert.equal(resolveKey('KeyQ', 'q').rotate, +1);
  assert.equal(resolveKey('KeyE', 'e').rotate, -1);
  assert.equal(resolveKey('BracketLeft', '[').rotate, +1);
  assert.equal(resolveKey('BracketRight', ']').rotate, -1);
});

test('prototype keys resolve to null, not to inherited functions', () => {
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.equal(resolveKey(k, k), null, `${k} must not resolve to an action`);
  }
});

test('unmapped and non-string keys resolve to null', () => {
  assert.equal(resolveKey('KeyZ', 'z'), null);
  assert.equal(resolveKey(undefined, undefined), null);
  assert.equal(resolveKey(null, 42), null);
});

test('no action is a hole — every entry does exactly one thing', () => {
  for (const [key, action] of Object.entries(KEY_ACTIONS)) {
    const moves = action.move != null;
    const rotates = action.rotate != null;
    assert.ok(moves !== rotates, `${key} must either move or rotate, not both/neither`);
    if (moves) assert.equal(action.move.length, 2, `${key} move is not a screen delta`);
    if (rotates) assert.ok(action.rotate === 1 || action.rotate === -1,
      `${key} rotate must be a single quarter turn`);
  }
});

test('the module reads no clock and no rng', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/ui/index.js', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  for (const banned of [
    'performance.now', 'Date.now', 'new Date', 'Math.random', 'setTimeout',
    'setInterval', 'requestAnimationFrame', 'fetch(', 'ctx.time', 'ctx.rng',
    '@font-face', '@keyframes', 'transition:', 'animation:',
  ]) {
    assert.ok(!src.includes(banned), `src/ui/index.js must not contain ${banned}`);
  }
});

test('src/ui imports no other subsystem', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/ui/index.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(!/\.\.\/(render|world|player|audio|fx|core|dev)\//.test(spec),
      `ARCHITECTURE.md §3.3: src/ui may not import ${spec}`);
  }
});
