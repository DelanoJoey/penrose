# The second figure family

**2026-07-26** · branch `feat/second-figure-family` off `main` @ `9063d7e`

Every number in this document was measured this session against the real
`Structure` from `src/geometry/index.js`. Where a claim rests on human judgement
rather than measurement, it says so.

## The finding this rests on

Three of the four campaign levels are the same figure at three sizes. That is not
a content oversight — it is forced by the geometry.

A closed circuit requires net displacement `(t,t,t)`, because that is the only
displacement the view direction collapses to nothing. Enumerating **every**
three-leg circuit with legs 1..8 on three distinct axes gives 48 hits, and the
distinct leg-length multisets are exactly:

```
1,1,1  2,2,2  3,3,3  4,4,4  5,5,5  6,6,6  7,7,7  8,8,8
```

**Every three-leg closed circuit has all three legs equal.** The tribar family has
one degree of freedom: size. `loop-01`, `spur-01`, `span-02` and `shelf-03` are
not four designs, they are one design at four scales with different cells hung
off it. No amount of level authoring escapes that; only a different leg count
does.

## 1. What was ruled out, and why it is worth recording

**The endless staircase is not constructible here.** It is the obvious second
Escher figure and the module docstring already notes the mechanism — `+x` then
`+y` has the same screen delta as `-z`, which *is* the Penrose staircase.

It still cannot close. Closing on screen forces net `(t,t,t)`, so `net_y = t` is
the total climb while `net_x + net_z = 2t`. A staircase that climbs once per
horizontal step spends only `t` horizontal steps and needs `2t`. The shallowest
closable stair is therefore **two horizontal steps per unit of climb**, which
reads as a ramp rather than as stairs.

Measured against the algebra: of 3,562 four-flight closed circuits carrying an
illusion edge, **280** have three of four flights climbing and **0** have all
four. The zero is a search confirming a proof, not a search that came up empty.

This is recorded because "why not the staircase" is the first question anyone
picking this up will ask, and the answer is a property of the projection rather
than a failure of effort.

## 2. The selection pipeline

The previous phase's guidance was *"the work is the render-and-judge loop over
that pool, not more searching."* That is right about the destination and wrong
about the order. Visual judgement is the **expensive, human, non-reproducible**
stage. Everything cheap belongs in front of it.

| stage | survivors | kind |
|---|---|---|
| four legs, net a positive multiple of `(1,1,1)`, legs 1..6 | 810 | computed |
| no repeated 3D cell | 810 | computed |
| at least one illusion edge | 440 | computed |
| ≥8 distinct screen cells | 400 | computed |
| **encloses a hole on screen** | 330 | computed — new |
| non-degenerate: min leg 2, doubles back on an axis, ≥9 screen cells, ≤20 cells | 102 | computed — new |
| hosts a strong-premise route once augmented | 102 | computed |
| **reads as an impossible figure** | human | judged last |

The counts form a genuine chain: the non-degeneracy stage is strictly stronger
than the one above it on every axis (≥9 vs ≥8 screen cells, min leg 2 vs 1), so
102 is a subset of 330 rather than a separately-scoped measurement.
`tools/search.mjs` (§7) prints all six numbers, so any future drift is a visible
diff rather than an argument.

### 2.1 The hole criterion

An impossible figure needs somewhere for the eye to trace the loop. The tribar
reads as impossible because you can see through the middle of it; a circuit that
folds back onto itself projects as a filled slab and reads as an ordinary solid
no matter what its routing premise says.

The screen lattice is `(a,b) = (x-z, x+z-2y)` with `a+b` always even, so every
screen position has six neighbours. A **hole** is an empty screen position that
cannot reach the outside of the bounding box under a six-neighbour flood fill.

Measured against figures whose reading is already known:

| figure | reads as | hole |
|---|---|---|
| `tribar(3)` / `tribar(4)` / `tribar(5)` | impossible | 1 / 3 / 6 |
| `spur-01` (ships) | impossible | 1 |
| `shelf-03` (ships) | impossible | 6 |
| four-leg candidate that rendered as a bar | ordinary | **0** |
| four-leg candidate that rendered as a block | ordinary | **0** |
| two staircase circuits | ordinary | **0** |
| four-leg candidate that rendered as ordinary stairs | ordinary | **3** |

**It is a necessary condition, not a sufficient one.** The last row is the
counterexample and it is stated rather than buried: a figure with three hole
cells still read as an ordinary staircase. The hole test is a filter that removes
most of the garbage before a render is spent. It is not a judge, and this phase
does not claim to have replaced the eye.

### 2.2 Non-degeneracy

There are only three axes, so a four-leg circuit must reuse one:

- reusing the **same** direction (`+y` twice) splits a leg — the figure is a
  tribar and the fourth leg is bookkeeping;
- reusing the **opposite** direction (`+z` and `-z`) doubles back — a new shape.

Without this constraint the pool's top-ranked members by hole size are all
`tribar(5)` carrying a one-cell nub, which is the existing family wearing a hat.
Requiring a doubling-back axis and a minimum leg length of 2 removes them.

## 3. The figures

Twelve survivors were drawn as true isometric projections — same `(a,b)`
invariant, same `x+y+z` depth rule as the engine — and judged by eye. Three read
as impossible; nine read as ordinary frames, slabs or notched blocks.

**Every one of the twelve has exactly 2 illusion edges, the same as the tribar.**
That metric does not discriminate at all, which is worth knowing before anyone
tries to rank candidates by it.

The single most useful measurement is that the visual judgement and the routing
depth agree. `+x×6 +y×4 -x×2 +z×4` was judged impossible on sight, and it is also
the deepest-routing figure in the pool.

### 3.1 The validated set

Nine augmented candidates at `minTurns` 6 were rendered and judged. **Five held
up; four collapsed into ordinary slabs.** The survivors, as leg sequences with
their spur:

| | figure | spur | cells | turns | walks |
|---|---|---|---|---|---|
| 1 | `-x×2 +z×4 +x×6 +y×4` | `+y×2` from `-2,0,1` | 19 | 6 | 8 |
| 2 | `-z×2 +x×4 +z×6 +y×4` | `+y×2` from `1,0,-2` | 19 | 6 | 8 |
| 4 | `-x×2 +z×3 +x×5 +y×3` | `+y×2` from `-2,0,1` | 16 | 6 | 6 |
| 7 | `-z×2 +x×3 +z×5 +y×3` | `+y×2` from `1,0,-2` | 16 | 6 | 6 |
| 8 | `+x×3 -y×2 +z×3 +y×5` | `-x×2` from `3,0,3` | 16 | 6 | 5 |

Rows 1/2 and 4/7 are mirror pairs, so this is **three distinct figures**, not
five. Row 1 is a cyclic rotation of the `+x×6 +y×4 -x×2 +z×4` judged above — the
same figure entered from a different leg.

Rows 3, 5, 6 and 9 of that render are recorded as rejected so nobody re-derives
them: `-x×2 +z×2 +x×4 +y×2`, `+z×6 +y×2 -z×4 +x×2`, `-z×2 +x×2 +z×4 +y×2` and
`+z×5 +y×2 -z×3 +x×2`, each with the spur listed above, all read as blocks.

**The figures for `minTurns` 4 and 5 have not been selected.** Only the 6-turn set
has been rendered and judged. That selection is the plan's first task, using the
same pipeline, and §5 states what happens if it fails.

## 4. Playability, measured before any level is written

A figure that reads as impossible is worthless if it cannot host a route where
rotation is load-bearing. "Strong premise" here means all of: solvable,
`requiresTurn`, `usesIllusion`, `flatSolvableTurns` empty, and `route[0]` is a
walk so the level is playable on frame one.

| | figures hosting a strong-premise route | max `minTurns` reachable |
|---|---|---|
| bare figure | 74 / 102 | `{1: 56, 2: 12, 4: 6}` |
| figure + a 1–3 cell spur | **102 / 102** | `{3: 20, 4: 33, 5: 39, 6: 10}` |

Bare figures cap out shallow — the best of the visually-approved three offered
seven start/goal pairs, **all at `minTurns` 1**, and a second read as impossible
but hosted only one pair with a two-walk route. A third read as impossible and
hosted **zero**. Visual approval and playability are independent properties and
both must be checked.

Augmentation is the unlock, and it is the mechanism the shipping levels already
use: `spur-01`, `span-02` and `shelf-03` are a bare `tribar` plus hung cells. The
spur is constrained not to fill the hole, or it destroys the read it was added to.

## 5. The levels

Three new levels, extending `ORDER` from four entries to seven.

| | `minTurns` | figure |
|---|---|---|
| existing | 0, 1, 2, 3 | tribar at four sizes |
| **new** | **4, 5, 6** | four-leg doubled-back circuit |

`campaign.test.js:39` asserts the curve is non-decreasing, so 4/5/6 extends it
cleanly and the assert keeps its teeth. The distribution in §4 supports each
target: 33 figures reach 4, 39 reach 5, 10 reach 6.

Each level declares `{ turn, illusion, minWalks, minTurns, openWithWalk }` and
`tools/analyze.mjs` proves it, exactly as the existing five do. CI already
iterates every key in `LEVELS`, so new levels are covered without a workflow
change.

### 5.1 `minTurns` must be declared at the measured value, not merely bounded

`levels.test.js:28` asserts `turnsInRoute >= minTurns`, so a level whose route
takes six turns would pass a `minTurns: 4` declaration. Declaring a slack bound
would make the campaign curve meaningless while keeping every test green — the
exact silent-drift failure the premise system was built to close.

So the declaration states the **measured** `turnsInRoute` for the chosen
start/goal pair, matching what the shipping levels already do (`spur-01` declares
1 and routes in 1; `shelf-03` declares 3 and routes in 3). Hitting a target of 4
means selecting a start/goal pair that routes in exactly 4 — not declaring 4 on a
figure that routes in 6.

### 5.2 If a target cannot be met

The 6-turn set is validated; 4 and 5 are not. If the pipeline yields no figure at
one of those targets that survives visual judgement, the fallback in order of
preference is:

1. **Re-target the curve.** Ship the levels that do survive at whatever measured
   values they have, provided the sequence stays non-decreasing — 4/6/6 or 5/6/6
   is a worse curve than 4/5/6 but a real one.
2. **Ship two levels instead of three.** Two new levels on a genuinely second
   figure family still ends the one-figure-campaign problem.
3. **Widen the search** — leg lengths beyond 6, or spurs beyond 3 cells — and
   re-run the pipeline before relaxing anything else.

What is **not** acceptable: declaring a slack `minTurns` to manufacture a curve,
or shipping a figure that failed visual judgement because the numbers were good.
Both were available to the previous phase and both would have passed CI.

Level naming follows the existing convention, where the name describes the
augmentation (`spur` detached, `span` detached, `shelf` integrated) and the number
is the position in the curve. Specific names are deferred to the plan, because the
figures at `minTurns` 4 and 5 have not yet been selected and named — only the
6-turn set has been rendered and judged.

**`DEFAULT_LEVEL` stays `loop-01`.** All 15 gated shots capture it; changing it
would move every reference at once and confound a content change with a harness
change.

## 6. Harness — three new shots

15 → 18. One plate per new level at turn 0, matching `spur01` / `span02` /
`shelf03`. The per-shot `level` declaration added in P5 already supports this, so
no harness change is required and existing shot URLs stay byte-identical.

**Cost must be measured under `PENROSE_GL=swiftshader`, not asserted.** Three cost
estimates in this repository have missed, in both directions: P5's spec was 8×
high, P6's spec was arithmetically wrong, and P6's *measured* local figure was
1.8× low against the real runner. The static-shot marginal rate measured in P5 was
~1.4 s/shot, giving ≈8.5 s of gate delta for three shots captured twice — which
is a starting hypothesis to be checked, not a result.

## 7. Tooling — the search becomes a committed tool

`tools/search.mjs`, committed rather than thrown away.

The previous phase's search scaffolding was discarded, and its finding — "18
four-leg closed impossible circuits exist at net `(2,2,2)`" — is now
**unverifiable**. This session measured 70 at that net under broader constraints
and cannot reconcile the difference, because there is nothing left to diff
against. That is not a claim the earlier number was wrong; it is a claim that
nobody can now tell.

The tool takes the filter cascade in §2 and prints the survivor pool with the
per-stage counts, so the pool is reproducible and a future change to the
constraints shows up as a diff in a number rather than as a differently-shaped
argument.

## 8. Tests

- **The hole detector gets unit tests with negative controls.** The figures in
  §2.1 whose reading is already known become the fixtures — the tribars and
  shipping levels must report a hole, the bar and block candidates must report
  zero. A detector that only ever returns "hole" proves nothing.
- **The counterexample gets a test too**, pinning `hole > 0` on a figure that
  reads as ordinary, so the necessary-not-sufficient property is asserted in code
  and cannot quietly be forgotten into a sufficiency claim.
- **Per-level premise tests** come for free from the existing loop over `LEVELS`.
- **A guard verified to fail** for each new assert, per this repository's standing
  practice — a gate that has never been seen to fail is not evidence.

## 9. Verification

| check | bar |
|---|---|
| `npm test` | exit 0, full suite, no path scope |
| `node tools/analyze.mjs <each of 8 levels>` | exit 0 |
| `npm run gate` | `identical: true` across 18 shots |
| existing 15 references, before and after | `maxDelta: 0` — new levels must be invisible to existing shots |
| hole-detector guards | verified to fail |
| CI gate wall-clock | measured under `PENROSE_GL=swiftshader`, reported against the P6 baseline |
| **played end to end** | all seven levels, `campaign/complete`, zero page errors |

The last row is not ceremony. `src/campaign` is inert under `config.capture`, so
the pixel gate covers none of the progression path; a playthrough with
`lockstep=1&capture=0` is the only thing that exercises it.

## Risks

1. **A 6-turn route may not be fun.** Six turns against six to eight walks means
   half the player's inputs are rotations. `findRoute` costs a turn and a walk
   equally — a deliberate, recorded open decision from P5 with no evidence yet
   behind a better weighting. This is a playtest question, not an analysis
   question, and it is the most likely reason the `minTurns` targets in §5 move.

2. **The visual judgements in §3 were made on flat SVG at one camera angle**, not
   on the engine's render with its palette, lighting and framing. Every figure
   must be re-judged through `baseline.mjs` before a level is built on it. Four
   defects in this repository's history passed every automated check and were
   caught only by opening the image; this spec's own evidence is one render away
   from being in that category.

3. **The hole test admits ordinary figures**, as §2.1's counterexample shows. It
   cuts 400 → 330, which is real but modest. The eye stays in the loop and this
   phase does not remove it.

4. **Augmentation can destroy the read.** The spur is constrained not to fill the
   hole, but that is a necessary condition and not a sufficient one — of nine
   augmented candidates rendered, five held up and four collapsed into ordinary
   slabs. Same failure mode as the base figures, same remedy: look at it.

5. **`npm install` in the worktree.** `node_modules/` is gitignored and not
   shared, so the worktree needs its own install before anything runs. A symlinked
   `node_modules` is **not** covered by the `node_modules/` gitignore pattern,
   which matches directories only.
