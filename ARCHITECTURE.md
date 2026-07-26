# ARCHITECTURE

This is the contract. Every agent working in this repository reads this file
before changing anything, and every change is judged against it.

---

## 1. The determinism contract

**Rule: the same frame index must produce the same pixels, on every run and on
every machine.**

This is not a style preference. It is the precondition for the pixel gate in §5,
and the pixel gate is the only mechanism by which any optimization, refactor or
art change in this repository can be *proven* rather than asserted. If
determinism breaks, nothing downstream is measurable.

### 1.1 Forbidden in any code path that affects rendered output

| Forbidden | Use instead |
|---|---|
| `performance.now()` | `ctx.time.raw` |
| `Date.now()`, `new Date()` | `ctx.time.raw` |
| `Math.random()` | `ctx.rng()` |
| `setTimeout` / `setInterval` driving visual state | frame counts via `ctx.time.frame` |
| `requestAnimationFrame` inside a subsystem | the engine owns the only frame loop |
| `document.timeline`, CSS animations/transitions on captured DOM | engine-driven values |
| network fetch of any asset | generate it procedurally at load |

"Affects rendered output" includes animation, simulation, camera, easing,
particle seeding, procedural generation, and anything that feeds a uniform.

### 1.2 The one exemption

Pure instrumentation may read wall-clock time — a `performance.now()` pair used
*only* to log how long an init step took does not affect output. If you leave
one in place, say so explicitly in your report and name the file. Do not churn
them.

### 1.3 Why this is stated up front

The harness in this repository is adapted from a project that retrofitted it
onto finished code. That retrofit cost a dedicated remediation pass across six
subsystems, plus a second pass whose only job was verifying the first one
landed, because subsystems had been animating off wall-clock time. Enabling a
1.4-second shader pre-warm shifted 78–88% of pixels, which made every
performance claim unfalsifiable until it was fixed.

Declaring the contract on day one costs nothing. Recovering it later costs two
phases of work. See `NOTICE`.

---

## 2. Time and randomness

`ctx.time` is the only clock:

```js
ctx.time.frame     // integer frame index, starts at 0
ctx.time.dt        // seconds elapsed this frame, scaled
ctx.time.raw       // unscaled seconds since boot
ctx.time.elapsed   // scaled seconds since boot
ctx.time.scale     // time scale, 1.0 normally
```

In lockstep mode `dt` is exactly `1/60` every frame regardless of how long the
frame actually took. That is the whole point: round-trip latency between the
harness and the page cannot advance simulation state.

`ctx.rng` is a seeded PRNG (`sfc32`). It is reseeded deterministically from
`config.seed`. `ctx.rng.fork(label)` returns an independent stream so one
subsystem consuming a different number of values cannot shift another
subsystem's sequence — **use a fork, never the root stream**, or you introduce
cross-subsystem coupling that behaves exactly like a nondeterminism bug.

---

## 3. Subsystems

### 3.1 Interface

Every subsystem is a directory under `src/` with an `index.js` default-exporting:

```js
export default {
  name: 'geometry',
  async init(ctx) {},        // build resources; may be async
  update(ctx) {},            // per-frame, uses ctx.time.dt
  fixedUpdate(ctx, h) {},    // fixed-step simulation, h is constant
  dispose() {},
};
```

Only `src/render` may call into the WebGL renderer. Only `src/core` may own a
frame loop.

### 3.2 Directory ownership

One owner per directory. Do not edit outside your assigned directory — if your
change requires something elsewhere, report it as `needsElsewhere` and let
integration apply it.

| Directory | Owns | Coupling |
|---|---|---|
| `src/core` | engine, clock, rng, config, ctx, lockstep hooks | **reserved** — integration only |
| `src/render` | renderer, camera rig, post chain, palette application | coupled with `world`, `fx` |
| `src/geometry` | isometric projection, impossible-geometry path graph, rotation mechanics, solvability | **coupled core** — single owner, never fanned out |
| `src/world` | level content, tile kit, props, level definitions | coupled with `geometry` |
| `src/player` | avatar state, traversal along the path graph | consumes `geometry` |
| `src/ui` | HUD, level select, transitions | independent |
| `src/audio` | procedural audio synthesis | independent |
| `src/fx` | particles, dissolve/assemble transitions | coupled with `render` |
| `src/dev` | shot registry, debug overlays | independent |
| `tools` | capture, diff, profile, gate | independent |

### 3.3 Event vocabulary

Subsystems talk through `ctx.emit(event, payload)` / `ctx.on(event, fn)` and
never by importing each other. The only permitted direct reach is
`ctx.peek(name)` for a read, and `src/geometry` which is a pure module with no
engine state.

| Event | Emitted by | Payload |
|---|---|---|
| `player/moved` | `player` | `{ from, to, viaIllusion }` — cell ids; `viaIllusion` is true when the edge was not 3D-adjacent |
| `player/blocked` | `player` | `{ from, direction }` — attempted a step with no edge |
| `world/rotated` | `world` | `{ from, to }` — quarter-turn indices |
| `level/loaded` | `world` | `{ name, cells, start, goal }` |
| `level/solved` | `player` | `{ moves, turns }` |

**An event may not carry a timestamp.** Anything time-derived must be read from
`ctx.time` at the point of use, or the payload becomes a nondeterminism channel.

### 3.4 Fan-out rule

**Coupled directories get a single sequential owner. Only independent
directories are fanned out in parallel.**

Measured upstream: three rounds of six parallel agents moved a quality score
+0.46 and left frame-ruining defects *higher* than they started (60 → 47 → 66),
because lighting, sky and indirect light are one system and isolated agents kept
invalidating each other's assumptions. One sequential pass with a single owner
per coupled concern moved +1.00 and cut defects 66 → 26.

`geometry`, `render` and `world` are one coupled system here. Treat them as one.

---

## 4. Lockstep hooks

`src/main.js` installs these on `window` when the page is loaded with
`?capture=1&lockstep=1`. The harness depends on all of them.

| Hook | Contract |
|---|---|
| `window.__READY__` | `true` once boot has completed and the first frame is renderable |
| `window.__ENGINE__` | the engine handle; `ctx.peek(name)` reaches a subsystem |
| `window.__SHOTS__` | map of shot name → camera/scene setup |
| `window.__APPLY_SHOT__(name, opts)` | applies a named shot; returns `{error}` on failure |
| `window.__PUMP__(n)` | advances **exactly** `n` engine frames synchronously |
| `window.__PRESENT__(n)` | yields `n` rAFs with simulation frozen, so the compositor has certainly picked up the final frame before the shutter |
| `window.__RENDER_INFO__` | draw calls, triangles, programs, memory |

**In lockstep mode the page runs no frame loop of its own.** Nothing advances
during harness round trips or during the screenshot. `ctx.time.frame` at the
shutter is a constant on every run and every machine. If you add a code path
that advances state outside `__PUMP__`, you have broken the gate.

---

## 5. The pixel gate

The hard constraint on all optimization and refactor work: **no change to
rendered output.** A change that is faster and moves one pixel is a failed
change and must be reverted.

```bash
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/<you>-before --port=<YOUR_PORT>
# ... make your change ...
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/<you>-after  --port=<YOUR_PORT>
node tools/imagediff.mjs --a=/tmp/<you>-before --b=/tmp/<you>-after
```

It must report `identical: true`. Not "close". Not `withinEpsilon`. IDENTICAL.

`tools/baseline.mjs` isolates each shot in its own page, which is what makes the
comparison bit-reproducible. Do **not** substitute a shared-page capture for
gate purposes — shared pages drift.

If your change fails the gate you have two options and no others:

1. Find the reason it moved pixels, eliminate it, re-verify.
2. Revert it and report it as not-viable, with the reason.

**Never rationalize a diff as "imperceptible". Report it.**

Intentional art changes are the exception and are handled by re-capturing the
reference set deliberately, as a reviewed commit of its own — never by relaxing
the tolerance.

---

## 6. Measurement

```bash
node tools/profile.mjs --port=<YOUR_PORT> --dpr=2 --frames=900
```

Report the frame-time **distribution**, never a median alone. A median hides the
stalls that make an interactive scene feel broken: upstream, a static-camera
benchmark reported 94 fps on a build that ran 12–17 fps in real gameplay with
728–1236 ms stalls from lazily-compiled shaders.

`profile.mjs` reports p1/p50/p90/p95/p99/max and attributes every hitch via the
per-frame WebGL program-count delta.

Run it at least 3 times and report the spread. Single runs of this profiler vary
enough to have produced a misleading conclusion upstream.

**Target for this project: p99 ≥ 60 fps, no frame above 30 ms, at DPR 2.** The
isometric target is deliberately chosen so this is achievable rather than
aspirational — there is no cascaded-shadow/GTAO/TAA stack here to pay for.

---

## 7. Reporting

Report measured numbers, not impressions. Profiler output before and after, at
least 3 runs each, plus the imagediff verdict. If the gate cannot be made to
pass, say so plainly — a false pass invalidates every downstream claim.
