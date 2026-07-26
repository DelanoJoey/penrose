# Second Figure Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second impossible-figure family — the four-leg doubled-back circuit — and three campaign levels built on it, ending the situation where three of four levels are the same tribar.

**Architecture:** One new pure method on `Structure` (`enclosedHoles`), one new committed tool (`tools/search.mjs`) implementing the filter cascade, then three levels and three plate shots using machinery that already exists. No harness change: `src/dev/shots.js` already supports a per-shot `level` declaration and `tools/baseline.mjs:94` already discovers it.

**Tech Stack:** Node 20+ ESM, `node:test`, three.js, Playwright + SwiftShader for capture. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-26-second-figure-family-design.md`

**Worktree:** `/Users/jelstner/penrose/.worktrees/second-figure-family`, branch `feat/second-figure-family` off `main` @ `9063d7e`.

---

## Read before starting

- `ARCHITECTURE.md` — §1 determinism, §3.2 directory ownership, §5 the pixel gate. `src/geometry` is a **coupled core, single owner, never fanned out.**
- `METHODOLOGY.md` §P5 — why the turn edge is unconditional and why the first three levels were visually meaningless.
- The spec, in full. §2.1 and §5.1 contain the two constraints most likely to be violated by accident.

## File structure

| file | responsibility | change |
|---|---|---|
| `src/geometry/index.js` | projection, path graph, routing, **and now screen-space hole detection** | modify — add `SCREEN_NEIGHBOURS`, add `Structure.enclosedHoles()` |
| `src/geometry/holes.test.js` | proves the hole detector against figures whose reading is already known | create |
| `tools/search.mjs` | the filter cascade, reproducible, with per-stage counts | create |
| `src/world/levels.js` | level data | modify — three new levels, extend `ORDER` |
| `src/dev/shots.js` | shot registry | modify — three new plate shots |
| `METHODOLOGY.md` | the dated record | modify — add §P8 |

`enclosedHoles` goes on `Structure` rather than in `tools/` because it is a property of the projection, the same kind of thing as `visibility` and `impossibleEdges`, and because `src/world/levels.js` must stay data-only.

---

## Task 0: Worktree setup

**Files:** none

- [x] **Step 1: Install dependencies in the worktree**

`node_modules/` is gitignored and NOT shared between worktrees.

```bash
cd /Users/jelstner/penrose/.worktrees/second-figure-family
npm install && npx playwright install chromium
```

DONE 2026-07-26 — `added 20 packages, and audited 21 packages`, `found 0 vulnerabilities`.
`npx playwright install chromium` printed nothing (already cached), so the browser
was verified by launching it rather than by trusting the installer's silence:
`chromium OK: 151.0.7922.34`.

- [x] **Step 2: Verify the inherited baseline before changing anything**

```bash
npm test
```

Expected: `ℹ tests 166` / `ℹ pass 166` / `ℹ fail 0`. If this is not 166/166, **stop** — you are not on the commit this plan was written against.

DONE — `ℹ tests 166 / ℹ pass 166 / ℹ fail 0`, `duration_ms 133.160208`.

- [x] **Step 3: Exclude a symlinked node_modules if you made one**

`.gitignore` has `node_modules/` with a trailing slash, which matches **directories only**. A symlink shows as untracked and `git add -A` would commit the whole tree.

```bash
grep -q '^node_modules$' .git/info/exclude || echo 'node_modules' >> .git/info/exclude
git status --short   # expected: empty
```

DONE — no action needed. `npm install` created a **real directory**, not a symlink,
so the `node_modules/` pattern matches it; and the shared common-dir exclude
already carries `/node_modules` from an earlier phase. `git status --short` is
empty.

---

## Task 1: `Structure.enclosedHoles()`

**Files:**
- Modify: `src/geometry/index.js` (add export near `HORIZONTAL_STEPS`, add method after `impossibleEdges`)
- Test: `src/geometry/holes.test.js` (create)

The screen lattice has `a+b` always even, so every screen position has **six** neighbours, not four. A hole is an empty screen position that cannot reach the outside of the bounding box.

- [x] **Step 1: Write the failing test**

Create `src/geometry/holes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Structure } from './index.js';
import { LEVELS } from '../world/levels.js';

const V = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};

/** Walk a leg sequence from the origin, inclusive of the starting cell. */
function legs(seq) {
  const cells = [[0, 0, 0]];
  let cur = [0, 0, 0];
  for (const [dir, len] of seq) {
    for (let i = 0; i < len; i++) {
      cur = [cur[0] + V[dir][0], cur[1] + V[dir][1], cur[2] + V[dir][2]];
      cells.push([...cur]);
    }
  }
  return cells;
}
const holes = (cells) => new Structure(cells).enclosedHoles(0).length;

// -------------------------------------------------- POSITIVE: reads impossible

test('a tribar encloses a hole, and it grows with the figure', () => {
  assert.equal(holes(legs([['+x', 3], ['+y', 3], ['+z', 3]])), 1);
  assert.equal(holes(legs([['+x', 4], ['+y', 4], ['+z', 4]])), 3);
  assert.equal(holes(legs([['+x', 5], ['+y', 5], ['+z', 5]])), 6);
});

test('the shipping levels that read as impossible all enclose a hole', () => {
  assert.equal(holes(LEVELS['spur-01'].cells), 1);
  assert.equal(holes(LEVELS['shelf-03'].cells), 6);
});

// -------------------------------------------------- NEGATIVE CONTROLS
// A detector that only ever answers "hole" proves nothing. These two figures
// close on screen, carry illusion edges, and RENDERED AS ORDINARY SOLIDS.

test('a four-leg circuit that rendered as a plain bar encloses nothing', () => {
  assert.equal(holes(legs([['-x', 4], ['+z', 1], ['+x', 5], ['+y', 1]])), 0);
});

test('a four-leg circuit that rendered as a plain block encloses nothing', () => {
  assert.equal(holes(legs([['-z', 3], ['+x', 1], ['+z', 4], ['+y', 1]])), 0);
});

// -------------------------------------------------- THE COUNTEREXAMPLE
// Pinned so the necessary condition cannot quietly become a sufficiency claim.

test('NECESSARY, NOT SUFFICIENT — a figure can enclose holes and still read as an ordinary staircase', () => {
  const ordinaryStairs = legs([['+x', 2], ['-z', 3], ['+y', 2], ['+z', 5]]);
  assert.equal(holes(ordinaryStairs), 3);
  // If a future change makes this 0, the detector has become a judge and this
  // test should be REPLACED with that stronger claim, not deleted.
});

test('an empty structure has no holes rather than throwing', () => {
  assert.equal(new Structure([]).enclosedHoles(0).length, 0);
});
```

- [x] **Step 2: Run it and verify it fails for the right reason**

```bash
node --test src/geometry/holes.test.js
```

Expected: FAIL — `s.enclosedHoles is not a function`. If it fails any other way, read the error before continuing.

- [x] **Step 3: Add `SCREEN_NEIGHBOURS` to `src/geometry/index.js`**

Immediately after the `HORIZONTAL_STEPS` export:

```js
/**
 * All six screen-lattice neighbours. Because a+b is always even, the reachable
 * screen lattice is a hex grid and NOT a 4-connected square grid — a flood fill
 * using four neighbours leaks through the diagonals and reports no holes.
 */
export const SCREEN_NEIGHBOURS = Object.values(SCREEN_DELTA);
```

- [x] **Step 4: Add the method to `Structure`, directly after `impossibleEdges`**

```js
  /**
   * Screen positions the figure ENCLOSES: empty, and unable to reach the
   * outside of the bounding box.
   *
   * WHY THIS EXISTS. An impossible figure needs somewhere for the eye to trace
   * the loop. A closed circuit that folds back on itself projects as a filled
   * slab and reads as an ordinary solid however good its routing premise is —
   * which is exactly how a previous phase rendered a four-leg circuit and got
   * a rectangular bar.
   *
   * NECESSARY, NOT SUFFICIENT. holes.test.js pins a figure with three enclosed
   * cells that still reads as an ordinary staircase. This is a filter that
   * removes most of the garbage before a render is spent. It is not a judge,
   * and it does not replace looking at the image.
   */
  enclosedHoles(turns = 0) {
    if (!this.cells.length) return [];
    const rot = this.cells.map((c) => rotateY(c, turns));
    const occupied = new Set(rot.map((c) => screenId(...c)));

    const keys = rot.map((c) => screenKey(...c));
    const minA = Math.min(...keys.map((k) => k[0])) - 2;
    const maxA = Math.max(...keys.map((k) => k[0])) + 2;
    const minB = Math.min(...keys.map((k) => k[1])) - 2;
    const maxB = Math.max(...keys.map((k) => k[1])) + 2;

    // Flood the empty complement inward from the border ring.
    const outside = new Set();
    const queue = [];
    const visit = (a, b) => {
      if (((a + b) % 2 + 2) % 2 !== 0) return;      // odd cells are off-lattice
      const k = `${a},${b}`;
      if (occupied.has(k) || outside.has(k)) return;
      outside.add(k);
      queue.push([a, b]);
    };
    for (let a = minA; a <= maxA; a++) { visit(a, minB); visit(a, minB + 1); visit(a, maxB); visit(a, maxB - 1); }
    for (let b = minB; b <= maxB; b++) { visit(minA, b); visit(maxA, b); }
    while (queue.length) {
      const [a, b] = queue.shift();
      for (const [da, db] of SCREEN_NEIGHBOURS) {
        const na = a + da, nb = b + db;
        if (na < minA || na > maxA || nb < minB || nb > maxB) continue;
        visit(na, nb);
      }
    }

    const enclosed = [];
    for (let a = minA; a <= maxA; a++)
      for (let b = minB; b <= maxB; b++) {
        if (((a + b) % 2 + 2) % 2 !== 0) continue;
        const k = `${a},${b}`;
        if (!occupied.has(k) && !outside.has(k)) enclosed.push(k);
      }
    return enclosed.sort();
  }
```

- [x] **Step 5: Run the new test file**

```bash
node --test src/geometry/holes.test.js
```

Expected: **6** pass, 0 fail. (The first draft of this plan said 7 — a miscount
of the tests written directly above it. The file contains six `test(...)` calls.)

- [x] **Step 6: Run the FULL suite — no path scope**

```bash
npm test
```

Expected: `ℹ tests 172` / `ℹ pass 172` / `ℹ fail 0` (166 + 6).

- [x] **Step 7: Commit**

```bash
git add src/geometry/index.js src/geometry/holes.test.js
git commit -m "geometry: detect the holes a figure encloses on screen"
```

---

## Task 2: Prove the hole detector can fail — DONE, and it did not go as planned

A gate that has never been seen to fail is not evidence. This repository verifies
every guard. This one falsified the plan instead, which is the more useful result.

**Files:** `src/geometry/index.js` — two comments corrected. The plan said "no
commit"; that assumed nothing would change, and two committed claims turned out
to be false.

- [x] **Step 1–2: The planned mutation DID NOT FAIL**

Substituting `HORIZONTAL_STEPS` for the six-neighbour set left the suite at
**6 pass, 0 fail**. The plan predicted collapse. Both halves of its reasoning
were wrong:

- the four horizontal steps **generate** the vertical ones — `(+1,+1) + (-1,+1) = (0,+2)` — so both sets reach the same lattice;
- and a *smaller* neighbourhood makes a fill **more** restricted, so the error would be over-reporting enclosure, never "reports that nothing is enclosed".

- [x] **Step 2b: Two further "load-bearing" details were also redundant**

| mutation | result |
|---|---|
| `SCREEN_NEIGHBOURS` → 4-connected | **6 pass, 0 fail** — not covered |
| bounding-box padding `2` → `0` | **6 pass, 0 fail** — not covered |
| border seed two b-rows → one | **6 pass, 0 fail** — not covered |
| flood fill drops the `occupied` wall check | **3 pass, 3 fail** ✅ |

Padding is uncovered because no fixture has a hole touching its bounding box.
The two-row seed is uncovered because the `minA`/`maxA` column loop already seeds
both parities.

- [x] **Step 3: The mutation that does fail, with literal output**

```
✖ a tribar encloses a hole, and it grows with the figure     0 !== 1
✖ the shipping levels that read as impossible enclose a hole 0 !== 1
✖ NECESSARY, NOT SUFFICIENT — ordinary stairs                0 !== 3
ℹ tests 6 / pass 3 / fail 3
```

Right signature: every positive collapses to `0` while **both negative controls
stay green**, which is what distinguishes a detector that broke from a test set
that never discriminated.

- [x] **Step 4: Revert, correct the false comments, verify**

Reverted, then corrected the `SCREEN_NEIGHBOURS` docstring and the border-seed
comment to state what was measured — including that six-vs-four is correctness by
construction rather than by coverage. `npm test` → **172 pass, 0 fail**.

**Carry to METHODOLOGY §P8:** three details this plan asserted were load-bearing
are not covered by the fixtures. The comments now say so. A comment claiming a
constraint matters, on code where nothing tests it, is the same species of defect
as a green gate that measures the wrong thing.

## Task 3: `tools/search.mjs`

The previous phase discarded its search scaffolding, which is why its "18 four-leg circuits" claim is now unverifiable. This one is committed.

**Files:**
- Create: `tools/search.mjs`

- [ ] **Step 1: Write the tool**

```js
#!/usr/bin/env node
/**
 * Figure search — the filter cascade from
 * docs/superpowers/specs/2026-07-26-second-figure-family-design.md §2.
 *
 * COMMITTED ON PURPOSE. The previous phase's equivalent was throwaway, so its
 * reported pool size cannot now be reproduced or diffed against. Every count
 * this prints is a number a future change can move visibly.
 *
 * The stages are ordered CHEAP FIRST. Visual judgement is the expensive,
 * human, non-reproducible stage and it belongs after everything computable.
 *
 *   node tools/search.mjs [--legs=4] [--max-leg=6] [--min-leg=2] [--json]
 */
import { Structure, screenId, cellId } from '../src/geometry/index.js';

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.replace(/^--/, '').split('='))
  .map(([k, v]) => [k, v ?? true]));

// The cascade is enumerated from leg length 1 so the reported stage counts
// reproduce the spec's table exactly. The min-leg-2 rule is a NON-DEGENERACY
// constraint and is applied at that stage, not by narrowing the enumeration.
const MAX_LEG = Number(args['max-leg'] ?? 6);
const MIN_LEG = Number(args['min-leg'] ?? 1);
const NON_DEGENERATE_MIN_LEG = Number(args['degenerate-min-leg'] ?? 2);

const V = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};
const DIRS = Object.keys(V);
const axis = (d) => d[1];

function build(seq) {
  const cells = [[0, 0, 0]];
  let cur = [0, 0, 0];
  for (const [dir, len] of seq) {
    for (let i = 0; i < len; i++) {
      cur = [cur[0] + V[dir][0], cur[1] + V[dir][1], cur[2] + V[dir][2]];
      cells.push([...cur]);
    }
  }
  return cells;
}

/** Translation-invariant identity, so cyclic leg rotations collapse to one. */
function canon(cells) {
  const m = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
  return cells.map((c) => `${c[0] - m[0]},${c[1] - m[1]},${c[2] - m[2]}`).sort().join('|');
}

const stage = { closed: 0, noRepeat: 0, illusion: 0, screen: 0, hole: 0, nonDegenerate: 0 };
const seen = new Set();
const hits = [];

for (const d1 of DIRS) for (const d2 of DIRS) for (const d3 of DIRS) for (const d4 of DIRS) {
  if (axis(d1) === axis(d2) || axis(d2) === axis(d3) || axis(d3) === axis(d4)) continue;
  const dirs = [d1, d2, d3, d4];
  // Only three axes exist, so a four-leg circuit must reuse one. Reusing the
  // SAME direction splits a leg and the figure is still a tribar; reusing the
  // OPPOSITE direction doubles back, which is the new shape.
  const doublesBack = ['x', 'y', 'z'].some(
    (ax) => dirs.includes(`+${ax}`) && dirs.includes(`-${ax}`));

  for (let a = MIN_LEG; a <= MAX_LEG; a++)
  for (let b = MIN_LEG; b <= MAX_LEG; b++)
  for (let c = MIN_LEG; c <= MAX_LEG; c++)
  for (let d = MIN_LEG; d <= MAX_LEG; d++) {
    const seq = [[d1, a], [d2, b], [d3, c], [d4, d]];
    const cells = build(seq);
    const net = cells[cells.length - 1];
    // Closing on screen requires net displacement a positive multiple of
    // (1,1,1) — the only displacement the view direction collapses to nothing.
    if (!(net[0] === net[1] && net[1] === net[2] && net[0] > 0)) continue;
    stage.closed++;

    if (new Set(cells.map((x) => cellId(...x))).size !== cells.length) continue;
    stage.noRepeat++;

    const s = new Structure(cells);
    if (s.impossibleEdges(0).length === 0) continue;
    stage.illusion++;

    const screenCells = new Set(cells.map((x) => screenId(...x))).size;
    if (screenCells < 8) continue;
    stage.screen++;

    const holes = s.enclosedHoles(0).length;
    if (holes === 0) continue;
    stage.hole++;

    const minLeg = Math.min(a, b, c, d);
    if (!doublesBack || minLeg < NON_DEGENERATE_MIN_LEG
        || screenCells < 9 || cells.length > 20) continue;
    stage.nonDegenerate++;

    const key = canon(cells);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      legs: seq.map(([x, n]) => `${x}×${n}`).join(' '),
      cells: cells.length, screenCells, holes,
      illusionEdges: s.impossibleEdges(0).length,
      standable: s.standable(0).length,
      net: net.join(','),
      cellList: cells,
    });
  }
}

if (args.json) {
  console.log(JSON.stringify(hits, null, 2));
} else {
  console.log(`four-leg circuits, legs ${MIN_LEG}..${MAX_LEG}\n`);
  console.log(`  closes on screen, net a positive multiple of (1,1,1)   ${stage.closed}`);
  console.log(`  no repeated 3D cell                                    ${stage.noRepeat}`);
  console.log(`  carries at least one illusion edge                     ${stage.illusion}`);
  console.log(`  >=8 distinct screen cells                              ${stage.screen}`);
  console.log(`  ENCLOSES A HOLE                                        ${stage.hole}`);
  console.log(`  non-degenerate (doubles back, min leg 2, >=9, <=20)    ${stage.nonDegenerate}`);
  console.log(`  distinct up to translation                             ${hits.length}\n`);
  console.log('  Visual judgement is NOT in this list. It comes last, on rendered output.');
}
```

- [ ] **Step 2: Run it**

```bash
node tools/search.mjs
```

Expected — every number must match the spec's §2 table exactly:

```
  closes on screen, net a positive multiple of (1,1,1)   810
  no repeated 3D cell                                    810
  carries at least one illusion edge                     440
  >=8 distinct screen cells                              400
  ENCLOSES A HOLE                                        330
  non-degenerate (doubles back, min leg 2, >=9, <=20)    ???
  distinct up to translation                             102
```

The `nonDegenerate` count was not separately recorded when the spec was written, so it is the one number without a prior value — record whatever it reports and add it to the spec table.

**If any of the other six differs, stop.** The `ENCLOSES A HOLE` row is the load-bearing one: it is produced by `enclosedHoles()` from Task 1, and a mismatch means the committed detector does not agree with the throwaway probe the spec's numbers came from. That is a defect in Task 1, not a reason to edit the expectation.

- [ ] **Step 3: Commit**

```bash
git add tools/search.mjs
git commit -m "tools: commit the figure search instead of throwing it away"
```

---

## Task 4: Select and judge the 4- and 5-turn figures — HUMAN GATE

The spec validated three distinct figures at `minTurns` 6. The figures for 4 and 5 do not exist yet. **This task cannot be completed by reasoning.**

**Files:** none committed. Output is a decision recorded in the next task.

- [ ] **Step 1: Enumerate candidates at each target**

For every figure in the search pool, augment it with a 1–3 cell spur off any cell, in any of the six directions, rejecting any spur that fills the hole. For each augmented figure enumerate `(start, goal)` pairs over standable cells and keep those with a **strong premise**: `solvable`, `requiresTurn`, `usesIllusion`, `flatSolvableTurns` empty, and `route[0].kind === 'walk'`.

Group by exact `turnsInRoute`. Per §5.1 the target must be hit **exactly**, not bounded — a route taking 6 turns does not qualify as a `minTurns: 4` level.

- [ ] **Step 2: Render the candidates through the real engine**

Not SVG. Not reasoning. The engine, with its palette and framing:

```bash
node tools/baseline.mjs --out=/tmp/judge --port=5601 --shots=hero --query=level=<name>
```

For candidates not yet in `LEVELS`, add them temporarily, render, and revert. This is the only reliable way to see what a figure looks like — `analyze.mjs` proves routing and never proves the picture.

- [ ] **Step 3: OPEN EVERY IMAGE**

Four defects in this repository's history passed every automated check and were caught only by looking. Do not skip this and do not delegate it to a metric.

Reject anything that reads as a frame, a slab, a notched block or an ordinary staircase — regardless of how good its numbers are.

- [ ] **Step 4: If a target cannot be met, follow §5.2 of the spec**

In preference order: re-target the curve to the measured values that survive (keeping it non-decreasing); ship two levels instead of three; widen the search. **Do not** declare a slack `minTurns` to manufacture a curve, and **do not** ship a figure that failed visual judgement because its numbers were good.

- [ ] **Step 5: Record the decision**

Write the chosen figures, spurs, start/goal pairs and measured premises into the Task 5 level definitions. No commit yet.

---

## Task 5: The three levels

**Files:**
- Modify: `src/world/levels.js`

- [ ] **Step 1: Write the failing test first — by adding the levels**

`src/world/levels.test.js` already loops over every entry in `LEVELS` and proves the declared premise against measured geometry. Adding a level with a wrong declaration therefore fails automatically; there is no separate test to write.

Add each level as a function beside `shelf03()`, following the existing shape — a doc comment that says what the figure IS and why the premise is what it is, then data only. Add a shared `quad(...)` builder beside `tribar(n)` so the four-leg figure is defined once.

Declare `minTurns` at the **measured** `turnsInRoute`, per spec §5.1.

- [ ] **Step 2: Register them and extend the campaign**

```js
export const LEVELS = {
  'loop-01': loop01(),
  'probe-01': probe01(),
  'spur-01': spur01(),
  'span-02': span02(),
  'shelf-03': shelf03(),
  // three new entries here
};

export const ORDER = ['loop-01', 'spur-01', 'span-02', 'shelf-03', /* three new */];
```

`DEFAULT_LEVEL` stays `loop-01`. All 15 existing shots capture it.

- [ ] **Step 3: Prove each level with the analyser**

```bash
for lv in loop-01 probe-01 spur-01 span-02 shelf-03 <new-1> <new-2> <new-3>; do
  echo "== $lv"; node tools/analyze.mjs "$lv" >/dev/null || echo "FAILED: $lv";
done
```

Expected: no `FAILED` lines. `analyze.mjs` exits 1 on any declared-vs-measured mismatch.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

Expected: 172 + 3 new premise tests per level (`declares a premise`, `start is not the goal`, `the declared premise is what the geometry measures`) = **181 pass, 0 fail**. The campaign curve test at `campaign.test.js:39` must pass — if it reports "the curve goes backwards", the `minTurns` ordering in `ORDER` is wrong.

- [ ] **Step 5: Commit**

```bash
git add src/world/levels.js
git commit -m "levels: three levels on the four-leg figure"
```

---

## Task 6: Three plate shots

**Files:**
- Modify: `src/dev/shots.js`

- [ ] **Step 1: Capture the existing 15 references BEFORE touching anything**

```bash
node tools/baseline.mjs --out=/tmp/sff-before --port=5601
```

- [ ] **Step 2: Add three shots beside `spur01` / `span02` / `shelf03`**

```js
    <name1>: Object.assign(plate(0, { fillY: 0.74, fillX: 0.84, liftY: 0.025 }),
      { level: '<level-1>' }),
```

Tune `fillY` / `fillX` per figure so the subject fills the frame — these figures are a different shape from the tribar and the tribar's framing constants are not automatically right.

- [ ] **Step 3: Capture after, and prove the existing references did not move**

```bash
node tools/baseline.mjs --out=/tmp/sff-after --port=5601
node tools/imagediff.mjs --a=/tmp/sff-before --b=/tmp/sff-after
```

Expected: the 15 pre-existing shots report `maxDelta: 0`. A new level must be invisible to an existing shot. If any existing shot moved, **stop and find out why** — do not re-baseline.

- [ ] **Step 4: OPEN THE THREE NEW PLATES**

Look at each one. A shot that frames its subject badly gates less than it claims — P6 shipped an orbit shot with a third of the structure out of frame and every automated check passed.

- [ ] **Step 5: Run the gate**

```bash
npm run gate
```

Expected: `identical: true` across 18 shots.

Note: `npm run gate` captures the same tree twice and compares. **It cannot fail on a code change** — it is a determinism self-check, and Step 3 is what proves a change moved no pixels.

- [ ] **Step 6: Commit**

```bash
git add src/dev/shots.js
git commit -m "shots: gate the three new levels"
```

---

## Task 7: Verification and the record

**Files:**
- Modify: `METHODOLOGY.md`

- [ ] **Step 1: Measure the CI cost under the rasteriser CI actually uses**

A timing from this machine is not evidence about CI.

```bash
PENROSE_GL=swiftshader node tools/baseline.mjs --out=/tmp/sff-15 --port=5601 --shots=hero,seam,wide,offaxis,rot1,rot2,rot3,avatar,avatarmid,spur01,span02,shelf03,orbitmid,orbitlate,stepmid
PENROSE_GL=swiftshader node tools/baseline.mjs --out=/tmp/sff-18 --port=5601
```

Record both wall-clock figures and the marginal per-shot rate. Three cost estimates in this repository have missed, in both directions — report the measurement, not the prediction.

- [ ] **Step 2: Play it end to end**

```bash
npm run dev
```

Play all seven campaign levels to `campaign/complete`. `src/campaign` is inert under `config.capture`, so the pixel gate covers **none** of the progression path — this is the only thing that exercises it.

**Record honestly whether the 6-turn levels are tedious.** Spec risk 1 says roughly half the player's inputs are rotations and that this is a playtest question. If it is not fun, say so in the record and raise it rather than shipping it silently.

- [ ] **Step 3: Full verification sweep**

| check | command | bar |
|---|---|---|
| tests | `npm test` | 181 pass, 0 fail |
| analyser | `analyze.mjs` × 8 levels | all exit 0 |
| gate | `npm run gate` | `identical: true`, 18 shots |
| references | `imagediff.mjs` before/after | 15 existing at `maxDelta: 0` |
| hole guard | Task 2 | verified to fail, output recorded |
| playthrough | manual | 7 levels, `campaign/complete`, zero page errors |

- [ ] **Step 4: Write METHODOLOGY §P8**

Follow the existing section shape: what was found, what was decided and why, **what the spec got wrong**, the verification table, and what is still open. Include:

- the one-dimensionality proof for the tribar family
- the staircase impossibility result
- the hole criterion **and its counterexample** — do not write it up as sufficient
- that the previous phase's "18 circuits" is unverifiable, and that this is why `tools/search.mjs` is committed
- the measured CI cost against the P6 baseline
- an honest verdict on whether 6-turn levels are fun

- [ ] **Step 5: Commit and open the PR**

```bash
git add METHODOLOGY.md
git commit -m "docs: record the second figure family phase"
git push -u origin feat/second-figure-family
gh pr create --title "The second figure family" --body "..."
```

- [ ] **Step 6: Verify CI conclusion authoritatively**

`gh run watch --exit-status` is unreliable.

```bash
gh run list --branch feat/second-figure-family --limit 1
gh run view <id> --json status,conclusion
```

Expected: `"conclusion": "success"`.

---

## Definition of done

- [ ] 181 tests pass, full suite, no path scope
- [ ] All 8 levels exit 0 from `analyze.mjs`
- [ ] Gate `identical: true` across 18 shots
- [ ] The 15 pre-existing references at `maxDelta: 0`
- [ ] Hole-detector guard verified to fail, literal output recorded
- [ ] Every new figure judged by opening its render, not by its metrics
- [ ] Played end to end, with an honest verdict on the 6-turn levels
- [ ] CI green, confirmed via `gh run view --json conclusion`
- [ ] METHODOLOGY §P8 written, including what this plan got wrong
