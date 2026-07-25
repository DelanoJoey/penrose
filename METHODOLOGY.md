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

## Attribution

`tools/baseline.mjs`, `tools/imagediff.mjs` and `tools/profile.mjs` are adapted
from mshumer/Claude-of-Duty under the MIT license. See `NOTICE` for what was
taken and why.
