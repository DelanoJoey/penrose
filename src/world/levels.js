/**
 * Level definitions, as plain cell lists.
 *
 * Levels are DATA. Nothing here computes visibility or connectivity — that is
 * src/geometry's job, and keeping the split clean is what lets a level be
 * checked for solvability before anyone draws it.
 */

/**
 * loop-01 — three legs that close on screen while never meeting in space.
 *
 * Net displacement is exactly (n,n,n), a multiple of the view direction, so the
 * far end lands on the screen position the first leg started from.
 *
 * WHY THREE LEGS AND NOT TWO. The first attempt used a climbing flight (+x,+y)
 * and a flat walkway (+z). Their screen deltas are (+1,-1) and (-1,+1) — exact
 * inverses — so the return leg retraced the outbound leg pixel for pixel. The
 * analyser caught it immediately: 11 cells collapsed to 6 visible positions, and
 * zero impossible edges. Perfectly correct algebra, completely wrong picture.
 *
 * Three legs along +x, +y and +z each contribute a distinct screen direction —
 * (+1,+1), (0,-2), (-1,+1) — so the screen path is a genuine triangle that
 * closes, rather than a line walked twice.
 */
function loop01(n = 5) {
  const cells = [];

  // Leg 1: east along +x.        screen direction (+1,+1)
  for (let i = 0; i <= n; i++) cells.push([i, 0, 0]);
  // Leg 2: up along +y.          screen direction (0,-2)
  for (let j = 1; j <= n; j++) cells.push([n, j, 0]);
  // Leg 3: north along +z.       screen direction (-1,+1)
  for (let k = 1; k <= n; k++) cells.push([n, n, k]);

  return {
    name: 'loop-01',
    cells,
    // (n,n,n) aliases (0,0,0) on screen and sits in front of it, so the loop
    // reads as closed. The start is therefore taken one cell along the first
    // leg, where it is actually visible.
    start: [1, 0, 0],
    goal: [n, n, n],
    /**
     * MEASURED, not aspirational. loop-01 is solvable in one move in the
     * rotation it opens in -- `turn: false` is the honest declaration, and
     * saying so out loud is what stopped this being mistaken for a level that
     * uses its own mechanic. See tools/analyze.mjs.
     */
    premise: { turn: false, illusion: true },
  };
}

/**
 * probe-01 — the minimal reproduction of the mechanic, kept as a fixture.
 * Two blocks, ten units apart in 3D, visually adjacent.
 */
function probe01() {
  return {
    name: 'probe-01',
    cells: [[0, 0, 0], [4, 3, 3]],
    start: [0, 0, 0],
    goal: [4, 3, 3],
    premise: { turn: false, illusion: true },
  };
}

/**
 * ledge-01 — the level that teaches the turn.
 *
 * A walkway you can see the whole of, and a tower whose top is not reachable
 * from it. Walking runs out after two steps; the only thing left to try is Q or
 * E, and one quarter turn brings the tower top into reach.
 *
 * This is the first level in the project where the goal cannot be reached in
 * the rotation the level opens in — loop-01 and probe-01 are both solvable in
 * one move without ever turning, which is why they declare turn: false.
 */
function ledge01() {
  const cells = [];
  for (let i = 0; i <= 4; i++) cells.push([i, 0, 0]);   // ground walkway
  for (let j = 0; j <= 2; j++) cells.push([0, j, 1]);   // the tower
  return {
    name: 'ledge-01',
    cells,
    start: [0, 0, 0],
    goal: [0, 2, 1],
    premise: { turn: true, illusion: true, minWalks: 3, minTurns: 1, openWithWalk: true },
  };
}

export const LEVELS = {
  'loop-01': loop01(),
  'probe-01': probe01(),
  'ledge-01': ledge01(),
};

export const DEFAULT_LEVEL = 'loop-01';
