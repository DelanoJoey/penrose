# P21 — play-test instrumentation and the frame rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the simulation run at a true 60 Hz on any display, record a play session in enough detail to reconstruct it, and make level branching computable — so the first play-test since P17 produces evidence instead of a sentence.

**Architecture:** Four independent changes behind one goal. An accumulator in `Engine.start()` decouples simulation rate from display refresh rate; `start()` is unreachable in lockstep so the pixel gate is untouched. A dev-only subsystem `src/dev/trace.js`, active only under `?trace=1`, subscribes to all nine engine events *and* attaches its own `keydown` listener — necessary because `src/ui` dispatches movement by calling `player.step()` directly and two of that method's refusal paths emit nothing. `Structure.branching()` joins `minTurnsBetween`/`minWalksBetween` in geometry and is surfaced by `analyze.mjs` and `search.mjs`. Finally a written protocol so the session is repeatable.

**Tech Stack:** Vanilla ES modules, `node:test` + `node:assert/strict`, Vite dev server, Playwright (existing, for the framerate re-measure only).

**Spec:** `docs/superpowers/specs/2026-07-27-playtest-and-frame-rate-design.md`

**Branch:** `feature/p21-decision-density`, off `main` @ `bf49aa4`.

---

## Before you start

Read these, in this order. They are short and each one contains a rule this plan
depends on:

1. `ARCHITECTURE.md` §1 (determinism), §1.2 (the instrumentation exemption),
   §3.1 (subsystem interface), §3.2 (`src/core` is reserved), §3.3 (event
   vocabulary, and "an event may not carry a timestamp"), §4 (lockstep).
2. The spec above, in full.
3. `src/ui/index.js` lines 1-46 — the header that explains why input is gated on
   `!(capture || lockstep)`. The recorder inherits that rule.

**A worktree has no `node_modules`.** Run `npm install` first (~1 s) or every
tool fails with `ERR_MODULE_NOT_FOUND`. Node resolves from the *file's*
location, so a scratch script outside the repo cannot import its deps.

**`timeout` is not on this box** (BSD userland). Use background runs plus
`pkill`.

**Baseline, established before any change:** `npm test` → **227 pass, 0 fail**.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/core/engine.js` | modify | frame loop only — the accumulator lives in `start()`; `step()` and `pump()` are not touched |
| `src/core/engine.test.js` | create | lockstep guard, source-level clock ban, accumulator behaviour |
| `src/core/config.js` | modify | one new `trace` flag, following the `hud` pattern |
| `src/dev/trace.js` | create | the recorder: event subscriptions, keydown capture, O(1) persistence, dump/save/clear |
| `src/dev/trace.test.js` | create | inert-in-capture, ordering, failure isolation, payload fidelity, reload continuity |
| `src/main.js` | modify | conditional registration, first, when `config.trace` |
| `src/geometry/index.js` | modify | add `Structure.branching()` beside the other two cost methods |
| `src/geometry/branching.test.js` | create | hand-checked fixtures, the campaign pin, and agreement with `minWalksBetween` |
| `tools/analyze.mjs` | modify | report the five branching fields |
| `tools/search.mjs` | modify | `--min-forks=N` as a late filter |
| `docs/playtest/PROTOCOL.md` | create | the session procedure and the four hypotheses |
| `ARCHITECTURE.md` | modify | add the missing `level/failed` row to §3.3 |
| `docs/superpowers/specs/2026-07-27-...-design.md` | modify | amend §3.3/§3.4 to the simplified key scheme (Task 3) |

`npm test` runs `node --test test/*.test.js src/*/*.test.js`. Both globs are
**exactly one level deep**. Every path above is chosen to be collected — a test
file anywhere else silently does not run.

---

## Task 1: The frame loop accumulator

`Engine.step()` advances a constant `fixedDt` and is called once per
`requestAnimationFrame` with no accumulator, so simulation rate tracks display
refresh rate. Measured 1.844 sim-seconds per wall-second on the target machine.

**Files:**
- Create: `src/core/engine.test.js`
- Modify: `src/core/engine.js:73-83` (`start()` only)

- [ ] **Step 1: Write the failing tests**

Create `src/core/engine.test.js`:

```js
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
  assert.ok(h.engine.time.frame <= 5,
    `a 30-second gap produced ${h.engine.time.frame} frames — MAX_STEPS did not hold`);

  // And the residue must be DROPPED, not carried: the next ordinary frame runs
  // at most one step. Without that, the loop spends the next several frames
  // draining the accumulator, which is the burst the clamp exists to prevent.
  const after = h.engine.time.frame;
  h.tick(30_016);
  assert.ok(h.engine.time.frame - after <= 1,
    'the accumulator carried a backlog past the clamp');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test src/core/engine.test.js
```

Expected: the two lockstep/clock tests **pass** (they describe existing
behaviour), and the three pacing tests **fail** — 120 Hz yields 240 frames,
30 Hz yields 60, the stall yields 1.

- [ ] **Step 3: Implement the accumulator**

In `src/core/engine.js`, add the constants above the class:

```js
/**
 * Seconds of real time a single tick may absorb. A tab that was backgrounded
 * for thirty seconds must not return and fast-forward 1,800 steps.
 */
const MAX_CATCHUP = 0.25;

/** Hard bound on the inner loop, whatever the accumulator says. */
const MAX_STEPS = 5;
```

Replace `start()` (lines 73-83) with:

```js
  /**
   * Interactive loop. Never started in lockstep mode.
   *
   * WHY THIS IS AN ACCUMULATOR AND NOT ONE STEP PER FRAME. step() advances a
   * CONSTANT fixedDt, so calling it once per animation frame ties simulation
   * speed to display refresh rate: measured 1.844 sim-seconds per wall-second
   * on a 120 Hz panel, which made every wall-clock number in METHODOLOGY --
   * "1.633 s", "21.5 seconds of optimal play" -- true only at 60 Hz, and true
   * nowhere it was actually being read. See METHODOLOGY §P21.
   *
   * The timestamp comes from requestAnimationFrame's own argument, so this file
   * still reads no clock and src/core/engine.test.js can ban clock calls
   * outright rather than carve out an exception a later change could widen.
   *
   * Both clamps drop time rather than repaying it: after a stall the simulation
   * is permanently behind wall time, which is correct for a game with no
   * network and nothing to reconcile, and is what stops a returning tab from
   * animating a burst nobody can follow.
   */
  start() {
    if (this._running || this.config.lockstep) return;
    this._running = true;
    let last = null;
    let acc = 0;
    const tick = (now) => {
      if (!this._running) return;
      if (last === null) last = now;
      acc += Math.min((now - last) / 1000, MAX_CATCHUP);
      last = now;
      let steps = 0;
      while (acc >= this.time.fixedDt && steps < MAX_STEPS) {
        this.step();
        acc -= this.time.fixedDt;
        steps += 1;
      }
      // Hitting the bound means we are behind by more than we will ever repay.
      // Keeping the remainder would spend the next several frames draining it.
      if (steps === MAX_STEPS) acc = 0;
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test src/core/engine.test.js
```

Expected: 5 pass, 0 fail.

- [ ] **Step 5: Run the whole suite**

```bash
npm test
```

Expected: **232 pass, 0 fail** (227 + 5).

- [ ] **Step 6: Prove the gate is untouched**

This is the only real evidence that the accumulator cannot reach a captured
frame. The two guards above are cheaper checks that fail earlier.

```bash
npx playwright install chromium    # once per worktree
npm run gate
```

Expected: **20 shots, gate PASS**, byte-identical to `main`. If any shot
differs, stop — `start()` has become reachable from a capture path and the
change is wrong, not the gate.

- [ ] **Step 7: Commit**

```bash
git add src/core/engine.js src/core/engine.test.js
git commit -m "engine: the simulation ran at display refresh rate

step() advances a constant fixedDt and was called once per animation frame, so
the game ran at 1.844x on a 120 Hz panel -- measured, in a real browser, on the
machine the play-test will run on. Every wall-clock number in METHODOLOGY
carried an unstated 60 Hz assumption.

An accumulator in start(), which lockstep never reaches, so the gate is
byte-identical. The timestamp comes from rAF's own argument rather than
performance.now(), which lets the new guard ban clock reads in this file
outright instead of carving out an exception."
```

---

## Task 2: Config flag

**Files:**
- Modify: `src/core/config.js`

- [ ] **Step 1: Add the flag**

In the returned object, after `hud`:

```js
    /**
     * Play-session recording (src/dev/trace.js). Off by default and never set
     * by any capture, so the gate sees an unchanged program. See
     * METHODOLOGY §P21 and the spec at
     * docs/superpowers/specs/2026-07-27-playtest-and-frame-rate-design.md §3.
     */
    trace: flag('trace'),
```

- [ ] **Step 2: Verify nothing broke**

```bash
npm test
```

Expected: 232 pass. No new tests here — the flag is exercised by Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/core/config.js
git commit -m "config: a trace flag, off by default"
```

---

## Task 3: The recorder

**Files:**
- Create: `src/dev/trace.js`
- Create: `src/dev/trace.test.js`
- Modify: `src/main.js`
- Modify: `docs/superpowers/specs/2026-07-27-playtest-and-frame-rate-design.md` §3.3, §3.4

### Design note: the spec's key scheme is simplified here

Spec §3.3 derives a session index by scanning for the highest existing one and
using it "if the page was reloaded within the same session or that index + 1 for
a new one". **The recorder cannot tell those two cases apart** without a clock
or an explicit signal, so the rule is not implementable as written.

The resolution is simpler and strictly better: **the recorder always continues
whatever is already in the store.** Reloads accumulate into one session, which
is exactly what a play-test wants, since §5.2 step 4 treats reaching for reload
as a finding rather than an interruption. A new session begins when the operator
calls `clear()`, which §5.2 step 1 already requires. No session index is needed
at all, so keys are `penrose:trace:<seq>` with `seq` zero-padded so lexical
order is numeric order.

`frame` and the wall-clock `t` both reset on reload. Rather than add state to
reconcile them, the recorder writes one `{kind:'boot'}` entry at init, so a
reader can see exactly where each page load begins. **Amend the spec in this
task's commit** — a spec and a plan that disagree is the failure this project
keeps recording.

- [ ] **Step 1: Write the failing tests**

Create `src/dev/trace.test.js`:

```js
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
  // Engine._emit has no try/catch (src/core/engine.js:42-46): one throwing
  // listener kills every listener registered after it. The recorder subscribes
  // to nine events during the one session this phase exists to run, so it must
  // swallow its own failures. THIS TEST MUST ACTUALLY MAKE IT THROW -- a
  // version that does not will pass against an unwrapped implementation, which
  // is the P18/P19 failure repeating.
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
  const t = createTrace({ store: fakeStore(), target, now: () => 7 });
  t.init(ctx);

  const payload = { from: '0,0,0', to: '0,0,1', viaIllusion: true };
  ctx.emit('player/moved', payload);

  const entry = JSON.parse(t.dump()).find((e) => e.name === 'player/moved');
  assert.deepEqual(entry.payload, payload);
  assert.equal(entry.t, 7, 'the stamp belongs on the entry');
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test src/dev/trace.test.js
```

Expected: FAIL, `Cannot find module './trace.js'`.

- [ ] **Step 3: Implement the recorder**

Create `src/dev/trace.js`:

```js
/**
 * Play-session recorder. Off unless `?trace=1`.
 *
 * WHY THIS EXISTS. P18, P19 and P20 each shipped against a single observation
 * of one person playing, and the whole of that observation was a sentence: "I
 * dont know, I cant do anything but bounce around." None of the three fixes has
 * been in front of a player since. This subsystem is the difference between the
 * next session producing another sentence and producing something a later phase
 * can argue with.
 *
 * WHY IT LISTENS FOR KEYS AND NOT ONLY FOR EVENTS. src/ui dispatches a movement
 * key by calling `player.step()` directly (src/ui/index.js:587), not by
 * emitting, and `step()` has two paths that emit nothing at all: it returns
 * early while the level is lost -- the entire 72-frame window before the retry
 * lands -- and it skips `player/blocked` when no level is loaded. An
 * events-only recorder is therefore blind in exactly the two moments worth
 * understanding, and a player mashing keys during a reload would produce a
 * trace showing that nothing happened. The raw key is recorded and NOT
 * classified: `resolveKey` stays in src/ui, and interpretation happens offline.
 * A trace is a record, not an interpreter.
 *
 * WALL CLOCK. `now()` is a `performance.now()` pair and this is the only
 * wall-clock read in the subsystem. ARCHITECTURE.md §1.2 permits pure
 * instrumentation to do that and requires the file be named: it is this one.
 * Nothing here feeds rendered output, and §3.5 of the spec keeps the whole
 * subsystem unregistered in capture and lockstep, where §4's rule about paths
 * that advance state outside __PUMP__ applies.
 *
 * FAILURE ISOLATION. Engine._emit has no try/catch, so one throwing listener
 * aborts every listener registered after it. Nine subscriptions during the one
 * session this exists to run is nine chances to take the game down with a
 * quota error, so the handler swallows everything and drops entries instead.
 * That is a workaround for open item B3, and it is also the fresh argument B3
 * has been waiting for: the engine's failure isolation is currently supplied by
 * convention among listeners, and every listener added is a place that
 * convention can lapse.
 */

const PREFIX = 'penrose:trace:';
const PAD = 8;

/** Every event the project emits. ARCHITECTURE §3.3, plus level/failed (P19). */
const EVENTS = [
  'player/moved',
  'player/blocked',
  'world/rotate-request',
  'world/rotated',
  'level/load-request',
  'level/loaded',
  'level/solved',
  'level/failed',
  'campaign/complete',
];

export function createTrace({
  store = globalThis.localStorage,
  target = globalThis,
  now = () => performance.now(),
} = {}) {
  let seq = 0;
  let t0 = 0;
  let ctx = null;
  let onKeyDown = null;

  const keys = () => {
    const out = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(PREFIX)) out.push(k);
    }
    return out.sort();
  };

  /**
   * O(1) per entry. Serialising a growing array on every entry is O(n^2), and
   * the reload that P17 documents as the only escape from a bad position is
   * exactly the event that would otherwise destroy the session.
   */
  const write = (kind, name, payload) => {
    try {
      const entry = {
        seq,
        frame: ctx?.time?.frame ?? 0,
        t: Math.round(now() - t0),
        kind,
        name,
        payload,
      };
      store.setItem(PREFIX + String(seq).padStart(PAD, '0'), JSON.stringify(entry));
      seq += 1;
    } catch {
      // Dropped deliberately. See FAILURE ISOLATION above.
    }
  };

  return {
    name: 'trace',

    init(c) {
      ctx = c;
      // Same rule as src/ui: no input path and no side effects in capture or
      // lockstep, independently of any other flag.
      if (c.config.capture || c.config.lockstep) return;
      t0 = now();

      const existing = keys();
      seq = existing.length
        ? Number(existing[existing.length - 1].slice(PREFIX.length)) + 1
        : 0;

      write('boot', 'trace/boot', { frameOrigin: c.time.frame });

      for (const name of EVENTS) {
        c.on(name, (payload) => { write('event', name, payload); });
      }

      onKeyDown = (event) => {
        write('key', 'keydown', {
          code: event.code,
          key: event.key,
          repeat: !!event.repeat,
          modified: !!(event.ctrlKey || event.metaKey || event.altKey),
        });
      };
      target.addEventListener('keydown', onKeyDown);
    },

    /** Every entry in the store, ordered, as JSON. */
    dump() {
      return JSON.stringify(keys().map((k) => JSON.parse(store.getItem(k))), null, 2);
    },

    /**
     * The same string as a downloaded file. Exists because the alternative is
     * asking somebody to select several thousand lines out of a devtools
     * console at the end of a session, and losing a session to a mis-click is
     * worth ten lines of code. Called explicitly; never automatic.
     */
    save(document = globalThis.document) {
      const blob = new Blob([this.dump()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'penrose-trace.json';
      a.click();
      URL.revokeObjectURL(url);
      return true;
    },

    /** Empties the store. This is what BEGINS a session -- see the protocol. */
    clear() {
      for (const k of keys()) store.removeItem(k);
      seq = 0;
    },

    dispose() {
      if (onKeyDown) target.removeEventListener('keydown', onKeyDown);
      onKeyDown = null;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test src/dev/trace.test.js
```

Expected: 7 pass, 0 fail.

- [ ] **Step 5: Wire it into main.js**

In `src/main.js`, add the import beside the existing dev import:

```js
import { createTrace } from './dev/trace.js';
```

and register it **before** `render`, replacing the `await engine.add(render);`
line with:

```js
// FIRST, when enabled. addEventListener fires in registration order, so the
// recorder's keydown entry precedes the engine events that keypress causes and
// the trace reads in causal order. It consumes ctx.on and ctx.time only -- both
// exist from the Engine constructor -- so it does not need the scene that the
// comment below is about. With the flag unset nothing is registered, no
// listener is attached, and the gate sees an unchanged program.
if (config.trace) globalThis.__TRACE__ = await engine.add(createTrace());

await engine.add(render);
```

- [ ] **Step 6: Amend the spec to match**

Edit `docs/superpowers/specs/2026-07-27-playtest-and-frame-rate-design.md`:

- §3.3, replace the "session id is derived, not random" paragraph with the
  simplified rule: the recorder continues whatever is in the store, `clear()`
  begins a session, keys are `penrose:trace:<seq>` zero-padded, and a `boot`
  entry marks each page load because `frame` and `t` reset with it.
- §3.4, change `dump()`'s description from "across every session" to "every
  entry in the store", and drop `<session>` from the download filename.

- [ ] **Step 7: Run the whole suite and the gate**

```bash
npm test
npm run gate
```

Expected: **239 pass, 0 fail** (232 + 7), and gate PASS byte-identical — the
flag is off in every capture, so nothing is registered.

- [ ] **Step 8: Verify it actually records in a real browser**

The unit tests use a fake store and a fake target. This is the only step that
exercises the real `localStorage`, the real `keydown` path and `save()`.

```bash
npx vite --port 5301 --strictPort &
```

Open `http://localhost:5301/?trace=1`, press a few arrow keys including one that
does nothing, then in the console:

```js
JSON.parse(__TRACE__.dump()).length     // > 0
__TRACE__.save()                        // downloads penrose-trace.json
```

Confirm a key that produced no movement still appears as a `kind: 'key'` entry
with no `event` entry after it. Then `pkill -f "vite --port 5301"`.

- [ ] **Step 9: Commit**

```bash
git add src/dev/trace.js src/dev/trace.test.js src/main.js docs/superpowers/specs/
git commit -m "dev: record the session, including the keys that did nothing

Events alone are not enough. src/ui dispatches movement by calling
player.step() directly, and step() returns silently while the level is lost and
skips player/blocked when no level is loaded -- so an events-only trace goes
blank in the two moments worth reading. The recorder takes the raw keydown and
does not classify it; interpretation happens offline.

Wrapped so it cannot throw, because _emit still has no try/catch and a throwing
listener aborts every listener after it. That is B3's missing argument, written
down rather than acted on.

Spec §3.3's session-index rule was not implementable -- the recorder cannot
distinguish a reload from a new session without a clock. Amended: it continues
the store, and clear() begins a session."
```

---

## Task 4: `Structure.branching()`

**Files:**
- Modify: `src/geometry/index.js` (add a method to `Structure`, after `minWalksBetween`)
- Create: `src/geometry/branching.test.js`
- Modify: `docs/superpowers/specs/2026-07-27-playtest-and-frame-rate-design.md` §6

Spec §6's test table puts the campaign fork pin in `test/true-minturns.test.js`.
It belongs with the other branching tests instead — that file is about declared
versus measured `minTurns`, and the pin is a geometry property, not a curve
property. Amend the spec row in this task's commit rather than leaving the two
documents disagreeing.

- [ ] **Step 1: Write the failing tests**

Create `src/geometry/branching.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { Structure, cellId } from './index.js';
import { LEVELS, ORDER } from '../world/levels.js';

/**
 * A FORK is a position where two different neighbours each STRICTLY reduce the
 * remaining walks to the goal, so the player must pick and neither pick is
 * forced.
 *
 * The definition is the whole value of the metric and it is narrower than it
 * looks. A first pass counted positions whose neighbours merely DIFFER in
 * remaining cost and reported 173 of 358 for the shipping campaign, where the
 * honest answer is 1 -- because on a corridor you may always also walk
 * backwards, and that is not a decision. A metric that counts corridors as
 * decisions would aim level selection somewhere worse than turn count already
 * does.
 */

test('a corridor has no forks', () => {
  // A straight run of standable cells: every position offers forward, back, or
  // both, and only one of the two ever reduces the distance to the goal.
  const s = new Structure([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]]);
  const b = s.branching([0, 0, 0], [0, 0, 3]);
  assert.equal(b.forks, 0);
  assert.ok(b.positions > 0, 'the fixture has no standable positions at all');
});

test('the campaign contains exactly one fork', () => {
  // Measured 2026-07-27 across all eight levels: 358 positions, one fork, in
  // post-05. This is the number the next content phase exists to move.
  let positions = 0;
  let forks = 0;
  for (const name of ORDER) {
    const L = LEVELS[name];
    const b = new Structure(L.cells).branching(L.start, L.goal);
    positions += b.positions;
    forks += b.forks;
  }
  assert.equal(positions, 358);
  assert.equal(forks, 1);
});

test('branching agrees with minWalksBetween on every campaign cell', () => {
  // branching() takes cost-to-goal from ONE breadth-first search over the union
  // of the four rotations' path graphs, rather than one minWalksBetween per
  // cell. Turns are free -- the same decision, for the same reason -- so the
  // two must agree exactly. This is the one place the metric could silently
  // disagree with the number the move budget rests on.
  for (const name of ORDER) {
    const L = LEVELS[name];
    const s = new Structure(L.cells);
    const costs = s.branching(L.start, L.goal).costs;
    for (const [id, viaUnion] of costs) {
      const viaDijkstra = s.minWalksBetween(id.split(',').map(Number), L.goal);
      assert.equal(viaUnion, viaDijkstra,
        `${name} ${id}: union graph says ${viaUnion}, minWalksBetween says ${viaDijkstra}`);
    }
  }
});

test('an unreachable goal reports null rather than zero', () => {
  const s = new Structure([[0, 0, 0], [9, 0, 9]]);
  assert.equal(s.branching([0, 0, 0], [9, 0, 9]), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test src/geometry/branching.test.js
```

Expected: FAIL, `s.branching is not a function`.

- [ ] **Step 3: Implement `branching()`**

In `src/geometry/index.js`, insert after `minWalksBetween` (before `premise`):

```js
  /**
   * How much CHOICE a level offers, which is not what any other measurement
   * here reports.
   *
   * The campaign's difficulty curve is declared in turns and every level was
   * selected on turns. Turn count says nothing about whether a position offers
   * a decision: measured across all eight shipping levels, `crook-06` requires
   * six turns and contains no fork at all, `arm-04` has par 12 and contains
   * none, and the whole campaign holds ONE across 358 positions. Roughly half
   * of the augmented pool has at least one. Nothing had ever computed it, so
   * nothing had ever selected on it.
   *
   * COST COMES FROM ONE SEARCH, NOT ONE PER CELL. Turns are free -- the same
   * decision, for the same reason, as in minWalksBetween -- so walking cost is
   * rotation-independent and a single breadth-first search from the goal over
   * the UNION of the four rotations' path graphs gives every cell's remaining
   * walks. src/geometry/branching.test.js asserts that agrees with
   * minWalksBetween on every campaign cell, because that is the one place this
   * could silently disagree with the number the move budget rests on.
   *
   * @returns {{positions:number, forks:number, choices:number, maxDegree:number,
   *            zeroMoves:number, costs:Map<string,number>}|null}
   *          null if the goal is unreachable from the start.
   */
  branching(fromCell, toCell) {
    const graphs = [0, 1, 2, 3].map((t) => this.pathGraph(t));

    const adj = new Map();
    for (const g of graphs) {
      for (const [id, tos] of g) {
        if (!adj.has(id)) adj.set(id, new Set());
        for (const to of tos) adj.get(id).add(to);
      }
    }

    const goal = cellId(...toCell);
    const start = cellId(...fromCell);
    if (!adj.has(goal) || !adj.has(start)) return null;

    const costs = new Map([[goal, 0]]);
    const queue = [goal];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const d = costs.get(cur);
      for (const n of adj.get(cur) ?? []) {
        if (!costs.has(n)) { costs.set(n, d + 1); queue.push(n); }
      }
    }
    if (!costs.has(start)) return null;

    let positions = 0, forks = 0, choices = 0, maxDegree = 0, zeroMoves = 0;
    for (const g of graphs) {
      for (const [id, tos] of g) {
        positions += 1;
        const uniq = [...new Set(tos)];
        if (uniq.length > maxDegree) maxDegree = uniq.length;
        if (uniq.length === 0) zeroMoves += 1;
        if (uniq.length >= 2) choices += 1;

        const here = costs.get(id);
        if (here == null || uniq.length < 2) continue;
        // STRICTLY closer, on two different neighbours. "Differs in cost" would
        // also count walking back the way you came, which is not a decision.
        let better = 0;
        for (const n of uniq) {
          const c = costs.get(n);
          if (c != null && c < here) better += 1;
        }
        if (better >= 2) forks += 1;
      }
    }

    return { positions, forks, choices, maxDegree, zeroMoves, costs };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test src/geometry/branching.test.js
```

Expected: 4 pass, 0 fail.

**If `positions` is not 358 or `forks` is not 1, stop and do not adjust the
expected numbers.** They were measured against this exact `Structure` on
2026-07-27. A disagreement means either the implementation differs from the one
that produced them or the campaign changed; find out which before touching the
assertion.

- [ ] **Step 5: Amend the spec's test table**

In `docs/superpowers/specs/2026-07-27-playtest-and-frame-rate-design.md` §6,
change the last row's file from `test/true-minturns.test.js` to
`src/geometry/branching.test.js`, per the note at the head of this task.

- [ ] **Step 6: Commit**

```bash
git add src/geometry/index.js src/geometry/branching.test.js docs/superpowers/specs/
git commit -m "geometry: measure choice, not just turns

The campaign has exactly ONE fork across 358 positions. crook-06 requires six
turns and has none; arm-04 has par 12 and has none. Turn count -- the number
every level was selected on -- does not predict whether a position offers a
decision, and roughly half the augmented pool has at least one.

A fork is two neighbours that each STRICTLY reduce remaining walks. Counting
neighbours that merely differ in cost gives 173 of 358, because on a corridor
you may always walk backwards, and that is not a decision."
```

---

## Task 5: Surface it in the tools

**Files:**
- Modify: `tools/analyze.mjs`
- Modify: `tools/search.mjs`

- [ ] **Step 1: Report it in `analyze.mjs`**

After the `measured` block, add:

```js
  branching: (() => {
    const b = s.branching(level.start, level.goal);
    if (!b) return null;
    const { costs, ...rest } = b;   // the cost map is machinery, not a report
    return rest;
  })(),
```

Do **not** rename or remove any existing field. Renaming `minWalks` to `par`
already left `analyze.mjs` testing `decl.minWalks` — always undefined, a dead
check that still printed OK.

- [ ] **Step 2: Verify against a known level**

```bash
node tools/analyze.mjs post-05
```

Expected: a `branching` object reporting `forks: 1` — `post-05` holds the
campaign's only one. Then:

```bash
node tools/analyze.mjs crook-06
```

Expected: `forks: 0`.

- [ ] **Step 3: Add `--min-forks` to `search.mjs`**

Read the premise-mode block first (`tools/search.mjs`, from `if (args.turns != null)`).
The cascade is deliberately cheap-first — §P20 repaired exactly that ordering,
taking premise mode from ten minutes to 75 seconds. Add the filter **after**
`minTurnsBetween` and the standable-goal check and **before** `premise()`:

Read it once, beside the existing `TARGET` and `SPUR_MAX` at the top of the
block:

```js
  const MIN_FORKS = Number(args['min-forks'] ?? 0);
```

and apply it inside the pair loop, on the line after the `minTurnsBetween`
check:

```js
              if (s.minTurnsBetween(from, to) !== TARGET) continue;
              if (MIN_FORKS > 0) {
                const b = s.branching(from, to);
                if (!b || b.forks < MIN_FORKS) continue;
              }
```

- [ ] **Step 4: Verify it filters and does not slow the tool down**

```bash
time node tools/search.mjs --turns=4                  # baseline: 928 shapes, ~75 s
time node tools/search.mjs --turns=4 --min-forks=1    # strictly fewer, similar time
```

Expected: the second count is `<=` the first, and runtime has not regressed by
more than a few seconds. **Record both counts in the commit message** — this
tool's history is that its printed counts were wrong for twelve phases, so a
number nobody wrote down is a number nobody can diff.

- [ ] **Step 5: Commit**

```bash
git add tools/analyze.mjs tools/search.mjs
git commit -m "tools: report and select on branching

analyze.mjs reports forks/choices/maxDegree/zeroMoves per level. search.mjs
gains --min-forks=N, applied after the turn target and before premise() so the
cascade stays cheap-first.

--turns=4 alone: <N> shapes. --turns=4 --min-forks=1: <M>."
```

---

## Task 6: The protocol, and the documentation gap

**Files:**
- Create: `docs/playtest/PROTOCOL.md`
- Modify: `ARCHITECTURE.md` §3.3

- [ ] **Step 1: Write the protocol**

Create `docs/playtest/PROTOCOL.md` from spec §5, in full: the four hypotheses
with their falsification conditions, the seven procedure steps, and the output
paths. Two things must survive verbatim into it:

- the scripted opening line, and the list of words that must not be said
  (adjacency, illusion, impossible, goal marker, rotation);
- "a hypothesis with no trace entry bearing on it is recorded as **untested**,
  not as held".

- [ ] **Step 2: Add the missing event row**

`ARCHITECTURE.md` §3.3's table lists eight events; the project emits nine.
`level/failed` was added in P19 and never documented. Add, after `level/solved`:

```markdown
| `level/failed` | `player` | `{ moves, budget, turns }` — the move budget was spent without solving. Emitted once per level attempt, checked AFTER the solve and gated on `!solved`, so a final walk onto the goal wins even when it is the last one allowed. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/playtest/PROTOCOL.md ARCHITECTURE.md
git commit -m "docs: the play-test protocol, and the event P19 never documented

ARCHITECTURE §3.3 listed eight events; the project emits nine. level/failed
shipped in P19 undocumented, and the recorder subscribes to it."
```

---

## Task 7: Verification

Nothing here is new code. It is the evidence the phase is allowed to claim.

- [ ] **Step 1: Full suite**

```bash
npm test
```

Expected: **243 pass, 0 fail** (227 baseline + 5 engine + 7 trace + 4 branching).
If the count differs, reconcile it before continuing — do not round.

- [ ] **Step 2: Gate, byte-identical**

```bash
npm run gate
```

Expected: 20 shots, **PASS**. This is the load-bearing check for Task 1.

- [ ] **Step 3: Re-measure the frame rate**

Re-run the headed measurement that produced 1.844 before the fix:

```bash
npx vite --port 5301 --strictPort &
node <scratch fps script> http://localhost:5301/
pkill -f "vite --port 5301"
```

Expected: **1.000 ± 0.02 sim-seconds per wall-second**, and roughly 110 frames
per wall-second still being *delivered* — the display is unchanged, only what
the simulation does with them. Record the measured figure.

- [ ] **Step 4: Mutation testing on the new guards**

Standing practice, and it has paid in each of the last two phases. Apply each
mutant, confirm a test fails, revert:

| mutant | must be caught by |
|---|---|
| `MAX_STEPS` → `Infinity` | the stall test |
| drop `if (steps === MAX_STEPS) acc = 0;` | the stall test's second assertion |
| `acc >= this.time.fixedDt` → `acc > 0` | the 120 Hz test |
| remove the recorder's `try`/`catch` | the isolation test |
| recorder writes `t` into the payload | the payload test |
| recorder's `init` drops the capture/lockstep guard | the inert test |
| `better >= 2` → `better >= 1` in `branching()` | the corridor and campaign tests |

**A surviving mutant is a finding, not a formality.** P19's two survivors were
both defects in the tests. Before adjusting anything, check which of the two is
wrong — P18 withdrew a mutant that violated nothing, and adjusting to it would
have weakened a correct test.

- [ ] **Step 5: Commit any test repairs, then open the PR**

```bash
git push -u origin feature/p21-decision-density
gh pr create --title "P21: play-test instrumentation, and the frame the numbers were measured in" --body "..."
```

The PR body states the measured numbers: 227 → 243 tests, gate PASS, and the
frame-rate figure before and after.

---

## What this plan does NOT do

Carried from spec §9, restated because a plan is what gets read at 2am:

- **No new levels.** Task 4 makes the number computable; choosing levels is the
  next phase, and the evidence for which levels does not exist until the
  play-test runs.
- **No change to the movement model.** One step off an optimal route costs
  exactly two walks, always, on any figure — that is a property of undirected
  unit-cost graphs, not of these levels. Making mistakes expensive means
  changing the model, and that is a bigger phase.
- **B3 is not opened.** Task 3 records the argument and works around it.
- **Issue #16 is untouched.**
- **No grading instrumentation.** §P17 said stop. Task 3 measures the *player*;
  the panel measures the picture.

## After the plan

The play-test itself is not a task in this plan — it needs a person. Once Task 7
is green, the next action is the session in `docs/playtest/PROTOCOL.md`, with a
fresh player, in person, at `?trace=1`, and its output written to
`~/claude/projects/penrose/`.
