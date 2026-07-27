import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Structure, cellId, parseCell, screenId, screenKey, HORIZONTAL_STEPS,
} from '../src/geometry/index.js';
import { LEVELS, ORDER } from '../src/world/levels.js';

/**
 * THE PROPERTIES THAT MAKE teach-00 TEACH, AS ASSERTIONS.
 *
 * Every existing test on a level proves it is SOLVABLE and that its declared
 * premise matches its geometry. None of them can tell a level that teaches the
 * rule from one that merely has a route, and the difference is the entire
 * reason this level exists — the campaign already had seven solvable levels
 * when a player spent an hour failing to infer the rule from them.
 *
 * So each filter that tools/teach.mjs applied to FIND this level is re-applied
 * here to KEEP it. A later edit that moves the start two cells, lengthens the
 * bar, or nudges the figure would leave the level solvable, leave analyze.mjs
 * green, and silently destroy the thing it was built for.
 *
 * The counts in these assertions are read from the level's own `teaches`
 * declaration rather than hard-coded, so the level stays the single source of
 * truth and a deliberate redesign updates one place.
 */

const NAME = 'teach-00';
const L = LEVELS[NAME];
const st = new Structure(L.cells);
const T = L.teaches;

const manhattan = (a, b) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** The far object: cells not 6-connected to the one carrying the start. */
function componentOf(cells, seed) {
  const solid = new Set(cells.map((c) => cellId(...c)));
  const seen = new Set([cellId(...seed)]);
  const q = [cellId(...seed)];
  while (q.length) {
    const [x, y, z] = parseCell(q.shift());
    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const n = cellId(x + dx, y + dy, z + dz);
      if (solid.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  return seen;
}

test(`${NAME} declares what it teaches`, () => {
  assert.ok(T, `${NAME} must declare a \`teaches\` block — the guards below read it`);
  for (const k of ['runUp', 'pivot', 'landing', 'after']) {
    assert.ok(T[k] != null, `${NAME}.teaches.${k} is missing`);
  }
});

test(`${NAME} opens the campaign`, () => {
  // A teaching level that is not first teaches nobody. This is the whole
  // point of the phase and it is one line in ORDER away from being undone.
  assert.equal(ORDER[0], NAME);
});

test(`${NAME} needs no rotation — it teaches ONE rule`, () => {
  const p = st.premise(L.start, L.goal);
  assert.equal(p.requiresTurn, false);
  assert.equal(p.turnsInRoute, 0,
    'the route turns, so the player must learn rotation AND screen-adjacency at once');
  assert.equal(st.minTurnsBetween(L.start, L.goal), 0);
});

test(`${NAME}: the run-up is ${'`'}teaches.runUp${'`'} ORDINARY walks, then the crossing`, () => {
  // If the crossing came first, the player would meet the illusion before
  // learning that walking works, and would have nothing to contrast it with.
  const route = st.premise(L.start, L.goal).route;
  const steps = route.map((m) => ({
    ...m, jump: manhattan(parseCell(m.from), parseCell(m.to)),
  }));
  assert.ok(steps.every((s) => s.kind === 'walk'), 'the route contains a turn');

  const firstIllusion = steps.findIndex((s) => s.jump > 1);
  assert.equal(firstIllusion, T.runUp,
    `the gap arrives after ${firstIllusion} ordinary walks, not the declared ${T.runUp}`);
  assert.equal(steps.filter((s) => s.jump > 1).length, 1,
    'more than one illusion crossing — the lesson should be a single unambiguous event');
  assert.equal(steps.length, T.runUp + 1 + T.after);
  assert.equal(steps[firstIllusion].from, cellId(...T.pivot));
  assert.equal(steps[firstIllusion].to, cellId(...T.landing));
});

test(`${NAME}: the crossing CANNOT be walked around`, () => {
  // The property the whole level rests on. Remove the one edge and the goal
  // must become unreachable at turn 0 — otherwise a player can reach the goal
  // without ever making the move the level exists to demonstrate.
  const from = cellId(...T.pivot), to = cellId(...T.landing);
  const graph = st.pathGraph(0);
  const banned = new Set([`${from}>${to}`, `${to}>${from}`]);
  const start = cellId(...L.start), goal = cellId(...L.goal);

  const seen = new Set([start]);
  const q = [start];
  let reached = false;
  while (q.length) {
    const cur = q.shift();
    if (cur === goal) { reached = true; break; }
    for (const n of graph.get(cur) ?? []) {
      if (banned.has(`${cur}>${n}`) || seen.has(n)) continue;
      seen.add(n); q.push(n);
    }
  }
  assert.equal(reached, false,
    'the goal is reachable without the illusion crossing — the level can be solved ' +
    'without ever learning the rule, which is exactly how loop-01 failed');
});

test(`${NAME}: the walkable surface ENDS at the pivot`, () => {
  // The player must arrive somewhere that offers nothing except the crossing.
  // With an alternative on offer they can wander instead of being taught, and
  // wandering on an unstated rule is the reported failure this level answers.
  const neighbours = st.pathGraph(0).get(cellId(...T.pivot)) ?? [];
  const route = st.premise(L.start, L.goal).route;
  const arrivedFrom = route[T.runUp - 1].from;
  const forward = neighbours.filter((n) => n !== arrivedFrom);
  assert.deepEqual(forward, [cellId(...T.landing)],
    `the pivot offers ${forward.length} onward moves; a teaching level must offer one`);
});

test(`${NAME}: the goal sits on a SEPARATE object`, () => {
  // Two 3D components, not one. A spur grown off the figure is the same solid,
  // and stepping along your own solid teaches nothing — which is why
  // tools/search.mjs, whose spurs are attached by construction, could not
  // produce this level.
  const home = componentOf(L.cells, L.start);
  assert.equal(home.has(cellId(...L.goal)), false,
    'the goal is part of the same connected solid the player starts on');
  assert.equal(home.has(cellId(...T.landing)), false);
  assert.ok(manhattan(T.pivot, T.landing) > 1, 'the crossing is not an illusion edge');
});

/**
 * How the two objects sit in the PICTURE, which is a different question from
 * how they sit in space and is not answered by any 3D property.
 *
 * Counts every cell, standable or not: the renderer draws them all, so a cell
 * the player can never stand on still decides what the player sees.
 */
function pictureRelation(cells, farSeed) {
  const far = componentOf(cells, farSeed);
  const nearScreen = new Set(cells
    .filter((c) => !far.has(cellId(...c)))
    .map((c) => screenId(...c)));
  const farCells = [...far].map(parseCell);
  return {
    overlaps: farCells.filter((c) => nearScreen.has(screenId(...c))).map((c) => cellId(...c)),
    contacts: farCells.reduce((n, c) => {
      const [a, b] = screenKey(...c);
      return n + HORIZONTAL_STEPS.filter(([da, db]) => nearScreen.has(`${a + da},${b + db}`)).length;
    }, 0),
  };
}

test(`${NAME}: the two objects do not overlap, and touch ONCE, in the picture`, () => {
  // Cross-component is not the same as "reads as two objects" — see the pinned
  // negative control below for the figure that proved it.
  const { overlaps, contacts } = pictureRelation(L.cells, T.landing);
  assert.deepEqual(overlaps, [],
    'a far-object cell occludes the figure — it replaces the figure in the picture ' +
    'instead of adding to it');
  assert.equal(contacts, 1,
    `the objects touch at ${contacts} screen points; one keeps the touch reading as a ` +
    'coincidence rather than as a joint');
});

/**
 * PINNED NEGATIVE CONTROL, in the style holes.test.js already uses.
 *
 * This is the real figure that topped the FIRST shortlist tools/teach.mjs
 * produced, before the picture-level filters existed. It is a tribar of side 4
 * with a three-cell bar at (10,9,9). Every 3D filter passes: the bar is a
 * separate component, the crossing is forced, the route has a four-walk run-up.
 *
 * And it is unusable. The bar's screen cells are 1,1 / 2,2 / 3,3 — exactly the
 * tribar's own bottom leg — sitting 27 depth units in front of it. The plate is
 * an ordinary tribar whose bottom leg happens to be a separate floating object.
 * Nothing that looks impossible is on screen, which is the entire defect the
 * teaching level exists to fix.
 *
 * Kept as an assertion because the property it violates is invisible to every
 * other test in this repository, and because it is the concrete evidence for
 * why the check above counts pixels rather than cells.
 */
test('PINNED: the occluding candidate is rejected on its picture, not its geometry', () => {
  const cells = [
    [0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0],
    [4,1,0],[4,2,0],[4,3,0],[4,4,0],
    [4,4,1],[4,4,2],[4,4,3],[4,4,4],
    [10,9,9],[11,9,9],[12,9,9],
  ];
  const st2 = new Structure(cells);

  // The 3D premise is sound — this is what made it top the shortlist.
  const p = st2.premise([4, 4, 4], [12, 9, 9]);
  assert.equal(p.solvable, true);
  assert.equal(p.requiresTurn, false);
  assert.equal(p.usesIllusion, true);

  // The picture is not.
  const { overlaps } = pictureRelation(cells, [10, 9, 9]);
  assert.deepEqual(overlaps.sort(), ['10,9,9', '11,9,9', '12,9,9'],
    'this figure no longer occludes — re-derive the fixture, do not delete it');
});

test(`${NAME}: every route cell is somewhere the player can actually see`, () => {
  // standable() already requires frontmost, so this is a restatement — but the
  // failure it guards is a level that asks the player to walk onto a platform
  // hidden behind the figure, which is unplayable rather than merely hard.
  const stand = new Set(st.standable(0).map((c) => cellId(...c)));
  for (const m of st.premise(L.start, L.goal).route) {
    assert.equal(stand.has(m.to), true, `route steps onto ${m.to}, which is not visible`);
  }
});
