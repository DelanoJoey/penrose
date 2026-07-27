import test from 'node:test';
import assert from 'node:assert/strict';
import { Structure } from '../src/geometry/index.js';
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
 * PINNED DEFECT, in the style this repo already uses for the hole detector.
 *
 * `perch-05` declares 5 and requires 3. This is asserted rather than fixed
 * because closing it is a DESIGN decision, not a mechanical correction:
 *
 *   - re-declaring it at 3 makes the curve 0,1,2,3,4,3,6, which is no longer
 *     non-decreasing and breaks what ORDER claims about the campaign;
 *   - no start/goal pair on perch-05 has a true minimum of 5 — searched
 *     exhaustively over all 18x17 pairs, and the highest the figure supports
 *     anywhere is 4 — so the level CANNOT honestly fill the 5 slot;
 *   - filling it needs a different figure, and P8 left 1,255 augmented shapes
 *     at exactly 4 turns and 104 at 5 unexplored in `tools/search.mjs`.
 *
 * WHEN THIS IS FIXED, THIS TEST MUST BE REPLACED WITH THE STRONGER CLAIM —
 * `declared === exact` for every level — and not deleted. Deleting it removes
 * the only thing standing between the campaign curve and a number nobody
 * measured.
 */
test('PINNED: perch-05 declares more turns than it requires', () => {
  const L = LEVELS['perch-05'];
  const st = new Structure(L.cells);
  const p = st.premise(L.start, L.goal);

  assert.equal(declared('perch-05'), 5, 'perch-05 no longer declares 5 — re-derive this fixture');
  assert.equal(p.turnsInRoute, 5, 'findRoute no longer returns the 5-turn tie-break');
  assert.equal(p.minTurnsExact, 3,
    'perch-05 true minimum moved. If it is now 5, the defect is FIXED — replace this test with ' +
    'the stronger claim (declared === exact for every level) rather than deleting it.');
});

test('every OTHER level declares exactly its true minimum', () => {
  // The stronger claim, already true everywhere except the pinned level. If
  // perch-05 is ever fixed, fold it in here and delete the fixture above.
  for (const name of ORDER) {
    if (name === 'perch-05') continue;
    const d = declared(name);
    if (d == null) continue;
    const L = LEVELS[name];
    const exact = new Structure(L.cells).minTurnsBetween(L.start, L.goal);
    assert.equal(exact, d,
      `${name} declares minTurns ${d} but its true minimum is ${exact} — the campaign curve ` +
      'is reporting a routing artifact, not the level');
  }
});
