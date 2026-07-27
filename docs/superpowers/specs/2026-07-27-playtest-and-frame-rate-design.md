# The frame the numbers were measured in, and the first player since P17

**2026-07-27** · branch `feature/p21-decision-density` off `main` @ `bf49aa4`

Every number in this document was measured this session against the real
`Structure` from `src/geometry/index.js`, the real `Engine` in a real headed
browser, or `npm test` in this worktree. Where a claim rests on an argument
rather than a measurement, it says so and says which.

## The finding this rests on

The handoff's first open item is "more levels, from the pool of 928 shapes at 4
turns and 26 at 5". Selecting from that pool on turn count repeats P20's mistake
in a new place. Turn count is measurably orthogonal to whether a level contains
a choice.

Measured across all eight campaign levels, over every standable cell in every
rotation — 358 positions:

| | |
|---|---|
| mean legal walks | **1.53** of 4 |
| positions with <= 1 way out | **44%** |
| positions with zero legal walks | **10** |
| positions offering 3 or more walks | **1** |
| positions that are a FORK | **1** |

A *fork* is a position where two different neighbours each strictly reduce the
remaining walks to the goal, so the player has to pick and the pick is not
forced. There is **one** in the entire game — in `post-05`. `crook-06`, six
turns and nominally the hardest level, has none. `arm-04`, par 12, has none.

The property is not scarce in the material. Over the same enumeration
`tools/search.mjs` uses:

| | bare circuits | augmented |
|---|---|---|
| shapes | 102 | 14,410 |
| start/goal pairs (par >= 3) | 5,496 | 982,104 |
| pairs with at least one fork | **1,734** | **478,426** |
| pairs with a 3-or-more-walk position | 1,048 | — |

Roughly a third of bare pairs and half of augmented pairs have branching, and
the best bare figure has seven forks in one level. No tool in the project has
ever selected on it, because no tool has ever computed it.

### The thing that cannot be fixed by choosing levels

A separate question is whether a wrong step can be made to *cost* something.
It cannot, and this is a proof rather than a search result:

> On an undirected, unit-cost graph, adjacent vertices' distances to a fixed
> target differ by at most 1. So one step off an optimal route always leaves the
> goal exactly 2 walks further away than the best step would have — one to come
> back, one to retake.

That is every level, on every figure, under this movement model. Running it over
982,104 pairs returns 0 exceptions and adds nothing the two lines already give.

**A first pass measured this wrong.** It computed the spread of remaining-cost
among each junction's own neighbours and reported "173 consequential choices of
358", which is not a decision count — it is the count of corridor positions from
which the player may also walk *backwards*. Discarded. Recorded here because the
number looked meaningful and was not, which is this project's recurring failure
mode and worth one paragraph each time it recurs.

The consequence for design: being lost is available, being *wrong* is not, and
no amount of level selection changes that. Making a mistake expensive requires
changing the movement model — one-way edges, a resource, level state. **That is
explicitly not in this phase.**

## 1. Why this phase is a play-test and not levels

P18, P19 and P20 each shipped against a single observation: a player spent an
hour without inferring `screen-adjacent means walkable`, asked "what is the
green thing", and logged 31 successful walks on a level whose par is 8.

**None of the three has been in front of a player.** The teaching level, the
move budget and the honest curve are all untested hypotheses about a person.
Adding six branchy levels on top of three unverified fixes is the pattern
METHODOLOGY records catching, repeatedly, in this project — most recently in
§P17: "Every significant defect in this document was caught by looking. This one
was caught by someone else looking, which is the only version this project had
not tried."

The play-tester is a fresh player, in person, on a local dev server. Fresh
matters: the one question that cannot be answered any other way is whether
`teach-00` makes the rule inferable, and only somebody who does not already know
the rule can answer it.

## 2. The frame loop, which invalidates the session if left alone

`Engine.step()` advances the clock by a constant `fixedDt` and is called once
per `requestAnimationFrame`, with no accumulator and no clamp
(`src/core/engine.js:59-79`). Simulation rate is therefore proportional to
display refresh rate.

Measured in a headed Chromium on the machine the play-test will run on:

```
wall seconds        3.001
engine frames         332      ->  110.6 frames per wall-second
simulated seconds   5.533      ->  1.844 sim-seconds per wall-second
```

Every animation in the project is driven by `ctx.time.dt`, which is always
`fixedDt`. So on this display `ORBIT_SECONDS = 0.45`
(`src/render/index.js:467`) elapses in 0.244 wall-seconds and
`MOVE_SECONDS = 0.22` (`src/player/index.js:33`) in 0.119. `teach-00`,
"measured by playthrough at 1.633 s" in §P18, takes 0.886 s here. The
"21.5 seconds of optimal play" is about 11.7.

Two things this is not. It is **not** a violation of the determinism contract:
frame N still produces identical pixels, which is what ARCHITECTURE §1 requires.
And it is **not** new — it has been true since P0. What it means is that every
wall-clock number in METHODOLOGY carries an unstated 60 Hz assumption, and a
play-test on this hardware would run 1.84x faster than anything documented,
against a tester who has no way to know.

### 2.1 The change

An accumulator in `Engine.start()`. `step()`, `pump()` and the lockstep path are
untouched.

```js
/** Seconds of real time a single tick may absorb. A backgrounded tab that
 *  returns after 30 s must not fast-forward 1,800 steps. */
const MAX_CATCHUP = 0.25;
/** Belt and braces on the inner loop. */
const MAX_STEPS = 5;

start() {
  if (this._running || this.config.lockstep) return;
  this._running = true;
  let last = null, acc = 0;
  const tick = (now) => {
    if (!this._running) return;
    if (last === null) last = now;                 // seed on the first tick
    acc += Math.min((now - last) / 1000, MAX_CATCHUP);
    last = now;
    let steps = 0;
    while (acc >= this.time.fixedDt && steps < MAX_STEPS) {
      this.step();
      acc -= this.time.fixedDt;
      steps += 1;
    }
    this._rafId = requestAnimationFrame(tick);
  };
  this._rafId = requestAnimationFrame(tick);
}
```

Both clamps mean simulated time falls permanently behind wall time after a
stall, rather than catching up in a burst. That is the right trade for a game
with no network and no physics that must reconcile.

`requestAnimationFrame` passes its callback a `DOMHighResTimeStamp`, so the
delta comes from the argument and **`performance.now()` never enters
`src/core/engine.js`**. That is not cosmetic: it lets the guard in §5 ban
wall-clock reads in the engine outright instead of carving out an exception that
a later change could widen.

`src/core` is marked **reserved — integration only** in ARCHITECTURE §3.2. This
change is made as integration, by a single owner, with no fan-out.

### 2.2 Why this cannot reach the gate, and how that is checked rather than asserted

`start()` returns early when `config.lockstep` is set. Capture and gate runs are
lockstep, so no captured frame can depend on the accumulator. That is an
argument, and this project's own history says arguments of this shape get
checked. §5 lists three checks, of which the byte-identical gate run is the only
real evidence.

## 3. The recorder — `src/dev/trace.js`

Without instrumentation the session's output is one sentence, which is what the
last one produced. The engine already emits nine distinct events, so most of a
trace is free.

### 3.1 Events are not enough, which was checked

`src/ui/index.js:587` dispatches a movement key by calling
`ctx.peek('player')?.step?.(action.move)` **directly**, not by emitting. And
`player.step()` has two paths that emit nothing at all:

- `if (this.failed) return false` — the entire 72-frame window between
  `level/failed` and the reload;
- `player/blocked` is emitted only `if (this.cell && Array.isArray(screenDelta))`,
  so it is skipped when no level is loaded.

An events-only recorder is therefore blind in exactly the two moments worth
understanding: **after a loss, and between levels** — a player mashing keys
during a reload window would produce a trace showing that nothing happened,
reproducing the original ambiguity one level down.

So the recorder attaches its own `keydown` listener and records the raw event.
It does **not** classify the key: `resolveKey` stays in `src/ui`, the trace
stores `code`/`key` verbatim, and interpretation happens offline. A trace is a
record, not an interpreter — and this also avoids creating a `dev -> ui` import
edge that ARCHITECTURE §3.3 would have to be read carefully to permit.

### 3.2 Shape

Enabled by `config.trace` (`?trace=1`), parsed in `src/core/config.js` beside
the existing flags and following the `hud` pattern exactly.

Each entry is `{ seq, frame, t, kind, name, payload }`:

- `frame` is `ctx.time.frame` — the deterministic index;
- `t` is milliseconds since the recorder's own boot, from one `performance.now()`
  pair. **ARCHITECTURE §1.2 permits this and requires the file be named: it is
  `src/dev/trace.js`, and it is the only wall-clock read added by this phase.**
- `kind` is `'key'` or `'event'`.

Subscribes to all nine: `player/moved`, `player/blocked`, `world/rotate-request`,
`world/rotated`, `level/load-request`, `level/loaded`, `level/solved`,
`level/failed`, `campaign/complete`.

**Payloads are copied, never modified.** ARCHITECTURE §3.3: "An event may not
carry a timestamp." The timestamp lives on the trace entry, at the point of
observation. An implementation that stamps the payload breaks that rule and must
fail review.

### 3.3 Three constraints that are not obvious

**It must be inert in capture and lockstep.** `src/ui` gates its keydown
listener on `!(capture || lockstep)` because ARCHITECTURE §4 forbids any path
that advances state outside `__PUMP__`. A second keydown listener is the same
hazard. The recorder attaches nothing when `capture || lockstep`, and §5 asserts
it.

**It must be incapable of throwing.** `Engine._emit` has no try/catch
(`src/core/engine.js:42-46`), so one throwing listener aborts every listener
registered after it. Adding nine subscriptions raises that exposure during the
one session this phase exists to run. The recorder's handler body is wrapped in
its own try/catch and drops entries rather than propagating.

> This is the fresh argument that open item **B3** has been waiting for. The
> handoff records `_emit`'s missing try/catch as "declined deliberately in P4"
> with no rationale written anywhere, and asks for the P4 reasoning or a new
> argument on the merits. The new argument is: the engine's failure isolation is
> currently supplied by *convention among listeners*, and every listener added
> is a place that convention can lapse. **B3 is not opened in this phase** — the
> argument is recorded so the next session does not have to rediscover it.

**Persistence must be O(1) per entry.** The reload that P17 documents as the
only escape from a bad position is exactly the event that would destroy an
in-memory trace, and it happens mid-level. Serialising a growing array on every
entry is O(n^2). Each entry is written under its own key,
`penrose:trace:<session>:<seq>`, and the reader scans by prefix. A 15-minute
session is on the order of a few thousand entries at ~150 bytes, well inside the
~5 MB origin quota.

`globalThis.__TRACE__` exposes `dump()` (JSON, all sessions) and `clear()`.

### 3.4 Registration

Added in `src/main.js` **first**, before `render`, and only when `config.trace`
is set. First because `addEventListener` fires in registration order, so the
recorder's keydown entry precedes the engine events that keypress causes, and
the trace reads in causal order. The subsystem has no `update`, `fixedUpdate` or
`draw`, so it adds nothing to the frame loop. With the flag unset nothing is
registered and no listener is attached, so the gate sees an unchanged program.

## 4. The play-test protocol — `docs/playtest/PROTOCOL.md`

Prose, not code, and versioned with the repo so a second session is comparable
to the first.

### 4.1 What is on trial

Each hypothesis is written with the observation that would falsify it, decided
**before** the session rather than after.

| | hypothesis | falsified by |
|---|---|---|
| H1 | `teach-00` makes `screen-adjacent means walkable` inferable without being told | the player does not cross the gap within 5 minutes, **or** crosses it without registering that anything unusual happened |
| H2 | the move budget fires on wandering, not on confusion | the player runs out of moves while making sense of the level, or reads the loss as arbitrary |
| H3 | the curve `0,0,1,2,3,4,5,6` reads as a curve | difficulty is reported as flat, or a later level is easier than an earlier one |
| H4 | it reads as a game rather than a demo | recorded verbally; no numeric threshold, and stated as such |

H1 is the one that needs a fresh player. H2 and H3 do not.

### 4.2 Procedure

1. Fresh page at `?trace=1`. Confirm `__TRACE__` exists before handing over.
2. The opening line is **scripted** and leaks nothing: *"This is a small game.
   Have a go. Say what you're thinking if you can."* No mention of adjacency,
   illusion, impossible geometry, the goal marker, or rotation.
3. **No questions are answered during play.** A question is data: it is logged
   with the wall-clock time so it can be aligned against the trace.
4. Stop at `campaign/complete`, or at 15 minutes, whichever comes first. Record
   which.
5. Dump the trace, then ask the fixed post-play questions.

### 4.3 Output

`~/claude/projects/penrose/PLAYTEST-2026-07-27-01.json` for the trace and
`...-notes.md` for observations, per the working-files convention. The
hypotheses are marked held or falsified against §4.1, with the trace line that
decides each.

## 5. Tests

| what | asserts |
|---|---|
| `engine.test.js` — lockstep | `start()` leaves `_running` false and schedules no rAF when `config.lockstep` |
| `engine.test.js` — no clock | `src/core/engine.js` contains none of `performance.now`, `Date.now`, `new Date`, `Math.random` — source-level, in the style of `test/ui.test.js:108` |
| `engine.test.js` — accumulator | a synthetic tick sequence at 120 Hz produces half as many `step()` calls as ticks; at 30 Hz, twice as many; a 30-second gap produces at most `MAX_STEPS` |
| `trace.test.js` — inert | no listener attached and no subsystem registered when `capture` or `lockstep` |
| `trace.test.js` — order | a keydown followed by `player/moved` records in that order with non-decreasing `seq` |
| `trace.test.js` — isolation | a handler that throws does not prevent a later `ctx.on` listener from running |
| `trace.test.js` — payload | the recorded payload is deep-equal to the emitted one and carries no added timestamp |
| `geometry.test.js` — branching | `Structure.branching()` on hand-checked fixtures: a corridor has 0 forks, a diamond has 1 |
| `true-minturns.test.js` — campaign | the campaign totals **1 fork across 358 positions**, so the number moves visibly when levels change |

## 6. Verification

- `npm test` — currently **227 pass, 0 fail**, verified in this worktree before
  any change.
- `npm run gate` — **byte-identical** before and after §2. This is the only real
  evidence that the accumulator cannot reach a captured frame; the two guards
  above are cheaper checks that fail earlier.
- The 1.844 measurement re-run after the fix, expecting `1.000 +/- 0.02`
  sim-seconds per wall-second on the 120 Hz panel.
- Mutation testing on §5's guards, per the standing practice. P18 and P19 each
  found a test that passed without exercising its subject; the `trace.test.js`
  isolation guard is the most likely repeat, because a test that never makes the
  handler throw will pass against an unwrapped implementation.

## 7. Documentation debt found on the way

ARCHITECTURE §3.3's event vocabulary table lists eight events. The project emits
nine: **`level/failed` was added in P19 and never documented there.** The
recorder subscribes to it, so the row is added in this phase.

## 8. Out of scope, deliberately

- **New levels.** The point of §1 is that the evidence for what to build does
  not exist yet. §3's metric is built so that work is not blind when it happens.
- **Any change to the movement model.** The proof in "The finding this rests on"
  says that is what making mistakes expensive would take. It is a bigger phase
  and it risks the one clean idea the game has.
- **B3 itself.** The argument is recorded in §3.3; the change is not made.
- **Issue #16.** Untouched.
- **More grading instrumentation.** §P17 said stop, and this does not restart it.
  §3 measures the *player*; the panel measures the picture. They are different
  instruments and only one of them has ever found a product defect here.

## Risks

**The tester sees a game 1.84x slower than the one on this machine today.** That
is the intent of §2 and it is still a change to what is being tested. The
session measures the artifact as documented, not the artifact as it currently
runs on a ProMotion display.

**A sample of one.** H1 is a claim about people and the session tests it on a
single person. A held H1 is weak evidence; a falsified H1 is strong. That
asymmetry is the reason to run it before building levels and not after, and the
write-up must not report a held H1 as more than it is.

**Audio may not scale with the loop.** `src/audio` builds its buffers against
the `AudioContext` sample rate, not `ctx.time`, so its timing is unlikely to
have been running 1.84x fast alongside the animation. If the cues are one-shots
this is invisible; if anything is a sustained bed it has been desynchronised
from the motion on this hardware and the fix will change how it sounds. **Not
traced this session — flagged, not claimed.**

**`MAX_CATCHUP` and `MAX_STEPS` are chosen, not derived.** 0.25 s and 5 are
conventional values. Nothing in this project measures them, and the spec should
not pretend otherwise. They are falsifiable by the §5 accumulator test only in
the sense that the test pins the behaviour they produce.
