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

/**
 * THE SECOND FIGURE FAMILY — a four-leg circuit that doubles back on an axis.
 *
 * WHY A SECOND FAMILY WAS NEEDED, AND WHY IT HAS FOUR LEGS. Every level above
 * is a tribar, and that is forced rather than lazy: enumerating all three-leg
 * closed circuits with legs 1..8 gives 48 hits and EVERY ONE has its three legs
 * equal. The tribar family has exactly one degree of freedom — size. Escaping
 * it needs a different leg count.
 *
 * Only three axes exist, so a four-leg circuit must reuse one. Reusing the same
 * direction merely splits a leg and the figure is still a tribar; reusing the
 * OPPOSITE direction doubles back, which is the genuinely new shape. All three
 * levels below do that: +x with -x, or +y with -y.
 *
 * Closure is the same algebra as the tribar: net displacement must be a
 * positive multiple of (1,1,1), so the far end aliases the near end on screen
 * and sits in front of it. See tools/search.mjs for the full filter cascade and
 * Structure.enclosedHoles for the criterion that rejects the circuits which
 * project as ordinary slabs.
 */
function circuit(legs) {
  const STEP = {
    '+x': [1, 0, 0], '-x': [-1, 0, 0],
    '+y': [0, 1, 0], '-y': [0, -1, 0],
    '+z': [0, 0, 1], '-z': [0, 0, -1],
  };
  const cells = [[0, 0, 0]];
  let cur = [0, 0, 0];
  for (const [dir, len] of legs) {
    for (let i = 0; i < len; i++) {
      cur = [cur[0] + STEP[dir][0], cur[1] + STEP[dir][1], cur[2] + STEP[dir][2]];
      cells.push([...cur]);
    }
  }
  return cells;
}

/**
 * arm-04 — four turns. A triangle with a beam driven THROUGH it.
 *
 * The most visually distinct figure in the project: the -x leg carries the
 * circuit back across its own opening, so a bar appears to pass through the
 * triangle it is part of. Chosen over three near-identical alternatives at the
 * same turn count precisely because it does not look like the others.
 *
 * The arm is a three-cell +z run off the standing leg, carrying the start.
 */
function arm04() {
  return {
    name: 'arm-04',
    cells: [
      ...circuit([['+x', 6], ['+z', 4], ['+y', 4], ['-x', 2]]),
      [6, 1, 5], [6, 1, 6], [6, 1, 7],
    ],
    start: [6, 1, 5],
    goal: [6, 0, 3],
    premise: { turn: true, illusion: true, minWalks: 12, minTurns: 4, openWithWalk: true },
  };
}

/**
 * perch-05 — five turns. A closed loop with the goal raised above it.
 *
 * The circuit doubles back on z and climbs, and a single cell hung on top of
 * the far leg carries the goal. One cell rather than a run, so the figure stays
 * a clean loop and the goal reads as sitting ON the structure rather than as a
 * separate object stuck to it.
 */
function perch05() {
  return {
    name: 'perch-05',
    cells: [
      ...circuit([['-z', 2], ['+y', 4], ['+z', 6], ['+x', 4]]),
      [0, 5, 2],
    ],
    start: [0, 4, -2],
    goal: [0, 0, 0],
    premise: { turn: true, illusion: true, minWalks: 10, minTurns: 5, openWithWalk: true },
  };
}

/**
 * crook-06 — six turns, the deepest route in the project.
 *
 * The only level whose circuit doubles back on the VERTICAL axis (+y against
 * -y) rather than a horizontal one, which is why its silhouette stands upright
 * where every other figure here lies along the ground plane.
 *
 * Fewest walks of the three (5) against the most turns (6), so it is the level
 * where rotation carries the most weight relative to walking. If any level in
 * the campaign proves tedious rather than clever, expect it to be this one --
 * findRoute costs a turn and a walk equally, which is a recorded open decision
 * from P5 and not yet backed by evidence about what a player actually enjoys.
 */
function crook06() {
  return {
    name: 'crook-06',
    cells: [
      ...circuit([['+x', 3], ['-y', 2], ['+z', 3], ['+y', 5]]),
      [2, 0, 3], [1, 0, 3],
    ],
    start: [2, 0, 3],
    goal: [3, 3, 3],
    premise: { turn: true, illusion: true, minWalks: 5, minTurns: 6, openWithWalk: true },
  };
}

export const LEVELS = {
  'loop-01': loop01(),
  'probe-01': probe01(),
  'spur-01': spur01(),
  'span-02': span02(),
  'shelf-03': shelf03(),
  'arm-04': arm04(),
  'perch-05': perch05(),
  'crook-06': crook06(),
};

export const DEFAULT_LEVEL = 'loop-01';

/**
 * The campaign, in order. Separate from LEVELS on purpose.
 *
 * LEVELS is the full registry and stays reachable by `?level=`; probe-01 is a
 * two-cell fixture and belongs in the registry but not in a playthrough.
 *
 * loop-01 opens, which reverses what the spec for this phase said. The spec
 * argued it "teaches nothing and wins itself" because it solves in one move.
 * That one move is the entire mechanic — a single sideways step that crosses
 * fourteen units — and loop-01 is the only level whose figure is the bare
 * tribar with nothing hung off it. As an opener that is the cleanest possible
 * statement of what this game is. The turn is introduced immediately after.
 *
 * The curve is then the measured `minTurns` of each level: 0, 1, 2, 3, 4, 5, 6.
 *
 * The run changes FAMILY at shelf-03 -> arm-04, not just difficulty. The first
 * four levels are one tribar at four sizes; the last three are four-leg
 * circuits that double back. That break is deliberate and is the point of the
 * phase — a player who has learned to read a tribar meets a figure that does
 * not resolve the same way, at the moment the turn count starts to bite.
 *
 * Each minTurns is the MEASURED turnsInRoute for that level's start/goal pair,
 * never a slack bound. levels.test.js asserts `turnsInRoute >= minTurns`, so
 * declaring 4 on a route that takes 6 would pass every test while making this
 * curve meaningless — which is the silent-drift failure the premise system was
 * built to close.
 *
 * ===================================================================
 * AND IT CLOSED ONLY HALF OF IT. THE CURVE ABOVE IS NOT 0..6.
 * ===================================================================
 *
 * `turnsInRoute` is not a minimum. `findRoute` is a BFS in which a walk and a
 * turn are one edge each, so it minimises KEYPRESSES and, among equally short
 * routes, returns whichever it reached first — an arbitrary tie-break that
 * `turnsInRoute` then inherits.
 *
 * `perch-05` has two 15-input routes, one using 5 turns and one using 3. BFS
 * returns the 5. So this level declares 5, requires 3, and
 * `turnsInRoute >= minTurns` passes as 5 >= 5 — slack in exactly the direction
 * the paragraph above did not consider. The real curve is
 *
 *     0, 1, 2, 3, 4, 3, 6      not      0, 1, 2, 3, 4, 5, 6
 *
 * and it is not non-decreasing.
 *
 * perch-05 CANNOT be fixed by re-declaring: searched exhaustively over all
 * 18x17 start/goal pairs, the highest true minimum the figure supports anywhere
 * is 4. Filling the 5 slot honestly needs a different figure, and tools/search.mjs
 * has 1,255 augmented shapes at exactly 4 turns and 104 at 5, barely explored.
 *
 * `Structure.minTurnsBetween` is the honest number and `premise().minTurnsExact`
 * reports it. test/true-minturns.test.js asserts declared === exact for every
 * level except perch-05, which is PINNED as a fixture — see the note there
 * before changing any of this.
 */
export const ORDER = [
  'loop-01', 'spur-01', 'span-02', 'shelf-03',   // tribar, sizes 5/3/4/5
  'arm-04', 'perch-05', 'crook-06',              // four-leg doubled-back circuit
];
