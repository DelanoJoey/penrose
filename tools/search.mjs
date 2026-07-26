#!/usr/bin/env node
/**
 * Figure search — the filter cascade from
 * docs/superpowers/specs/2026-07-26-second-figure-family-design.md §2.
 *
 * COMMITTED ON PURPOSE. The previous phase's equivalent was throwaway, so its
 * reported pool size ("18 four-leg circuits") cannot now be reproduced or
 * diffed against. Every count this prints is a number a future change moves
 * visibly instead of arguably.
 *
 * The stages are ordered CHEAP FIRST. Visual judgement is the expensive, human,
 * non-reproducible stage and it belongs after everything computable — which
 * inverts the previous phase's advice that the work was "the render-and-judge
 * loop, not more searching". Right about the destination, wrong about the order.
 *
 * WHAT THIS TOOL CANNOT DO. It cannot tell you whether a figure reads as
 * impossible. Structure.enclosedHoles is a necessary condition and not a
 * sufficient one — src/geometry/holes.test.js pins a figure with three enclosed
 * cells that still renders as an ordinary staircase. Everything below is a
 * filter that saves render cycles. The judge is a person looking at a plate.
 *
 *   node tools/search.mjs [--max-leg=6] [--min-leg=1] [--degenerate-min-leg=2] [--json]
 */
import { Structure, screenId, cellId } from '../src/geometry/index.js';

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.replace(/^--/, '').split('='))
  .map(([k, v]) => [k, v ?? true]));

// The cascade is enumerated from leg length 1 so the reported stage counts
// reproduce the spec's table exactly. The min-leg-2 rule is a NON-DEGENERACY
// constraint and is applied at that stage, not by narrowing the enumeration.
const MAX_LEG = Number(args['max-leg'] ?? 6);
const MIN_LEG = Number(args['min-leg'] ?? 1);
const NON_DEGENERATE_MIN_LEG = Number(args['degenerate-min-leg'] ?? 2);

const V = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};
const DIRS = Object.keys(V);
const axis = (d) => d[1];

function build(seq) {
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

/** Translation-invariant identity, so cyclic leg rotations collapse to one. */
function canon(cells) {
  const m = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
  return cells.map((c) => `${c[0] - m[0]},${c[1] - m[1]},${c[2] - m[2]}`).sort().join('|');
}

const stage = { closed: 0, noRepeat: 0, illusion: 0, screen: 0, hole: 0, nonDegenerate: 0 };
const seen = new Set();
const hits = [];

for (const d1 of DIRS) for (const d2 of DIRS) for (const d3 of DIRS) for (const d4 of DIRS) {
  if (axis(d1) === axis(d2) || axis(d2) === axis(d3) || axis(d3) === axis(d4)) continue;
  const dirs = [d1, d2, d3, d4];
  // Only three axes exist, so a four-leg circuit must reuse one. Reusing the
  // SAME direction splits a leg and the figure is still a tribar; reusing the
  // OPPOSITE direction doubles back, which is the genuinely new shape.
  const doublesBack = ['x', 'y', 'z'].some(
    (ax) => dirs.includes(`+${ax}`) && dirs.includes(`-${ax}`));

  for (let a = MIN_LEG; a <= MAX_LEG; a++)
  for (let b = MIN_LEG; b <= MAX_LEG; b++)
  for (let c = MIN_LEG; c <= MAX_LEG; c++)
  for (let d = MIN_LEG; d <= MAX_LEG; d++) {
    const seq = [[d1, a], [d2, b], [d3, c], [d4, d]];
    const cells = build(seq);
    const net = cells[cells.length - 1];
    // Closing on screen requires net displacement a positive multiple of
    // (1,1,1) — the only displacement the view direction collapses to nothing.
    // Positive so the far end sits IN FRONT of the near end and occludes it.
    if (!(net[0] === net[1] && net[1] === net[2] && net[0] > 0)) continue;
    stage.closed++;

    if (new Set(cells.map((x) => cellId(...x))).size !== cells.length) continue;
    stage.noRepeat++;

    const s = new Structure(cells);
    const illusionEdges = s.impossibleEdges(0).length;
    if (illusionEdges === 0) continue;
    stage.illusion++;

    const screenCells = new Set(cells.map((x) => screenId(...x))).size;
    if (screenCells < 8) continue;
    stage.screen++;

    const holes = s.enclosedHoles(0).length;
    if (holes === 0) continue;
    stage.hole++;

    const minLeg = Math.min(a, b, c, d);
    if (!doublesBack || minLeg < NON_DEGENERATE_MIN_LEG
        || screenCells < 9 || cells.length > 20) continue;
    stage.nonDegenerate++;

    const key = canon(cells);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      legs: seq.map(([x, n]) => `${x}×${n}`).join(' '),
      cells: cells.length, screenCells, holes, illusionEdges,
      standable: s.standable(0).length,
      net: net.join(','),
      cellList: cells,
    });
  }
}

if (args.json) {
  console.log(JSON.stringify(hits, null, 2));
} else {
  console.log(`four-leg circuits, legs ${MIN_LEG}..${MAX_LEG}\n`);
  console.log(`  closes on screen, net a positive multiple of (1,1,1)   ${stage.closed}`);
  console.log(`  no repeated 3D cell                                    ${stage.noRepeat}`);
  console.log(`  carries at least one illusion edge                     ${stage.illusion}`);
  console.log(`  >=8 distinct screen cells                              ${stage.screen}`);
  console.log(`  ENCLOSES A HOLE                                        ${stage.hole}`);
  console.log(`  non-degenerate (doubles back, min leg ${NON_DEGENERATE_MIN_LEG}, >=9, <=20)    ${stage.nonDegenerate}`);
  console.log(`  distinct up to translation                             ${hits.length}\n`);
  console.log('  Visual judgement is NOT in this list. It comes last, on rendered output.');
}
