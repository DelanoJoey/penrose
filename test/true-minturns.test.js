import test from 'node:test';
import assert from 'node:assert/strict';
import { Structure, cellId } from '../src/geometry/index.js';
import { LEVELS, ORDER } from '../src/world/levels.js';

/**
 * THE CAMPAIGN CURVE IS BUILT ON A NUMBER THAT WAS NEVER A MINIMUM.
 *
 * `ORDER`'s docstring says the curve is "the measured `minTurns` of each level:
 * 0, 1, 2, 3, 4, 5, 6" and that each is "the MEASURED turnsInRoute for that
 * level's start/goal pair, never a slack bound."
 *
 * `turnsInRoute` is not a minimum. `findRoute` is a BFS in which a walk and a
 * turn are one edge each, so it minimises KEYPRESSES and, among equally short
 * routes, returns whichever it reached first. `perch-05` has two 15-input
 * routes — one using 5 turns, one using 3 — and BFS returns the 5.
 *
 * `levels.test.js` asserts `turnsInRoute >= minTurns`, which is slack in the
 * direction that lets an OVERSTATEMENT through: 5 >= 5 passes while the level
 * genuinely requires 3. The ORDER docstring identifies this exact failure mode
 * in the other direction only — "declaring 4 on a route that takes 6" — and the
 * premise system was built to close that half of it.
 */

const declared = (name) => LEVELS[name].premise?.minTurns;

test('every declared minTurns is at least achievable', () => {
  // The half the existing assertion already covers, restated against the true
  // minimum rather than against one arbitrary route.
  for (const name of ORDER) {
    const d = declared(name);
    if (d == null) continue;
    const L = LEVELS[name];
    const exact = new Structure(L.cells).minTurnsBetween(L.start, L.goal);
    assert.ok(exact != null, `${name} is unreachable`);
    assert.ok(d >= exact,
      `${name} declares minTurns ${d} but no route can do better than ${exact} — ` +
      'the declaration is below the true minimum, which is the failure ORDER already warned about');
  }
});

test('minTurnsBetween never exceeds what findRoute actually achieved', () => {
  // A minimum that is larger than an achieved route is not a minimum. This is
  // the negative control on the search itself.
  for (const name of ORDER) {
    const L = LEVELS[name];
    const st = new Structure(L.cells);
    const p = st.premise(L.start, L.goal);
    assert.ok(p.minTurnsExact <= p.turnsInRoute,
      `${name}: minTurnsExact ${p.minTurnsExact} exceeds an achieved route of ${p.turnsInRoute} — ` +
      'the turn-minimising search is wrong');
  }
});

/**
 * THE STRONGER CLAIM, which replaces the pinned defect rather than deleting it.
 *
 * This test used to read `PINNED: perch-05 declares more turns than it
 * requires`, and its own note said: when this is fixed, replace it with
 * `declared === exact` for every level, and do not delete it — because deleting
 * it removes the only thing standing between the campaign curve and a number
 * nobody measured.
 *
 * `perch-05` is fixed by replacement: it could not honestly fill the 5 slot (no
 * start/goal pair on that figure has a true minimum above 4), so `post-05` took
 * it. There is no exception left to pin.
 */
test('EVERY level declares exactly its true minimum — no exceptions', () => {
  const wrong = [];
  for (const name of ORDER) {
    const d = declared(name);
    if (d == null) continue;
    const L = LEVELS[name];
    const exact = new Structure(L.cells).minTurnsBetween(L.start, L.goal);
    if (exact !== d) wrong.push(`${name} declares ${d}, requires ${exact}`);
  }
  assert.deepEqual(wrong, [],
    'a level is reporting a routing artifact rather than its own difficulty. Do not ' +
    'weaken this assertion to accommodate it — either re-aim the level or replace ' +
    'the figure, which is what perch-05 needed.');
});

test('the campaign curve is non-decreasing in TRUE turns, not in declared ones', () => {
  // The curve was 0,1,2,3,4,3,6 for four phases while every test passed, because
  // campaign.test.js checks the DECLARED minTurns and the declaration was the
  // thing that was wrong. Measuring it here closes that loop.
  const exact = ORDER.map((n) => {
    const L = LEVELS[n];
    return new Structure(L.cells).minTurnsBetween(L.start, L.goal);
  });
  for (let i = 1; i < exact.length; i++) {
    assert.ok(exact[i] >= exact[i - 1],
      `${ORDER[i]} truly requires ${exact[i]} turns but ${ORDER[i - 1]} requires ` +
      `${exact[i - 1]} — the curve goes backwards: [${exact.join(', ')}]`);
  }
});

test('the goal is visible in the rotation the level opens in', () => {
  // perch-05 shipped with an occluded goal and nothing noticed. Its goal sat at
  // the circuit's closure point, and a closed circuit's far end aliases that
  // point while sitting IN FRONT of it — so the marker drew nothing and the
  // player was sent somewhere they could not see. It was the only level where
  // that was true, and it is a property no premise assertion covers: the level
  // is perfectly solvable, and the picture is what is wrong.
  const blind = [];
  for (const name of ORDER) {
    const L = LEVELS[name];
    const st = new Structure(L.cells);
    const visible = st.standable(0).some((c) => cellId(...c) === cellId(...L.goal));
    if (!visible) blind.push(name);
  }
  assert.deepEqual(blind, [],
    'a campaign level opens with its goal hidden behind the figure');
});
