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

### Still open

- **The blind A/B is prepared but not judged.** `tools/grade.mjs prepare` built an
  18-pair package, `worstSkew: 0`, pairIds neutralised. It has no verdicts,
  because the only party available to judge it is the one that made the change.
  A verdict from a judge who knows which side is which is not a measurement.
- Everything in P9's *Still open* except the two "defects", which are resolved as
  non-defects rather than fixed: the HUD re-grade, a stronger panel, `crook-06`'s
  55% rotations, persistence, an ending, the `-1` orbit, `_emit`'s missing
  try/catch.

---

## Attribution

`tools/baseline.mjs`, `tools/imagediff.mjs` and `tools/profile.mjs` are adapted
from mshumer/Claude-of-Duty under the MIT license. See `NOTICE` for what was
taken and why.
