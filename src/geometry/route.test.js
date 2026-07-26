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
  const s = new Structure([[0, 0, 0], [0, 40, 0]]);
  assert.equal(s.findRoute([0, 0, 0], [0, 40, 0]), null);
});

test('turning is legal FROM a cell that is not standable in the current rotation', () => {
  // THE decisive control for the turn-edge rule. Under the "standable in both
  // rotations" rule this returns null and the test fails.
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

  const route = s.findRoute([0, 0, 0], lv.goal, 0);
  assert.ok(route, 'a stranded start must still route — turning is never blocked');
  assert.equal(route[0].kind, 'turn');
  assert.equal(route.length, 4);
});

test('findRoute reaches a goal that NO single rotation can reach', () => {
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
