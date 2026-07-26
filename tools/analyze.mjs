#!/usr/bin/env node
/**
 * Level analysis. Reports what the geometry subsystem actually derives from a
 * level definition — visibility, standable cells, the illusion edges, and
 * solvability under each rotation — and PROVES the level's declared premise
 * against that measurement rather than assuming it.
 *
 * A level declares what it is (`premise` in src/world/levels.js: whether a
 * turn is required, whether the illusion is load-bearing, and optionally a
 * minimum walk count or that the route must open with a walk). This script
 * measures the same properties from the geometry and fails if declared and
 * measured disagree. That is the check that replaces the old pair of asserts
 * (solvable at all; has an impossible edge somewhere) which loop-01 satisfied
 * by accident — solvable in one move with zero turns — while passing for a
 * level that uses its own mechanic.
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
const p = s.premise(level.start, level.goal);
const decl = level.premise ?? null;

const report = {
  level: level.name,
  cells: level.cells.length,
  start: cellId(...level.start),
  goal: cellId(...level.goal),
  declared: decl,
  measured: {
    solvable: p.solvable,
    requiresTurn: p.requiresTurn,
    turnsInRoute: p.turnsInRoute,
    walksInRoute: p.walksInRoute,
    usesIllusion: p.usesIllusion,
    illusionWalks: p.illusionWalks,
    flatSolvableTurns: p.flatSolvableTurns,
  },
  perRotation: [0, 1, 2, 3].map((t) => ({
    turns: t,
    visible: s.visibility(t).size,
    standable: s.standable(t).length,
    impossibleEdges: s.impossibleEdges(t).length,
    pathLength: s.findPath(level.start, level.goal, t)?.length ?? null,
  })),
  // NOT "the player must rotate". It means SOME rotations work and some do
  // not, which is how a level solvable in one move with zero turns passed for
  // a level that uses its own mechanic. requiresTurn above is the real answer.
  someRotationsFail: sol.requiresRotation,
  route: p.route,
};

console.log(JSON.stringify(report, null, 2));

// Design asserts. These are the premise of the game, not style preferences.
const problems = [];
if (!p.solvable) problems.push('level is not solvable in any rotation');
if (cellId(...level.start) === cellId(...level.goal)) problems.push('start equals goal');

if (!decl) {
  problems.push('level declares no premise — add one so CI can prove it');
} else {
  if (decl.turn !== p.requiresTurn)
    problems.push(`declares turn: ${decl.turn} but measured requiresTurn: ${p.requiresTurn}`);
  if (decl.illusion !== p.usesIllusion)
    problems.push(`declares illusion: ${decl.illusion} but measured usesIllusion: ${p.usesIllusion}`);
  if (decl.minWalks != null && p.walksInRoute < decl.minWalks)
    problems.push(`declares minWalks: ${decl.minWalks} but the route has ${p.walksInRoute}`);
  if (decl.minTurns != null && p.turnsInRoute < decl.minTurns)
    problems.push(`declares minTurns: ${decl.minTurns} but the route has ${p.turnsInRoute}`);
  if (decl.openWithWalk && p.route?.[0]?.kind !== 'walk')
    problems.push('declares openWithWalk but the route opens with a turn — the level is unplayable on frame one');
}

if (problems.length) {
  console.error('\nDESIGN PROBLEMS:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.error('\nOK: the level is what it declares itself to be.');
