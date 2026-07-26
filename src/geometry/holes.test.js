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

// ------------------------------------------------ POSITIVE: reads impossible

test('a tribar encloses a hole, and it grows with the figure', () => {
  assert.equal(holes(legs([['+x', 3], ['+y', 3], ['+z', 3]])), 1);
  assert.equal(holes(legs([['+x', 4], ['+y', 4], ['+z', 4]])), 3);
  assert.equal(holes(legs([['+x', 5], ['+y', 5], ['+z', 5]])), 6);
});

test('the shipping levels that read as impossible all enclose a hole', () => {
  assert.equal(holes(LEVELS['spur-01'].cells), 1);
  assert.equal(holes(LEVELS['shelf-03'].cells), 6);
});

// ------------------------------------------------ NEGATIVE CONTROLS
// A detector that only ever answers "hole" proves nothing. Both figures below
// close on screen, carry illusion edges, and RENDERED AS ORDINARY SOLIDS.

test('a four-leg circuit that rendered as a plain bar encloses nothing', () => {
  assert.equal(holes(legs([['-x', 4], ['+z', 1], ['+x', 5], ['+y', 1]])), 0);
});

test('a four-leg circuit that rendered as a plain block encloses nothing', () => {
  assert.equal(holes(legs([['-z', 3], ['+x', 1], ['+z', 4], ['+y', 1]])), 0);
});

// ------------------------------------------------ THE COUNTEREXAMPLE
// Pinned so the necessary condition cannot quietly become a sufficiency claim.

test('NECESSARY, NOT SUFFICIENT — a figure can enclose holes and still read as ordinary stairs', () => {
  const ordinaryStairs = legs([['+x', 2], ['-z', 3], ['+y', 2], ['+z', 5]]);
  assert.equal(holes(ordinaryStairs), 3);
  // If a future change makes this 0, the detector has become a judge and this
  // test should be REPLACED with that stronger claim, not deleted.
});

test('an empty structure has no holes rather than throwing', () => {
  assert.equal(new Structure([]).enclosedHoles(0).length, 0);
});
