import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeRng } from '../core/rng.js';
import audio, {
  scaleHz, toCell, span, cellDegree, cellPan, hash01,
  stepVoice, fillNoise, fillImpulse, softClipCurve,
} from './index.js';

/**
 * Unit tests for src/audio.
 *
 * These run in node, where there is no AudioContext at all — which is exactly
 * the environment that proves the two things worth proving mechanically:
 * that the subsystem is inert in capture, and that everything downstream of a
 * missing/blocked AudioContext degrades to a no-op instead of throwing.
 *
 * NOTE: `npm test` globs test/*.test.js, so this file is not picked up yet.
 * Run it with:  node --test src/audio/audio.test.js
 */

function fakeCtx({ capture = false, seed = 'penrose' } = {}) {
  const listeners = new Map();
  return {
    config: { capture, seed },
    rng: makeRng(seed),
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) fn(payload);
    },
    peek: () => null,
    listeners,
  };
}

const EVENTS = ['player/moved', 'player/blocked', 'world/rotated', 'level/solved'];

// ------------------------------------------------------------ inert in capture

test('capture mode: init bails before subscribing or constructing anything', async () => {
  const ctx = fakeCtx({ capture: true });
  await audio.init(ctx);
  try {
    assert.equal(audio.enabled, false);
    assert.equal(audio.audio, null);
    assert.equal(audio.bus, null);
    assert.equal(ctx.listeners.size, 0, 'capture run must register no listeners');
    assert.equal(audio._ensure(), null, '_ensure must stay null in capture');
    assert.equal(audio.audio, null);
  } finally {
    audio.dispose();
  }
});

test('capture mode: emitting every event is a no-op and never throws', async () => {
  const ctx = fakeCtx({ capture: true });
  await audio.init(ctx);
  try {
    for (const e of EVENTS) ctx.emit(e, { from: '0,0,0', to: '1,0,0', viaIllusion: true });
    assert.equal(audio.audio, null);
  } finally {
    audio.dispose();
  }
});

// -------------------------------------------------------------- subscriptions

test('interactive mode subscribes to exactly the four gameplay events', async () => {
  const ctx = fakeCtx();
  await audio.init(ctx);
  try {
    assert.deepEqual([...ctx.listeners.keys()].sort(), [...EVENTS].sort());
    for (const e of EVENTS) assert.equal(ctx.listeners.get(e).size, 1);
  } finally {
    audio.dispose();
  }
});

test('dispose() unsubscribes everything', async () => {
  const ctx = fakeCtx();
  await audio.init(ctx);
  audio.dispose();
  for (const e of EVENTS) assert.equal(ctx.listeners.get(e).size, 0);
});

test('with no AudioContext available, every handler degrades to a no-op', async () => {
  const ctx = fakeCtx();
  await audio.init(ctx);
  try {
    assert.equal(audio.enabled, true, 'enabled until construction is actually attempted');
    ctx.emit('player/moved', { from: '1,0,0', to: '5,5,5', viaIllusion: true });
    ctx.emit('player/moved', { from: '0,0,0', to: '1,0,0', viaIllusion: false });
    ctx.emit('player/blocked', { from: '0,0,0', direction: [1, 1] });
    ctx.emit('world/rotated', { from: 0, to: 1 });
    ctx.emit('level/solved', { moves: 7, turns: 1 });
    assert.equal(audio.audio, null);
    assert.equal(audio.enabled, false, 'a failed construction disables permanently');
  } finally {
    audio.dispose();
  }
});

test('world/rotated updates the rotation used for pitch and pan', async () => {
  const ctx = fakeCtx();
  await audio.init(ctx);
  try {
    assert.equal(audio._turns, 0);
    ctx.emit('world/rotated', { from: 0, to: 3 });
    assert.equal(audio._turns, 3);
    ctx.emit('world/rotated', { from: 3, to: 0 });
    assert.equal(audio._turns, 0);
  } finally {
    audio.dispose();
  }
});

test('state() exposes nothing that changes with time', async () => {
  const ctx = fakeCtx();
  await audio.init(ctx);
  try {
    assert.deepEqual(audio.state(), { enabled: true, ready: false, muted: false });
    assert.deepEqual(audio.state(), audio.state());
  } finally {
    audio.dispose();
  }
});

// ------------------------------------------------------- the illusion contract

test('an illusion step differs from an ordinary step on every axis', () => {
  const ordinary = stepVoice({ reach: 1, viaIllusion: false });
  const illusion = stepVoice({ reach: 14, viaIllusion: true });

  assert.ok(illusion.tail > ordinary.tail * 4, 'tail must be materially longer');
  assert.ok(illusion.detuneCents > 0 && ordinary.detuneCents === 0, 'detune only on illusion');
  assert.ok(illusion.haasMs > 0 && ordinary.haasMs === 0, 'interchannel delay only on illusion');
  assert.ok(illusion.spread > ordinary.spread + 0.5, 'stereo must be wider');
  assert.ok(illusion.send > ordinary.send * 4, 'reverb send must be much larger');
  assert.ok(illusion.sub > 0 && ordinary.sub === 0, 'sub-octave only on illusion');
  assert.ok(illusion.cutoff > ordinary.cutoff, 'illusion is spectrally brighter');
});

test('illusion intensity scales with how far the step really went in 3D', () => {
  const near = stepVoice({ reach: 2, viaIllusion: true });
  const far = stepVoice({ reach: 14, viaIllusion: true });
  assert.ok(far.detuneCents > near.detuneCents);
  assert.ok(far.haasMs > near.haasMs);
  assert.ok(far.tail > near.tail);
});

test('detune stays inside the beating range, never a separate pitch', () => {
  for (const reach of [1, 2, 5, 14, 24, 400]) {
    const v = stepVoice({ reach, viaIllusion: true });
    assert.ok(v.detuneCents >= 9 && v.detuneCents <= 50,
      `reach ${reach} gave ${v.detuneCents} cents — outside the fuse-and-beat range`);
    assert.ok(v.haasMs > 0 && v.haasMs < 25,
      `reach ${reach} gave ${v.haasMs} ms — past the Haas echo threshold`);
  }
});

test("loop-01's illusion edge is measured as a 14-unit leap", () => {
  assert.equal(span(toCell('1,0,0'), toCell('5,5,5')), 14);
  assert.equal(span(toCell('0,0,0'), toCell('1,0,0')), 1);
});

// -------------------------------------------------------------- pure helpers

test('scaleHz is a strictly rising pentatonic from C4', () => {
  assert.ok(Math.abs(scaleHz(0) - 261.6255653005986) < 1e-9);
  assert.ok(Math.abs(scaleHz(5) - scaleHz(0) * 2) < 1e-9, 'five degrees is an octave');
  assert.ok(Math.abs(scaleHz(-5) - scaleHz(0) / 2) < 1e-9, 'negative degrees walk down');
  for (let d = -8; d < 12; d++) assert.ok(scaleHz(d + 1) > scaleHz(d), `degree ${d}`);
});

test('toCell accepts both payload shapes and rejects junk', () => {
  assert.deepEqual(toCell('3,-2,7'), [3, -2, 7]);
  assert.deepEqual(toCell([3, -2, 7]), [3, -2, 7]);
  for (const junk of [null, undefined, '', 'a,b,c', '1,2', {}, 42]) {
    assert.equal(toCell(junk), null, `accepted junk: ${JSON.stringify(junk)}`);
  }
});

test('pitch tracks height and pan tracks the screen-x invariant', () => {
  // y is the dominant term: climbing raises the note.
  assert.ok(cellDegree([0, 3, 0]) > cellDegree([0, 0, 0]));
  // rotateY leaves y untouched, so the elevation reading is rotation-invariant.
  for (const t of [0, 1, 2, 3]) {
    assert.ok(cellDegree([2, 4, -1], t) >= 4, `turn ${t} lost the elevation term`);
  }
  // Pan is a = x - z, the same quantity geometry uses for screen position.
  assert.ok(cellPan([4, 0, 0]) > 0);
  assert.ok(cellPan([0, 0, 4]) < 0);
  assert.equal(cellPan([2, 0, 2]), 0);
  // Cells that alias on screen must also alias in the stereo field.
  assert.equal(cellPan([1, 0, 0]), cellPan([5, 4, 4]));
  for (const v of [cellPan([99, 0, -99]), cellPan([-99, 0, 99])]) {
    assert.ok(v >= -1 && v <= 1, 'pan must stay in range');
  }
});

test('per-event variation is a pure hash, not a random draw', () => {
  assert.equal(hash01(1, 2, 3), hash01(1, 2, 3));
  assert.notEqual(hash01(1, 2, 3), hash01(1, 2, 4));
  for (const args of [[0, 0, 0], [-5, 12, 7], [1e6, -1e6, 3]]) {
    const v = hash01(...args);
    assert.ok(v >= 0 && v < 1, `hash01(${args}) = ${v} out of range`);
  }
});

// ---------------------------------------------- generated buffers, from a fork

test('noise and impulse buffers reproduce exactly from the same seed', () => {
  const make = (seed, label) => {
    const rng = makeRng(seed).fork('audio').fork(label);
    return fillNoise(new Float32Array(512), rng);
  };
  assert.deepEqual(make('penrose', 'noise'), make('penrose', 'noise'));
  assert.notDeepEqual(make('penrose', 'noise'), make('penrose', 'ir'));
  assert.notDeepEqual(make('penrose', 'noise'), make('other', 'noise'));
});

test('the generated impulse response actually decays', () => {
  const rng = makeRng('penrose').fork('audio').fork('ir');
  const [l, r] = fillImpulse(
    [new Float32Array(4096), new Float32Array(4096)], rng, { predelaySamples: 32 });

  const energy = (a, from, to) => {
    let s = 0;
    for (let i = from; i < to; i++) s += a[i] * a[i];
    return s;
  };
  assert.ok(energy(l, 32, 1056) > energy(l, 3072, 4096) * 20, 'tail is not decaying');
  for (let i = 0; i < 32; i++) assert.equal(l[i], 0, 'predelay must be silent');
  assert.notDeepEqual(l, r, 'channels must be decorrelated or there is no width');
  for (const v of l) assert.ok(v >= -1 && v <= 1, 'impulse sample out of range');
});

test('the soft-clip curve cannot exceed full scale and is transparent below the knee', () => {
  const knee = 0.75;
  const curve = softClipCurve(2048, knee);
  let maxOut = 0;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const y = curve[i];
    assert.ok(Number.isFinite(y), `curve[${i}] is not finite`);
    maxOut = Math.max(maxOut, Math.abs(y));
    if (Math.abs(x) <= knee) {
      assert.ok(Math.abs(y - x) < 1e-6, `knee region must be transparent at x=${x}`);
    } else {
      assert.ok(Math.abs(y) < 1, `x=${x} escaped full scale as ${y}`);
      assert.ok(Math.abs(y) > knee, `x=${x} collapsed below the knee`);
    }
  }
  assert.ok(maxOut < 1, `curve peaks at ${maxOut} — must stay under full scale`);
  // Monotone, or the shaper would fold and distort rather than limit.
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i] >= curve[i - 1], `curve is not monotone at ${i}`);
  }
});

// ------------------------------------------------- mechanical contract guards

test('src/audio contains no forbidden nondeterminism source', () => {
  const src = readFileSync(join(import.meta.dirname, 'index.js'), 'utf8');
  // Strip comments — the header discusses these constructs by name, and a
  // guard that a comment can trip is a guard nobody keeps.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

  for (const banned of [
    'performance.now', 'Date.now', 'new Date', 'Math.random',
    'setTimeout', 'setInterval', 'requestAnimationFrame', 'document.timeline',
  ]) {
    assert.ok(!code.includes(banned), `forbidden in src/audio: ${banned}`);
  }
  // Audio must never read or write the engine clock (ARCHITECTURE.md §1).
  assert.ok(!/\bctx\s*\.\s*time\b/.test(code), 'src/audio must not touch ctx.time');
  assert.ok(!/\.\s*(dt|frame|elapsed)\b/.test(code), 'src/audio must not read clock fields');
});

test('src/audio fetches nothing and decodes no sound file', () => {
  const src = readFileSync(join(import.meta.dirname, 'index.js'), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

  for (const banned of [
    'fetch(', 'XMLHttpRequest', 'decodeAudioData', 'new Audio(',
    '.mp3', '.wav', '.ogg', '.m4a', 'MediaElementSource',
  ]) {
    assert.ok(!code.includes(banned), `src/audio must synthesise everything: ${banned}`);
  }
});

test('src/audio takes an rng fork and never the root stream', () => {
  const src = readFileSync(join(import.meta.dirname, 'index.js'), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

  assert.ok(code.includes("ctx.rng.fork('audio')"), 'must fork the rng');
  assert.ok(!/\bctx\.rng\s*\(/.test(code), 'must never call the root stream');
  assert.ok(!/\bctx\.rng\.(range|int|pick)\b/.test(code), 'must never draw from the root stream');
});

test('src/audio declares no update() — it is not in the frame loop at all', () => {
  const src = readFileSync(join(import.meta.dirname, 'index.js'), 'utf8');
  assert.ok(!/^\s{2}update\s*\(/m.test(src), 'audio must not participate in the frame loop');
  assert.ok(!/^\s{2}fixedUpdate\s*\(/m.test(src), 'audio must not participate in fixedUpdate');
});
