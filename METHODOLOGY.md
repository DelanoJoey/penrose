# METHODOLOGY

A running, dated record of what was actually done and what the evidence was.
Claims here are backed by command output, not by recollection. Where a number is
not yet trustworthy, it says so.

---

## The premise

This project is a deliberate variation on
[mshumer/Claude-of-Duty](https://github.com/mshumer/Claude-of-Duty), which built
a Three.js FPS from a single prompt and published an unusually honest scorecard:
eleven adversarial critics scored it 3.59 → 4.14 → 4.05 → 5.05 out of 10 against
a modern Call of Duty, two shots reached "CLOSE", the rest stayed "AMATEUR", and
in blind A/B every critic in every round picked the real frame.

Its stated shortfalls were hands, material richness, characters, indirect light,
and frame rate — with one named as a hard ceiling: *"surfaces read as procedural
noise rather than photographed reality at close range — the ceiling of generating
texture from code."*

**The variation: choose a target where that ceiling does not exist.**

A stylised isometric target has no first-person hands, no photoreal reference to
lose against, no crowd of humans, no GI approximation to fall short of, and no
cascaded-shadow/GTAO/TAA stack to pay for. What remains is spatial-logic
correctness — impossible geometry that connects in projection but not in 3D,
path graphs that rewire under rotation, solvability. That is a problem where
being good at algorithms helps and being bad at photorealism does not hurt.

This is target selection as the engineering decision.

---

## P0 — contracts and harness

**Completed 2026-07-25.** Exit criterion: the pixel gate is proven green, and
proven able to fail, before any game content exists.

### The inversion

Upstream retrofitted its capture harness onto a finished project. That cost a
dedicated remediation pass across six subsystems to remove wall-clock
dependencies, plus a second pass whose only job was verifying the first landed —
because enabling a 1.4-second shader pre-warm shifted 78–88% of pixels and made
every performance claim unfalsifiable until fixed.

Here the determinism contract (`ARCHITECTURE.md` §1) is a precondition on all
code, the lockstep hooks are part of the engine skeleton, and the gate was proven
against a stub scene before any content existed. Two of upstream's four workflow
phases have no equivalent here because the debt they were paying down was never
taken on.

### Evidence

**1. The gate passes on identical input.** `node tools/gate.mjs` captures the
full shot set twice into separate temp directories and diffs them:

```
"identical": true,  "withinEpsilon": true,  "pass": true,  "missing": 0
worst: { "shot": "hero.png", "changedPct": 0, "maxDelta": 0, "meanDelta": 0 }
```

All 5 shots, `maxDelta: 0`. Exit code 0.

**2. The gate fails on a 1/255 change.** Negative control — a gate that only
ever passes proves nothing. `PALETTE.faceTop` was moved `0xf2b880 → 0xf2b881`
(one LSB on one channel of one face tone) and the set re-captured:

```
"identical": false,  "pass": false
worst: { "shot": "treads.png", "changedPct": 30.8607, "maxDelta": 1, "meanDelta": 0.309 }
```

Exit code 1. Reverting returned it to `identical: true`, exit 0.

The gate is bidirectional. It detects a single least-significant-bit change to
one palette entry.

### Deliberate difference from upstream: the exit code

Upstream's `imagediff.mjs` exits 0 when the result is merely *within epsilon*
(<0.05% of pixels moved and max channel delta ≤ 2) — so a genuine small change
exits 0 even at `--tol=0`, contradicting its own stated rule that the gate must
report IDENTICAL.

Here strict pixel identity is the default pass condition; accepting an epsilon
requires passing `--tol` explicitly, and the output always reports `strict`,
`identical` and `withinEpsilon` separately. A gate whose exit code is looser than
its documentation is not a gate.

*Note: the negative control above fails under both the strict and the upstream
rule (it moves 6–31% of pixels). It demonstrates gate sensitivity, not the
exit-code difference. The exit-code hole is narrower than this test.*

### Portability bug found in the ported harness

Vite 7's default `localhost` bind resolves to `::1` first on macOS, so the dev
server listens on IPv6 only:

```
node  ...  IPv6  ...  TCP [::1]:5199 (LISTEN)
```

while the harness probes and navigates `127.0.0.1`. The port never opens from the
harness's point of view and every capture dies with `vite failed to start`.
Fixed by pinning `server.host: '127.0.0.1'` in `vite.config.js` **and** passing
`--host 127.0.0.1` in the spawn, so the harness does not silently depend on the
config file being correct.

### Baseline measurement, with a caveat

`node tools/profile.mjs --dpr=2 --frames=600`, internal buffer 3024×1964
(5.94 MP):

| | |
|---|---|
| boot | 72 ms |
| draw calls | 1 (min = max) |
| WebGL programs | 1, **0 compiled during play** |
| hitches | 0 |
| heap growth | 0 MB |
| frame time p50 / p99 | 0.1 ms / 0.2 ms |

**The frame-time figures are not yet a meaningful frame-rate measurement.** At
one draw call and one program, with vsync and the frame-rate limiter disabled in
headless mode, rAF dispatch overhead dominates and the reported "10000 fps" is an
artifact of that, not a property of the renderer. This is a mild instance of
exactly the failure upstream documented — a benchmark reporting a number that
does not correspond to the experience.

What *is* meaningful right now: 1 draw call for ~110 instances confirms the
instancing path works, 0 programs compiled during play confirms no lazy shader
compilation, and 0 MB heap growth confirms nothing allocates per frame. The fps
figure becomes trustworthy once the scene is GPU-bound; treat it as unvalidated
until then.

### Known stub-quality items, deliberately not fixed in P0

- Camera framing is off-centre — the structure's centroid is well above the
  origin the camera targets. Cosmetic; belongs to the art pass.
- The staircase loop genuinely climbs and therefore does not close. Making it
  close in projection while staying disjoint in 3D is the actual problem and
  belongs to `src/geometry` in P1. Faking it in the stub would hide the work.

---

## P1 — isometric projection and the impossible-geometry path graph

**Completed 2026-07-25.** Single sequential owner, not fanned out, per
`ARCHITECTURE.md` §3.3 — projection, visibility and traversal are one coupled
system.

### The result

The whole subsystem rests on one fact. In an orthographic projection viewed
along (1,1,1), the points `(x,y,z)` and `(x+t,y+t,z+t)` project to the *same*
screen point. So

```
a = x - z        b = x + z - 2y
```

is a **complete invariant of screen position** — two cells overlap on screen if
and only if they share `(a,b)`. Exact integer arithmetic on a lattice: no float
comparison, no epsilon, and therefore no nondeterminism.

Every impossible connection is a consequence rather than a special case.
Stepping `+x` changes `(a,b)` by `(+1,+1)`; stepping `+y` changes it by `(0,-2)`;
their sum is `(+1,-1)`, which is exactly the change from stepping `-z`. "Walk one
east and climb one" is therefore indistinguishable on screen from "walk one
north" — the Penrose staircase, falling out of the algebra.

The traversal graph is built from **visual** adjacency, not 3D adjacency. That
inversion is the mechanic: an edge exists because two platforms *look* next to
each other. Occlusion is resolved by depth `x+y+z`, and ties are impossible —
two distinct cells sharing a screen position differ by a nonzero multiple of
(1,1,1), so their depths differ by exactly `3t`.

Rendering `loop-01` produced a **Penrose triangle**. It was not modelled; three
legs along `+x`, `+y`, `+z` with net displacement `(5,5,5)` produce the tribar
automatically, because the net is a multiple of the view direction and therefore
closes on screen.

### The first level design was wrong, and the analyser caught it

`loop-01` was originally a climbing flight (`+x,+y`) plus a flat walkway (`+z`).
The algebra was correct — net displacement `(5,5,5)`, ends aliased — but the
picture was not. Running `tools/analyze.mjs`:

```
turns 0:  visible 6 / 11 cells,  impossibleEdges 0,  pathLength null
solvableTurns: [3]
```

The two legs' screen deltas are `(+1,-1)` and `(-1,+1)` — exact inverses — so the
return leg retraced the outbound leg pixel for pixel instead of forming a loop.
Eleven cells collapsed to six visible positions and the illusion did not exist.

Rebuilt with three legs along `+x`, `+y`, `+z`, whose screen directions
`(+1,+1)`, `(0,-2)`, `(-1,+1)` are all distinct:

```
turns 0:  visible 15 / 16 cells,  impossibleEdges 2,  pathLength 2
solvableTurns: [0],  requiresRotation: true
illusionEdge: 1,0,0 -> 5,5,5   manhattan 14
```

The solution is a **single step across a gap of 14 units in 3D**. Solvable only
at rotation 0, so rotation is load-bearing.

This is the argument for having the analyser at all. The failure was invisible in
the code, invisible in the tests (the math was right), and would have been
invisible in a pixel diff (the render was self-consistent). Only a tool that
asks *"does this level's premise actually hold"* catches it.

### Verification

| check | result |
|---|---|
| `npm test` | 18/18 pass, exit 0 |
| `node tools/analyze.mjs loop-01` | solvable, illusion load-bearing, exit 0 |
| `npx vite build` | exit 0 |
| `node tools/gate.mjs` | `identical: true` across 6 shots, exit 0 |

The off-axis shot is the proof the geometry is honest: viewed off the isometric
axis, the loop visibly fails to close and the three legs float apart. Nothing is
faked — the projection does all of the work.

One test bug was found and fixed during this phase: the lattice-parity assertion
compared `(a+b) % 2` to `0`, but `-6 % 2` is `-0` in JavaScript and strict
equality distinguishes the two. The property held; the assertion was wrong.

### Added to CI

`npm test` and the level design asserts now run on every PR alongside the pixel
gate. A level with no impossible edges, or one solvable in all four rotations,
fails the build — neither is catchable by a pixel diff.

### Known items, deliberately deferred

- Camera framing is off-centre in every shot. Cosmetic; belongs to the art pass.
- Rotation is discrete state with no transition. Interpolating cell positions
  between rotation states would place them at non-integer coordinates where the
  screen-position invariant does not hold; animating the **camera** between the
  four states is the correct approach and belongs to P2.
- The avatar does not exist yet. The path graph is proven by unit test and by
  `tools/analyze.mjs`, not by anything walking it.

---

## P2 — avatar, HUD, audio, rotation transitions

### Corrections to the P1 record above

Two of the three deferred items are closed, and the third is closed in one
direction only. Stated here rather than edited into P1, so the record of what
was believed when still reads straight:

- **"The avatar does not exist yet"** is now false. `src/player` walks the path
  graph, resolving every edge through `Structure.pathGraph(turns)` and every
  illusion classification through `Structure.impossibleEdges(turns)` — the same
  calls `tools/analyze.mjs` makes, so the avatar cannot disagree with the
  analyser about what the level is. Verified end to end under lockstep: from
  `1,0,0` a single `-x` screen step lands on `5,5,5`, emitting
  `player/moved{viaIllusion:true}` and `level/solved{moves:1,turns:0}`. That is
  a 14-unit Manhattan jump rendered as one ordinary sideways step.
- **"Rotation is discrete state with no transition"** is now half true. The
  camera orbit exists (`src/render`, `CameraOrbit`), is bound to Q/E through
  `world/rotate-request`, and is proven by 24 unit tests including the
  orbit-equals-turn identity with its negative controls. The world is still
  never interpolated — only the camera moves, which was the requirement.
- Camera framing is still off-centre, still deferred, and now has a second
  consequence: `rotateY` pivots at the world origin, which is loop-01's corner,
  so the structure swings toward the frame edge at mid-orbit. The orbit pivot
  and the world's rotation axis must stay the same axis; `render.orbitPivot`
  exists so they can be moved together when the art pass re-centres.

### Deferred out of P2, with the reason

- **The rotation commit frame carries a face-tone swap** (~3.1% of pixels,
  maxDelta 48 = `|faceLeft.r - faceRight.r|`). `paintByNormal` bakes tone onto
  *world*-space normals and `src/world._applyRotation` writes translation-only
  instance matrices, so a world turn keeps tone fixed to the screen while a
  camera orbit carries tone around with the geometry. The two conventions
  disagree only at the commit. Both are internally coherent — "the light is
  fixed in the world and the viewpoint moved" versus "the light is fixed to the
  screen and the world moved" — and choosing between them changes the static
  look of every rotated view. That is an art-direction decision with a required
  reference re-capture (§5), not an integration decision, so it is left open.
  The measurement that isolates it: with the two side tones set equal and the
  avatar hidden, the last orbit frame and the commit frame are **identical, max
  delta 0** — so the camera-orbit-equals-world-turn identity itself is exact
  through the real renderer, and the residual is entirely this convention clash.
- **The avatar's view bias is still visible in the static off-axis shot.** At
  the start cell the avatar is pushed 5 lattice steps along `(1,1,1)` so it wins
  the depth test against a walkway block 12 units nearer; that translation is a
  screen no-op *only* under exact isometric projection. In `offaxis.png` the
  avatar therefore sits about 90 px from where its cell projects. Without the
  bias the avatar is 100% invisible on the frame the level opens on, so the
  alternatives are a real choice (depth-test override, render order, or
  accepting the displacement) and not a bug fix. Left as chosen, measured and
  disclosed. The new `avatar` shot frames the start cell at frustum 6
  specifically so the on-axis cancellation is checked at magnification on every
  gate run.

  What was **not** left alone is the same bias during a rotation orbit, because
  binding Q/E to the transition made it move: measured at the commit frame,
  3.32% of pixels changed with maxDelta 228 and the avatar visibly crossed the
  screen. `src/player` now polls `ctx.peek('render').transitionState().active`
  and takes a bias of 0 for the duration of an orbit. After that change the
  commit frame is 3.19% / maxDelta 48 — 48 being exactly
  `|faceLeft.r - faceRight.r|`, i.e. the whole remaining residual is the tone
  convention above and none of it is the avatar. The price, measured by counting
  avatar-toned pixels frame by frame: at the start cell the avatar is honestly
  occluded for the first 6 frames of the orbit (100 ms) before the camera moves
  far enough off-axis to separate it from the walkway. At the other 9 standable
  cells in loop-01 the bias was already 0 and nothing changes at all.
- **Audio waveform output is not bit-reproducible when three or more voices
  sum.** Isolated to Blink's mixer, not to project code: a control using bare
  Web Audio and none of `src/audio` reproduces it at three summed connections
  and above, while every individual voice renders bit-identical. IEEE-754
  addition is not associative, so the sum depends on the order the connections
  are iterated. It cannot reach the gate — audio constructs no `AudioContext` at
  all in capture mode (measured: constructor call count 0 across a full capture,
  including after emitting every gameplay event).

---

## P3 — the art pass, run as a judge panel

**Completed 2026-07-26.** Three complete art directions built independently in
isolated git worktrees, then scored by three single-lens judges, then a human
picked the winner from the rendered images.

### Why a panel and not a single owner

`ARCHITECTURE.md` §3.4 says coupled systems get one sequential owner. Palette,
tone convention and composition *are* one coupled system — which is the argument
for each agent owning **all three**, independently, rather than for splitting
them across agents. Three complete attempts is not the fan-out the rule forbids;
three agents each holding one third of a palette would have been.

The directions were **riso** (limited-ink print), **dusk** (twilight monument)
and **draft** (technical drafting). Judges scored craft / premise / rigor, with
"premise" defined as *does this serve the illusion* — an art direction that makes
the trick obvious has failed however attractive it is.

| direction | craft | premise | rigor | weighted |
|---|---|---|---|---|
| **riso** | 8.5 | 9 | 6 | **8.3** |
| draft | 6 | 6 | 8 | 6.4 |
| dusk | 8 | 3 | 9 | 5.95 |

### The finding that decided it

**dusk lost on its own strength.** It was the best-measured of the three and
produced the most beautiful individual frames in the set — and its central idea,
atmospheric recession keyed to lattice depth, is self-defeating here. A Penrose
figure works *only* if the eye cannot tell which leg is far. Any depth cue makes
the impossible edge visibly cross fourteen units of atmosphere in one step, so
the trick becomes **more** legible, not less. Its own report said so out loud.

riso won because it is the only direction that supplies zero depth information
anywhere: flat limited-ink planes, no gradient, no lighting term at all.

This is the generalisable result. **The constraint that decides an art direction
here is not aesthetic, it is informational** — the illusion requires the render to
withhold depth, so any technique that adds depth cueing is disqualified no matter
how well executed.

### The tone convention, settled

All three directions independently chose **light fixed in the world**, and each
drove the commit-frame delta to zero through a separately written harness. The
before-figure was re-measured a fourth time on the merge branch:

| | changedPct | maxDelta | meanDelta | identical |
|---|---|---|---|---|
| before | 3.1891 | 48 | 1.433 | false |
| after | **0** | **0** | **0** | **true** |

`maxDelta 48` is exactly `|faceLeft.r − faceRight.r| = |0xd9 − 0xa9|`, so the
entire residual was provably the tone convention and nothing else.

`paintByNormal` bakes tone onto world-space normals while `_applyRotation` wrote
translation-only matrices, so a world turn kept tone screen-fixed while a camera
orbit carried it with the geometry. Composing `makeRotationY` makes a turn a true
rigid rotation, so a turn and an orbit are the same transform.

Accepted consequence: at odd rotations the two side tones are exchanged relative
to turn 0, because you are genuinely looking at a different pair of faces.

`test/tone-convention.test.js` guards it by asserting the upper 3×3 is a proper
rotation. **The guard was verified to fail**: reverting to `makeTranslation`
produces "turn 1 left the basis unrotated", 3 pass / 1 fail. This defect class
reverts silently — `makeTranslation` is shorter, looks correct, and neither a
static shot nor the pixel gate distinguishes the two.

### A correctness bug found by reframing

The `avatar` and `avatarmid` shots were **not exactly isometric**. An orthographic
camera at (40,40,40) aimed at (1,1,0) looks along (−39,−39,−40) — about 1.4° off
the (1,1,1) diagonal. Those shots exist specifically to assert that the avatar's
`(1,1,1)` view bias cancels on screen, which is exact *only* on the diagonal. The
assertion had been weaker than its docstring claimed since P2. Framing is now
derived: all eight corners of every cell are projected for a given view
direction, the bounding box solved for frustum and target, and the camera placed
at `target + distance * (−direction)`.

### Cost, disclosed

**Draw calls 2 → 3.** The extra call is the paper ground — a vertex-coloured quad
parented to the camera. Everything else held, confirmed over 3 profiler runs:
1 program, 0 compiled during play, 0 hitches, 0 MB heap growth, max frame
0.9–1.2 ms. Boot rose 114–130 ms to 129–137 ms.

The misregistered second impression costs **zero** additional draw calls — it is
sixteen more instances on an InstancedMesh that already existed.

### Verification

| check | result |
|---|---|
| `npm test` | 112/112, exit 0 |
| `analyze loop-01` / `probe-01` | exit 0 |
| `npx vite build` | exit 0 |
| `node tools/gate.mjs` | `identical: true` across 9 shots, exit 0 |
| commit-frame delta | `identical: true`, 0/0 |

### The cost local profiling could not see

CI passed, but the gate step went from **~30 s to 10 m 41 s** — 53% of the
20-minute job budget. Three profiler runs on this machine showed nothing wrong,
because this machine has a GPU and the CI runner does not.

Measured cause, not guessed: triangles per frame went **208 → 128,400**, and
128,000 of those are the paper ground's `PlaneGeometry(1, 1, 320, 200)`. CI
rasterises via SwiftShader, so re-rendering that static backdrop for all 90
settle frames of each of 9 shots, twice, is the entire cost. Reproduced locally
by forcing `--use-gl=swiftshader`: **4.4 s per shot** for `pump(90)` plus
screenshot, versus milliseconds on Metal.

This is the second time in this project that a number looked fine and meant
nothing — the first was the fps figure that measures rAF dispatch overhead. The
pattern is the same both times: **a measurement taken under conditions the target
does not share.** The structural budget (draw calls, programs, heap) was held
exactly and still failed to predict a 20× wall-clock regression, because it
counts objects rather than the cost of rasterising them.

The job timeout was raised to 30 minutes as *headroom, not a fix*.

### The fix, and what chasing bit-exactness actually cost

The paper is now rasterised **once** into a render target, and the scene draws a
two-triangle quad sampling it. Same mesh, same hash, same art.

Measured under `--use-gl=swiftshader` to reproduce CI's conditions:

| | before | after |
|---|---|---|
| `pump(90)` + screenshot, hero @1600×1000 | 4394 ms | **1023 ms** |
| triangles per frame | 128,400 | **402** |
| draw calls | 3 | 3 |
| programs compiled during play | 0 | **0** |
| heap growth | 0 MB | 0 MB |

Costs, stated rather than buried: **programs 1 → 3** (all at boot — two was the
prediction, three is the measurement, and the obvious fix of matching the
structure's material key does *not* reduce it), and **textures 0 → 1**.

**It is not pixel-identical: maxDelta 1 over 2.8% of the widest shot.** Getting
there from maxDelta 2 / 30.9% meant finding three separate causes, none of which
was the one guessed first:

1. A material declaring `vertexColors` on geometry with no colour attribute —
   renders black. Caught immediately by looking at the image rather than the
   number.
2. A target sized to the viewport when the paper quad is scaled to `bleed: 1.03`
   times the frustum, so the texture was magnified by 3% instead of sampled 1:1.
3. An 8-bit colour-space round trip.

The residual is last-bit difference along the paper's internal triangle edges.
Handled the way §5 requires — a **deliberate reference re-capture**, not a
relaxed tolerance. The gate is a self-consistency check, so it stayed green
throughout and never had an opinion about this; the honesty here is doing the
re-capture as a reviewed act instead of quietly widening `--tol`.

---

## P5 — making rotation load-bearing

**Completed 2026-07-26.** Three levels, and the routing model that made them
possible to check.

### The mechanic was asserted by CI and load-bearing in nothing

`loop-01` is solvable in one move without ever rotating:

```
$ node tools/analyze.mjs loop-01
"solvableTurns": [0]
"pathUnrotated": ["1,0,0", "5,5,5"]
```

Two nodes is one step, taken in the state the level opens in. `probe-01` is the
same. The mechanic this project is named for had never been required to solve
anything.

The analyser could not have said so. `findPath(from, to, turns)` searches
`pathGraph(t)` for one fixed `t`; `solvability()` runs it four times
independently. So `requiresRotation` means *"some rotations work and some do
not"* — and reads as *"the player must rotate"*. That phrasing is the entire
reason this survived a whole phase, which is why the field is now reported as
`someRotationsFail` and `requiresTurn` answers the real question.

`findRoute` searches `(cell, turns)`, where walking uses `pathGraph(t)` and
turning is a move.

### The obvious turn rule was wrong

The intuitive rule is that a turn should be legal only when the cell is
standable in **both** rotations, so the player cannot strand themselves. The
game disagrees. `world.setRotation` has no standability check, and
`src/player/index.js:366` says it out loud: *"If the current cell is not
standable in this rotation it has no entry, and every direction is blocked —
which is correct: rotate back to get out."* A route may pass **through** a
rotation in which its cell is not a platform.

An analyser using the stricter rule would disagree with the player about what
the level is, which is the failure `ARCHITECTURE.md` §3 exists to prevent.

`loop-01` supplies the negative control without needing a fixture built for it:
at turn 0, `(5,5,5)` aliases `(0,0,0)` and sits in front of it, so `(0,0,0)` is
standable at turns 1, 2 and 3 but **not** at turn 0. Routing from there at turn
0 returns 4 moves opening with a turn; under the stricter rule it returns null.

**The guard was verified to fail.** Patching the turn edge to require
standability in both rotations produces 8 pass / 1 fail, and the one failure is
exactly that test.

One coverage limit, stated rather than left implicit: a *different* wrong rule —
requiring standability only at the **destination** rotation — passes all nine
tests. Catching it needs a cell standable at `t` and `t+2` but not at `t+1` or
`t+3`. A search over 5,915 two-leg structures found **zero** such shapes, so the
gap is unreachable rather than merely uncaught, and no test was written against
a fixture that does not exist.

### Levels declare their premise; CI proves it

A global "every level must require a turn" assert would fail `loop-01` and
`probe-01`, which honestly do not. Each level now declares
`{ turn, illusion, minWalks, minTurns, openWithWalk }` and `tools/analyze.mjs`
proves the declaration, with `turn` and `illusion` as equalities in **both**
directions — if `turn: false` merely meant "no constraint", a level could
quietly acquire a turn-requiring route with nothing to say so.

Guard verified to fail: declaring `turn: true` on `loop-01` exits 1 with
`declares turn: true but measured requiresTurn: false`.

`minTurns` was added after the fact, because `turn: true` only asserts that
*some* turn is needed and `shelf-03`'s premise is specifically three.

### The first three levels passed every assert and were wrong

`ledge-01`, `ascent-02` and `tiers-03` satisfied the routing premise — no flat
solution in any rotation, two to three turns, illusion edges load-bearing — and
were rejected on sight. They rendered as a tower beside a road, a bracket, and
three floating bars.

**An impossible figure requires a closed circuit.** `loop-01` reads as a tribar
because its legs close on screen: net displacement `(n,n,n)` is a multiple of
the view direction, so the far end aliases the near end. All three rejected
levels were *open* paths — walkway, tower, walkway — and no routing premise can
make an open path read as impossible.

This is the second time in this project a level has been algebraically correct
and visually meaningless, and the first time the analyser could not catch it:
`analyze.mjs` proves a level's **routing**, never its picture. The check that
caught it was looking at the render.

The replacements keep a tribar closed and hang the goal off it:

| level | figure | turns | walks | illusion walks | cells |
|---|---|---|---|---|---|
| `spur-01` | tribar(3) + detached spur | 1 | 7 | 2 | 13 |
| `span-02` | tribar(4) + detached span | 2 | 8 | 2 | 16 |
| `shelf-03` | tribar(5) + integrated shelf | 3 | 8 | 2 | 18 |

All three have `flatSolvableTurns: []` — no single rotation contains a complete
path — and all open with a walk, so the level is playable on frame one and the
turn-0 plate is not a picture of a stuck state. That constraint came from the
search rather than from taste: most layouts satisfying the strong premise open
with a turn.

Feasibility was measured before any of this was specified: 797 two-leg layouts
requiring a turn, and 19,021 three-leg layouts with no flat solution in any
rotation. The search is a filter, never the author — those hits are
geometrically valid and visually arbitrary, which is exactly how the first three
levels happened.

### A harness bug that made a passing gate meaningless

`tools/baseline.mjs` skipped spawning a dev server whenever the port was already
open. A vite process from a **different worktree** (`/Users/jelstner/penrose`,
port 5199) therefore served every capture, and an entire before/after comparison
ran against code containing none of the branch's changes — reporting
`maxDelta: 0`, which looked like a pass and proved nothing.

Re-verified properly, with a real worktree checked out at the pre-change commit
and two fresh ports: `identical: true`, 0 of 9 rows moved. The conclusion held;
the original evidence for it was worthless.

The harness now scans for a free port and always spawns its own, announcing the
move. Deliberately not an error: `gate.mjs` runs `baseline.mjs` twice on the
same port and a lingering socket must not fail the second run.

This is the third time in this project a number looked fine and meant nothing —
after the fps figure that measures rAF dispatch overhead, and the structural
budget that held exactly through a 20× wall-clock regression. All three share a
shape: **a measurement taken under conditions the target does not share.**

### The CI cost estimate was 8× too high

The spec predicted roughly **+70 s** of CI for 9 → 12 shots. Measured under
`PENROSE_GL=swiftshader`, which is what CI actually rasterises with:

| | wall clock |
|---|---|
| 9 shots | 14.620 s |
| 12 shots | 18.872 s |
| marginal, 3 shots | **4.252 s** (~1.4 s/shot) |
| projected gate delta (captures twice) | **≈8.5 s** |

The prediction divided total historic gate wall-clock by total shot-captures,
which treats fixed per-invocation cost — vite start, browser launch, the
discovery probe — as if it scaled per shot. It does not, and it cancels out of a
delta. Stated here rather than corrected in the spec, so the record of what was
believed when still reads straight.

`PENROSE_GL=swiftshader` was added to `tools/_browser.mjs` to make this
measurable at all; it is inert when unset, verified by the gate reporting
`identical: true` with it absent.

### Verification

| check | result |
|---|---|
| `npm test` | 141 pass, 0 fail |
| `analyze` × 5 levels | all exit 0 |
| guard: turn-edge rule | verified to fail (8/1) |
| guard: premise declaration | verified to fail (exit 1) |
| `npm run gate` | `identical: true`, 12 shots |
| existing 9 references after harness change | `maxDelta: 0`, re-verified on fresh ports |

### Still open

- No pixel coverage of anything in motion. Unchanged from P4 — shots may not
  start animations, so a step in flight and a mid-orbit camera are still covered
  by unit tests and ad-hoc probes only.
- The route BFS costs a turn and a walk equally, both being one keypress. No
  evidence yet says what a better weighting would be.
- `spur-01` and `span-02` are the same composition at two scales — a tribar with
  a detached bar. Only `shelf-03` integrates its goal into the figure.

---

## P6 — motion coverage

**Completed 2026-07-26.** The gate now covers three frames captured mid-flight.

### What was ungated

All 12 gated shots were **static states**: a shot put the world somewhere and the
harness pumped a fixed 90 frames, by which time nothing was moving. So the camera
orbit, the avatar's step interpolation, and the avatar's bias-drop during an orbit
were covered by unit tests and ad-hoc probes only.

That was tolerable while rotation was decorative. P5 made it load-bearing in three
levels, which turned the orbit into the most-exercised interaction in the game and
the largest thing the gate could not see.

### Determinism was never the blocker

`tools/commitframe.mjs` had already been driving motion reproducibly since P2: it
emits `world/rotate-request`, pumps an exact number of frames, and derives the orbit
length from the engine rather than assuming it.

The blocker was the **shot contract** — "a shot may not start an animation" — and
that rule turns out to be about *legibility*, not determinism. Motion under lockstep
is perfectly reproducible; a shot that starts an animation simply stops describing a
*state* and starts describing a state **plus a frame count**. So the rule became: a
shot may start an animation **if it declares the `settle` it needs**, which makes the
frame count part of what the shot describes. Symmetric with the `level` declaration
added in P5, and it reuses the same discovery machinery.

### The assertion that stops this being theatre

The failure mode for this whole change is a motion shot that silently captures a
**settled** frame. It would be perfectly reproducible, pass the gate forever, and
cover nothing — the same shape as any green result that measured something other
than what it claimed.

So `tools/baseline.mjs` **refuses** any shot that declared a `settle` and is not in
motion at the shutter, reading `render.info().orbiting` and `player.motionState()`.

*Guard verified to fail:* declaring `settle: 14` on the static `wide` shot gives
exit 1, `ok: false`, `"declared settle 14 but nothing was in motion at the shutter"`,
with `motion { orbiting: false, moving: false }`.

### Measured, not computed — again

| | frames | `ceil(seconds / fixedDt)` |
|---|---|---|
| orbit, request → commit | **28** | 27 — **wrong** |
| step, `step()` → settled | **14** | 14 |

`src/render/camera.test.js` derives 27 from the same constants *in isolation*; the
extra frame appears only when the whole engine is driven. A spec that trusted the
arithmetic would have captured the frame **before** the commit and called it the
commit — and the gate would have passed on it forever.

This is why `orbitlate` sits at 27, the last frame still in flight, and why there is
deliberately **no commit-frame shot**: at 28 the orbit is inactive, so such a shot
reports `orbiting: false` and the harness rejects it. The committed state is already
covered statically by `rot1`, and the delta across the commit is what
`commitframe.mjs` exists to measure.

`test/motion-frames.test.js` pins the measured **counts**, not just the constants,
by driving the player through a harness. *Guards verified to fail:* `ORBIT_SECONDS`
0.45 → 0.5 fails the orbit pin; `MOVE_SECONDS` 0.22 → 0.3 fails with "the step settle
count changed".

### A framing error the numbers could not catch

The orbit shots were first framed on the structure at turn 0. Every automated check
passed — the capture reported `orbiting: true`, the gate was identical. **Looking at
the render showed a third of the structure swinging out of frame**, because the camera
rotates 90° about the world origin during an orbit and the frustum had been solved for
the on-axis view.

Anything out of frame is not gated, so the shot was covering less than it claimed.
Fixed by framing the **union** of where the cells sit at turn 0 and turn 1 — the two
ends of the swing, which the orbit-equals-turn identity makes equivalent. The subject
is smaller; completeness matters more than scale for a gate shot.

Third time in this project that looking at the image caught what the numbers could
not, after the black `vertexColors` material and the three visually-meaningless levels
in P5.

### Cost, and an arithmetic error in the spec

Measured under `PENROSE_GL=swiftshader`, which is what CI rasterises with:

| | wall clock |
|---|---|
| 12 shots | 18.820 s |
| 15 shots | 21.255 s |
| marginal, 3 shots | **2.435 s** (~0.81 s/shot) |
| projected gate delta (captures twice) | **≈ 4.9 s** |

The spec predicted "≈ +2.8 s", and that number was **arithmetically wrong**: it
doubled the per-shot rate for the gate's two captures but dropped the count of three
shots. The correct prediction from the static rate would have been ≈ 8.4 s.

The measurement is *below* even the corrected figure, because motion shots pump 7, 14
and 27 frames rather than the default 90 — a motion shot is **cheaper** than a static
one.

**And then CI disagreed with the local measurement too.** Comparing the `Determinism
gate` step on the real runner:

| run | shots | gate step |
|---|---|---|
| `30210393896` (P5 on main) | 12 | **155 s** |
| `30212724921` (P6) | 15 | **164 s** |

**+9 s observed, against +4.9 s predicted from the local SwiftShader measurement** —
low by roughly 1.8×. One sample each, so runner variance is a plausible explanation
and this is not a strong result on its own. It is recorded because the alternative is
leaving a laptop figure standing as though it were a CI figure, which is the exact
mistake §P3 documents.

Three cost estimates in this repository have now missed, in both directions. The
figure that matters is the one taken under the conditions the target actually runs
in, and even that wants more than one sample. Nothing here is close to the 30-minute
timeout, so the practical answer is unchanged.

### What this widens, deliberately

**The gate now depends on animation timing.** Every other shot is a static state;
these three are a state plus a clock. Any future change to easing, `HOP`,
`MOVE_SECONDS` or the orbit curve will move pixels in a gated shot.

That is the coverage being bought, not a defect — but it means a red gate after an
animation change is **expected**, and the correct response is a deliberate reference
re-capture as a reviewed commit (`ARCHITECTURE.md` §5), never a widened tolerance.

### Verification

| check | result |
|---|---|
| `npm test` | 146 pass, 0 fail |
| motion assertion | verified to fail on a static shot |
| frame-count pins | both verified to fail |
| existing 12 references after the harness change | `maxDelta: 0`, all rows |
| `npm run gate` | `identical: true` across 15 shots |

The last row is the real result: motion reproduces frame-for-frame across two
independent captures.

### Still open

- The orbit shots frame the union of both swing ends, so the subject is small. A
  tighter frame that still contains the whole swing would need `frameCells` to solve
  against a camera path rather than a static direction.
- Only `+1` orbits are covered. A `-1` orbit uses the same code with the opposite
  sign, which `camera.test.js` covers in unit form but no shot captures.

---

## P7 — the campaign spine

**Completed 2026-07-26.** The four campaign levels can now be played end to end.

### What was actually missing

The mechanic was proven and gated. What was missing was everything *between* one
level and the next: `world` resolved the level from boot config at `init` and sized
its `InstancedMesh` there, so `?level=` was the only route to a different one. That
was scoped out of P5 deliberately, and it was the blocker.

The blast radius turned out to be small, because the event already existed and the
other subsystems already handled it: `src/player` resets its cell, counters, caches
and any in-flight move on `level/loaded`, and `src/render` cancels any transition.
A correct `loadLevel` is therefore: dispose the mesh, rebuild, reset rotation,
re-emit. Nothing else needed to know.

Sequencing lives in a new `src/campaign` subsystem, which asks for the next level
with `level/load-request` — the same request shape `ui` uses to ask `render` for a
rotation. It reads the order through `ctx.peek('world').order` rather than importing
`src/world/levels.js`, because §3.3 permits subsystems to reach each other only
through `peek` for a read.

### Two decisions worth defending

**Progression is inert under `config.capture`.** It advances state in response to an
event, which is the shape that makes captures nondeterministic, and the gate is this
project's artifact. The honest cost: that path is covered by unit tests only — the
same class of gap P6 had just closed for motion, reopened deliberately elsewhere. It
also closes a foot-gun rather than only a present risk: `stepmid` already calls
`player.step()` during a capture, and a future motion shot that stepped onto a *goal*
would otherwise load a level mid-capture.

*Guard verified to fail:* forcing `enabled = true` fails the inertness test.

**The advance is frame-counted, not immediate.** Loading inside the `level/solved`
handler would re-enter `player.step()` while it is still executing — `level/loaded`
resets the player's cell and counters mid-call — and would teleport the player the
instant they touched the goal, with no beat to register the win. So it is a countdown
in frames served from `update()`. Frames, never wall-clock: §1 forbids `setTimeout`,
and a frame count is a pure function of the fixed timestep.

### An off-by-one that only looking could catch

The HUD showed **`1 / 4` while playing level 2**.

`main.js` added `campaign` *after* `world`, and `world` emits `level/loaded` inside
its own `init` — so the listener was registered too late to ever hear the opening
level, and the index sat at 0. The eleven campaign unit tests all emitted
`level/loaded` manually *after* init, so not one of them could have caught it. The
rendered HUD caught it immediately.

Fixed in both directions: `campaign` now registers before `world` (the rule `main.js`
already documented for `player`), **and** seeds its index from `ctx.peek('world')` at
init so registration order is no longer load-bearing. Regression test added.

Fourth time in this repository that a change passed every automated check and was
wrong in a way only looking could reveal — after the black `vertexColors` material,
three visually-meaningless levels, and an orbit shot with a third of its subject out
of frame.

### The spec asked for work that did not need doing

It called for per-level hint text to teach the controls, and argued hints would be a
visible change requiring careful sequencing against the reference set.

Both claims were wrong. `src/ui` already carries a permanent legend — `↑←↓→ Move`,
`Q E Rotate` — so the onboarding existed. And `src/ui/index.js:315` sets the HUD root
to `display: none` under `config.capture`, so **nothing in the HUD reaches a plate**
and no sequencing was needed either way. No hint was added.

What was genuinely missing was campaign *feedback*: the HUD named the level but not
the position in the run, and `campaign/complete` fired into nothing.

### `ORDER` opens with `loop-01`, reversing this phase's own spec

The spec said `loop-01` "teaches nothing and wins itself" because it solves in one
move. That one move **is** the mechanic — a single sideways step across fourteen
units — and `loop-01` is the only level whose figure is the bare tribar with nothing
hung off it. As an opener that is the cleanest statement of what the game is; the
turn is introduced immediately after. The curve is then the measured `minTurns` of
each level: 0, 1, 2, 3, asserted by test as non-decreasing.

### Verification

| check | result |
|---|---|
| `npm test` | 166 pass, 0 fail |
| capture inertness | verified to fail when forced on |
| mesh-leak guard | verified to fail when teardown removed |
| `analyze` × 5 levels | all exit 0 |
| `npm run gate` | `identical: true` across 15 shots |
| 15 references, before and after | `maxDelta: 0` — the spine is invisible to the gate |
| **played end to end** | loop-01 1 move, spur-01 7, span-02 8, shelf-03 8, `campaign/complete`, zero page errors |

The playthrough runs with `lockstep=1` but `capture=0`, so `src/campaign` is enabled —
it exercises precisely the path the pixel gate does not cover.

### Still open

- **Four levels is a spine, not a game.** Three of them are tribars; the second figure
  family is unbuilt. A four-leg closed circuit was proven constructible (18 exist) and
  the first one rendered read as an ordinary solid, not an impossible figure — so that
  family needs the render-and-judge loop, not just the search.
- No persistence: a refresh restarts the run.
- No ending beyond a HUD line.

---

## P8 — the second figure family

**Completed 2026-07-26.** The campaign is seven levels across two figure
families, and stops being one shape at four sizes.

### The tribar family is one-dimensional, and that is provable

P7 left "three of four levels are tribars" as a content gap. It is not a content
gap. Enumerating **every** three-leg closed circuit with legs 1..8 gives 48 hits,
and the distinct leg-length multisets are exactly `1,1,1` through `8,8,8` —
**every three-leg closed circuit has all three legs equal.**

Closure requires net displacement `(t,t,t)`, the only displacement the view
direction collapses to nothing. With three legs on three distinct axes and
positive lengths, that forces all three equal. The family has one degree of
freedom: size. No amount of level authoring escapes it; only a different leg
count does.

### The endless staircase is not constructible here

The obvious second Escher figure, and `src/geometry`'s own docstring already
notes the mechanism — `+x` then `+y` has the same screen delta as `-z`, which
*is* the Penrose staircase.

It still cannot close. Closing forces net `(t,t,t)`, so `net_y = t` is the total
climb while `net_x + net_z = 2t`; a staircase climbing once per horizontal step
spends only `t` horizontal steps and needs `2t`. The shallowest closable stair is
therefore **two horizontal steps per unit of climb**, which reads as a ramp.

Measured against the algebra: of 3,562 four-flight closed circuits carrying an
illusion edge, **280** have three of four flights climbing and **0** have all
four. A search confirming a proof, not a search that came up empty.

### The order of the loop was wrong, not the destination

P7's advice was *"the work is the render-and-judge loop over that pool, not more
searching."* Right about the destination, wrong about the order. Visual judgement
is the expensive, human, non-reproducible stage, so everything computable belongs
in front of it:

| stage | survivors |
|---|---|
| four legs, net a positive multiple of `(1,1,1)`, legs 1..6 | 810 |
| no repeated 3D cell | 810 |
| carries at least one illusion edge | 440 |
| ≥8 distinct screen cells | 400 |
| **encloses a hole on screen** | 330 |
| non-degenerate: doubles back, min leg 2, ≥9 screen cells, ≤20 cells | 102 |
| hosts a strong-premise route once augmented | 102 |

`tools/search.mjs` prints all seven numbers. It is **committed**, unlike its
predecessor: P7's scaffolding was thrown away, so its finding — 18 four-leg
circuits at net `(2,2,2)` — cannot now be reproduced or diffed against. This
phase measured 70 at that net under broader constraints and cannot reconcile the
two, because there is nothing left to compare with. That is not a claim the
earlier number was wrong. It is a claim that nobody can now tell.

### The hole criterion, and why it is not a judge

An impossible figure needs somewhere for the eye to trace the loop. A closed
circuit that folds back on itself projects as a filled slab and reads as an
ordinary solid however good its routing premise is — which is exactly what P7
got when it rendered a four-leg circuit and saw a rectangular bar.

`Structure.enclosedHoles` floods the empty complement inward from the bounding
box and returns what it cannot reach. Six neighbours, not four: `a+b` is always
even, so the screen lattice is a hex grid.

**It is necessary and NOT sufficient**, and the counterexample is pinned as a
test fixture: a figure with three enclosed cells that still renders as an
ordinary staircase. Closure was already known to be necessary-not-sufficient;
this is a second such condition, not a decision procedure. The filter cuts
400 → 330. The eye still decides.

### Three details this phase asserted were load-bearing are not covered

The guard for the hole detector was supposed to be swapping the six-neighbour set
for the four horizontal steps. **It did not fail** — 6 pass, 0 fail. The
reasoning behind it was wrong twice over: the four horizontal steps *generate*
the vertical ones, since `(+1,+1) + (-1,+1) = (0,+2)`, so both sets reach the same
lattice; and a smaller neighbourhood makes a fill *more* restricted, so the error
would be over-reporting enclosure, never under-reporting it.

Two further details the code's comments implied were load-bearing also turned out
uncovered:

| mutation | result |
|---|---|
| `SCREEN_NEIGHBOURS` → 4-connected | 6 pass, 0 fail — **not covered** |
| bounding-box padding `2` → `0` | 6 pass, 0 fail — **not covered** |
| border seed two b-rows → one | 6 pass, 0 fail — **not covered** |
| flood fill drops the `occupied` wall check | **3 pass, 3 fail** ✅ |

Padding is uncovered because no fixture has a hole touching its bounding box; the
two-row seed because the column loop already seeds both parities. The mutation
that does fail collapses every positive to `0` while **both negative controls stay
green** — the signature that distinguishes a broken detector from a fixture set
that never discriminated.

The comments now say which parts are correct by construction rather than by
coverage. A comment asserting that a constraint matters, on code where nothing
checks it, is the same species of defect as a green gate measuring the wrong
thing.

### Flat projections are not a substitute for the renderer

Candidates were first judged as true isometric SVG — same `(a,b)` invariant, same
depth rule. On that evidence 9 of 12 figures were rejected as ordinary frames and
slabs.

Rendered through `baseline.mjs`, **all six shortlisted candidates read as
impossible.** The riso palette and lighting do work a wireframe throws away, and
the SVG pass was badly pessimistic. Fifth time in this repository that looking at
the real render overturned a conclusion — and the first time it overturned one in
the *optimistic* direction. Every figure that ships was chosen from an engine
render.

### Identical statistics are not an identical figure

The spec claimed one figure was "a cyclic rotation of" another, "the same figure
entered from a different leg". Measured: neither the 3D cell set nor the screen
outline matches. These circuits close **on screen** but not in 3D — the net is a
positive multiple of `(1,1,1)`, never zero — so reordering the legs traces a
different shape.

They were conflated because their statistics are identical: 17 cells, 9 holes, 2
illusion edges, 12 standable. That is the same trap as the illusion-edge count,
which is 2 for every four-leg candidate *and* for the tribar, and therefore
discriminates nothing.

### A false green, caught by a count

The first before/after capture reported 15 shots and an all-zero diff. It ran in
the reference worktree — no `cd` back — and compared the pre-change tree against
itself. **The tell was the shot count: 15 where 18 was expected.**

Same species as P5's stale dev server, different mechanism, same lesson: an
all-zero diff is evidence only if you can say what produced it. Re-verified
against a reference captured at the commit *before* the levels landed, so the
comparison covers the levels and the shots together rather than the shots alone.

### The first cost estimate in this repository that did not miss

Measured under `PENROSE_GL=swiftshader`, twice each:

| | run 1 | run 2 |
|---|---|---|
| 15 shots | 21.61 s | 21.56 s |
| 18 shots | 26.09 s | 26.01 s |

Marginal **1.49 s/shot**, projected gate delta **≈8.9 s** against the plan's 8.5 s
hypothesis. P5's static rate was ~1.4 s/shot and P6 measured 21.255 s for 15
shots, so both reproduce. Note P6 found CI running ~1.8× above the local
SwiftShader figure, so the CI delta may land nearer 16 s; nothing here is close to
the 30-minute timeout.

### Verification

| check | result |
|---|---|
| `npm test` | 181 pass, 0 fail |
| `analyze` × 8 levels | all exit 0 |
| `npm run gate` | `identical: true`, 18 shots, "[gate] PASS" |
| 15 references, before the levels and after the shots | `rows 15, missing 0, strict, tol 0, identical true`, no nonzero row |
| hole-detector guard | verified to fail — 3 pass / 3 fail, both negative controls green |
| declared vs measured premises | exact on all 7 campaign levels, `minTurns` and `minWalks` |
| plate framing | measured subject bbox, `fillY` 0.748/0.749/0.748 against the existing 0.749 |
| **played end to end** | 7 levels, `campaign/complete {"levels":7}`, zero page errors |

The playthrough drives `player.step()` and `world/rotate-request` directly,
because `src/ui/index.js:412` does not attach the keydown listener under lockstep
at all. So `resolveKey` is *not* covered by it — `test/ui.test.js` covers that —
and everything downstream is.

### Still open

- **Whether a 6-turn level is any good is still unmeasured.** `crook-06` is 5
  walks against 6 turns: **55% of the player's inputs are rotations**, where
  `arm-04` is 25% and `perch-05` 33%. The playthrough proves it is completable,
  not that it is enjoyable, and a machine driving the route cannot tell the
  difference. `findRoute` still costs a turn and a walk equally — the open
  decision from P5 — and this is the level that would justify revisiting it.
- The 102-figure pool was judged nine figures deep. There are 1,255 distinct
  augmented shapes at exactly 4 turns and 104 at 5; the vast majority have never
  been looked at.
  > **Corrected in §P20.** Both counts were computed on `turnsInRoute`, which is
  > a tie-break rather than a minimum, so neither is a count of shapes that
  > REQUIRE that many turns. Measured properly, and requiring the goal to be
  > visible in the opening rotation: **928 at 4 turns and 26 at 5.**
- No persistence, and no ending beyond a HUD line. Unchanged from P7.
- The `-1` orbit is still uncaptured, and `src/core/engine._emit` still has no
  try/catch. Both unchanged.

---

## P9 — graded, at last, and the premise did not survive it

**Completed 2026-07-26.** `blind-panel` and `tools/grade.mjs` had existed since
P4 and this project had never been scored against anything. It has now. Raw
verdicts and tallies are in `docs/grading/`.

### The headline is a negative result

Five adversarial critics, each with a different lens, scored nine frames 1–10 on
*how close is this to a professionally shipped, commercially released game in its
own style* — explicitly instructed that marking it down for not being photoreal
would be a category error.

| lens | mean | range | CLOSE |
|---|---|---|---|
| colour | 5.0 | 4–6 | 3/9 |
| composition | 4.4 | 3–6 | 1/9 |
| communication | 4.3 | 3–6 | 2/9 |
| storefront | 4.0 | 3–5 | 0/9 |
| surface | **3.3** | 3–4 | 0/9 |

**Overall: mean 4.22, median 4.0, stdev 1.04. AMATEUR 39, CLOSE 6, SHIPPED 0.**

The benchmark this project defines itself against is in §The premise:
Claude-of-Duty scored **3.59 → 4.14 → 4.05 → 5.05** out of 10 against a modern
Call of Duty, with two shots reaching CLOSE and the rest AMATEUR.

Penrose scores **inside that band, and below its final round.** The premise —
*"choose a target where that ceiling does not exist"* — predicted that a
stylised isometric target would escape the photoreal ceiling. Measured against
its own genre's commercial bar, it did not.

Three qualifications, none of which rescue the claim:

- Claude-of-Duty's 5.05 came after **four rounds** of iteration. This is one round.
- Different panels, rubrics, judges and eras. Indicative, not rigorous.
- **The judged plates deliberately carry no HUD** — `src/ui/index.js:315` hides it
  under `config.capture` — and the storefront critic marked it down for exactly
  that. So 4.22 is a **floor** on the game as played, not an estimate of it.

The honest reading is that target selection bought less than the premise claimed,
and that the gap is craft: shading, contact shadows, framing and a presentation
layer, none of which the target choice supplies for free.

### The panel found defects the pixel gate is structurally blind to

Three lenses independently reported hairline artifacts at beam edges. Magnified
3× on `hero` and `crook06`, two are confirmed present in the shipped render:

- **bright slivers along the bottom edges** of red and blue faces;
- **tonal breaks mid-face** on surfaces that should read continuous.

This is the finding worth more than the score. **18 gated shots, 181 tests and a
green gate coexist with visible rendering artifacts**, because the gate proves
two captures are *identical*, never that either is *correct*. Determinism is not
correctness, the distinction has been implicit in `ARCHITECTURE.md` §5 since P0,
and one adversarial pass surfaced what the gate cannot express.

### The art direction call was right, and now measured

A genuinely blind panel — three variants of the same scene, judges unable to know
which shipped — over 9 shots × 2 candidates:

| candidate | wins | winRate | CI95 | verdict |
|---|---|---|---|---|
| `dusk` (night palette) | 0 / 9 | 0 | [0, 0.2992] | worse |
| `draft` (greybox) | 0 / 9 | 0 | [0, 0.2992] | worse |

Position bias clean: left chosen 44.4%, `suspect: false`. The riso direction P3
chose beat both losing candidates on **every one of 18 comparisons**.

### Two corrections applied to this phase's own method

**The tool's reported `n` was wrong and the headline interval with it.** All five
judges returned byte-identical verdicts, so 90 verdicts are 18 independent
observations. `tally` computed a Wilson interval on n=45 giving `[0, 0.0787]`;
collapsed to one effective judge the same code path gives **`[0, 0.2992]`**,
nearly 4× wider. Only the second is reported.

**`meanPairwiseAgreement: 1.0` is vacuous and is not counted as evidence.**
`blind-panel` computes inter-rater agreement to catch a panel that detected no
shared signal. Five instances of one model cannot fail that check — perfect
agreement measures **determinism, not consensus** — so `problemsWith` returning
clean proves nothing. This is the same shape as every other green-but-meaningless
result in this record.

The fix, applied to the rubric panel: **differentiate the judges.** Five distinct
lenses produced a 1.7-point spread and converged independently on the same two
weakest frames (`wide` and `crook06`, both 3.2). Differentiation is what turns a
panel into a measurement.

### A leak caught before judging, not after

`grade.mjs` names composites `<candidate>--<shot>.png`. Judges reading filenames
would learn which candidate was in the pair, and "draft" additionally connotes
*unfinished*. Side assignment was still blind, so the position-bias statistic was
safe, but the verdict itself was exposed to a word. Judges saw `image-01..18` in a
salted-hash order instead.

### What was abandoned, and why

The planned thesis test was penrose against Monument Valley through the same
pairwise harness. It was dropped before any number was produced:

- **Sourcing.** One cleanly obtainable fair-use frame, not nine. The rest would
  have meant scraping a fan site.
- **Format confound, which is fatal on its own.** Penrose plates are 3224×1000
  poster compositions; Monument Valley frames are portrait phone screenshots
  carrying game UI. That comparison measures presentation format, not art — *a
  measurement taken under conditions the target does not share*, which is the
  failure this record has already documented three times.
- **Blinding would have been cosmetic.** Flat riso against soft-gradient pastel
  is not confusable; every judge identifies both instantly. Claude-of-Duty's
  blind A/B was meaningful because both sides were photoreal military frames.

The absolute rubric replaced it, and answers the same question better: it is the
question Claude-of-Duty's critics actually answered, so the numbers compare.

### Verification

| check | result |
|---|---|
| art variants genuinely distinct | 27 of 27 captured files distinct by sha256 |
| Panel B side balance | `worstSkew: 1`, the minimum achievable at 9 shots |
| Panel B position bias | leftRate 0.4444, `suspect: false` |
| Panel B tally | exit 0, both candidates `worse` |
| Panel A spread | 1.7 points across five lenses — not pseudo-replicates |
| defect reports | 2 of 2 confirmed by 3× magnification |
| raw data | `docs/grading/` — verdicts, key, both tallies, all five lens sheets |

### Still open

- **Two confirmed rendering defects**, unfixed: bottom-edge slivers and mid-face
  tonal breaks. Neither is expressible as a gate failure, so fixing them needs a
  check the repository does not currently have.
- **The gate cannot see correctness.** The single largest gap in this project's
  verification story, and now demonstrated rather than suspected.
- **4.22 is a floor, not a score.** Re-run against frames that include the HUD
  before treating it as the game's number.
- The panel is five instances of one model with different prompts. Different
  models, or a human, would be a stronger panel — and would let inter-rater
  agreement mean something.
- Unchanged from P8: `crook-06` is 55% rotations and unplaytested for tedium; no
  persistence; no ending; the `-1` orbit uncaptured; `_emit` has no try/catch.

---

## P10 — the defects were the art direction

**Completed 2026-07-26.** P9 ended by filing [issue #16](https://github.com/DelanoJoey/penrose/issues/16),
"two confirmed rendering defects the pixel gate cannot express," and listing them
under *Still open* above. Both were measured this phase. **Neither was a defect.**
Both were constants in `src/render/index.js`, doing exactly what their docstrings
said they would.

### What they actually were

| reported | is | evidence |
|---|---|---|
| "bright hairline slivers along bottom edges" | `INK.ghost` + `INK.ghostDropY` | 3861 red / 3072 blue ghost pixels; **99.6% / 99.5% have their own plate directly above**; median run 8px; **0** on the top plate, which is what a −Y drop predicts |
| "tonal breaks mid-face at cube boundaries" | `INK.densityJitter`, documented as per-block | the red field is **9 flat plateaus**, not a gradient; top 12 tones cover **99.8%**; spread ch0 **235..247** against a predicted **235..247** |

So the issue's two proposed checks were both unbuildable, and that is the more
useful half of the finding:

- **"no pixel carries a colour absent from the palette"** cannot fail. Every ink
  is a multiplicative transform of a palette entry — in palette by construction.
- **"sample face interiors for uniformity"** fails on *correct* output. Interiors
  are deliberately non-uniform; that is what `densityJitter` is.

The premise that a correctness check would have caught these does not hold,
because there was nothing incorrect to catch. What is true is worse: **five
independent lenses read the deliberate press-imperfection as breakage.** That is
an art-direction failure, not a rendering one.

### Two mechanisms, both measurable

**The ghost clamped.** Not "too bright" — by luma it was already *darker* on all
three plates (−21.6 / −11.0 / −9.3). The red channel at 1.15 drove two of three
plates past full: `faceTop 255,181,17 -> 255,146,8` and
`faceRight 241,80,96 -> 255,63,65`. A clamped channel stops being a denser pass
of the same ink and becomes a saturated primary. **The eye was reading saturation
and reporting brightness**, which is why the first diagnosis this phase produced —
"the ghost is too bright, make it darker" — was wrong in its mechanism while
right about the symptom. It was corrected by computing the values rather than
describing them.

**The density was keyed per instance.** `hash01(i)` is uncorrelated between
neighbours, so every cube boundary carried the full amplitude as a step and every
seam landed exactly on a geometry edge — which is precisely what makes variation
read as rasterisation error instead of as ink.

### What changed, and what it bought

`ghost` `[1.15, 0.62, 0.45]` → `[0.86, 0.78, 0.70]`; density re-keyed from the
instance index to a smooth 3D value-noise field (`valueNoise3`, new) sampled at
the **unrotated cell**, wavelength 6 (`INK.densityWavelength`).

| | before | after |
|---|---|---|
| ghost peak red, `hero` | **255 — clamped** | **230** |
| ghost coverage, red plate | 3861 px | 3979 px |
| adjacent-cell density step, **all 7 levels** | max **7**, mean 3.40–3.82 | max **2**, mean 0.45–0.87 |

Coverage barely moves, so the misregistration still reads as clearly as it did —
it just no longer reads as an error. Five variants were captured and looked at
(`ghost` alone, smooth field alone, jitter off, and both combinations) before
choosing; jitter-off removed the seams entirely and was rejected because it
discards a stated pillar of the direction ("THE PRESS IS IMPERFECT").

### The ceiling, which is structural

`instanceColor` is one colour per instance and the cube geometry is shared across
instances, so **density cannot vary within a cube** without a fragment-shader or
per-vertex change — both blocked by the shared geometry and by the program-count
budget. Seams can therefore be made quieter, never absent, at any wavelength that
still leaves the structure varying at all. Past roughly 24 cells the effect is
gone entirely. This is recorded because the obvious next move is to raise the
wavelength further, and it does not work.

### The check that can fail

Issue #16 asked for a check that could have failed. `test/ink-invariance.test.js`
is one, and it guards the invariant this change put at risk — density must be
sampled at the unrotated cell, or a quarter turn reshuffles every block and the
commit frame stops being pixel-identical. That invariant was asserted in a
comment and covered by nothing.

**Each of its three assertions was falsified before being trusted**, which is the
step P8's audit found missing on three earlier "load-bearing" claims:

| mutation | expected failure | result |
|---|---|---|
| sample the rotated position instead of the cell | invariance | ✅ failed, named the cause |
| `densityWavelength` 6 → 0.35 | smoothness | ✅ failed, `0.734 of full amplitude` |
| restore `ghost` red to 1.15 | clamp | ✅ failed, `faceTop channel 0 to 1.213` |

The smoothness test carries its own negative control — it reconstructs the old
uncorrelated keying and asserts it is *worse* — because without one it would pass
on a constant field and measure nothing.

`INK.knockout` is deliberately exempt from the clamp assertion: it is
`[1.60, 1.50, 1.35]` and clamps on purpose, because a knockout is meant to blow
out. Asserting the rule only where it applies is what makes it a check rather
than a lint.

### Verification

| check | result |
|---|---|
| unit tests | **184 pass, 0 fail** (181 + 3) |
| determinism gate | **PASS** — two captures pixel-identical |
| `analyze.mjs crook-06` | OK, routing premise unaffected |
| full capture | **18/18 shots**, 0 errors — count checked, per P8's false-green |
| before/after diff | 18 rows, **0 missing**, `identical: false` as intended; maxDelta 25–35 |

### Corrected here

- **`shots/ref/` is gitignored** (`.gitignore:4`, `shots/*/`); only
  `shots/.gitkeep` is tracked. This repository has **no committed reference set**
  — the gate is purely self-consistency, so an intentional art change cannot
  break CI and there is no reference commit to make. Planning for one was an
  error, caught by trying to do it.

### The blind A/B, and why its headline number is not quotable

18 pairs, five differentiated lenses, `worstSkew: 0`, pairIds neutralised, key
withheld in a directory judges were forbidden to read. Raw data in
`docs/grading/2026-07-26-p10-*`.

The composites were rebuilt as full-view-over-detail before judging. Judging two
1600×1000 plates side by side would have handed the panel an instrument that
cannot resolve an 8px hairline or a 2-byte-level seam — P9's critics only caught
these at 3×. The magnified strip uses the same region on both sides, chosen from
the left half's ink, so the crop cannot favour a side.

| | wins | rate | CI95 | exactP | verdict |
|---|---|---|---|---|---|
| raw, 5 judges | 64/90 | 71.1% | 0.610–0.795 | 0.000077 | better |
| effective, 4 judges | 46/72 | 63.9% | 0.524–0.740 | 0.024 | better |

**`tally` exits 1 on both.** Mean pairwise agreement is 0.578 raw / 0.537
effective, and `problemsWith` correctly refuses to certify: *"the panel is not
detecting a shared signal, so these win rates are noise however decisive they
look."* **Do not quote 71.1%.** Position bias was clean — leftRate exactly 0.500.

The per-judge decomposition is the actual finding:

| lens | prefers the change | notes cite |
|---|---|---|
| edge-quality | **18/18** | measured pixel values — "peaks at R254 … brighter than the flat pink itself" |
| colour-coherence | **18/18** | measured — "H≈359° vs 354–356°, S≈75% vs ≈67% … outside the ink set" |
| surface | 11/18 | qualitative |
| print-authenticity | 10/18 | qualitative |
| storefront | **7/18 — against** | qualitative |

The two lenses that reached 100% both independently resorted to **measuring the
pixels**, and both described the clamp without being told it existed. They were
prompted differently and agreed 18/18, which is why the effective tally collapses
them to one judge — the inverse of P9's error, where five near-identical judges
inflated `n`.

The three qualitative lenses were not detecting the stimulus at all, and they can
be shown not to have been:

- **storefront** justified its picks with "tighter corner joint", "better
  proportioned", "more balanced spacing", "avatar reads as anchored rather than
  floating". The two sides are **pixel-identical in geometry** — only ink differs.
  Every one of those differences is impossible.
- **print-authenticity** cited "shading depth", "gradation", "blends smoothly".
  This renderer has **no lighting term at all** (`src/render/index.js:6-8`). There
  is no shading to grade.

So the near-chance agreement is not evidence that the change did nothing. It is
evidence that **three of five lenses could not resolve the difference and
narrated instead**, and their noise swamps the two that could. Mean pairwise
agreement summarises a panel on the assumption that every judge is a noisy
sampler of one latent quality; it is the wrong statistic for a panel where some
judges measured and others guessed.

That cuts both ways and the honest position is the conservative one: **this A/B
did not produce a certified perceptual win.** What stands without it is the
objective half — the clamp is gone (peak red 255 → 230) and the seam dropped from
7 to 2 byte levels — and neither of those depends on anyone's taste.

**A lens that confabulates impossible differences is a broken instrument, not a
weak one.** P9 already flagged that five instances of one model is a weak panel.
This adds the sharper version: a lens must be shown capable of resolving the
stimulus before its verdict counts, and that capability is cheap to test —
give it a difference it cannot possibly see and check whether it reports one.

### Still open
- Everything in P9's *Still open* except the two "defects", which are resolved as
  non-defects rather than fixed: the HUD re-grade, a stronger panel, `crook-06`'s
  55% rotations, persistence, an ending, the `-1` orbit, `_emit`'s missing
  try/catch.

---

## P11 — the HUD is worth half a point, and rotation eats the clock

**Completed 2026-07-27.** Three of P10's open items, taken in the order that made
each measurable: playtest `crook-06`, build the competence control, then re-grade
with the HUD — the control first, because without it the re-grade's number means
what P10's meant, which is nothing.

### 1. `crook-06` — the rotation cost is worse than the input count says

P7 recorded `findRoute` costing a turn and a walk equally as an open decision
(`levels.js:227`), and P8 flagged `crook-06` as 55% rotations and unplaytested.

The input count understates it, because the two are not the same length:

```
MOVE_SECONDS 0.22    ORBIT_SECONDS 0.45    a rotation costs 2.05x a walk
```

| level | turns | walks | % inputs rot | % TIME rot |
|---|---|---|---|---|
| spur-01 | 1 | 7 | 12.5% | 22.6% |
| span-02 | 2 | 8 | 20.0% | 33.8% |
| shelf-03 | 3 | 8 | 27.3% | 43.4% |
| arm-04 | 4 | 12 | 25.0% | 40.5% |
| perch-05 | 5 | 10 | 33.3% | 50.6% |
| **crook-06** | 6 | 5 | 54.5% | **71.1%** |

**Seven tenths of `crook-06`'s optimal completion is spent watching the camera
swing.** And the orbit is dead time for its own purpose: `step()` is not refused
mid-orbit, but it resolves against `this.turns`, which is still the PRE-commit
rotation — so a player who rotates in order to open a route must wait the full
0.45 s before that route exists. That is the first real evidence on the P5
decision, and it argues the equal cost is wrong.

`loop-01` is excluded rather than reported as zero: its premise is
`{turn: false, illusion: true}` with no `minWalks` key at all, so a table row for
it would be a default masquerading as a measurement.

**The subjective half is still not done.** Driving the real build through a
browser produced `document.hidden: true` and **0 frames per second** — Chrome
throttles rAF in a background tab, so the engine ran 8 frames and stopped. The
cell still advanced, because `step()` resolves its target immediately, which is
exactly what makes it a convincing false instrument: it looks like play. Pacing
is the whole question, so a frozen clock invalidates any impression of it. What
is above is arithmetic on measured constants, not a verdict on whether it drags.

### 2. The competence control — `--controls=N` and `gate`

P10's finding was that three of five lenses were not resolving the stimulus and
nothing noticed. `tools/grade.mjs` now mixes in pairs whose two sides are the
same file, and `gate` disqualifies any judge that calls a winner on one. See the
note on control pairs in `prepare`; the rule it implements is that **a lens must
be shown capable of resolving the stimulus before its verdict counts.**

`gate` fails closed on a panel with no controls, `prepare` warns when it builds
one, and composites now get opaque `image-NN` aliases — promoting P9's manual
filename-neutralising step into the tool, because a manual step is one that gets
skipped.

The alias hash needed an avalanche and **the test caught that it did not have
one.** Plain FNV-1a leaves common-prefix strings adjacent in value, so sorting by
it sorted by prefix: every real pair in one band, every control in the next,
putting the controls in a block at the end where position alone gives them away.
All five new guards were falsified before being trusted.

### 3. The HUD re-grade — and P9's floor was real but small

`config.hud` forces the HUD through capture mode, default off. Measured, not
assumed: a default capture on this commit is `identical: true` against the P10
set across all 18 shots, and `npm run gate` PASSES.

Two panels, same five lenses, same rubric, same art, same nine shots, **paired
per shot** — differing only in whether the HUD is drawn. Raw data in
`docs/grading/2026-07-27-p11-*`.

| lens | HUD-off | HUD-on | delta |
|---|---|---|---|
| colour | 7.61 | 7.89 | +0.28 |
| communication | 3.28 | 5.89 | **+2.61** |
| composition | 6.06 | 6.44 | +0.39 |
| storefront | 7.56 | 6.67 | **−0.89** |
| surface | 7.33 | 7.67 | +0.33 |
| **overall** | **6.37** | **6.91** | **+0.54** |

Every judge passed the competence control — the HUD panel at d=0 on both
duplicate pairs, the HUD-free panel within the declared d≤1.

**So P9's floor was real and small.** The handoff said "4.22 is a FLOOR — re-grade
against HUD-bearing frames before quoting it anywhere," which implied the HUD was
suppressing the number substantially. It is worth **+0.54**. Nearly all of the
gain is `communication` (+2.61), which is the HUD doing precisely its job:
naming the level, the move count, the view state and the controls.

**`storefront` went DOWN with the HUD (−0.89)**, which inverts a P9 conclusion —
that critic marked the plates down for the HUD's absence, and given it, marks
them down for its presence. Store screenshots should stay HUD-free.

### What this does NOT establish

The naive reading — 4.22 then, 6.91 now — is **+2.69**, and only +0.54 of that is
the HUD. The remaining **+2.15** sits between P9's HUD-free run and this one's,
and it is **confounded**: the art changed in P10, and this is a different panel
run with its own calibration. Those two are not separated here and must not be
reported as if they were. Separating them needs this same competence-gated panel
run against pre-P10 art, which has not been done.

So: **do not quote 6.91 as "the score went up 2.7".** What is measured is the
HUD's contribution, +0.54, and that P10's blind A/B still has no certified
perceptual win behind it.

### Still open

- The **pre-P10 art run** that would separate the art change from panel variance.
- Whether `crook-06` actually drags — needs a foregrounded browser or a human.
- `findRoute`'s equal turn/walk cost, now with evidence against it but a
  campaign-wide blast radius: every `minTurns` is a MEASURED value and `ORDER`
  asserts them non-decreasing, so changing the cost re-derives the whole curve.
- Everything else from P10: a panel of genuinely different models, persistence,
  an ending, the `-1` orbit, `_emit`'s missing try/catch.

---

## P12 — the score was mostly the panel

**Completed 2026-07-27.** P11 closed with a confound it created: 4.22 (P9) against
6.91 (P11) is +2.69, of which only +0.54 was the HUD, and the remaining +2.15 sat
undivided between P10's art change and run-to-run variance. This separates them,
and the answer is not the flattering one.

### The decomposition

Two more panels, both on **pre-P10 art, HUD-free** — the same pixels P9 judged —
using the same five lenses and the same rubric as P11, paired per shot. Run A and
Run B differ in **nothing at all**: identical prompts, identical frames. Their
difference is therefore pure sampling noise.

| term | what varies | magnitude |
|---|---|---|
| **sampling noise** | nothing — identical prompts, identical frames | **0.14** |
| **P10 art change** | the ink re-key | **0.02** |
| **HUD** | HUD drawn or not | **0.54** |
| **P9 vs this session** | panel wording, same art | **2.12** |

```
pre-P10 art, no HUD, run A .... 6.34      P9, same art, no HUD .... 4.22
pre-P10 art, no HUD, run B .... 6.49
post-P10 art, no HUD .......... 6.37      art  delta  +0.02
post-P10 art, with HUD ........ 6.91      HUD  delta  +0.54
```

### Three readings, in order of how much they hurt

**1. The HUD result survives.** +0.54 against a 0.14 noise floor is roughly four
times noise. P11's finding stands, including that `storefront` goes *down* with
the HUD.

**2. The P10 art change is indistinguishable from zero.** +0.02, against a noise
floor seven times larger. This is now the **third** instrument to decline to
certify a perceptual win for the ink re-key: P10's blind A/B could not (agreement
near chance), the per-judge split there was suggestive but uncertifiable, and this
rubric puts it at nothing. The clamp was real and its removal is measurable in
pixels — peak red 255 → 230, seam 7 → 2 byte levels — but **no panel has yet shown
a human-visible improvement.** That is the honest status of P10.

**3. The number was mostly the panel, and this is the one that matters.** The same
art scored 4.22 under P9's wording and 6.34 under P11's. Sampling noise is 0.14,
so **that 2.12 is not chance — it is prompt formulation.** Fifteen times the noise
floor, and larger than every real effect measured in this project combined.

`METHODOLOGY` §P9 concluded that Penrose "lands inside that band and below its
final round" against Claude-of-Duty's 3.59 → 5.05, and treated that as the premise
failing. **That comparison cannot bear the weight put on it.** It set two
independently-authored panels, on different projects, in different eras, against
each other, and the measured sensitivity of such a score to its own wording is
±2 points. The differences being discussed were smaller than the instrument's
dependence on how it was phrased.

This does not rescue the premise — nothing here shows the project scores *well*.
It says the 4.22 never carried the precision it was quoted with, and neither does
6.91. **An absolute rubric score is an artifact of its panel. Only paired
comparisons within one panel are trustworthy**, which is exactly why the HUD
result is reportable and the cross-session one is not.

### What the competence control does and does not catch

Every judge in every P11/P12 panel passed the duplicate-frame control, most at
d=0. The control works — and it is **blind to exactly the failure that dominates
here**. It detects a judge that invents differences within a run. It cannot detect
a panel that is internally consistent and calibrated two points away from another
panel, because nothing inside a run reveals where its own scale sits.

So the rule from P11 needs its companion: a lens must be shown capable of
resolving the stimulus **before its verdict counts**, and its verdict counts
**only against another verdict from the same panel**. Consistency is not
calibration.

### Per-lens, for anyone tempted to quote one

Sampling noise at the lens level is far worse than the aggregate: `surface` moved
8.22 → 7.00 and `storefront` 5.56 → 6.67 between two runs that differed in
nothing. Per-frame-per-lens the standard deviation is 1.32 and the maximum
single-cell swing is **3 points**. The aggregate is stable because those errors
cancel; **no individual lens score in this document should be quoted alone.**

### Still open

- Whether the P10 ink change is perceptible to a human at all. Every automated
  instrument says either "cannot tell" or "no difference".
- A panel of genuinely different models, which is the only thing that would make
  cross-panel calibration meaningful. Unchanged since P9, and now the highest
  priority of the grading items rather than the lowest.
- Everything else from P11: the `crook-06` playtest, `findRoute`'s equal cost,
  persistence, an ending, the `-1` orbit, `_emit`'s missing try/catch.

---

## P13 — the orbit that had never been photographed

**Completed 2026-07-27.** Small, and it closes a coverage hole open since P2.

Every orbit this project has ever captured is `delta: +1`. Both motion shots
request `+1`, so three negative-delta paths had no gated frame behind them:

- `CameraOrbit.angle`, `CAMERA_TURN_SIGN * this.delta * ...` — the sign only
  flips for a negative delta (`src/render/index.js:528`);
- `_drain`'s `step = this._pending < 0 ? -1 : 1` and its matching
  `this._pending -= step`, the only place a negative queue is drained (`:1067`);
- `_commit`'s `setRotation(orbit.fromTurns + orbit.delta)`, which depends on
  `setRotation` normalising `0 + -1` to `3` (`:1056`).

Unit tests reach the arithmetic. **Nothing reached the picture.**

`orbitback` is `orbitmid`'s sweep in the other direction, framed on the union of
turn 0 and turn **3** — `rotated(1)` would have composed a destination the shot
never visits.

### The shot was falsified before it was trusted

Replacing `this.delta` with `Math.abs(this.delta)` in `CameraOrbit.angle` makes a
−1 orbit sweep the wrong way. Captured across the whole set:

```
MOVED:      orbitback.png   10.45% changed
UNCHANGED:  all 18 pre-existing shots
```

One shot moved and eighteen did not, which is the exact statement that the gated
set was blind to this and now is not. A sign error in any of the three paths would
have swung the camera backwards and every previously gated frame would have gone
on passing.

19 gated shots. 192 tests pass. `npm run gate` PASSES.

### Not done, and why

`src/core/engine._emit` still has no try/catch — one throwing listener still
aborts every listener after it. Left alone deliberately: the handoff records it as
"declined in P4", and **no rationale for that decline is recorded anywhere in this
document.** A deliberate decision whose reason was never written down is
indistinguishable from an omission, and reversing it blind is how the reason gets
rediscovered the expensive way. It needs whoever declined it, or a fresh argument
made on the merits.

---

## P14 — the judge mattered more than the game

**Completed 2026-07-27.** P12 ranked "a panel of genuinely different models" as
the highest-priority grading item and recorded it as out of reach. It was not —
subagents take a model parameter. One rubric prompt, **four different models**
(Opus, Sonnet, Haiku, Fable), both art versions, HUD-free, identical frames.
Raw data in `docs/grading/2026-07-27-p14-multi-model.json`.

### The variance ladder, complete

Every term below is the same stimulus judged differently:

| what varies | magnitude |
|---|---|
| nothing — identical prompt, identical model | 0.14 |
| the P10 ink re-key | 0.02 |
| the HUD | 0.54 |
| prompt wording, same model family | 2.12 |
| **MODEL CHOICE** | **3.78** |

Opus scored the set **4.44**. Haiku scored **the same pixels 8.22.** That is the
distance from AMATEUR to SHIPPED, decided entirely by which model was asked.

**Every absolute score this project has ever quoted is a property of its judge**,
and the judge was never a controlled variable. 4.22, 6.34, 6.91 — all of them sit
inside a 3.78-point band that opens purely on model selection.

### The control fired, for the first time on a real run

`sonnet` on art B scored the same image **7 and 3** — a delta of 4 on a duplicate
pair — describing one as "fuller frame, more complex crossbar geometry" and the
other as "player pawn is almost entirely hidden behind a pillar." Same file.
Disqualified by the P11 gate before its numbers reached any average, which is
exactly what that gate was built for. It is also, not coincidentally, the only
model that produced a strongly negative art delta.

### The two things worth more than the number

**1. The most discriminating judge was the harshest, and the only one that found
the real defects.** Opus scored lowest at 4.44 — and its notes, unprompted,
named the exact P10 mechanisms: *"per-cube tonal banding down the red face"*,
*"stray red/dark tick slivers along beam seams"*, *"bright-red edge sliver"*.
That is `densityJitter` keyed per instance and `INK.ghost` clamping, identified
from pixels by a judge that had never seen this document. It is also the only
model whose art delta was positive (+0.56).

**2. Haiku passed the control and discriminated nothing.**

| model | mean | stdev across 9 shots | distinct scores used |
|---|---|---|---|
| opus | 4.44 | 1.17 | 3, 4, 5, 6 |
| sonnet | 6.78 | 1.13 | 5, 6, 7, 8 |
| fable | 6.89 | 0.87 | 5, 6, 7, 8 |
| **haiku** | **8.22** | **0.42** | **8, 9** |

Haiku gave 8 or 9 to every frame, including ones three other models called
broken, and passed the duplicate control at **d=0**. Perfect self-consistency,
near-zero information.

**So the control has a second blind spot, opposite to P12's.** P12 found it
cannot detect miscalibration. This finds it cannot detect *non-discrimination* —
a judge that says the same thing about everything is trivially consistent.
`gate` now reports `sameRate` and `allSame` per judge.

That report deliberately does **not** disqualify, and the reason is the whole
subtlety: "no difference anywhere" is also the CORRECT answer when the difference
really is below threshold. The number does not decide anything by itself. A panel
where *every* judge reports allSame has learned something about the stimulus; one
judge doing it among several that did not has said something about the judge.

### The P10 art change, fourth verdict

Across gate-admitted models: opus **+0.56**, haiku **0.00**, fable **−0.33** —
mean **+0.07**. A fourth independent instrument putting the ink re-key at
approximately nothing.

The dissent is worth recording rather than averaging away: **the single most
discriminating judge in the panel is the only one that scored it better**, and it
is the same judge that independently located the defects the change fixed. That
is one observation, well inside its own noise, and it is not evidence. It is the
only thread left that has not been cut.

### Still open

- Everything from P12 except the multi-model panel, which is now done and made
  things worse rather than better.
- If an absolute score is wanted at all, the panel must fix its model AND its
  wording AND report both, and even then it compares only to itself.
- `crook-06`'s playtest, `findRoute`'s equal cost, persistence, an ending,
  `_emit`'s missing try/catch.

---

## P15 — the campaign curve was a tie-break

**Completed 2026-07-27.** P11 produced evidence against `findRoute` costing a
turn and a walk equally: a turn is 0.45 s and a walk 0.22 s, so a turn is 2.05x.
`findRoute`'s own docstring set the condition for revisiting — *"recorded rather
than weighted, because no evidence yet says what a better weighting would be"* —
and the evidence had arrived. So the router was re-costed and measured before
anything was changed.

### The change is not worth making

Uniform-cost search with the true weights, against the current BFS, on all seven
levels:

| | routes changed | campaign completion |
|---|---|---|
| equal cost (current) | — | 20.67 s |
| time-weighted 0.22 / 0.45 | **1 of 7** | 20.21 s |

**Six of seven routes are already time-optimal.** The one that changes is
`perch-05`, and the whole campaign-wide saving is **0.46 seconds**. Weighting it
would also break `levels.test.js` and make `ORDER`'s curve non-monotonic.

Crucially, **`crook-06` does not change.** It is 71% rotation by wall-clock
because the level requires 6 turns against 5 walks, not because the router chose
badly. The router was never the problem, and if `crook-06` drags the lever is
level design or `ORBIT_SECONDS` — not routing. **Recommendation: do not weight
`findRoute`.**

### But the measurement found something worse

Both `perch-05` routes are **15 inputs**. BFS did not choose a worse route; it
broke a tie. One tie has 5 turns, the other has 3, and BFS returns the 5.

`ORDER` declares `perch-05` at `minTurns: 5`, described as "the MEASURED
turnsInRoute … never a slack bound". `levels.test.js:28` asserts
`turnsInRoute >= minTurns`, so **5 >= 5 passes while the level requires 3.**

That docstring names this exact failure mode — "declaring 4 on a route that takes
6" — **in one direction only.** The premise system was built to stop a
declaration being too LOW. Nothing stopped it being too HIGH, and nothing could,
because the assertion compares the declaration against the same arbitrary route
that produced it. **A test validating its own input.**

The campaign curve is therefore

```
declared   0, 1, 2, 3, 4, 5, 6
actual     0, 1, 2, 3, 4, 3, 6      not non-decreasing
```

### And it cannot be fixed by re-declaring

Searched exhaustively over all 18x17 start/goal pairs on `perch-05`: **zero**
have a true minimum of 5, and the highest the figure supports anywhere is **4**.
The level cannot honestly fill the slot it was built for. Filling it needs a
different figure — and P8 left 1,255 augmented shapes at exactly 4 turns and 104
at 5 sitting unexplored in `tools/search.mjs`.

> **Corrected in §P20.** That pool was not what it said it was. `search.mjs`
> selected on `turnsInRoute === TARGET` — the same tie-break number this section
> is about — so it had been advertising shapes whose BFS tie-break returns N,
> not shapes that require N. The real figures are 928 and 26.

### What shipped

`Structure.minTurnsBetween` — uniform-cost search that minimises turns and uses
walks only to break ties — exposed through `premise().minTurnsExact`.
`test/true-minturns.test.js` asserts `declared === exact` for every level **except
`perch-05`, which is PINNED as a fixture** in the same style as the hole
detector's necessary-not-sufficient case. The fixture records the defect rather
than papering over it, because closing it is a design decision and not a
mechanical correction. Its docstring says explicitly: when it is fixed, replace
it with the stronger claim, never delete it.

Both new guards falsified before being trusted — making turns cost the same as
walks, and stubbing the search to a constant. Each failed the tests that claim
it. 197 tests pass.

### Still open

- **`perch-05` cannot fill the 5 slot.** Redesign it, replace it from the
  unexplored pool, or accept a curve that is not monotonic. A design call.
- `crook-06`'s subjective playtest, persistence, an ending, `_emit`'s missing
  try/catch, and everything from P14 about panels.

---

## P16 — the playthrough, and the constants were not the cost

**Completed 2026-07-27.** P11 tried to answer "does `crook-06` drag" by driving
the real build in a browser and got `document.hidden: true` with **0 frames per
second** — Chrome throttles rAF in a background tab. The cell still advanced,
because `step()` resolves its target immediately, so it *looked* like play while
the clock was stopped. Pacing was the whole question, so it measured nothing.

`tools/playthrough.mjs` routes around it. Lockstep has no frame loop at all —
state advances only inside `__PUMP__` (`src/main.js`) — so the throttle cannot
apply. Every frame is asked for explicitly.

Moves are driven through the same subsystem entry points a keypress reaches:
`player.step` for a walk (after asking the PLAYER which screen direction resolves
to the target, rather than deciding that here) and `world/rotate-request` for a
turn. Frame counts are **polled**, one pump at a time until the engine reports
the motion over — never a fixed count — so the timeline stays a measurement if
the timing constants ever move.

### `crook-06`, measured end to end

```
move  kind   frames  atFrame   cell      turns
   0  walk       14       14   1,0,3         0
   1  turn       28       42   1,0,3         1
   2  walk       14       56   3,-2,2        1
   3  turn       28       84   3,-2,2        2
   4  turn       28      112   3,-2,2        3     <-- two turns back to back
   5  walk       14      126   3,-2,1        3
   6  turn       28      154   3,-2,1        2
   7  walk       14      168   1,0,0         2
   8  turn       28      196   1,0,0         3
   9  turn       28      224   1,0,0         0     <-- and again
  10  walk       14      238   3,3,3         0     solved
```

**238 frames, 3.97 s. 168 of them — 70.6% — are camera-only.** Across the
campaign: `loop-01` 0%, `spur-01` 22.2%, `crook-06` 70.6%, tracking P11's
computed table (0 / 22.6 / 71.1) closely enough to confirm it.

### The correction: the constants are not the cost

P11 computed a turn at 0.45 s and a walk at 0.22 s, ratio **2.05x**. The engine
does not charge those. Measured, a walk takes **14 frames** and a turn **28** —
0.2333 s and 0.4667 s — and the true ratio is **exactly 2.0x**.

`test/motion-frames.test.js` already carried the warning, in bold, about this
precise trap: *"ceil(ORBIT_SECONDS / fixedDt) is 27, and the real engine commits
at 28 … Measure, do not compute."* P11 computed. The conclusion survives the
correction, which is luck rather than method.

### What it actually shows

Twice — moves 3–4 and moves 8–9 — the route takes **two turns back to back: 56
consecutive frames, 0.93 s, in which nothing happens but the camera swinging and
the player can do nothing that matters.** `step()` is not refused mid-orbit, but
it resolves against the pre-commit rotation, so any input during those 56 frames
answers a question about the arrangement being rotated away from.

That is the concrete form of the complaint, and it is now a thing that can be
looked at rather than inferred. **It is still not a verdict on whether it is
tedious** — that needs a person. But the artifact exists, it is reproducible, and
it is 0.93 seconds of dead air, twice, in an 11-input level.

### Still open

- Whether that is actually unpleasant. A human, or a foregrounded window.
- P15's `perch-05` design call; persistence; an ending; `_emit`'s try/catch;
  P14's finding that absolute panel scores are properties of their judge.

---

## P17 — someone played it and could not find the game

**Completed 2026-07-27.** Five moves into level 3 of 7, with the HUD on screen,
the person who commissioned this project asked three questions:

> *I can move with arrows, is this a puzzle game? I can spin the figure, but what
> is the point of the game? what is the green thing that jumps around?*

Not one of those is answerable from the screen. They were all correct questions.

### What was actually true

- **The game never states its objective.** Searching `src/ui` for *goal*,
  *objective*, *target* or *reach* returned nothing; the word appears once, in an
  unrelated comment. The HUD showed the level name, `3/7`, a move count and
  rotation pips — none of which is "get the pawn to the marked tile".
- **The goal was marked by a 1.5x ink-density lift and nothing else.** No shape,
  no outline, no label. A slightly paler tile.
- **Start and goal were rendered IDENTICALLY** (`_applyRotation`, one expression
  applying `INK.knockout` to both). Two pale tiles, nothing to say which was
  which. That is a defect, not a gap.

### Why nothing caught it

`communication` has been the lowest-scoring lens in every panel this project has
run — 4.3 at P9, 3.28 HUD-free at P11 — and **not one of them located this.**
A lens returns a score; a player returns a question. P11 even measured the HUD
lifting `communication` by +2.61, the largest single effect in this document, and
concluded the HUD was doing its job. **The HUD was on.** It moved the number
without touching the problem.

And several judges called the split figure "broken or missing geometry". P14
recorded that as judges failing to resolve the stimulus. **They were reading it
exactly as the player did.** That attribution was wrong and is corrected here.

### The fix

- **The start marker is gone.** The avatar stands on it; a second identical pale
  tile only competed with the real one. One knockout now means one thing.
- **A goal marker**, a flat green ring on the goal cell's floor. Green because
  that is already the avatar's ink, so the reading needs no legend: *green solid
  is you, green outline is where you go*. Shape is the one channel this art
  direction leaves free — the palette is fixed and `INK.knockout`'s docstring
  already proves a hue shift cannot work through a multiply-only channel.
- **One line in the HUD**: *"Walk the green pawn to the green ring."* Sentence
  case and tighter tracking than the all-caps chrome around it, because that
  chrome is exactly what the eye learns to skip.

Cost: draw calls 3 -> 4, **programs 3 -> 3**, +8 triangles. The marker reuses the
`InstancedMesh` + `instanceColor` + `MeshBasicMaterial{vertexColors}` parameter
set the level kit and the avatar already share, so three.js returns the cached
program instead of compiling a second one.

### It shipped invisible the first time

Placed at the goal cell's plain `y`, the ring rendered at `y - 0.5` — the BOTTOM
face of a solid block, buried inside it. **It drew nothing at all while the HUD
confidently instructed the player to walk to a green ring.** All 197 tests stayed
green. It was caught by opening the capture and seeing no ring.

A cell is a solid block and an occupant sits a cell above it — `_restPosition`
returns `y + 1` and offsets its geometry to `-0.5`, landing feet on the top face.
The marker now matches that exactly, which also keeps it under the pawn when the
pawn arrives rather than nearly under it.

### Guards

`loadlevel.test.js` now asserts the marker tracks all four rotations, including
the `+ 1`. Falsified twice — plain `y`, and a marker frozen at rotation 0 — each
failing the test that claims it.

The leak guard there asserted `meshes.length === 1` and would have been "fixed"
by changing the 1 to a 2. **That is satisfied by two level kits and no marker**,
which is the exact leak it exists to catch, so it would have gone quiet at the
moment it acquired a second thing to watch. It now asserts by NAME, and the
level kit was given one (`level-kit`) to make that possible — it had none, unlike
`avatar` and `paper`.

198 tests pass. `npm run gate` PASSES.

### Then they played the fixed build and still could not do anything

> *I dont know, I cant do anything but bounce around.*

The marker and the objective line were not the whole problem. Measured across
every cell of every level at all four rotations:

```
mean legal moves            1.56 of 4    -> 2.44 keys do NOTHING, silently
positions with <= 1 way out       43%
positions with ZERO legal moves     4    -> only a rotation is legal there
positions with 3+ options           2    of 321
```

**Roughly three fifths of every keypress is a silent no-op.** `player/blocked`
is emitted and `src/audio` is its ONLY subscriber, so a dead key made a sound
and changed no pixels. There was also no restart, no undo, and no way out of a
bad position except reloading the page — which loses campaign progress.

"Bouncing around" is not a complaint about the game being hard. It is an exact
description of walking a graph with a mean degree of 1.56 while blindfolded.

- **The key legend is now live.** Each arrow lights only while it does
  something, read from the player's own `available()` — the same `_resolve` a
  keypress runs, so the legend cannot drift from the keys. Verified against the
  real DOM at three states: 2 legal moves lights 2 arrows, 1 lights 1, and 0
  lights none.
- **Zero legal moves says so**: *"nothing to walk to, rotate"*. Four dark arrows
  is a legal, reachable state and is otherwise indistinguishable from a broken
  keyboard.
- **R restarts the level**, through the same `level/load-request` src/campaign
  uses.

This does not solve any puzzle. Which cells are reachable is not the question a
level asks; which of my four keys is currently wired to anything is not a puzzle
at all.

### Two guards caught two real defects, in one commit

**A CSS transition on the arrow dimming.** `test/ui.test.js` bans `transition:`
outright, and it is right to: a fade is a wall-clock animation, so a HUD-bearing
capture would depend on when the shutter landed relative to the state change
rather than on the frame index — precisely the nondeterminism `config.hud`
promised not to introduce two phases ago.

**A key that did neither of the two known things.** `no action is a hole`
asserted `moves !== rotates`, a two-verb exclusive-or that rejected `restart` as
a hole. Rewritten to count against a known vocabulary, which keeps both halves
of the original claim and adds one it could not express: an action carrying a
field the test has never heard of now fails, because that is how a key silently
acquires a second meaning.

**And one round of mutation testing was invalid and had to be redone.** A comment
inside the stylesheet — a JS template literal — quoted two identifiers in
backticks, which ended the string and broke the module at parse time. Every
mutation in that round "failed" on the syntax error rather than on the guard
under test. The re-run added a parse check before each mutation.

### The lesson, which is not new here

This project has built a pixel gate, a determinism gate, an adversarial pairwise
panel, a competence control, a four-model rubric panel, and a variance ladder
decomposing every instrument it owns. **All of it missed the fact that a player
could not tell what the game was.** Thirty seconds of somebody playing found it.

Every significant defect in this document was caught by looking. This one was
caught by someone else looking, which is the only version this project had not
tried.

---

## P18 — the level that teaches the rule, and the thing it cannot do

**Completed 2026-07-27.** P17 gave the game an objective line, a goal marker and
a key legend. It did not give it a level that teaches the one rule everything
rests on: **screen-adjacent means walkable.** That rule is stated nowhere and a
player who owns the project spent an hour without inferring it, logging 31
successful walks on an 8-move level.

`loop-01` was supposed to carry that lesson. It cannot: it wins in one move, so
the trick fires before the player has registered that anything happened.

### The measurement that reframed the task

The assumption going in was that some existing level could be re-aimed — a
different start or goal on a figure already in the repository. Measured across
all eight figures, over every standable start/goal pair:

| | |
|---|---|
| turn-0 routes whose illusion crossing is FORCED (removing the edge disconnects start from goal) | **212** |
| of those, joining two visually separate objects | **2** |
| of those, with any ordinary run-up before the crossing | **0** |

Both survivors are the two directions of `probe-01`, a two-cell fixture with
zero run-up that is not in the campaign. **Every other figure in the project is
a single 3D-connected solid**, so its crossings read as walking a closed
triangle rather than as stepping across a gap. Nothing that looks impossible
ever happens anywhere in the shipping campaign.

So no re-aiming could work, and `tools/search.mjs` could not produce a fix
either — not by oversight, but by construction. It augments a figure by growing
a spur FROM one of its cells, and an attached spur is in the same component as
what it hangs off. It can only ever build more of the same solid.

### `tools/teach.mjs`

A cell screen-adjacent to `A` but arbitrarily far from it in 3D is exactly

```
L = A + step + t*(1,1,1),   step in {+x,-x,+z,-z},  t != 0
```

because `(1,1,1)` is the view direction and collapses to nothing on screen. `t`
is the depth of the illusion. Hanging a DETACHED run at `L` is the difference
between a figure that contains a crossing and one that shows it. The cascade,
on the tribar family:

```
detached run placed, no collision                  27084
not 3D-adjacent to the figure (two objects)        24969
every run cell standable and frontmost             12784
figure still encloses a hole                       12563
run does not OCCLUDE the figure                     6510
the two objects touch at ONE screen point           3808
the far object TURNS AWAY (not a collinear beam)    2778
EXACTLY ONE seam between the two objects            2778
the pivot offers no alternative (corridor)           864
run-up of >=2 ordinary walks first                   816
premise: turn-0, no turns, opens with a walk         534
distinct shapes                                      209
```

**The last four filters were all added after looking at rendered plates**, and
each one exists because a shortlist that passed everything above it was wrong in
the picture:

- **Occlusion.** The top-ranked candidate of the first shortlist hung its bar at
  (10,9,9), whose screen cells are `1,1 / 2,2 / 3,3` — exactly the tribar's own
  bottom leg — sitting 27 depth units in front and hiding it. The plate is an
  ordinary tribar whose bottom leg happens to be a separate floating object.
  Cross-component passed; the picture merged. Pinned in
  `test/teaching-level.test.js` as a negative control.
- **One point of contact.** The seam check counts edges of the TRAVERSAL graph,
  which is built from standable cells. The renderer draws every cell. The next
  shortlist's leader touched the tribar at TWO screen positions and read as
  welded onto it.
- **Turning away.** Caught by playthrough, not by a plate: a candidate whose bar
  ran in the same screen direction as the crossing rendered as one continuous
  beam collinear with the arm the player walked in on.

### What a teaching level cannot do, established rather than assumed

**No level can make the crossing LOOK impossible.** A crossing moves the avatar
exactly one screen cell, which is precisely what an ordinary walk does, so the
two are pixel-indistinguishable by construction. Three separate candidate shapes
were played through frame by frame to confirm it before the fourth was chosen.
Building a level whose gap READS as a gap is trying to defeat the mechanic —
screen adjacency IS visual contact, and that is the illusion, not a flaw in it.

So the lesson is carried by the setup rather than by the step: the goal sits on
an object the player can see is not the one they are standing on, the surface
under them runs out, and the one input that does anything is the one that
crosses. That is a weaker claim than "the player will see something impossible",
and it is the true one.

### `teach-00`

A tribar of side 4 plus a three-cell bar hung in space at `(-1,-1,-6)`. Four
ordinary walks down the `+z` leg, arrive where the walkable surface ends, cross
16 units of nothing, two walks to the goal. Seven inputs, no rotation, measured
by playthrough at 1.633 s. Side 4 rather than 5 so that it and `loop-01`, which
now runs second, are not the same picture twice.

`DEFAULT_LEVEL` moved to `teach-00` with it — otherwise a player opening the
game starts on `loop-01`, `src/campaign` seeds its index from that, and the
opener is never played. Asserted now in `loadlevel.test.js`.

**That change exposed a dependency 13 shots had been carrying invisibly.** They
declared no level and captured `DEFAULT_LEVEL`; several name `loop-01` cells
outright — `seam` frames (5,5,5), `avatar` frames (1,1,0), `avatarmid` and
`stepmid` place the pawn at 5,5,x. `teach-00`'s tribar has side 4 and contains
no (5,5,x) cell at all. Left implicit, all 13 would have gone on capturing
successfully while framing coordinates that no longer exist — a whole set of
green plates composed against nothing. They now declare `loop-01`.

### Guards

Nine assertions in `test/teaching-level.test.js`, each re-applying a filter that
`teach.mjs` used to FIND the level in order to KEEP it. **Five mutants, five
caught** — start moved next to the pivot, bar attached to the figure, an extra
platform at the pivot, the level demoted out of `ORDER[0]`, and a cell hung
under the bar to create a second screen contact.

A sixth mutant SURVIVED and was withdrawn rather than counted: lengthening the
bar along `+x` cannot reach the tribar's screen columns (the bar's `a` is at
least 5, the tribar's at most 4), so it violated nothing. The guard was right and
the mutant was wrong, which is worth writing down because the opposite reading
was available and would have weakened a correct test.

### State

212 tests, 20 gated shots, gate PASS. The campaign is eight levels and the curve
is `0, 0, 1, 2, 3, 4, 5, 6`. `perch-05` is still pinned at B1 from the previous
handoff — it declares 5 turns and requires 3, and no start/goal pair on that
figure supports 5.

---

## P19 — it is now possible to be wrong, and the first budget was aimed at the wrong player

**Completed 2026-07-27.** There was no fail state anywhere in the project: no
move limit, no timer, no lose condition, and `MOVES` displayed unbounded. A game
you cannot be wrong in has no tension to resolve and no reason for a second
attempt.

### The design objection, and what answered it

The obvious implementation — a keypress budget — is aimed at the wrong player.
This game's one observed failure was somebody LOST (31 successful walks on a
level whose par is 8), not somebody careless, and a 23-second game makes
"restart the level" a non-punishment anyway. A budget that fires on confusion
adds hostility without adding stakes.

Two properties defuse that, and both are decisions rather than side effects:

- **Turning is free.** Rotation is how the player LOOKS at the figure — it is
  the only way to see what connects to what. `crook-06` needs 6 turns against 5
  walks, so a keypress budget would have charged that level's players twice over
  for looking, and two exploratory spins cost 8 keypresses while travelling
  nowhere.
- **A blocked key is free.** `step()` already counted nothing when it refused,
  so probing a wall costs nothing. Only travel in the wrong direction does.

What remains is a budget that fires on wandering and not on confusion.

### The formula was wrong, and only the numbers said so

First version: `par + MOVE_SLACK`, slack 10. It looked uniform. It was not:

| level | par | platforms | budget | ratio |
|---|---|---|---|---|
| loop-01 | 1 | 10 | 11 | **1.1x** |
| teach-00 | 7 | 12 | 17 | 1.5x |
| crook-06 | 5 | 8 | 15 | 1.9x |

**`loop-01`'s budget was 1.1x the size of its own figure.** A player who walked
once round the tribar to look at it would have lost, on level two, for doing the
thing the game is about. Anchoring on par is fine until par is tiny relative to
the figure, and then it is absurd — and `loop-01` is exactly that case, par 1 on
a ten-platform tribar.

It surfaced as a test failure, not as a review: `traversal.test.js` walks
back and forth across three rotations and started running out of moves. The
first reading was "the test makes too many moves". The right reading was that
the budget was too small for the figure.

    budget = max(par, reachable platforms) + MOVE_SLACK

"Enough walks to cross every platform in the level, or to walk your route,
whichever is longer, plus ten." Every level now lands at 1.6x-2.1x, with no
outlier, and it can never fall below `par + 10`. Checked against the one real
datum available: the player who spent 31 walks lost on `shelf-03` would have
been told at 23.

### `par`, and the tie-break trap again

`par` is the fewest WALKS a level can be solved in, and it replaces `minWalks`,
which was asserted only as a lower bound (`walksInRoute >= minWalks`). That is
the same slack that let `perch-05` declare 5 turns while requiring 3 — and a
budget built on an overstated par silently hands out extra moves.

So `Structure.minWalksBetween` was added as the mirror of `minTurnsBetween`
(uniform cost, walks 1, turns epsilon — turns free for the same reason they are
free in the budget), and `par` is asserted EXACT against it for every level.

**It currently catches nothing**: `walksInRoute` happens to equal the true
minimum on all eight levels. Worth saying plainly rather than implying the check
found something. It is there because the budget rests on the number, not because
it has caught a bug yet.

### Mutation testing found two of its own tests weak

Seven mutants, and the first run caught five. Both survivors were defects in the
TESTS, not the code:

- **`budget anchored on par alone` survived** because the test recomputed
  `max(par, size) + MOVE_SLACK` itself instead of reading `player.budget()`. It
  was asserting its own arithmetic. Reverting the implementation changed nothing
  it looked at.
- **`retry guarded on complete` survived** because the test loaded the last
  level but never finished the run, so `complete` was false and the guard it
  claimed to check was never reached. The reachable path is: finish the game,
  press R on the last level — which clears the player's `solved` flag but not
  the campaign's `complete` flag — then run out of moves.

Both fixed; 7/7 on the re-run. This is the second consecutive phase where
mutation testing found a test that passed without exercising its subject.

### Ordering, which is the most reversible decision here

The solve is checked BEFORE the fail, and the fail is gated on `!solved`. Swap
them and the budget is one move tighter than it reads, on exactly the move that
matters most — a player who spends every allowed walk and lands the last one on
the goal would lose the level they just solved. Pinned by a test that sets
`moves` to `budget - 1` directly rather than wandering towards the boundary and
hoping to hit it; the first version of that test asserted only `if` the next
step happened to be the goal, and it was not.

### State

223 tests, 20 gated shots, gate PASS. All eight levels play through solved, none
close to its budget. The HUD reads `MOVES 19 / 19 · par 5` and `OUT OF MOVES —
RETRYING`, in the warm ink rather than the accent, so winning and losing are
told apart by colour rather than by position.

---

## P20 — the campaign curve is finally the curve it claims, and the tool that broke it broke its own pool

**Completed 2026-07-27.** `perch-05` held the five-turn slot while requiring
three. It was pinned as a fixture in P15 rather than fixed, because closing it
was a design decision: no start/goal pair on that figure has a true minimum
above 4, so it needed a different figure.

### The pool it was supposed to be replaced from did not exist

The obvious move was to take a replacement from the 104 shapes `tools/search.mjs`
advertises at 5 turns. **That pool was selected on `turnsInRoute`** — the same
arbitrary BFS tie-break that produced `perch-05` in the first place. It had been
reporting shapes whose tie-break happens to return N, not shapes that require N,
and every count it has printed in premise mode since P8 counted the wrong thing.

`perch-05` did not slip past that filter. It was produced by it.

Measured on `minTurnsBetween` instead, and requiring the goal to be visible in
the opening rotation, the real pool is **928 shapes at 4 turns and 26 at 5** —
against the advertised 1,255 and 104.

### What the geometry actually supports

| | |
|---|---|
| bare four-leg circuits enumerated | **102** |
| start/goal pairs over them | **10,540** |
| true minimum turns, best case | **4** |
| pairs at a true minimum of 5 | **0** |

**No bare circuit requires 5 turns anywhere.** Augmentation is the only route
past four, which is also the reason `crook-06` reaches six. Of the 262 augmented
pairs that do require exactly 5:

```
require exactly 5 TRUE turns                          262
goal standable, and so visible, at turn 0             150
not doubling back on Y, not arm-04's base, no mirrors   6
avatar not hidden behind its own figure                 3
```

The Y exclusion does most of the cutting and it is a design choice, not a
correctness filter: `crook-06` is the only upright silhouette in the campaign and
`ORDER` says so. The alternatives it discards are longer — 8 walks against
`post-05`'s 5 — and **the campaign got shorter as a result**, from 79 optimal
keypresses to 74. That is a real cost and the honest trade for a curve where
every number is measured.

### The second defect, which nothing was looking for

`perch-05`'s goal was **not visible in the rotation the level opens in.** Its
goal sits at (0,0,0), the circuit's closure point — and a closed circuit's far
end aliases that point while sitting IN FRONT of it, so the goal is occluded at
turn 0 and standable only in rotations 1-3. It was the only shipping level where
that was true.

Nothing could have caught it. The level is solvable, its premise is provable,
the goal marker code is correct, and every pixel is reproducible. The level is
fine and the PICTURE is wrong — the same shape of defect as P18's occluding bar,
found the same way. `true-minturns.test.js` now asserts it for every campaign
level.

### The last filter was not computed, again

Three of the six surviving candidates put the AVATAR behind the post at turn 0,
and **no cell-level check sees it**: the occluding block sits at a different
screen cell and covers only part of the pawn's rendered height, so
`visibility()` reports the avatar's own screen cell as clear. A first draft of
`post-05`'s docstring claimed a filter caught this. It did not; the plates did.
That claim was removed before it shipped.

### `post-05`

A four-leg circuit doubling back on X with a two-cell post standing up from the
near walkway. Five turns, measured. Five walks. Goal and avatar both visible at
turn 0. The curve is now

```
0, 0, 1, 2, 3, 4, 5, 6      declared
0, 0, 1, 2, 3, 4, 5, 6      measured
```

and `test/true-minturns.test.js` asserts `declared === exact` for **every** level
with no exception pinned — which is what that test's own note demanded when the
defect was closed. `perch-05` stays in the registry, off-campaign, with its
declaration corrected from 5 to 3; a retired level with a false premise is still
a false premise.

### `search.mjs`, repaired

- selects on `minTurnsExact`, not `turnsInRoute`;
- requires the goal to be standable at turn 0;
- rejects a spur that OCCLUDES the figure it is hung on (it had no such check —
  the same omission that put an unusable figure at the top of `teach.mjs`'s
  first shortlist);
- and decides the turn target with one search BEFORE calling `premise()`, which
  it used to call for every pair and discard. Premise mode went from over ten
  minutes to **75 seconds**.

### State

227 tests, 20 gated shots, gate PASS. Eight levels, 74 optimal keypresses.

---

## P21 — the game was running at 1.8x, and the campaign contains one decision

**Completed 2026-07-27.** The handoff's first open item was "more levels, from
the pool of 928 shapes at 4 turns and 26 at 5". That would have repeated §P20's
mistake in a new place, and measuring the campaign before mining the pool is
what showed it.

### Turn count does not predict whether a level contains a choice

Measured across all eight campaign levels, over every standable cell in every
rotation — 358 positions:

| | |
|---|---|
| mean legal walks | **1.53** of 4 |
| positions with <= 1 way out | **44%** |
| positions with zero legal walks | **10** |
| positions offering 3 or more walks | **1** |
| positions that are a FORK | **1** |

A **fork** is a position where two different neighbours each strictly reduce the
remaining walks to the goal, so the player has to pick and the pick is not
forced. There is one in the entire game, in `post-05`. `crook-06` requires six
turns, is the last level, and has none. `arm-04` has par 12 and has none.

The property is not scarce in the material — 1,734 of 5,496 bare-circuit pairs
have at least one, and 478,426 of 982,104 augmented pairs do. Of the 928 shapes
`search.mjs` reports at four turns, **428 contain a fork.** Nothing had ever
computed the number, so nothing had ever selected on it, and turn count — the
axis every shipping level was chosen on — is orthogonal to it.

**A first pass measured this wrong and the wrong number looked meaningful.** It
counted positions whose neighbours merely DIFFER in remaining cost and reported
173 of 358. That is not a decision count; it is the count of corridor positions
from which the player may also walk backwards. Recorded because "173 of 358"
would have read as a healthy figure and sent level selection somewhere worse
than turn count already does.

### What no level in this game can do, which is a proof rather than a search

Being *lost* is available. Being **wrong** is not:

> On an undirected, unit-cost graph, adjacent vertices' distances to a fixed
> target differ by at most 1. So one step off an optimal route always leaves the
> goal exactly two walks further away than the best step would have — one to
> come back, one to retake.

Every level, every figure, under this movement model. Running it over 982,104
pairs returns 0 exceptions and adds nothing the two lines already give. Making a
mistake expensive is not a level-selection problem; it needs a change to the
movement model, and that is a bigger phase than this one.

### The simulation had been running at display refresh rate since P0

`Engine.step()` advances a constant `fixedDt` and was called once per
`requestAnimationFrame`, with no accumulator and no clamp. Measured in a headed
browser on the machine the play-test will run on:

```
wall seconds        3.001
engine frames         332      ->  110.6 frames per wall-second
simulated seconds   5.533      ->  1.844 sim-seconds per wall-second
```

Every animation is driven by `ctx.time.dt`, which is always `fixedDt`, so
`ORBIT_SECONDS = 0.45` elapsed in 0.244 wall-seconds and `MOVE_SECONDS = 0.22`
in 0.119. `teach-00`, "measured by playthrough at 1.633 s" in §P18, took 0.886.
The "21.5 seconds of optimal play" was about 11.7.

This never violated the determinism contract — frame N still produced identical
pixels, which is what ARCHITECTURE §1 requires. **What it violated was an
assumption nobody had written down**: every wall-clock number this document has
ever quoted was true at 60 Hz and true nowhere it was actually being read. After
the fix: **1.000 sim-seconds per wall-second, 180 frames in 3.001 s.**

The accumulator takes its timestamp from `requestAnimationFrame`'s own argument
rather than `performance.now()`, which is what lets the new guard ban clock
reads in `src/core/engine.js` outright instead of carving out an exception a
later change could widen. Both clamps DROP time rather than repaying it, and
the accumulator must be cleared when `MAX_STEPS` binds — keeping the remainder
spends the next several frames draining it, which is the burst the clamp exists
to prevent.

**`npm run gate` could not have caught a regression here, and nearly was asked
to.** It captures the shot set twice and diffs the two captures, so it proves
determinism on whatever it is pointed at and would pass just as happily on a
branch that changed every pixel. This repository commits no baseline images.
Branch-versus-main is a hand-run comparison, and it is the one that was run:
20 shots, `"identical": true`.

### Events alone could not have recorded a play session

`src/dev/trace.js` records a session under `?trace=1`. The design question worth
keeping is why it listens for keys at all when the engine emits nine events.

`src/ui` dispatches a movement key by calling `player.step()` **directly**, not
by emitting, and `step()` has two paths that emit nothing: it returns early
while the level is lost, and it skips `player/blocked` when no level is loaded.
Driven to the fail state in a real browser, four keypresses in the retry window
produced **four key entries and zero engine events.** An events-only recorder
would have shown nothing at all for four real presses — which is exactly the
ambiguity that made "I cant do anything but bounce around" unreadable.

The recorder stores raw `code`/`key` and does not classify them; `resolveKey`
stays in `src/ui` and interpretation happens offline. A trace is a record, not
an interpreter.

Two constraints that are not obvious. It must be inert in capture and lockstep,
because ARCHITECTURE §4 forbids any path that advances state outside `__PUMP__`
and a second keydown listener is exactly that. And it must be incapable of
throwing, because `Engine._emit` still has no try/catch and one throwing
listener aborts every listener after it.

**That second constraint is the fresh argument open item B3 has been waiting
for.** The record says the missing try/catch was "declined deliberately in P4"
with the reasoning written down nowhere. The argument on the merits is: the
engine's failure isolation is currently supplied by *convention among
listeners*, and every listener added is a place that convention can lapse. B3 is
still not opened — but it no longer needs the P4 rationale recovered to be
argued.

### Mutation testing, and a mutant withdrawn rather than counted

Seven mutants, six caught. The survivor was `acc >= fixedDt` weakened to
`acc > 0`, and it survived because it **violates nothing**: it steps once,
subtracts a full timestep regardless, and lets the accumulator go negative, so
it fires on alternate ticks at 120 Hz and twice per tick at 30 Hz. Identical
60 Hz average, sloppier bookkeeping. The guard was right and the mutant was
wrong — the same call §P18 made, and the second time this project has had to
make it.

Replaced with the mutation of that line that does change the rate — dropping
the remainder each tick instead of subtracting one step's worth — which three
tests catch.

One test defect found the same way it was found in §P19: the payload guard used
a constant fake clock, so `t` was 0 by construction and it would have passed
against a recorder that never stamped anything.

### Also

ARCHITECTURE §3.3's event table listed eight events; the project emits nine.
`level/failed` shipped in P19 undocumented. Table and code now agree.

### State

243 tests, 20 gated shots, gate PASS, and 20 shots byte-identical to `main`.
Eight levels, unchanged — **this phase added no content and was not supposed
to.** What it added is the ability to find out what the last three phases
actually did, which nobody has yet: `docs/playtest/PROTOCOL.md` fixes four
hypotheses and their falsification conditions in advance, and the next action is
a fresh player in front of it.

### Postscript — somebody played it the same day, and stopped at level 4

Recorded in full in `docs/playtest/OBSERVATIONS.md`. Not a protocol session, so
H1 is still untested. What it established:

**Two of the eight levels are solvable in a standing view.** From `spur-01`
onward, no rotation of the figure lets a player walk start-to-goal — the route
must be interrupted, rotated mid-way and resumed. The declared curve
`0,0,1,2,3,4,5,6` counts turns, so it reads as a ramp; what actually happens is
one step change at level 3, from *walk* to *walk, rotate, walk*, and **nothing
teaches it.** `teach-00` gives screen-adjacency an entire level; interleaved
rotation just becomes mandatory and stays mandatory.

That is the defect P18 closed, one level up, found the same way — by somebody
playing. It is worth noticing that P21 built an instrument for exactly this and
the finding arrived before the instrument was used; the instrument is still
right, and the lesson from §P17 holds twice over.

**And it is not difficulty.** `span-02`, where play stopped, has **zero forks**
and a maximum degree of 2. There is no decision in it to get wrong. So a
rotation teaching level ranks ahead of more content: six of eight levels already
require the untaught skill, and more levels of the same kind multiply the
opacity rather than the challenge.

---

## P22 — the framing never followed the rotation, and the second rule nothing taught

**Completed 2026-07-28.** P21 built the instruments and said the next action was
a play-test. Somebody played it the same day and stopped on level four, which
made both of this phase's findings before any protocol was run.

### The camera was composed once and never again

`frameCells` ran on `level/loaded`, from `level.cells` — the UNROTATED positions
— and nothing recomposed after a quarter turn. Six of the eight campaign levels
cannot be solved without rotating, so six of eight put the player in a view
nothing had ever composed.

| | |
|---|---|
| rotated views that fell OUTSIDE their own frustum | **23 of 24** |
| rotated views that needed a different framing | **24 of 24** |

`span-02` at view 2/4 ran off the top of the frame. That is the level play
stopped on, and the player was rotating to see what connected to what.

**The gate could not have caught it, by construction.** `rot1`, `rot2` and
`rot3` each call `frameCells` themselves before capturing, so they photograph
every rotation with a camera recomposed for that rotation — one live play never
had. They prove the rotated FIGURE renders and are blind to the rotated
FRAMING. The fix moves **zero** gated pixels, which is the same fact stated from
the other side.

That is now four instruments in three phases that measured something adjacent to
what ships: §P17's panels missed that the game was unreadable, §P21's gate could
not see the frame-rate coupling, and these shots cannot see the framing.

### The obvious fix costs half the artwork, and was rejected on measurement

Fitting one frustum to all four rotations removes the clipping and draws every
figure **1.5x to 2.2x smaller**, because `rotateY` turns about the world origin
and the figures do not sit on it, so a fixed frustum has to hold the whole
sweep. Measured across the campaign before it was discarded.

What shipped instead uses the identity the end-swap already rests on:

```
image(A(P), world T) === image(P, world T+1)
```

Travelling from `start` to `A(end)` while the world still shows T, then
restoring to `end` as the world becomes T+1, is continuous at both ends exactly
as travelling to `A(start)` was. The old behaviour is the special case
`end === start`, which is what a dev shot's orbit still gets — and is why the
gate is unmoved. `span-02`'s opening view is byte-identical to before the change;
views 2 to 4 are now composed at full size.

### `teach-01`

Two levels were solvable in a standing view. From `spur-01` on, none are, and
nothing taught the difference. The declared curve counts turns so it read as a
ramp; the demand stepped once, hard, at level three.

**The state that teaches it can only be a start.** `src/ui` says "nothing to
walk to, rotate" exactly at zero legal walks, and screen adjacency is symmetric
— so a cell reached on foot always keeps the way back and can never have zero.
A level that walks the player into a wall is not undiscovered, it is impossible,
and the first version of the search spent its time looking for one.

**Both quarter turns must open a walk**, which came from plates and not from
reasoning. A shortlist leader that opened one way only is, pressed the other way,
pixel-identical to the dead state it started in — still showing the same prompt.
A first rotation that changes nothing teaches that rotating does not help, more
convincingly than the level teaches the truth. That filter cut 2,304 candidates
to **8**.

After the turn the route is forced, eight walks to the goal. `span-02` is what
happens without that: zero forks, maximum degree two, and a player who cannot
tell being stuck from being wrong.

### The mutation round that proved nothing

The first run against the camera fix reported five of five caught. All five were
invalid: the script restores with `git checkout`, the work was **uncommitted**,
and the first restore deleted the implementation — so every later "failure" was
the new tests failing against methods that no longer existed. The implementation
had to be rebuilt from scratch.

The rule this project already had was "restore in `finally`". The rule it needed
is **commit before mutation testing**, because `git checkout` is only a restore
if the work is in git.

Re-run honestly, two mutants survived: reverting `level/loaded` to frame the
unrotated cells — the defect verbatim — because every guard called
`setLevelFraming` itself and none drove the handler; and dropping the mid-orbit
pose blend, because `restore()` still lands correctly and nothing checked the
path. Both closed, 5/5 on the re-run, and `_initFraming` now exists to be
drivable for the same reason `_initTransitions` does.

Counting §P21's payload guard and its stall guard, that is **four** guards in
two phases that passed without exercising their subject.

### State

265 tests, 21 gated shots, gate PASS, the 20 pre-existing shots byte-identical
to `main`. Nine levels; the curve is `0,0,1,1,2,3,4,5,6`, non-decreasing and
every value measured. Campaign branching moved from 358 positions to 402 with
the fork count still **1** — `teach-01` is a corridor on purpose, because a
level teaching one thing must not also ask the player to choose.

---

## Attribution

`tools/baseline.mjs`, `tools/imagediff.mjs` and `tools/profile.mjs` are adapted
from mshumer/Claude-of-Duty under the MIT license. See `NOTICE` for what was
taken and why.
