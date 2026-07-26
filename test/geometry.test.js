import test from 'node:test';
import assert from 'node:assert/strict';
import {
  screenKey, screenId, depth, rotateY, cellId,
  SCREEN_DELTA, Structure,
} from '../src/geometry/index.js';

// ---------------------------------------------------------------- projection

test('the view direction collapses: (x,y,z) and (x+t,y+t,z+t) share a screen position', () => {
  for (const [x, y, z] of [[0, 0, 0], [3, -2, 7], [-5, 4, 1]]) {
    const base = screenKey(x, y, z);
    for (const t of [-9, -1, 1, 4, 12]) {
      assert.deepEqual(screenKey(x + t, y + t, z + t), base,
        `t=${t} moved (${x},${y},${z}) off its own screen position`);
    }
  }
});

test('cells NOT on the view diagonal occupy different screen positions', () => {
  const seen = new Map();
  for (let x = -3; x <= 3; x++)
    for (let y = -3; y <= 3; y++)
      for (let z = -3; z <= 3; z++) {
        const id = screenId(x, y, z);
        if (!seen.has(id)) { seen.set(id, [x, y, z]); continue; }
        // Any collision must be a pure (t,t,t) offset — nothing else may alias.
        const [px, py, pz] = seen.get(id);
        const dx = x - px, dy = y - py, dz = z - pz;
        assert.equal(dx, dy, `collision at ${id} is not a (t,t,t) offset`);
        assert.equal(dy, dz, `collision at ${id} is not a (t,t,t) offset`);
      }
});

test('screen lattice is a checkerboard: a + b is always even', () => {
  for (let x = -4; x <= 4; x++)
    for (let y = -4; y <= 4; y++)
      for (let z = -4; z <= 4; z++) {
        const [a, b] = screenKey(x, y, z);
        // Math.abs, because (-6 % 2) is -0 in JS and strict equality
        // distinguishes -0 from 0. Evenness is the property under test.
        assert.equal(Math.abs((a + b) % 2), 0, `(${x},${y},${z}) left the lattice`);
      }
});

test('the Penrose identity: "east and up" is indistinguishable from "north"', () => {
  // +x then +y  ==  -z, on screen.
  const sum = [
    SCREEN_DELTA['+x'][0] + SCREEN_DELTA['+y'][0],
    SCREEN_DELTA['+x'][1] + SCREEN_DELTA['+y'][1],
  ];
  assert.deepEqual(sum, SCREEN_DELTA['-z']);

  // And concretely, on actual coordinates.
  const [x, y, z] = [2, 5, -1];
  assert.deepEqual(screenKey(x + 1, y + 1, z), screenKey(x, y, z - 1));
});

test('depth orders occlusion along the view axis', () => {
  assert.ok(depth(4, 3, 3) > depth(1, 0, 0));
  // Cells sharing a screen position can never tie: they differ by 3t.
  assert.equal(depth(4, 3, 3) - depth(1, 0, 0), 9);
});

// ---------------------------------------------------------------- rotation

test('rotateY is order 4 and returns to identity', () => {
  const p = [3, 1, -2];
  assert.deepEqual(rotateY(p, 0), p);
  assert.deepEqual(rotateY(p, 4), p);
  assert.deepEqual(rotateY(p, -1), rotateY(p, 3));
  assert.notDeepEqual(rotateY(p, 1), p);
});

test('rotateY preserves height', () => {
  for (let t = 0; t < 4; t++) assert.equal(rotateY([5, 7, -3], t)[1], 7);
});

// ---------------------------------------------------------------- structure

test('occluded cells are not standable', () => {
  // Both sit at screen position (1,1); the deeper one is hidden behind the other.
  const s = new Structure([[1, 0, 0], [4, 3, 3]]);
  assert.deepEqual(screenKey(1, 0, 0), screenKey(4, 3, 3));

  const stand = s.standable(0).map((c) => cellId(...c));
  assert.deepEqual(stand, ['4,3,3'], 'the frontmost cell should be the visible one');
});

test('a cell with something on top of it is not standable', () => {
  const s = new Structure([[0, 0, 0], [0, 1, 0]]);
  const stand = s.standable(0).map((c) => cellId(...c));
  assert.ok(!stand.includes('0,0,0'));
  assert.ok(stand.includes('0,1,0'));
});

test('visual adjacency creates an edge between cells 10 apart in 3D', () => {
  const s = new Structure([[0, 0, 0], [4, 3, 3]]);
  const graph = s.pathGraph(0);

  assert.deepEqual(graph.get('0,0,0'), ['4,3,3']);
  assert.deepEqual(graph.get('4,3,3'), ['0,0,0']);

  const impossible = s.impossibleEdges(0);
  assert.equal(impossible.length, 2, 'the edge should be flagged in both directions');
  assert.equal(impossible[0].manhattan, 10);
});

test('an ordinary adjacent pair produces NO impossible edge', () => {
  const s = new Structure([[0, 0, 0], [1, 0, 0]]);
  assert.deepEqual(s.impossibleEdges(0), [],
    'a real neighbour must not be reported as an illusion');
});

test('findPath traverses an impossible edge', () => {
  const s = new Structure([[0, 0, 0], [4, 3, 3]]);
  assert.deepEqual(s.findPath([0, 0, 0], [4, 3, 3], 0), ['0,0,0', '4,3,3']);
});

test('findPath returns null when unreachable', () => {
  const s = new Structure([[0, 0, 0], [20, 0, 0]]);
  assert.equal(s.findPath([0, 0, 0], [20, 0, 0], 0), null);
});

test('findPath returns null for a cell that is not standable', () => {
  const s = new Structure([[0, 0, 0], [0, 1, 0]]);
  assert.equal(s.findPath([0, 0, 0], [0, 1, 0], 0), null);
});

// ---------------------------------------------------------------- rotation rewires

test('rotation rewires connectivity — the core mechanic', () => {
  // (0,0,0) and (4,3,3) coincide on screen only in the unrotated view.
  const s = new Structure([[0, 0, 0], [4, 3, 3]]);
  const connectedAt = [0, 1, 2, 3].map((t) => (s.pathGraph(t).get('0,0,0') ?? []).length);
  assert.ok(connectedAt[0] > 0, 'should connect unrotated');
  assert.ok(connectedAt.some((n) => n === 0),
    'some rotation must break the connection, or rotation is not a mechanic');
});

test('solvability reports which rotations work and whether rotation matters', () => {
  const s = new Structure([[0, 0, 0], [4, 3, 3]]);
  const r = s.solvability([0, 0, 0], [4, 3, 3]);
  assert.equal(r.solvable, true);
  assert.ok(r.solvableTurns.includes(0));
  assert.equal(r.requiresRotation, true);
  assert.equal(r.perTurn.length, 4);
});

// ---------------------------------------------------------------- determinism

test('graph construction is deterministic across repeated builds', () => {
  const cells = [];
  for (let i = 0; i < 12; i++) cells.push([i, i % 3, (i * 5) % 7]);
  const s = new Structure(cells);

  const snapshot = () => JSON.stringify([0, 1, 2, 3].map((t) => [...s.pathGraph(t)]));
  const first = snapshot();
  for (let i = 0; i < 5; i++) {
    assert.equal(snapshot(), first, 'graph output drifted between identical builds');
  }
});

test('impossibleEdges output is stably ordered', () => {
  const cells = [[0, 0, 0], [4, 3, 3], [1, 0, 0], [5, 4, 4], [-2, 0, 1]];
  const s = new Structure(cells);
  const a = JSON.stringify(s.impossibleEdges(0));
  const b = JSON.stringify(new Structure([...cells].reverse()).impossibleEdges(0));
  assert.equal(a, b, 'edge order must not depend on input order');
});
