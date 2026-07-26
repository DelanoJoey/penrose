# Motion coverage — gating the parts of the engine that move

**2026-07-26** · branch `feat/motion-coverage` off `main` @ `796cd60`

## The gap

The pixel gate covers 12 shots. Every one of them is a **static state**: a shot puts the
world somewhere and the harness pumps a fixed 90 frames, by which time nothing is moving.

Three systems are therefore ungated:

- the camera orbit path (`src/render`, `CameraOrbit`)
- the avatar's step interpolation and hop arc (`src/player`)
- the avatar's **bias drop during an orbit**, which is the subtlest code in the project

All three are covered by unit tests and ad-hoc probes only. A rendering regression in any of
them ships silently.

This mattered less before P5, because no level required rotating — the orbit was decorative.
Three levels now cannot be solved without it, so the orbit is the most-exercised interaction
in the game and the largest thing the gate cannot see.

## What already exists, and what it proves

`tools/commitframe.mjs` already drives motion **deterministically**: it emits
`world/rotate-request`, pumps an exact number of frames, and screenshots the last orbit frame
and the commit frame. It derives the orbit length from the engine rather than assuming it:

```js
while (r.transitionState().active && n < 600) { window.__PUMP__(1); n++; }
```

So determinism was never the blocker. Motion under lockstep is already reproducible.

**The blocker is the shot contract.** `src/dev/shots.js` says a shot may not start an
animation, because the shutter lands a fixed number of pumped frames later and an in-flight
interpolation would make the captured pixels depend on that count rather than on the state
the shot describes. `baseline.mjs` pumps `SETTLE`, default 90.

That rationale is about **legibility, not determinism**. A shot that starts motion is still
perfectly reproducible; it just no longer describes a *state*, it describes a state plus a
frame count. The fix is to make the frame count part of what the shot declares.

## 1. The contract change

A shot may declare the settle it needs, and **only then** may it start an animation:

```js
orbitmid: Object.assign(fn, { level: 'loop-01', settle: 14 })
```

This is symmetric with the `level` declaration added earlier this branch, and uses the same
machinery: `baseline.mjs` already discovers shot metadata in its probe page

```js
Object.entries(window.__SHOTS__ ?? {}).map(([name, fn]) => ({ name, level: fn.level ?? null }))
```

and extends to `settle`, using it in place of the global default when present.

The rule in `src/dev/shots.js` becomes:

> A shot may not start an animation **unless it declares its own settle count**, because then
> the frame the shutter lands on is part of what the shot describes rather than an accident of
> the harness default.

There is already an unused channel for this: `__APPLY_SHOT__(name, { grabFrame: settle })`
passes the settle count *into* the shot, and **no current shot reads it**. A motion shot does
not need it — it declares the count rather than receiving it — but it is worth knowing the
plumbing exists before adding a second mechanism.

## 2. The three shots

| shot | level | frame | what it catches that nothing else does |
|---|---|---|---|
| `orbitmid` | `loop-01` | 14 of 28 | the orbit path, **and the avatar's bias drop mid-orbit** |
| `orbitcommit` | `loop-01` | 28 | the world-turn / camera-orbit identity at the commit |
| `stepmid` | `loop-01` | 7 of 14 | step interpolation and the hop arc |

`loop-01` is the right level for all three, and specifically its start cell. The avatar's
view bias there is **5 lattice steps** along (1,1,1) — the only cell in the project where the
bias is nonzero. `src/player` drops that bias for the duration of an orbit, and restores it on
arrival. At every other standable cell the bias is already 0, so a mid-orbit shot framed
anywhere else would prove nothing about the one piece of code most likely to break.

`orbitcommit` overlaps what `commitframe.mjs` measures, but answers a different question:
`commitframe` measures a **delta between two specific frames** (it is what settled the tone
convention in P3), while the gate asks whether that frame is **reproducible**. Keep both.

## 3. The staleness risk, and why it is handled with a test rather than cleverness

A hardcoded `settle: 14` silently captures a **different phase** of the animation if
`ORBIT_SECONDS` (0.45) or `MOVE_SECONDS` (0.22) ever changes. Nothing would fail; the gate
would go on passing against a picture nobody chose.

Measured, not computed:

| | value | arithmetic predicted |
|---|---|---|
| orbit, frames to commit | **28** | 27 — **wrong** |
| step, frames to settle | **14** | 14 |

The orbit figure is off by one from `ceil(ORBIT_SECONDS / fixedDt)`. That is the whole
argument for measuring: a spec that hardcoded 27 would have captured the frame *before* the
commit and called it the commit.

Two options considered:

- **Derive the frame count at capture time**, as `commitframe.mjs` does. Most robust, but it
  makes `settle` data-dependent, adds a page round-trip per shot, and complicates the harness
  the P0–P4 handoff explicitly says not to complicate.
- **Absolute frames, plus a unit test pinning both constants.** *Chosen.* If someone changes
  `ORBIT_SECONDS`, the test fails with an instruction to re-pick the motion frames, rather than
  the gate quietly capturing a different moment. Same guard-verified-to-fail discipline used
  everywhere else in this repo, and the harness stays simple.

The pinning test must assert the **measured frame counts**, not just the constants — the
off-by-one above shows the constants do not determine the count in the obvious way. So it
pins `ORBIT_SECONDS`, `MOVE_SECONDS`, `fixedDt` **and** asserts the derived counts are still
28 and 14, by driving the engine the way `commitframe.mjs` does.

## 4. Cost

12 → 15 shots. At the measured marginal cost under `PENROSE_GL=swiftshader` (~1.4 s/shot, and
the gate captures twice) that is **≈ +2.8 s** of CI, against a 30-minute timeout.

Stated because the last estimate in this repo was wrong by 8×: that one divided total gate
wall-clock by shot count, which treats fixed per-invocation overhead as if it scaled per shot.
This figure is a marginal measurement, not a division, but it should still be **re-measured**
rather than trusted (§6).

## 5. What this widens

**This is the first change that makes the pixel gate depend on animation timing.** Every
existing shot is a static state; these three are a state plus a clock.

That is a real widening of the surface the gate can false-positive on. Any future change to
easing (`smootherstep`), to `MOVE_SECONDS`, to `HOP`, or to the orbit's easing curve now moves
pixels in a gated shot. That is *desirable* — it is the coverage being bought — but it means
a red gate after an animation change is expected rather than alarming, and the response is a
**deliberate reference re-capture as a reviewed commit**, never a widened tolerance
(`ARCHITECTURE.md` §5).

The alternative — leaving motion ungated — keeps the gate narrow and lets orbit regressions
ship. Given rotation is now load-bearing in three levels, that trade is no longer worth it.

## 6. Verification

| check | bar |
|---|---|
| `npm test` | 0 failures, full suite, no path scope |
| pinning test | **verified to fail** — change `ORBIT_SECONDS` and confirm it reports the drift |
| `npm run gate` | `identical: true` across 15 shots |
| existing 12 shots | `maxDelta: 0` before/after, proving the harness change moved nothing |
| motion shots are genuinely mid-motion | assert `transitionState().active === true` at `orbitmid`, and a non-zero, non-terminal interpolation at `stepmid` — a "motion" shot that captured a settled frame would pass the gate and cover nothing |
| CI cost | re-measured under `PENROSE_GL=swiftshader` |

The second-to-last row is the one that matters most. The failure mode for this whole change is
a motion shot that silently captures a **settled** frame: it would be perfectly reproducible,
pass the gate forever, and cover nothing — the same shape as the stale-dev-server bug, where a
green result measured something other than what it claimed.

## Risks

1. **A motion shot that isn't actually in motion.** Covered by the assertion above; without it
   this change is theatre.
2. **The harness change can invalidate the existing 12 references.** Lands and is gated
   before any motion shot exists, so a reference shift can only be the harness.
3. **`npm install` in the worktree** — `node_modules/` is gitignored and not shared.
