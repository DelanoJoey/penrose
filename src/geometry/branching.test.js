import test from 'node:test';
import assert from 'node:assert/strict';

import { Structure } from './index.js';
import { LEVELS, ORDER } from '../world/levels.js';

/**
 * A FORK is a position where two different neighbours each STRICTLY reduce the
 * remaining walks to the goal, so the player must pick and neither pick is
 * forced.
 *
 * The definition is the whole value of the metric and it is narrower than it
 * looks. A first pass counted positions whose neighbours merely DIFFER in
 * remaining cost and reported 173 of 358 for the shipping campaign, where the
 * honest answer is 1 -- because on a corridor you may always also walk
 * backwards, and that is not a decision. A metric that counts corridors as
 * decisions would aim level selection somewhere worse than turn count already
 * does.
 */

test('a corridor has no forks', () => {
  // A straight run of standable cells: every position offers forward, back, or
  // both, and only one of the two ever reduces the distance to the goal.
  const s = new Structure([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]]);
  const b = s.branching([0, 0, 0], [0, 0, 3]);
  assert.equal(b.forks, 0);
  assert.ok(b.positions > 0, 'the fixture has no standable positions at all');
});

test('the campaign contains exactly one fork', () => {
  // Measured across all NINE levels: 402 positions, one fork, in post-05.
  //
  // It was 358 across eight before `teach-01`, which adds 44 positions and no
  // fork — a forced corridor on purpose, because a level teaching one thing
  // must not also ask the player to choose. The fork count standing still while
  // the campaign grows is the number the next content phase exists to move.
  let positions = 0;
  let forks = 0;
  for (const name of ORDER) {
    const L = LEVELS[name];
    const b = new Structure(L.cells).branching(L.start, L.goal);
    positions += b.positions;
    forks += b.forks;
  }
  assert.equal(positions, 402);
  assert.equal(forks, 1);
});

test('branching agrees with minWalksBetween on every campaign cell', () => {
  // branching() takes cost-to-goal from ONE breadth-first search over the union
  // of the four rotations' path graphs, rather than one minWalksBetween per
  // cell. Turns are free -- the same decision, for the same reason -- so the
  // two must agree exactly. This is the one place the metric could silently
  // disagree with the number the move budget rests on.
  for (const name of ORDER) {
    const L = LEVELS[name];
    const s = new Structure(L.cells);
    const costs = s.branching(L.start, L.goal).costs;
    for (const [id, viaUnion] of costs) {
      const viaDijkstra = s.minWalksBetween(id.split(',').map(Number), L.goal);
      assert.equal(viaUnion, viaDijkstra,
        `${name} ${id}: union graph says ${viaUnion}, minWalksBetween says ${viaDijkstra}`);
    }
  }
});

test('an unreachable goal reports null rather than zero', () => {
  const s = new Structure([[0, 0, 0], [9, 0, 9]]);
  assert.equal(s.branching([0, 0, 0], [9, 0, 9]), null);
});
