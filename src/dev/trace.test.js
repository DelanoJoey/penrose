import test from 'node:test';
import assert from 'node:assert/strict';

import { createTrace } from './trace.js';

/**
 * The recorder exists so a play session produces evidence rather than a
 * sentence. Every test here defends a property that, if it lapsed, would let a
 * session LOOK recorded and be missing the part worth reading.
 */

/** A Map-backed stand-in for localStorage; node has none. */
function fakeStore({ throwOnSet = false } = {}) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (throwOnSet) throw new Error('quota'); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

function fakeTarget() {
  const handlers = new Map();
  return {
    addEventListener: (type, fn) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
    },
    removeEventListener: (type, fn) => { handlers.get(type)?.delete(fn); },
    fire: (type, event) => { for (const fn of handlers.get(type) ?? []) fn(event); },
    count: (type) => handlers.get(type)?.size ?? 0,
  };
}

function ctxFor({ capture = false, lockstep = false, trace = true } = {}) {
  const listeners = new Map();
  const ctx = {
    config: { capture, lockstep, trace, seed: 'penrose', fixedDt: 1 / 60 },
    time: { frame: 0, dt: 1 / 60, raw: 0, elapsed: 0, scale: 1 },
    engine: {},
    peek: () => null,
    on: (e, fn) => {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e).add(fn);
      return () => listeners.get(e).delete(fn);
    },
    // Mirrors Engine._emit EXACTLY, including its lack of a try/catch -- which
    // is the behaviour the isolation test below exists to survive.
    emit: (e, p) => { for (const fn of listeners.get(e) ?? []) fn(p, ctx); },
  };
  return ctx;
}

test('inert in capture and in lockstep — ARCHITECTURE §4 forbids a second input path', () => {
  for (const mode of [{ capture: true }, { lockstep: true }]) {
    const target = fakeTarget();
    const store = fakeStore();
    const t = createTrace({ store, target, now: () => 0 });
    t.init(ctxFor(mode));
    assert.equal(target.count('keydown'), 0,
      `a keydown listener was attached with ${JSON.stringify(mode)}`);
    assert.equal(store.length, 0, 'nothing may be written in a capture');
  }
});

test('a keypress that does nothing is still recorded', () => {
  // The whole reason the recorder does not rely on events alone. src/ui calls
  // player.step() directly, and step() returns silently when the level is lost
  // or no level is loaded -- so an events-only trace goes blank in exactly the
  // two moments worth reading.
  const target = fakeTarget();
  const store = fakeStore();
  const t = createTrace({ store, target, now: () => 0 });
  t.init(ctxFor());

  target.fire('keydown', { code: 'ArrowUp', key: 'ArrowUp', repeat: false });

  const entries = JSON.parse(t.dump());
  const keys = entries.filter((e) => e.kind === 'key');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].payload.code, 'ArrowUp');
});

test('the keypress is recorded BEFORE the events it causes', () => {
  const target = fakeTarget();
  const store = fakeStore();
  const ctx = ctxFor();
  const t = createTrace({ store, target, now: () => 0 });
  t.init(ctx);

  target.fire('keydown', { code: 'ArrowUp', key: 'ArrowUp', repeat: false });
  ctx.emit('player/moved', { from: '0,0,0', to: '0,0,1', viaIllusion: false });

  const entries = JSON.parse(t.dump()).filter((e) => e.kind !== 'boot');
  assert.deepEqual(entries.map((e) => e.kind), ['key', 'event']);
  assert.deepEqual(entries.map((e) => e.seq), [...entries.map((e) => e.seq)].sort((a, b) => a - b));
});

test('a recorder that throws does not abort the listeners after it', () => {
  // Engine._emit has no try/catch (src/core/engine.js): one throwing listener
  // kills every listener registered after it. The recorder subscribes to nine
  // events during the one session this phase exists to run, so it must swallow
  // its own failures. THIS TEST MUST ACTUALLY MAKE IT THROW -- a version that
  // does not will pass against an unwrapped implementation, which is the
  // P18/P19 failure repeating.
  const ctx = ctxFor();
  const t = createTrace({ store: fakeStore({ throwOnSet: true }), target: fakeTarget(), now: () => 0 });
  t.init(ctx);

  let reached = false;
  ctx.on('player/moved', () => { reached = true; });

  ctx.emit('player/moved', { from: '0,0,0', to: '0,0,1', viaIllusion: false });
  assert.equal(reached, true, 'a later listener was aborted by the recorder');
});

test('payloads are recorded verbatim and gain no timestamp', () => {
  // ARCHITECTURE §3.3: "An event may not carry a timestamp." The stamp belongs
  // on the trace entry, at the point of observation.
  const target = fakeTarget();
  const ctx = ctxFor();
  // `t` is milliseconds since the RECORDER booted, not an absolute reading, so
  // the fake clock has to advance for the assertion to mean anything. A
  // constant clock makes every entry 0 and would pass against an
  // implementation that never stamped at all.
  let clock = 100;
  const t = createTrace({ store: fakeStore(), target, now: () => clock });
  t.init(ctx);
  clock = 107;

  const payload = { from: '0,0,0', to: '0,0,1', viaIllusion: true };
  ctx.emit('player/moved', payload);

  const entry = JSON.parse(t.dump()).find((e) => e.name === 'player/moved');
  assert.deepEqual(entry.payload, payload);
  assert.equal(entry.t, 7, 'the stamp belongs on the entry, relative to boot');
  assert.ok(!('t' in payload), 'the emitted payload was mutated');
});

test('a reload continues the trace instead of clobbering it', () => {
  const store = fakeStore();
  const ctx1 = ctxFor();
  const first = createTrace({ store, target: fakeTarget(), now: () => 0 });
  first.init(ctx1);
  ctx1.emit('level/loaded', { name: 'teach-00' });

  // Second page load: same store, fresh everything else, frame back to 0.
  const ctx2 = ctxFor();
  const second = createTrace({ store, target: fakeTarget(), now: () => 0 });
  second.init(ctx2);
  ctx2.emit('level/loaded', { name: 'loop-01' });

  const entries = JSON.parse(second.dump());
  const loaded = entries.filter((e) => e.name === 'level/loaded');
  assert.equal(loaded.length, 2, 'the second load clobbered the first');
  assert.ok(loaded[1].seq > loaded[0].seq, 'seq must be monotonic across loads');
  assert.equal(entries.filter((e) => e.kind === 'boot').length, 2,
    'each page load must leave a boot marker so frame and t can be interpreted');
});

test('clear() is what begins a session', () => {
  const store = fakeStore();
  const ctx = ctxFor();
  const t = createTrace({ store, target: fakeTarget(), now: () => 0 });
  t.init(ctx);
  ctx.emit('level/loaded', { name: 'teach-00' });
  assert.ok(JSON.parse(t.dump()).length > 0);

  t.clear();
  assert.equal(JSON.parse(t.dump()).length, 0);
});
