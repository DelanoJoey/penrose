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
 * A tribar of side n, the same closed figure loop-01 builds.
 *
 * Three legs along +x, +y and +z with net displacement (n,n,n). Because that
 * net is a multiple of the view direction, the far end aliases the near end on
 * screen and the loop reads as closed — which is the whole reason it looks
 * impossible. Shared by the three levels below so the figure is defined once.
 */
function tribar(n) {
  const cells = [];
  for (let i = 0; i <= n; i++) cells.push([i, 0, 0]);
  for (let j = 1; j <= n; j++) cells.push([n, j, 0]);
  for (let k = 1; k <= n; k++) cells.push([n, n, k]);
  return cells;
}

/**
 * spur-01 — the level that teaches the turn.
 *
 * A small tribar with a detached spur. Walking the figure never reaches the
 * spur; one quarter turn brings it into reach. This is the first level in the
 * project whose goal cannot be reached in the rotation it opens in — loop-01
 * and probe-01 are both solvable in one move without turning, which is why
 * they declare turn: false.
 */
function spur01() {
  return {
    name: 'spur-01',
    cells: [...tribar(3), [1, 0, 3], [2, 0, 3], [3, 0, 3]],
    start: [1, 0, 0],
    goal: [3, 0, 3],
    premise: { turn: true, illusion: true, minWalks: 7, minTurns: 1, openWithWalk: true },
  };
}

/**
 * span-02 — two turns, on a larger figure.
 *
 * No single rotation contains a complete path, so walking and turning have to
 * interleave rather than the player turning once and walking home.
 */
function span02() {
  return {
    name: 'span-02',
    cells: [...tribar(4), [0, 0, 3], [1, 0, 3], [2, 0, 3]],
    start: [1, 0, 0],
    goal: [2, 0, 3],
    premise: { turn: true, illusion: true, minWalks: 8, minTurns: 2, openWithWalk: true },
  };
}

/**
 * shelf-03 — three turns, with the goal built into the figure.
 *
 * A full-size tribar carrying a shelf on its standing leg. The shelf reads as
 * part of the structure rather than as a separate object, so the level looks
 * like one impossible solid and the route through it is the least obvious of
 * the three.
 */
function shelf03() {
  return {
    name: 'shelf-03',
    cells: [...tribar(5), [6, 4, 0], [6, 4, 1]],
    start: [1, 0, 0],
    goal: [6, 4, 1],
    premise: { turn: true, illusion: true, minWalks: 8, minTurns: 3, openWithWalk: true },
  };
}

export const LEVELS = {
  'loop-01': loop01(),
  'probe-01': probe01(),
  'spur-01': spur01(),
  'span-02': span02(),
  'shelf-03': shelf03(),
};

export const DEFAULT_LEVEL = 'loop-01';
