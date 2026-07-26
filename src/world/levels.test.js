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
    if (d.minTurns != null) assert.ok(p.turnsInRoute >= d.minTurns,
      `${name} declares minTurns: ${d.minTurns} but the route has ${p.turnsInRoute}`);
    if (d.openWithWalk) assert.equal(p.route[0]?.kind, 'walk');
  });
}
