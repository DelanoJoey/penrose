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
/**
 * THE SECOND TEACHING LEVEL — the one that teaches *rotate mid-route*.
 *
 * WHY IT EXISTS. Two of the campaign's levels are solvable in a standing view:
 * pick a rotation, walk to the goal, never rotate again. From `spur-01` on,
 * none are — the route must be interrupted, rotated and resumed. Nothing
 * taught that. `teach-00` gives screen-adjacency an entire level; interleaved
 * rotation simply became mandatory at level three and stayed mandatory, and a
 * player who built the mechanic stopped on level four with nine moves spent on
 * a level whose par is eight. See docs/playtest/OBSERVATIONS.md.
 *
 * HOW IT TEACHES. The start has NO legal walk, so `src/ui` shows "nothing to
 * walk to, rotate" on frame one — the game stating the lesson in words, on a
 * state the rest of the campaign visits ten times in 358 positions and never on
 * a route anybody walks.
 *
 * That state can ONLY be a start. Screen adjacency is symmetric, so a cell
 * reached on foot always has at least the way back, and the hint fires only at
 * zero legal walks (`elRotateHint.hidden = legal.length > 0`). A level that
 * walks the player into a wall is not merely undiscovered — it cannot exist.
 *
 * BOTH quarter turns open a walk, and that filter was added after looking at
 * plates. An earlier shortlist leader opened in one direction only, and pressed
 * the other way it is pixel-identical to the dead state it started in — still
 * saying "nothing to walk to, rotate". A first rotation that changes nothing
 * teaches that rotating does not help, which is the opposite of the lesson,
 * taught more convincingly than the level teaches the truth.
 *
 * After the turn the route is FORCED — one legal walk at each step, eight of
 * them, to the goal. `span-02` is what happens without that: zero forks, a
 * maximum degree of two, and a player who cannot tell being stuck from being
 * wrong. Here there is nothing to get wrong, so the only thing the level can
 * teach is the thing it is for.
 */
function teach01() {
  return {
    name: 'teach-01',
    cells: [
      [0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0],
      [0, 3, -1], [0, 3, -2],
      [1, 3, -2], [2, 3, -2], [3, 3, -2],
      [3, 3, -1], [3, 3, 0], [3, 3, 1], [3, 3, 2], [3, 3, 3],
      [0, 4, -2],
    ],
    start: [0, 4, -2],
    goal: [3, 3, 3],
    /**
     * openWithWalk is FALSE, and it is the only level that declares so.
     * `tools/analyze.mjs` calls a route that opens with a turn "unplayable on
     * frame one", which is right for every other level and is precisely the
     * point of this one: the first input must be a rotation, and the HUD says
     * so before the player presses anything.
     */
    premise: { turn: true, illusion: true, par: 8, minTurns: 1, openWithWalk: false },
    /**
     * The properties that make this a TEACHING level rather than a solvable
     * one, declared so test/teaching-rotation.test.js can measure them. Each is
     * something a later edit could quietly destroy while leaving the level
     * solvable and every other test green.
     */
    teaches: {
      stranded: [0, 4, -2],   // start: no legal walk in the opening view
      opens: 2,               // quarter turns that open one, out of two
      runUp: 8,               // forced walks to the goal after the turn
    },
  };
}

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
    premise: { turn: false, illusion: true, par: 1 },
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
    premise: { turn: false, illusion: true, par: 1 },
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
 * `par` — the fewest WALKS a level can be solved in, and the number the move
 * budget is measured against.
 *
 * It replaces the old `minWalks`, which was asserted only as a lower bound
 * (`walksInRoute >= minWalks`). That is the weaker half of a claim this project
 * has already been burned by: `perch-05` declared 5 turns and required 3, and
 * every test passed, because `turnsInRoute` is whichever equally-short route
 * BFS reached first rather than a minimum. `par` is asserted EXACT against
 * `Structure.minWalksBetween`, so the same drift cannot happen on walks.
 *
 * Turns are free in that measurement, deliberately — see minWalksBetween.
 */

/**
 * teach-00 — the level that teaches the rule the game is built on.
 *
 * WHY THE CAMPAIGN NEEDED THIS. The central rule — screen-adjacent means
 * walkable — was never stated anywhere and is not inferable from a still frame.
 * A player who owns the project spent an hour without finding it, asked "what
 * is the green thing", and logged 31 moves on a level whose optimum is 8. Those
 * were 31 SUCCESSFUL walks; `moves` only increments on a landed step. He was
 * not fighting dead keys, he was brute-forcing an unstated rule.
 *
 * loop-01 was meant to carry that lesson and cannot: it solves in one move, so
 * the trick fires before the player has registered that walking is a thing.
 *
 * THE SHAPE. A tribar of side 4, plus a three-cell bar hung in space at
 * (-1,-1,-6). The bar is a SEPARATE 3D object — nothing touches the tribar —
 * but it is screen-adjacent to the tribar's top corner at exactly one point.
 * Found by tools/teach.mjs, which is the tool this level exists because of;
 * every property below is one of its filters and each is proved in
 * test/teaching-level.test.js rather than trusted.
 *
 *   walk 4 ordinary steps down the +z leg   the player learns that walking works
 *   arrive at (4,4,0)                       the walkable surface visibly ENDS
 *   step across 16 units of nothing         the only legal move there is
 *   walk 2 more along the far bar           confirmation of having arrived
 *
 * WHAT THIS LEVEL CANNOT DO, AND WHY THAT IS NOT A DEFECT IN IT. It cannot make
 * the crossing LOOK impossible. A crossing moves the avatar exactly one screen
 * cell, which is precisely what an ordinary walk does, so the two are
 * pixel-indistinguishable by construction — measured on three different
 * candidate shapes, by playthrough, before this one was chosen. Trying to build
 * a level whose gap READS as a gap is trying to defeat the mechanic.
 *
 * So the lesson is carried by the setup rather than by the step: the goal sits
 * on an object the player can see is not the one they are standing on, the
 * surface under them runs out, and the one input that does anything is the one
 * that crosses. tribar(4) rather than tribar(5) so that this and loop-01, which
 * follows it, are not the same picture twice.
 */
function teach00() {
  return {
    name: 'teach-00',
    cells: [...tribar(4), [-1, -1, -6], [0, -1, -6], [1, -1, -6]],
    start: [4, 4, 4],
    goal: [1, -1, -6],
    premise: { turn: false, illusion: true, par:7, minTurns: 0, openWithWalk: true },
    /**
     * The properties that make this a TEACHING level rather than merely a
     * solvable one. Declared so test/teaching-level.test.js can measure them.
     * Every one of these is a thing a later edit could quietly destroy while
     * leaving the level solvable and every existing test green.
     */
    teaches: {
      runUp: 4,                 // ordinary walks before the gap
      pivot: [4, 4, 0],         // where the walkable surface ends
      landing: [-1, -1, -6],    // the near end of the far object
      after: 2,                 // walks along the far object after landing
    },
  };
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
    premise: { turn: true, illusion: true, par:7, minTurns: 1, openWithWalk: true },
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
    premise: { turn: true, illusion: true, par:8, minTurns: 2, openWithWalk: true },
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
    premise: { turn: true, illusion: true, par:8, minTurns: 3, openWithWalk: true },
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
    premise: { turn: true, illusion: true, par:12, minTurns: 4, openWithWalk: true },
  };
}

/**
 * perch-05 — RETIRED from the campaign. Kept as a registry fixture.
 *
 * It held the five-turn slot and could not fill it: it declares 5 and requires
 * 3. `turnsInRoute` is whichever equally-short route BFS reached first, and
 * `levels.test.js` asserted only `turnsInRoute >= minTurns`, so 5 >= 5 passed
 * while the level needed 3 — the campaign curve was reporting a routing
 * artifact. Searched exhaustively over all 18x17 start/goal pairs: the highest
 * true minimum this figure supports anywhere is 4, so no re-aiming could save
 * it. Replaced by `post-05`.
 *
 * A SECOND defect, found while replacing it and worth recording because
 * nothing in the project was looking for it: **its goal is not visible in the
 * rotation the level opens in.** (0,0,0) is the circuit's closure point, and a
 * closed circuit's far end aliases it while sitting IN FRONT of it, so the goal
 * is occluded at turn 0 and standable only in rotations 1-3. It was the only
 * shipping level where that was true. `ORDER` now asserts against it.
 *
 * Its declaration is corrected here rather than left at 5. A retired level with
 * a false premise is still a false premise, and `analyze.mjs` reads this file.
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
    premise: { turn: true, illusion: true, par: 10, minTurns: 3, openWithWalk: true },
  };
}

/**
 * post-05 — five turns, and the first level whose turn count is honestly five.
 *
 * A four-leg circuit doubling back on X, with a two-cell POST standing up from
 * the near walkway. The post is what makes the route deep: it is standable, it
 * is not where the goal is, and reaching the goal means rotating around it
 * rather than through it.
 *
 * WHY THIS FIGURE AND NOT A RE-AIMED perch-05. Measured over all 102 four-leg
 * circuits and 10,540 start/goal pairs, **no bare circuit supports a true
 * minimum of 5 turns anywhere** — the ceiling is 4. Augmentation is the only
 * route past it, which is also why `crook-06` reaches 6. The cascade over the
 * 262 augmented pairs that do require exactly 5:
 *
 *     require exactly 5 TRUE turns                          262
 *     goal standable, and so visible, at turn 0             150
 *     not doubling back on Y, not arm-04's base, no mirrors   6
 *     avatar not hidden behind its own figure                 3
 *
 * The Y exclusion is what does most of the cutting, not the visibility one —
 * and it is a design choice rather than a correctness filter: `crook-06` is the
 * only upright silhouette in the campaign and `ORDER` says so, so a second
 * upright figure at level 7 would cost that claim. The alternatives it discards
 * are longer (8 walks against this level's 5), and that is a real cost.
 *
 * THE LAST LINE OF THE CASCADE WAS NOT COMPUTED. Three of the six put the
 * avatar behind the post at turn 0, and **no cell-level check sees it**: the
 * occluding block sits at a different screen cell and covers only part of the
 * pawn's rendered height, so `visibility()` reports the avatar's own screen
 * cell as clear. It was caught by opening the plates. Again.
 *
 * `search.mjs` could not have found this. Its premise mode matches
 * `turnsInRoute === TARGET` — the same tie-break number that produced
 * `perch-05` — so its advertised pool of "5-turn" shapes is a pool of shapes
 * whose BFS tie-break happens to return 5.
 */
function post05() {
  return {
    name: 'post-05',
    cells: [
      ...circuit([['-x', 2], ['+z', 3], ['+x', 5], ['+y', 3]]),
      [-2, 1, 1], [-2, 2, 1],
    ],
    start: [3, 3, 3],
    goal: [0, 0, 3],
    premise: { turn: true, illusion: true, par: 5, minTurns: 5, openWithWalk: true },
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
    premise: { turn: true, illusion: true, par:5, minTurns: 6, openWithWalk: true },
  };
}

export const LEVELS = {
  'teach-00': teach00(),
  'teach-01': teach01(),
  'loop-01': loop01(),
  'probe-01': probe01(),
  'spur-01': spur01(),
  'span-02': span02(),
  'shelf-03': shelf03(),
  'arm-04': arm04(),
  'perch-05': perch05(),
  'post-05': post05(),
  'crook-06': crook06(),
};

/**
 * What loads when nothing is asked for — which is what a player who opens the
 * game gets, and therefore what the campaign starts on.
 *
 * This MUST track ORDER[0]. src/campaign seeds its index from whatever level
 * arrives, so a default that is not the first level starts the run partway in
 * and the opener is never played. Asserted in loadlevel.test.js.
 */
export const DEFAULT_LEVEL = 'teach-00';

/**
 * The campaign, in order. Separate from LEVELS on purpose.
 *
 * LEVELS is the full registry and stays reachable by `?level=`; probe-01 is a
 * two-cell fixture and belongs in the registry but not in a playthrough.
 *
 * teach-00 opens, and loop-01 — which used to open — now runs second.
 *
 * THE ARGUMENT THAT PUT loop-01 FIRST WAS RIGHT ABOUT THE FIGURE AND WRONG
 * ABOUT THE PLAYER. It ran: loop-01 solves in one move, that one move IS the
 * mechanic, and loop-01 is the only level whose figure is the bare tribar with
 * nothing hung off it, so as an opener it is the cleanest statement of what
 * this game is. Every clause is true. It is a statement of what the game is to
 * someone who already knows — and it was made by the person who built the
 * mechanic, about a level they could already solve.
 *
 * What it cost: a player spent an hour without inferring the rule and logged 31
 * successful walks on an 8-move level. A level that wins itself in one move
 * cannot teach, because the trick fires before the player has registered that
 * anything happened. See teach-00's header.
 *
 * loop-01 keeps slot 2 unchanged. Following a level that made the crossing
 * unavoidable, its one-move win reads as "you already know this" rather than as
 * a freebie, and it still introduces the bare tribar. The turn arrives at
 * spur-01, immediately after.
 *
 * The curve is then the measured `minTurns` of each level: 0, 0, 1, 2, 3, 4, 5, 6.
 *
 * The run changes FAMILY at shelf-03 -> arm-04, not just difficulty. The first
 * five levels are one tribar at four sizes (4/5/3/4/5); the last three are
 * four-leg circuits that double back. That break is deliberate and is the point
 * of the phase — a player who has learned to read a tribar meets a figure that
 * does not resolve the same way, at the moment the turn count starts to bite.
 *
 * teach-00 is a tribar for that reason and not by default: the opener has to
 * establish the figure the next four levels vary, or the break at arm-04 breaks
 * nothing. It is side 4 rather than 5 so that it and loop-01 are not the same
 * picture twice.
 *
 * ===================================================================
 * THE CURVE IS NOW 0,0,1,2,3,4,5,6 AND EVERY NUMBER IN IT IS MEASURED.
 * ===================================================================
 *
 * It was not, for four phases. `turnsInRoute` is not a minimum: `findRoute` is
 * a BFS in which a walk and a turn are one edge each, so it minimises
 * KEYPRESSES and, among equally short routes, returns whichever it reached
 * first — an arbitrary tie-break that `turnsInRoute` inherits. `levels.test.js`
 * asserted only `turnsInRoute >= minTurns`, which is slack in the direction
 * that lets an OVERSTATEMENT through.
 *
 * `perch-05` held the 5 slot with two 15-input routes, one using 5 turns and
 * one using 3. BFS returned the 5, so it declared 5, required 3, and 5 >= 5
 * passed. The real curve read `0,1,2,3,4,3,6` and was not non-decreasing.
 *
 * It could not be fixed by re-declaring — no start/goal pair on that figure has
 * a true minimum above 4 — so the figure was replaced. `post-05` requires 5,
 * measured by `Structure.minTurnsBetween`, and `test/true-minturns.test.js` now
 * asserts `declared === exact` for EVERY level with no exception pinned.
 *
 * THAT SEARCH IS ALSO WHY `tools/search.mjs` DID NOT SUPPLY THE REPLACEMENT.
 * Its premise mode matches `turnsInRoute === TARGET`, i.e. the same tie-break
 * number that created the defect, so the "104 shapes at 5 turns" it advertises
 * are shapes whose BFS tie-break happens to return 5. `post-05` was found by
 * searching on `minTurnsBetween` instead — see METHODOLOGY §P20.
 */
export const ORDER = [
  'teach-00',                                    // tribar 4 + a detached bar
  'loop-01',                                     // tribar 5, the bare figure
  // teach-01 sits here, before the first level that REQUIRES a mid-route
  // rotation. spur-01 onward cannot be solved from any standing view, and
  // until now nothing said so.
  'teach-01',
  'spur-01', 'span-02', 'shelf-03',              // tribar, sizes 3/4/5
  'arm-04', 'post-05', 'crook-06',               // four-leg doubled-back circuit
];
