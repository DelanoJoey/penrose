# Levels and Cross-Rotation Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rotation load-bearing — add routing across rotation states, let levels declare and CI prove their own premise, and ship three levels that cannot be solved without turning.

**Architecture:** `Structure` gains a breadth-first search over `(cell, turns)` where walking uses the existing per-rotation `pathGraph` and turning is always legal. Levels stay pure data but declare a premise that `tools/analyze.mjs` proves. `baseline.mjs` learns to capture a shot against a named level, which it currently cannot do at all.

**Tech Stack:** Node 22 (`node --test`), Three.js r180, Vite 7, Playwright/Chromium, pngjs.

**Spec:** `docs/superpowers/specs/2026-07-26-penrose-levels-design.md`

---

## Read first

`ARCHITECTURE.md` §1 (determinism), §3.3 (subsystems may not import each other; `src/geometry` is the only permitted direct reach), §5 (the gate). Then `METHODOLOGY.md`.

Three invariants this plan must not break:

1. **`src/geometry` is the single authority on what connects to what.** `src/player` reads it. Never compute connectivity anywhere else.
2. **Levels are data.** `src/world/levels.js` computes nothing.
3. **A shot may not start an animation.** Shots are pure functions of the scene.

## File structure

| File | Responsibility |
|---|---|
| `src/geometry/index.js` *(modify)* | add `findRoute`, `premise`. Do not touch `solvability` |
| `src/geometry/route.test.js` *(create)* | routing unit tests + negative controls |
| `src/world/levels.js` *(modify)* | premise declarations; three new levels |
| `src/world/levels.test.js` *(create)* | every level's declared premise is proven |
| `tools/lib/shot-url.mjs` *(create)* | pure capture-URL builder, so it can be tested |
| `test/shot-url.test.js` *(create)* | URL builder tests |
| `tools/baseline.mjs` *(modify)* | per-shot level via the builder |
| `src/dev/shots.js` *(modify)* | shots may declare a level; three new plates |
| `tools/analyze.mjs` *(modify)* | prove the declared premise; stop reporting `requiresRotation` bare |
| `.github/workflows/gate.yml` *(modify)* | iterate every level, not a hardcoded two |

---

### Task 1: Worktree setup and the before-picture

**Files:** none modified.

- [ ] **Step 1: Install dependencies**

`node_modules/` is gitignored and not shared between worktrees.

```bash
cd ~/penrose/.worktrees/levels-routing
npm install && npx playwright install chromium
```

- [ ] **Step 2: Confirm the baseline is green before changing anything**

```bash
npm test
node tools/analyze.mjs loop-01
node tools/analyze.mjs probe-01
```

Expected: 112 tests pass; both analyses exit 0 with `OK: solvable, and the illusion is load-bearing.`

- [ ] **Step 3: Capture the reference set that Task 2 must not move**

```bash
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/pen-before --port=5199
```

Expected: `"ok": true` and 9 PNGs in `/tmp/pen-before`. Keep this directory for Task 2.

---

### Task 2: Let a shot declare its level

The harness change lands **alone**, before any new level exists, so a reference-pixel shift can only be attributed to the harness. Today `gate.mjs` calls `baseline.mjs` with no `--query`, so every capture is `DEFAULT_LEVEL` and a non-default level cannot be captured at all.

**Files:**
- Create: `tools/lib/shot-url.mjs`
- Create: `test/shot-url.test.js`
- Modify: `tools/baseline.mjs:38`, `:73-76`, `:84`
- Modify: `src/dev/shots.js` (export shape only)

- [ ] **Step 1: Write the failing test**

`baseline.mjs` spawns Vite at import time, so the URL logic cannot be imported from it. Extract it.

Create `test/shot-url.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { shotUrl } from '../tools/lib/shot-url.mjs';

test('a shot with no declared level produces the historic URL exactly', () => {
  assert.equal(
    shotUrl({ port: 5199, shot: 'hero' }),
    'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=hero',
  );
});

test('a declared level is appended', () => {
  assert.equal(
    shotUrl({ port: 5199, shot: 'plate', level: 'ledge-02' }),
    'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=plate&level=ledge-02',
  );
});

test('extra query is appended after the level', () => {
  assert.equal(
    shotUrl({ port: 5199, shot: 'hero', level: 'a', extra: 'quality=low' }),
    'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=hero&level=a&quality=low',
  );
});

test('shot and level names are encoded', () => {
  assert.equal(
    shotUrl({ port: 5199, shot: 'a b', level: 'c&d' }),
    'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=a%20b&level=c%26d',
  );
});

test('null and undefined levels are both treated as absent', () => {
  const bare = 'http://127.0.0.1:5199/?capture=1&lockstep=1&shot=hero';
  assert.equal(shotUrl({ port: 5199, shot: 'hero', level: null }), bare);
  assert.equal(shotUrl({ port: 5199, shot: 'hero', level: undefined }), bare);
});
```

The first test is the load-bearing one: it pins the URL for undeclared shots byte-for-byte, which is what guarantees the nine existing references cannot move.

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/shot-url.test.js
```

Expected: FAIL — cannot find module `../tools/lib/shot-url.mjs`.

- [ ] **Step 3: Write the builder**

Create `tools/lib/shot-url.mjs`:

```js
/**
 * The capture URL for one shot.
 *
 * Extracted from baseline.mjs so it can be tested: baseline.mjs spawns Vite at
 * import time, so importing it from a test would start a dev server.
 *
 * A shot with no declared level MUST produce exactly the URL this harness has
 * always produced. That is what keeps the existing reference set valid across
 * this change — see docs/superpowers/specs/2026-07-26-penrose-levels-design.md §4.
 */
export function shotUrl({ port, shot, level = null, extra = '' }) {
  let url = `http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=${encodeURIComponent(shot)}`;
  if (level != null) url += `&level=${encodeURIComponent(level)}`;
  if (extra) url += `&${extra}`;
  return url;
}
```

- [ ] **Step 4: Run the test again**

```bash
node --test test/shot-url.test.js
```

Expected: PASS, 5/5.

- [ ] **Step 5: Teach `baseline.mjs` to discover and use declared levels**

In `tools/baseline.mjs`, add to the imports:

```js
import { shotUrl } from './lib/shot-url.mjs';
```

Replace the discovery evaluate at `:73` so it returns levels alongside names. Functions do not serialise, so map to plain objects in the page:

```js
const all = await probe.evaluate(
  'Object.entries(window.__SHOTS__ ?? {}).map(([name, fn]) => ({ name, level: fn.level ?? null }))');
await probe.close();

const wanted = args.shots
  ? String(args.shots).split(',').map((s) => s.trim()).map((n) => all.find((s) => s.name === n) ?? { name: n, level: null })
  : all;
```

Change the loop header from `for (const name of wanted)` to:

```js
for (const { name, level } of wanted) {
```

and replace the `page.goto` URL at `:84` with:

```js
    await page.goto(shotUrl({ port: PORT, shot: name, level, extra: EXTRA.replace(/^&/, '') }),
      { waitUntil: 'domcontentloaded', timeout: 90000 });
```

Record the level in the report so a capture is self-describing — inside `report.shots.push({...})`, add `level`.

- [ ] **Step 6: Document the convention in `src/dev/shots.js`**

No shot declares a level yet. Add to the file's header block, after the COMPOSITION section:

```
 * DECLARING A LEVEL. A shot may carry a `level` property naming the level it
 * needs; tools/baseline.mjs then boots that page with `&level=<name>`. This is
 * not optional plumbing — src/world reads the level from boot config and sizes
 * its InstancedMesh at init, so a shot function CANNOT switch levels itself.
 * A shot that declares nothing captures DEFAULT_LEVEL, and its URL is byte
 * identical to what it has always been, which is what keeps the existing
 * reference set valid across this change.
```

- [ ] **Step 7: Prove the existing references did not move**

```bash
npm test
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/pen-after --port=5199
node tools/imagediff.mjs --a=/tmp/pen-before --b=/tmp/pen-after
```

Expected: `"identical": true`, `"missing": 0`, worst `maxDelta: 0`, exit 0.

**If this reports anything other than `maxDelta: 0`, stop.** Do not widen tolerance and do not re-capture a reference — read the diff image. Per spec §4 this is the acceptance test for the whole task.

- [ ] **Step 8: Run the determinism gate**

```bash
npm run gate
```

Expected: `[gate] PASS`, exit 0.

- [ ] **Step 9: Commit**

```bash
git add tools/lib/shot-url.mjs test/shot-url.test.js tools/baseline.mjs src/dev/shots.js
git commit -m "harness: let a shot declare the level it needs

The gate could not capture a non-default level at all: gate.mjs passes no
--query, so baseline.mjs left EXTRA empty and every shot URL carried no
level. src/world reads the level from boot config and sizes its
InstancedMesh at init, so a shot function cannot switch levels itself --
it has to arrive in the URL.

Landed alone, before any new level exists, so a reference-pixel shift can
only be the harness. Verified: 9 existing shots maxDelta 0."
```

---

### Task 3: `findRoute` — breadth-first over (cell, turns)

**Files:**
- Create: `src/geometry/route.test.js`
- Modify: `src/geometry/index.js` (add methods to `Structure`; do not touch `solvability`)

- [ ] **Step 1: Write the failing tests**

Create `src/geometry/route.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Structure } from './index.js';
import { LEVELS } from '../world/levels.js';

test('loop-01 is routable with no turns — it is solvable in the state it opens in', () => {
  const lv = LEVELS['loop-01'];
  const route = new Structure(lv.cells).findRoute(lv.start, lv.goal);
  assert.ok(route, 'expected a route');
  assert.equal(route.filter((m) => m.kind === 'turn').length, 0);
  assert.equal(route.filter((m) => m.kind === 'walk').length, 1);
});

test('a walk move records the rotation it was taken in', () => {
  const lv = LEVELS['loop-01'];
  const route = new Structure(lv.cells).findRoute(lv.start, lv.goal);
  assert.equal(route[0].kind, 'walk');
  assert.equal(route[0].turns, 0);
  assert.equal(route[0].from, '1,0,0');
  assert.equal(route[0].to, '5,5,5');
});

test('an unreachable goal routes to null', () => {
  // Two lone cells that share no screen adjacency in any rotation.
  const s = new Structure([[0, 0, 0], [0, 40, 0]]);
  assert.equal(s.findRoute([0, 0, 0], [0, 40, 0]), null);
});

// ---- NEGATIVE CONTROLS. A search that only ever succeeds proves nothing.

test('turning is legal FROM a cell that is not standable in the current rotation', () => {
  // THE decisive control for the turn-edge rule. The rule that looks right --
  // "only turn when standable in both states", so you cannot strand yourself --
  // contradicts src/player/index.js:366, where a stranded player rotates back
  // out. Under that stricter rule this test returns null and fails.
  //
  // loop-01's own trick supplies the fixture: at turn 0, (5,5,5) aliases
  // (0,0,0) on screen and sits in front of it (depth 15 vs 0), so (0,0,0) is
  // NOT standable at turn 0 -- but it is at turns 1, 2 and 3.
  const lv = LEVELS['loop-01'];
  const s = new Structure(lv.cells);
  const standableAt = (t) => new Set(s.standable(t).map((c) => c.join(',')));

  assert.equal(standableAt(0).has('0,0,0'), false, 'fixture: (0,0,0) is occluded at turn 0');
  for (const t of [1, 2, 3]) {
    assert.equal(standableAt(t).has('0,0,0'), true, `fixture: (0,0,0) standable at turn ${t}`);
  }

  // Starting there at turn 0 there is no walk available at all -- the cell has
  // no entry in pathGraph(0). Only an unconditional turn edge gets the search out.
  const route = s.findRoute([0, 0, 0], lv.goal, 0);
  assert.ok(route, 'a stranded start must still route — turning is never blocked');
  assert.equal(route[0].kind, 'turn');
  assert.equal(route.length, 4);
});

test('findRoute reaches a goal that NO single rotation can reach', () => {
  // Ground walkway, a tower beside it, an upper walkway. No flat path exists.
  const cells = [
    [0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0],
    [0, 0, 1], [0, 1, 1], [0, 2, 1],
    [0, 3, 0], [1, 3, 0], [2, 3, 0],
  ];
  const s = new Structure(cells);
  const start = [0, 0, 0], goal = [2, 3, 0];

  for (const t of [0, 1, 2, 3]) {
    assert.equal(s.findPath(start, goal, t), null, `turn ${t} must have no flat path`);
  }
  const route = s.findRoute(start, goal);
  assert.ok(route, 'expected a cross-rotation route');
  assert.ok(route.filter((m) => m.kind === 'turn').length >= 2, 'expected at least two turns');
});

test('start equal to goal yields an empty route, not null', () => {
  const lv = LEVELS['loop-01'];
  const route = new Structure(lv.cells).findRoute(lv.start, lv.start);
  assert.deepEqual(route, []);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
node --test src/geometry/route.test.js
```

Expected: FAIL — `s.findRoute is not a function`.

- [ ] **Step 3: Implement**

In `src/geometry/index.js`, add to `Structure` **after** `findPath` and **before** `solvability`:

```js
  /**
   * Route from one cell to another ACROSS rotation states.
   *
   * findPath answers "is there a path in this one rotation". This answers the
   * question the game actually asks, where turning is itself a move:
   *
   *   walk : (cell, t) -> (neighbour, t)   only between standable cells
   *   turn : (cell, t) -> (cell, t +/- 1)  ALWAYS legal
   *
   * THE UNCONDITIONAL TURN IS NOT AN OVERSIGHT. The intuitive rule -- only turn
   * when the cell is standable in both states, so you cannot strand yourself --
   * contradicts the game. src/world.setRotation has no standability check, and
   * src/player/index.js:366 says so explicitly: "If the current cell is not
   * standable in this rotation it has no entry, and every direction is blocked
   * -- which is correct: rotate back to get out." A legitimate route may pass
   * THROUGH a rotation in which its cell is not a platform. An analyser using
   * the stricter rule would disagree with the player about what the level is,
   * and geometry is supposed to be the one authority both read.
   *
   * A turn and a walk cost the same: both are one keypress. So a "shortest"
   * route may prefer turning to walking. Deliberate, and recorded rather than
   * weighted, because no evidence yet says what a better weighting would be.
   *
   * @returns {Array<{kind:'walk'|'turn'}>|null} ordered moves, [] if already
   *   at the goal, null if unreachable in every rotation.
   */
  findRoute(fromCell, toCell, startTurns = 0) {
    const graphs = [0, 1, 2, 3].map((t) => this.pathGraph(t));
    const goal = cellId(...toCell);
    const t0 = ((startTurns % 4) + 4) % 4;
    const start = `${cellId(...fromCell)}@${t0}`;

    const prev = new Map([[start, null]]);
    const queue = [start];

    while (queue.length) {
      const cur = queue.shift();
      const [id, turns] = splitState(cur);

      if (id === goal) {
        const chain = [];
        for (let n = cur; n != null; n = prev.get(n)) chain.push(n);
        chain.reverse();
        const moves = [];
        for (let i = 1; i < chain.length; i++) {
          const [pc, pt] = splitState(chain[i - 1]);
          const [qc, qt] = splitState(chain[i]);
          moves.push(pc === qc
            ? { kind: 'turn', from: pt, to: qt }
            : { kind: 'walk', from: pc, to: qc, turns: pt });
        }
        return moves;
      }

      for (const next of graphs[turns].get(id) ?? []) {
        const k = `${next}@${turns}`;
        if (!prev.has(k)) { prev.set(k, cur); queue.push(k); }
      }
      for (const d of [1, 3]) {
        const k = `${id}@${(turns + d) % 4}`;
        if (!prev.has(k)) { prev.set(k, cur); queue.push(k); }
      }
    }
    return null;
  }
```

And add this helper at module scope, next to `parseCell`:

```js
/** Split a "x,y,z@t" search state. Uses lastIndexOf so negative coords are safe. */
const splitState = (s) => {
  const i = s.lastIndexOf('@');
  return [s.slice(0, i), Number(s.slice(i + 1))];
};
```

- [ ] **Step 4: Run the tests**

```bash
node --test src/geometry/route.test.js
```

Expected: PASS, 6/6.

- [ ] **Step 5: Run the full suite — nothing else may move**

```bash
npm test
```

Expected: **0 failures.** The count grows from 112 as tests are added; the number that matters is that nothing previously passing now fails.

- [ ] **Step 6: Commit**

```bash
git add src/geometry/index.js src/geometry/route.test.js
git commit -m "geometry: route across rotation states, with turning as a move

findPath searches one rotation, so nothing in this repo could express
'the player must turn to win' -- and no level ever required one.

Turn edges are unconditional, matching src/player:366 rather than the
intuitive rule: a stranded player rotates back out, so a route may pass
through a rotation where its cell is not a platform."
```

---

### Task 4: `premise` — the report levels are proven against

**Files:**
- Modify: `src/geometry/index.js`
- Modify: `src/geometry/route.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/geometry/route.test.js`:

```js
test('loop-01 does NOT require a turn, and premise says so', () => {
  const lv = LEVELS['loop-01'];
  const p = new Structure(lv.cells).premise(lv.start, lv.goal);
  assert.equal(p.solvable, true);
  assert.equal(p.requiresTurn, false, 'loop-01 opens already solvable');
  assert.equal(p.turnsInRoute, 0);
  assert.equal(p.walksInRoute, 1);
  assert.equal(p.usesIllusion, true);
  assert.deepEqual(p.flatSolvableTurns, [0]);
});

test('premise reports requiresTurn when no flat path exists at turn 0', () => {
  const cells = [
    [0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0],
    [0, 0, 1], [0, 1, 1], [0, 2, 1],
    [0, 3, 0], [1, 3, 0], [2, 3, 0],
  ];
  const p = new Structure(cells).premise([0, 0, 0], [2, 3, 0]);
  assert.equal(p.solvable, true);
  assert.equal(p.requiresTurn, true);
  assert.deepEqual(p.flatSolvableTurns, []);
  assert.ok(p.turnsInRoute >= 2);
  assert.equal(p.usesIllusion, true);
  assert.equal(p.route[0].kind, 'walk', 'this level must be playable on frame one');
});

test('an unsolvable level reports solvable false and requiresTurn false', () => {
  const p = new Structure([[0, 0, 0], [0, 40, 0]]).premise([0, 0, 0], [0, 40, 0]);
  assert.equal(p.solvable, false);
  assert.equal(p.requiresTurn, false, 'unreachable is not "requires a turn"');
  assert.equal(p.usesIllusion, false);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
node --test src/geometry/route.test.js
```

Expected: FAIL — `s.premise is not a function`.

- [ ] **Step 3: Implement**

In `src/geometry/index.js`, add after `findRoute`:

```js
  /**
   * Everything a level declares about itself, measured.
   *
   * `requiresTurn` is defined against turn 0 alone, because that is the state
   * every level opens in. If a flat path exists there the player never has to
   * turn, whatever the other three rotations do -- which is exactly how
   * loop-01 passed a "requiresRotation" assert while needing zero turns.
   */
  premise(fromCell, toCell) {
    const route = this.findRoute(fromCell, toCell);
    const flat = [0, 1, 2, 3].map((t) => this.findPath(fromCell, toCell, t));
    const illusion = [0, 1, 2, 3].map((t) =>
      new Set(this.impossibleEdges(t).map((e) => `${e.from}>${e.to}`)));

    const walks = (route ?? []).filter((m) => m.kind === 'walk');
    const illusionWalks = walks.filter((m) => illusion[m.turns].has(`${m.from}>${m.to}`));

    return {
      solvable: route !== null,
      requiresTurn: route !== null && flat[0] === null,
      turnsInRoute: (route ?? []).filter((m) => m.kind === 'turn').length,
      walksInRoute: walks.length,
      usesIllusion: illusionWalks.length > 0,
      illusionWalks: illusionWalks.length,
      flatSolvableTurns: [0, 1, 2, 3].filter((t) => flat[t]),
      route,
    };
  }
```

- [ ] **Step 4: Run tests**

```bash
node --test src/geometry/route.test.js && npm test
```

Expected: all tests in the file pass; suite has 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/geometry/index.js src/geometry/route.test.js
git commit -m "geometry: premise() -- the measured report levels declare against"
```

---

### Task 5: Levels declare their premise

**Files:**
- Modify: `src/world/levels.js`
- Create: `src/world/levels.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/world/levels.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Structure } from '../geometry/index.js';
import { LEVELS } from './levels.js';

for (const [name, lv] of Object.entries(LEVELS)) {
  test(`${name}: declares a premise`, () => {
    assert.ok(lv.premise, `${name} must declare a premise`);
  });

  test(`${name}: start is not the goal`, () => {
    assert.notDeepEqual(lv.start, lv.goal);
  });

  test(`${name}: the declared premise is what the geometry measures`, () => {
    const p = new Structure(lv.cells).premise(lv.start, lv.goal);
    const d = lv.premise;

    assert.equal(p.solvable, true, `${name} is not solvable`);

    // Equalities in BOTH directions: if `turn: false` merely meant "no
    // constraint", a level could quietly acquire a turn-requiring route and
    // nothing would say so.
    assert.equal(p.requiresTurn, d.turn, `${name} declares turn: ${d.turn}`);
    assert.equal(p.usesIllusion, d.illusion, `${name} declares illusion: ${d.illusion}`);

    if (d.minWalks != null) assert.ok(p.walksInRoute >= d.minWalks);
    if (d.openWithWalk) assert.equal(p.route[0]?.kind, 'walk');
  });
}
```

- [ ] **Step 2: Run and watch it fail**

```bash
node --test src/world/levels.test.js
```

Expected: FAIL — `loop-01 must declare a premise`.

- [ ] **Step 3: Declare what the two existing levels actually are**

In `src/world/levels.js`, add to `loop01`'s returned object, after `goal`:

```js
    /**
     * MEASURED, not aspirational. loop-01 is solvable in one move in the
     * rotation it opens in -- `turn: false` is the honest declaration, and
     * saying so out loud is what stopped this being mistaken for a level that
     * uses its own mechanic. See tools/analyze.mjs.
     */
    premise: { turn: false, illusion: true },
```

and to `probe01`'s, after `goal`:

```js
    premise: { turn: false, illusion: true },
```

- [ ] **Step 4: Run the tests**

```bash
node --test src/world/levels.test.js && npm test
```

Expected: PASS. If either level's declaration does not match, **fix the declaration, not the level** — the measurement is the truth here.

- [ ] **Step 5: Commit**

```bash
git add src/world/levels.js src/world/levels.test.js
git commit -m "levels: declare the premise each level actually has

Both existing levels declare turn: false, because both are solvable in
the state they open in. That is the honest reading and it is the whole
point of declaring."
```

---

### Task 6: `analyze.mjs` proves the declaration

**Files:** Modify `tools/analyze.mjs`

- [ ] **Step 1: Replace the report and the asserts**

Replace everything from `const sol = s.solvability(...)` to the end of `tools/analyze.mjs` with:

```js
const sol = s.solvability(level.start, level.goal);
const p = s.premise(level.start, level.goal);
const decl = level.premise ?? null;

const report = {
  level: level.name,
  cells: level.cells.length,
  start: cellId(...level.start),
  goal: cellId(...level.goal),
  declared: decl,
  measured: {
    solvable: p.solvable,
    requiresTurn: p.requiresTurn,
    turnsInRoute: p.turnsInRoute,
    walksInRoute: p.walksInRoute,
    usesIllusion: p.usesIllusion,
    illusionWalks: p.illusionWalks,
    flatSolvableTurns: p.flatSolvableTurns,
  },
  perRotation: [0, 1, 2, 3].map((t) => ({
    turns: t,
    visible: s.visibility(t).size,
    standable: s.standable(t).length,
    impossibleEdges: s.impossibleEdges(t).length,
    pathLength: s.findPath(level.start, level.goal, t)?.length ?? null,
  })),
  // NOT "the player must rotate". It means SOME rotations work and some do
  // not, which is how a level solvable in one move with zero turns passed for
  // a level that uses its own mechanic. requiresTurn above is the real answer.
  someRotationsFail: sol.requiresRotation,
  route: p.route,
};

console.log(JSON.stringify(report, null, 2));

// Design asserts. These are the premise of the game, not style preferences.
const problems = [];
if (!p.solvable) problems.push('level is not solvable in any rotation');
if (cellId(...level.start) === cellId(...level.goal)) problems.push('start equals goal');

if (!decl) {
  problems.push('level declares no premise — add one so CI can prove it');
} else {
  if (decl.turn !== p.requiresTurn)
    problems.push(`declares turn: ${decl.turn} but measured requiresTurn: ${p.requiresTurn}`);
  if (decl.illusion !== p.usesIllusion)
    problems.push(`declares illusion: ${decl.illusion} but measured usesIllusion: ${p.usesIllusion}`);
  if (decl.minWalks != null && p.walksInRoute < decl.minWalks)
    problems.push(`declares minWalks: ${decl.minWalks} but the route has ${p.walksInRoute}`);
  if (decl.openWithWalk && p.route?.[0]?.kind !== 'walk')
    problems.push('declares openWithWalk but the route opens with a turn — the level is unplayable on frame one');
}

if (problems.length) {
  console.error('\nDESIGN PROBLEMS:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.error('\nOK: the level is what it declares itself to be.');
```

Update the file's header comment to describe premise-proving rather than the old two asserts.

- [ ] **Step 2: Verify it passes on both existing levels**

```bash
node tools/analyze.mjs loop-01; echo "exit=$?"
node tools/analyze.mjs probe-01; echo "exit=$?"
```

Expected: `exit=0` for both, `"requiresTurn": false`, `OK: the level is what it declares itself to be.`

- [ ] **Step 3: Prove the assert can FAIL — a check that only passes is not a check**

Temporarily edit `loop-01`'s premise to `{ turn: true, illusion: true }`:

```bash
node tools/analyze.mjs loop-01; echo "exit=$?"
```

Expected: `exit=1` and `declares turn: true but measured requiresTurn: false`.

**Revert the edit** and confirm `exit=0` again. Do not commit the broken declaration.

- [ ] **Step 4: Commit**

```bash
git add tools/analyze.mjs
git commit -m "analyze: prove the declared premise, and stop reporting requiresRotation bare

requiresRotation reads as 'the player must rotate' and means 'some
rotations work and some do not'. That phrasing is how a one-move,
zero-turn level passed as one that uses its own mechanic. Renamed in the
report to someRotationsFail; requiresTurn is the real answer.

Guard verified to fail: declaring turn: true on loop-01 exits 1."
```

---

### Task 7: CI covers every level

**Files:** Modify `.github/workflows/gate.yml`

- [ ] **Step 1: Replace the hardcoded loop**

The current step iterates `loop-01 probe-01`, so a new level escapes the design asserts entirely — the same silent-gap class this whole branch exists to close. Replace the `Level design asserts` step's `run:` block with:

```yaml
        run: |
          levels=$(node -e "import('./src/world/levels.js').then(m => console.log(Object.keys(m.LEVELS).join(' ')))")
          echo "levels: $levels"
          test -n "$levels" || { echo "no levels discovered"; exit 1; }
          for level in $levels; do
            echo "--- $level"
            node tools/analyze.mjs "$level"
          done
```

The `test -n` guard matters: without it, a discovery bug that returns nothing would make this step pass while checking nothing.

- [ ] **Step 2: Verify the discovery command locally**

```bash
node -e "import('./src/world/levels.js').then(m => console.log(Object.keys(m.LEVELS).join(' ')))"
```

Expected: `loop-01 probe-01`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/gate.yml
git commit -m "CI: run the design asserts on every level, not a hardcoded two"
```

---

### Task 8: Level 1 — teach the turn

**Files:** Modify `src/world/levels.js`

Starting candidate, premise-verified during planning. **It is a starting point, not the answer** — spec §3 requires the level be shaped for the picture and then verified, because a layout can satisfy every assert and still be visually meaningless. That already happened once here: `loop-01`'s first design was algebraically correct and rendered as one line walked twice.

Candidate: a five-cell ground walkway plus a three-cell tower beside it.
Measured: `flatSolvableTurns: []`, 1 turn, 3 walks, 1 illusion walk, opens with a walk, `standablePerTurn: [6,5,6,6]`.

- [ ] **Step 1: Add the level**

```js
/**
 * ledge-01 — the level that teaches the turn.
 *
 * A walkway you can see the whole of, and a tower whose top is not reachable
 * from it. Walking is exhausted after two steps; the only thing left to try is
 * Q or E, and after one quarter turn the tower top aliases into reach.
 */
function ledge01() {
  const cells = [];
  for (let i = 0; i <= 4; i++) cells.push([i, 0, 0]);      // ground walkway
  for (let j = 0; j <= 2; j++) cells.push([0, j, 1]);      // the tower
  return {
    name: 'ledge-01',
    cells,
    start: [0, 0, 0],
    goal: [0, 2, 1],
    premise: { turn: true, illusion: true, minWalks: 3, openWithWalk: true },
  };
}
```

and register it: `'ledge-01': ledge01(),`

- [ ] **Step 2: Verify the premise holds**

```bash
node tools/analyze.mjs ledge-01; echo "exit=$?"
npm test
```

Expected: `exit=0`, `"requiresTurn": true`, `"flatSolvableTurns": []`, route opening with a walk.

- [ ] **Step 3: Look at it**

```bash
npm run dev
```

Open `http://127.0.0.1:5173/?level=ledge-01`, play it with arrows/WASD and Q/E. **Judge the picture, not the numbers.** If it does not read as architecture, change the cells and return to Step 2. Iterate here rather than accepting the first thing that passes.

- [ ] **Step 4: Commit**

```bash
git add src/world/levels.js
git commit -m "level: ledge-01, the level that teaches the turn"
```

---

### Task 9: Level 2 — interleave

**Files:** Modify `src/world/levels.js`

Candidate measured during planning: ground walkway + tower + upper walkway, 11 cells, `flatSolvableTurns: []`, 2 turns, 6 walks, 2 illusion walks, opens with a walk, `standablePerTurn: [9,8,9,8]`.

- [ ] **Step 1: Add the level**

```js
/**
 * ascent-02 — walking and turning interleave.
 *
 * No single rotation contains a complete path. The tower is reachable from the
 * ground only at one turn, and the upper walkway only from the tower at
 * another, so the route is walk, turn, walk, turn, walk.
 */
function ascent02() {
  const cells = [];
  for (let i = 0; i <= 4; i++) cells.push([i, 0, 0]);      // ground walkway
  for (let j = 0; j <= 2; j++) cells.push([0, j, 1]);      // the tower
  for (let i = 0; i <= 2; i++) cells.push([i, 3, 0]);      // upper walkway
  return {
    name: 'ascent-02',
    cells,
    start: [0, 0, 0],
    goal: [2, 3, 0],
    premise: { turn: true, illusion: true, minWalks: 5, openWithWalk: true },
  };
}
```

and register it.

- [ ] **Step 2: Verify**

```bash
node tools/analyze.mjs ascent-02; echo "exit=$?"
npm test
```

Expected: `exit=0`, `turnsInRoute` ≥ 2, `flatSolvableTurns: []`.

- [ ] **Step 3: Play it, then iterate on the picture as in Task 8 Step 3**

- [ ] **Step 4: Commit**

---

### Task 10: Level 3 — occlusion carries the puzzle

**Files:** Modify `src/world/levels.js`

No pre-verified candidate. This one is designed from the mechanic: a platform that is **not standable at some rotations** because another cell aliases in front of it, so rotating genuinely creates and destroys ground. Add decoy branches that lead nowhere, so the level cannot be solved by walking every direction blindly.

- [ ] **Step 1: Design against the analyser before drawing anything**

Iterate cells → `node tools/analyze.mjs <name>` until:
- `flatSolvableTurns: []`
- `turnsInRoute` ≥ 2
- `perRotation[].standable` varies by at least 2 between rotations (occlusion doing real work)
- the route opens with a walk

- [ ] **Step 2: Declare and verify**

```js
premise: { turn: true, illusion: true, minWalks: 5, openWithWalk: true },
```

```bash
node tools/analyze.mjs <name>; echo "exit=$?"
npm test
```

- [ ] **Step 3: Play it. Confirm the decoys actually mislead and the level is solvable by a human, not just by BFS**

- [ ] **Step 4: Commit**

---

### Task 11: Plates for the three levels, and the gate

**Files:** Modify `src/dev/shots.js`

- [ ] **Step 1: Add one plate per level**

Each declares its level and frames it at turn 0 — the state it opens in, which `openWithWalk` guarantees is playable rather than stuck. Add to the returned object in `makeShots`, and note that `plate(0, ...)` already reads `world().level.cells`, so nothing level-specific is hardcoded:

```js
    ledge01: Object.assign(plate(0, { fillY: 0.72, fillX: 0.84, liftY: 0.025 }),
      { level: 'ledge-01' }),
    ascent02: Object.assign(plate(0, { fillY: 0.74, fillX: 0.84, liftY: 0.025 }),
      { level: 'ascent-02' }),
    // third level's plate, named to match
```

- [ ] **Step 2: Capture and eyeball all twelve**

```bash
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/pen-12 --port=5199
```

Expected: `"ok": true`, 12 PNGs, and each new shot's `level` recorded in `report.json`. **Open the three new PNGs.** A plate showing the wrong level, or an empty frame, is the failure mode here and no number will report it.

- [ ] **Step 3: Run the gate**

```bash
npm run gate
```

Expected: `[gate] PASS`, `identical: true` across 12 shots.

- [ ] **Step 4: Measure the CI cost under CI's conditions, not this machine's**

Per `METHODOLOGY.md`, the structural budget held exactly through a 20× wall-clock regression, so a timing from a GPU machine is not evidence about CI.

`tools/_browser.mjs` has **no** switch for this today — `captureArgs()` hardcodes `--use-angle=metal` on macOS. Add one, since reproducing CI locally is a recurring need this repo has already paid for twice. In `tools/_browser.mjs`, after `const isMac = ...`:

```js
/**
 * Force a software rasteriser, to reproduce CI locally.
 *
 * CI has no GPU and rasterises via SwiftShader. METHODOLOGY.md records a 20x
 * wall-clock regression that three profiler runs on this machine could not see,
 * because it counts objects rather than the cost of rasterising them. A perf
 * claim measured on a GPU is not evidence about CI.
 */
const forceSoftware = process.env.PENROSE_GL === 'swiftshader';

/** The GPU backend flags, or the software rasteriser when forced. */
const glArgs = () =>
  forceSoftware ? ['--use-gl=swiftshader'] : isMac ? ['--use-angle=metal'] : [];
```

Then use `...glArgs()` in place of the inline `...(isMac ? [...] : [])` in **both** `captureArgs()` and `profileArgs()`.

```bash
PENROSE_GL=swiftshader OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/pen-sw --port=5199
```

Record wall-clock per shot and the projected gate total. The spec predicts ~+70s for 9 → 12 shots against a 30-minute timeout; **report the measured number, and say so plainly if it disagrees.**

- [ ] **Step 4b: Prove the switch is inert when unset**

Default behaviour must be byte-identical, or this measurement tool has changed the thing it measures.

```bash
npm run gate
```

Expected: `[gate] PASS`, `identical: true`. Commit `tools/_browser.mjs` with this task.

- [ ] **Step 5: Commit**

```bash
git add src/dev/shots.js tools/_browser.mjs
git commit -m "shots: one plate per new level, captured against its own level

Also adds PENROSE_GL=swiftshader to _browser.mjs so CI's rasteriser can be
reproduced locally. Inert when unset -- gate verified identical."
```

---

### Task 12: Record what happened

**Files:** Modify `METHODOLOGY.md`

- [ ] **Step 1: Add a dated section**

Follow the existing house style: what was measured, what was wrong, what still is. It must state:

- `loop-01` was solvable in one move with zero turns, and `requiresRotation` meant "some rotations work and some do not" — so the mechanic was asserted by CI and load-bearing in nothing.
- The turn-edge rule that looked right was wrong, and why `src/player:366` settled it.
- Feasibility numbers: 797 two-leg layouts requiring a turn, 19,021 three-leg layouts with no flat solution, and that most of them open with a turn — which is where `openWithWalk` came from.
- The measured CI delta from Task 11 Step 4, whatever it turned out to be.
- Anything still open.

- [ ] **Step 2: Full verification before opening the PR**

```bash
npm test
for l in $(node -e "import('./src/world/levels.js').then(m=>console.log(Object.keys(m.LEVELS).join(' ')))"); do node tools/analyze.mjs "$l" || echo "FAILED: $l"; done
npx vite build
npm run gate
```

Expected: all exit 0; gate `identical: true`.

- [ ] **Step 3: Commit and push**

```bash
git add METHODOLOGY.md
git commit -m "docs: record the rotation-routing phase"
git push -u origin feat/levels-rotation-routing
```

- [ ] **Step 4: Open the PR and confirm CI by the reliable route**

`gh run watch --exit-status` is unreliable here. Use:

```bash
gh pr create --fill
gh run view --json status,conclusion
```

Expected: `"conclusion": "success"`.

---

## Definition of done

- [ ] `npm test` passes in full, unscoped
- [ ] `analyze` exits 0 for all five levels, and its guard was proven able to fail
- [ ] `npm run gate` reports `identical: true` across 12 shots
- [ ] The 9 pre-existing shots were proven unmoved by the harness change (`maxDelta: 0`)
- [ ] CI gate wall-clock measured under SwiftShader and recorded
- [ ] Three levels exist that cannot be solved without turning, and a human has played each
