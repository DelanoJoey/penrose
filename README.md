# Penrose

A stylised isometric impossible-geometry puzzle, built under a pixel-identity
gate.

**The harness is the artifact.** The game is what proves it works.

```bash
npm install
npx playwright install chromium
npm run dev            # http://127.0.0.1:5173
```

## Status

**P0 complete.** Engine skeleton, determinism contract, and capture/diff/profile
harness are in place, and the gate is proven to pass on identical input and fail
on a single least-significant-bit palette change. No game content exists yet —
that is the point. See [METHODOLOGY.md](METHODOLOGY.md) for the evidence.

| Phase | | |
|---|---|---|
| P0 | Contracts & harness | ✅ complete |
| P1 | Core geometry — isometric projection, impossible-geometry path graph | next |
| P2 | Independent surfaces — audio, UI, level content, FX | |
| P3 | Art pass | |
| P4 | Adversarial grading loop | |
| P5 | Performance + publish | |

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
