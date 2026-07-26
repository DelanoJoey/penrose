# Penrose

A stylised isometric impossible-geometry puzzle, built under a pixel-identity
gate.

**The harness is the artifact.** The game is what proves it works.

```bash
npm install
npx playwright install chromium
npm run dev            # http://127.0.0.1:5173
```

Move with the arrow keys or WASD, rotate with Q/E. The four movement directions
are the four screen diagonals, because every horizontal step in an isometric
projection reads as one.

## Status

| Phase | | |
|---|---|---|
| P0 | Contracts, determinism, and a proven pixel gate | ✅ |
| P1 | Isometric projection and the impossible-geometry path graph | ✅ |
| P2 | Avatar, HUD, procedural audio, camera-orbit rotation | ✅ |
| P3 | Art pass — run as a judge panel | ✅ |
| P4 | Blind grading harness | ✅ |

112 tests. The determinism gate runs on every PR.

[METHODOLOGY.md](METHODOLOGY.md) is the honest record: what was measured, what
was wrong, and what is still wrong. It is the most useful file here.

## What is worth stealing

Four things, in rough order of how transferable they are:

1. **Declare determinism before you need it.** The gate below is worthless
   unless the same frame index produces the same pixels. Stating that as a
   precondition costs nothing; retrofitting it costs a remediation pass across
   every subsystem. See `ARCHITECTURE.md` §1.
2. **A gate that has never failed is not a gate.** Every guard in this
   repository was verified by breaking the thing it guards and confirming it
   fails. A pixel gate that has only ever passed proves nothing.
3. **Measure under the conditions the target actually has.** Two numbers in this
   project looked fine and meant nothing — an fps figure that measures rAF
   dispatch overhead, and a structural budget that stayed constant through a 20×
   wall-clock regression because CI has no GPU and the dev machine does.
4. **Report position bias and inter-judge agreement, not just the win rate.**
   See `tools/grade.mjs`.

## Origin

A deliberate variation on
[mshumer/Claude-of-Duty](https://github.com/mshumer/Claude-of-Duty), which built
a Three.js FPS from one prompt and published an unusually honest scorecard:
5.05/10 against modern Call of Duty, with every critic in every blind round
picking the real frame. Its own post-mortem named the wall — *"surfaces read as
procedural noise rather than photographed reality — the ceiling of generating
texture from code."*

So this picks a target where that ceiling does not exist. **Target selection is
the engineering decision**, and the art panel in P3 proved the point from the
other direction: the most beautiful of the three candidate directions *lost*,
because its atmospheric depth cue made the impossible edge legible. A Penrose
figure only works if the eye cannot tell which leg is far, so any depth cueing is
disqualified however well executed.

## The gate

```bash
npm run gate          # capture twice, diff — is the engine deterministic right now?
```

That command is the one that matters. It captures the full shot set twice into
isolated temp directories and requires the two runs to be pixel-identical. If it
fails, the engine has nondeterminism and **every** downstream claim about
performance or refactoring is unfalsifiable until it is fixed.

To gate a change:

```bash
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/before --port=5199
# ... make the change ...
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/after  --port=5199
node tools/imagediff.mjs --a=/tmp/before --b=/tmp/after --write-diff
```

`identical: true`, or the change does not land. Not "close". Not "within
epsilon". See [ARCHITECTURE.md](ARCHITECTURE.md) §5.

## Why isometric

This is a deliberate variation on
[mshumer/Claude-of-Duty](https://github.com/mshumer/Claude-of-Duty), which built
a Three.js FPS from one prompt and published an honest scorecard: 5.05/10 against
modern Call of Duty, with every critic in every blind round picking the real
frame. Its own post-mortem named the wall — *"surfaces read as procedural noise
rather than photographed reality — the ceiling of generating texture from code."*

So the target here is one where that ceiling does not exist. No first-person
hands, no photoreal reference, no crowd of characters, no GI to approximate, and
no shadow/AO/TAA stack to pay for. What is left is spatial-logic correctness:
geometry that connects in isometric projection but not in 3D, path graphs that
rewire under rotation, and provable solvability.

Target selection is the engineering decision.

## Tooling

| tool | purpose |
|---|---|
| `tools/gate.mjs` | Harness self-consistency — capture twice, require pixel identity |
| `tools/baseline.mjs` | Reproducible capture: isolated page per shot, fixed frame budget |
| `tools/imagediff.mjs` | Per-pixel gate. Strict identity by default; `--tol` is an explicit opt-out |
| `tools/profile.mjs` | Frame-time distribution and hitch attribution via per-frame WebGL program counts |
| `tools/analyze.mjs` | Level design asserts — is the level solvable, and is the illusion load-bearing? |
| `tools/grade.mjs` | Blind pairwise grading: seeded blinding, position-bias check, inter-judge agreement |

### Blind grading

```bash
node tools/grade.mjs prepare --candidates=/tmp/a,/tmp/b --reference=/tmp/ref \
                             --out=/tmp/grade --seed=run-1
# judges see /tmp/grade/manifest.json and /tmp/grade/pairs/ — never key.json
node tools/grade.mjs tally --dir=/tmp/grade --verdicts=/tmp/verdicts.json
```

The win rate is the number everyone quotes and the number that means least. This
reports two others alongside it:

- **Position bias** — if judges chose "left" far from half the time they were
  responding to position rather than content, and every score is suspect.
- **Inter-judge agreement** — near chance means the panel detected no shared
  signal, so the win rate is noise however decisive it looks. High agreement means
  either a real difference *or* a bias the judges share; this statistic cannot
  distinguish those, and pretending otherwise is how blind panels get oversold.

Either condition exits non-zero. Blinding is seeded, so anyone holding the seed
can re-derive the assignment and check the arithmetic rather than trusting it.

## License

MIT. Portions of the harness are adapted from mshumer/Claude-of-Duty (MIT) — see
[NOTICE](NOTICE).
