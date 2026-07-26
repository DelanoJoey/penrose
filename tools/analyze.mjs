#!/usr/bin/env node
/**
 * Level analysis. Reports what the geometry subsystem actually derives from a
 * level definition — visibility, standable cells, the illusion edges, and
 * solvability under each rotation.
 *
 * This exists so a level's premise is CHECKED rather than assumed. A level with
 * no impossible edges is an ordinary staircase, and a level solvable in all four
 * rotations does not use its own mechanic.
 *
 *   node tools/analyze.mjs [level]
 */
import { Structure, cellId } from '../src/geometry/index.js';
import { LEVELS, DEFAULT_LEVEL } from '../src/world/levels.js';

const name = process.argv[2] ?? DEFAULT_LEVEL;
const level = LEVELS[name];
if (!level) {
  console.error(`unknown level: ${name}. known: ${Object.keys(LEVELS).join(', ')}`);
  process.exit(2);
}

const s = new Structure(level.cells);
const sol = s.solvability(level.start, level.goal);

const report = {
  level: level.name,
  cells: level.cells.length,
  start: cellId(...level.start),
  goal: cellId(...level.goal),
  perRotation: [0, 1, 2, 3].map((t) => ({
    turns: t,
    visible: s.visibility(t).size,
    standable: s.standable(t).length,
    impossibleEdges: s.impossibleEdges(t).length,
    pathLength: s.findPath(level.start, level.goal, t)?.length ?? null,
  })),
  solvable: sol.solvable,
  solvableTurns: sol.solvableTurns,
  requiresRotation: sol.requiresRotation,
  illusionEdgesUnrotated: s.impossibleEdges(0),
  pathUnrotated: s.findPath(level.start, level.goal, 0),
};

console.log(JSON.stringify(report, null, 2));

// Design asserts. These are the premise of the game, not style preferences.
const problems = [];
if (!sol.solvable) problems.push('level is not solvable in any rotation');
if (s.impossibleEdges(0).length === 0 && !sol.solvableTurns.some((t) => s.impossibleEdges(t).length))
  problems.push('level has no impossible edges in any solvable rotation — it is an ordinary staircase');

if (problems.length) {
  console.error('\nDESIGN PROBLEMS:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.error('\nOK: solvable, and the illusion is load-bearing.');
