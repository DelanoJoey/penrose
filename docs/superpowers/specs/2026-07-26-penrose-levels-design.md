# Levels, and making rotation load-bearing

**2026-07-26** · branch `feat/levels-rotation-routing` off `main` @ `224e3f2`

## The finding this rests on

`loop-01` is solvable in one move without ever rotating.

```
$ node tools/analyze.mjs loop-01
"solvableTurns": [0]
"pathUnrotated": ["1,0,0", "5,5,5"]
```

Two nodes is one step, taken in the rotation state the level opens in. `probe-01`
is the same. So the mechanic the project is named for — rotation rewiring the
traversal graph — is asserted by CI and load-bearing in nothing.

The analyser cannot express anything better, and that is the real gap.
`findPath(from, to, turns)` (`src/geometry/index.js:187`) searches `pathGraph(t)`
for one fixed `t`; `solvability()` (`:215`) runs it four times independently.
`requiresRotation` therefore means *"some rotations work and some do not"*, not
*"the player must rotate to win"*. No route in this repository has ever needed a
turn, and no tool here could have told us.

## 1. Cross-rotation routing

Additive to `Structure`. `solvability()` is left exactly as it is, so existing
tests and `analyze` output do not move.

**`findRoute(from, to, startTurns = 0)`** — breadth-first over `(cellId, turns)`,
returning an ordered list of `{kind: 'walk'|'turn'}` moves, or `null`.

- **Walk** edges come from `pathGraph(t)`, so only standable cells connect.
- **Turn** edges are **unconditional**: `(cell, t) -> (cell, (t±1) mod 4)`.

The unconditional turn is the part worth stating plainly, because the obvious
rule is wrong. It is tempting to require the cell be standable in both
rotations — you should not be able to turn into a state where you are stranded.
But `src/player` already decided otherwise, deliberately, at `index.js:366`:

> If the current cell is not standable in this rotation it has no entry, and
> every direction is blocked — which is correct: rotate back to get out.

`world.setRotation` has no standability check, so Q/E always work. A player may
turn into a stranded state and turn back out, and a legitimate route may pass
*through* a rotation in which its cell is not a platform. An analyser using the
stricter rule would under-report reachable levels and disagree with the game
about what the level is — the exact failure `ARCHITECTURE.md` §3 exists to
prevent, since geometry is meant to be the single authority the player reads.

**`premise(from, to)`** returns the report the analyser and the tests both use:
`solvable`, `requiresTurn`, `turnsInRoute`, `walksInRoute`, `usesIllusion`,
`illusionWalks`, `flatSolvableTurns`, `route`.

`requiresTurn` is defined as *no flat path exists at turn 0*, because turn 0 is
the state every level opens in. If a flat path exists there, no turn is needed,
whatever the other three rotations do.

### Open decision, stated rather than buried

BFS costs a turn and a walk equally. Both are one keypress, which is the honest
default, but it means a "shortest" route may prefer turning to walking. Shipping
equal-cost and recording it here beats inventing a weighting with no evidence
behind it. Revisit only if a designed level's reported route disagrees with the
route a human actually takes.

## 2. Levels declare their own premise

Levels stay data (`src/world/levels.js` computes nothing, and that split is what
lets a level be checked before anything renders it). Each level declares what it
claims to be, and CI proves the claim:

```js
premise: { turn: true, illusion: true, minWalks: 3, openWithWalk: true }
```

A single global "every level must require a turn" assert was rejected: it would
fail `loop-01` and `probe-01`, which genuinely do not require one. Declaring the
premise per level keeps those two honest — they declare `turn: false` — while
making it impossible for a new level to silently degrade into a no-turn solve.

`openWithWalk` exists because of something the feasibility search surfaced rather
than something predicted: most layouts satisfying the strong premise open with a
turn, so the player cannot move at all on the first frame, and the turn-0 hero
plate is a picture of a stuck state.

## 3. The three levels

| | premise | shape |
|---|---|---|
| **L1** teach | `flatSolvableTurns` excludes 0 but is non-empty; 1 turn | walk to a dead end, turn, the bridge is there |
| **L2** combine | `flatSolvableTurns: []`; 2 turns | walking and turning interleave |
| **L3** test | `flatSolvableTurns: []`; 2–3 turns; decoy branches | occlusion load-bearing — a platform that exists at only one rotation |

### Feasibility, measured before committing to the table

A throwaway probe implementing the routing model above, run against the real
`Structure`:

- It reproduces both existing levels exactly — `loop-01`: solvable,
  `requiresTurn: false`, 0 turns, 1 walk, uses illusion. That is the negative
  control for the router itself.
- Two-leg search: **797** layouts requiring a turn. All were
  `flatSolvableTurns: [1]` with `standablePerTurn: [10,10,10,10]` — turn once,
  then a straight shot, no occlusion in play. Adequate for L1, not for L2 or L3.
- Three-leg search: **19,021** layouts with `flatSolvableTurns: []`. Sample route:
  `turn 0→1 · walk 0,0,0→-2,3,3 · walk →-2,4,4 · turn 1→2 · walk →-2,3,5`.
  `standablePerTurn` varies across hits (`[9,6,10,9]`, `[12,12,8,12]`), so cells
  stop being platforms at some rotations without anything being added to support
  it. The occlusion mechanic falls out of existing code.

### The method, which matters more than the table

Those 19,021 hits are geometrically valid and visually arbitrary. Levels are
**shaped by hand** the way `loop-01` was — three legs chosen so the projection
produces a tribar — and then **verified** by the analyser. The search is a
filter, never the author.

This is not a stylistic preference. `loop-01`'s first design was algebraically
correct, passed its unit tests, rendered self-consistently, and was visually
meaningless: two legs whose screen deltas were exact inverses, so the return leg
retraced the outbound leg pixel for pixel. Only a tool asking *"does this level's
premise actually hold"* caught it. A search that optimises the premise alone
reproduces that failure at scale.

## 4. Harness — per-shot level

`src/world/index.js:42` reads the level from boot config and sizes its
`InstancedMesh` to `level.cells.length` at `init`, so the level **must** arrive
in the URL. A shot function cannot switch it.

Today the gate physically cannot capture a non-default level: `gate.mjs:41,45`
calls `baseline.mjs` with only `--out` and `--port`, `baseline.mjs:38` leaves
`EXTRA` empty without `--query`, and the per-shot URL at `:84` carries no level.
Every capture is `DEFAULT_LEVEL`.

- `src/dev/shots.js` — a shot may declare a level, exposed as page metadata
  beside `__SHOTS__`.
- `baseline.mjs` — append `&level=<name>` when a shot declares one, discovered in
  the probe page it already loads to enumerate shot names. Roughly ten lines.

Rejected alternative: having `gate.mjs` run `baseline.mjs` once per level into
sub-directories. `imagediff.mjs:30` is `readdirSync(A).filter(...)` with no
recursion, so it would need sub-directory support as well — a larger change to
the most load-bearing tool in the repo, for the same result.

**Existing shots declare nothing, so their URLs stay byte-identical and their
pixels must not move.** That is the acceptance test for this change. It lands and
is gated *alone*, before any new level exists, so a reference shift can only be
attributed to the harness.

Then three new plate shots, one per level: 9 → 12.

## 5. Tests and CI

- Route BFS unit tests **with negative controls** — a turn edge must be legal
  from a cell not standable at the current rotation, and `requiresTurn` must
  report `false` for `loop-01`. A gate that only ever passes proves nothing; that
  is this repo's own P0 argument and it applies here.
- Per-level premise tests, so `npm test` catches a regression without the tool.
- CI currently hardcodes `for level in loop-01 probe-01`. Replace with iteration
  over all levels — otherwise a new level escapes the design asserts entirely,
  which is the same class of silent gap as the one this spec opens with.

## 6. Verification

| check | bar |
|---|---|
| `npm test` | exit 0, full suite, no path scope |
| `node tools/analyze.mjs <each level>` | exit 0 |
| `npm run gate` | `identical: true` |
| harness change, before/after `imagediff` | existing 9 shots `maxDelta: 0` |
| CI gate wall-clock | measured, under `--use-gl=swiftshader`, not on a GPU machine |

The last row is not ceremony. The structural budget held *exactly* through a 20×
CI regression once already, because draw calls and heap growth count objects
rather than the cost of rasterising them. A perf claim from this machine is not
evidence about CI.

## Risks

1. **The harness change can invalidate the existing reference set.** It lands
   first, alone, gated.
2. **The levels will need iteration.** The premise is mechanically checkable;
   "does this read as architecture" is not, and that is a human call on rendered
   images.
3. **`npm install` in the worktree.** `node_modules/` is gitignored and not
   shared, so the worktree needs its own install before anything runs.
