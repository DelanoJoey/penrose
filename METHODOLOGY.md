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

## Attribution

`tools/baseline.mjs`, `tools/imagediff.mjs` and `tools/profile.mjs` are adapted
from mshumer/Claude-of-Duty under the MIT license. See `NOTICE` for what was
taken and why.
