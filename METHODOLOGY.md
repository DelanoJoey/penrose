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

The job timeout was raised to 30 minutes as *headroom, not a fix*. The real fix
is to bake the paper once into a render target and draw a single textured quad —
128,000 triangles down to 2, art preserved exactly — which trades `textures 0 → 1`
and is therefore an art-owner decision rather than a unilateral one.

---

## Attribution

`tools/baseline.mjs`, `tools/imagediff.mjs` and `tools/profile.mjs` are adapted
from mshumer/Claude-of-Duty under the MIT license. See `NOTICE` for what was
taken and why.
