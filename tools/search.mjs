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

/**
 * PREMISE MODE — `--turns=N`.
 *
 * A figure that reads as impossible is worthless if it cannot host a route where
 * rotation is load-bearing, and the bare figures cap out shallow. Augmentation is
 * the unlock and it is what the shipping levels already do: spur-01, span-02 and
 * shelf-03 are a bare tribar plus hung cells.
 *
 * The target is matched EXACTLY, not bounded. levels.test.js asserts
 * `turnsInRoute >= minTurns`, so a route taking six turns would satisfy a
 * `minTurns: 4` declaration and the campaign curve would be meaningless while
 * every test stayed green. See spec §5.1.
 */
if (args.turns != null) {
  const TARGET = Number(args.turns);
  const SPUR_MAX = Number(args['spur-max'] ?? 3);
  const out = [];

  for (const f of hits) {
    const solid = new Set(f.cellList.map((c) => cellId(...c)));
    for (const anchor of f.cellList) {
      for (const d of DIRS) {
        for (let len = 1; len <= SPUR_MAX; len++) {
          const extra = [];
          let cur = anchor, ok = true;
          for (let i = 0; i < len; i++) {
            cur = [cur[0] + V[d][0], cur[1] + V[d][1], cur[2] + V[d][2]];
            if (solid.has(cellId(...cur))) { ok = false; break; }
            extra.push([...cur]);
          }
          if (!ok) continue;
          const cells = [...f.cellList, ...extra];
          const s = new Structure(cells);
          // The spur must not fill the hole it was hung beside, or it destroys
          // the read it was added to.
          if (s.enclosedHoles(0).length === 0) continue;

          for (const from of s.standable(0)) {
            for (const to of cells) {
              if (cellId(...from) === cellId(...to)) continue;
              const p = s.premise(from, to);
              if (!p.solvable || !p.requiresTurn || !p.usesIllusion) continue;
              if (p.flatSolvableTurns.length !== 0) continue;
              if (p.route?.[0]?.kind !== 'walk') continue;
              if (p.turnsInRoute !== TARGET) continue;
              out.push({
                figure: f.legs,
                spur: `${d}×${len} from ${anchor.join(',')}`,
                cells: cells.length,
                holes: s.enclosedHoles(0).length,
                turns: p.turnsInRoute, walks: p.walksInRoute,
                illusionWalks: p.illusionWalks,
                start: from.join(','), goal: to.join(','),
                cellList: cells,
              });
            }
          }
        }
      }
    }
  }

  // One entry per distinct augmented shape: the most walks, as the richest route.
  const best = new Map();
  for (const o of out) {
    const k = canon(o.cellList);
    const prev = best.get(k);
    if (!prev || o.walks > prev.walks) best.set(k, o);
  }
  const shortlist = [...best.values()].sort((p, q) => (q.walks - p.walks) || (q.holes - p.holes));

  if (args.json) {
    console.log(JSON.stringify(shortlist, null, 2));
  } else {
    console.log(`augmented figures hosting a strong-premise route of EXACTLY ${TARGET} turns\n`);
    console.log(`  (start,goal) pairs: ${out.length}   distinct augmented shapes: ${shortlist.length}\n`);
    for (const o of shortlist.slice(0, 15)) {
      console.log(`  ${o.figure.padEnd(24)} + ${o.spur.padEnd(20)} cells=${String(o.cells).padStart(2)} holes=${String(o.holes).padStart(2)} walks=${String(o.walks).padStart(2)} illusionWalks=${o.illusionWalks} start=${o.start} goal=${o.goal}`);
    }
    console.log('\n  NOT judged. Render these and look at them.');
  }
} else if (args.json) {
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
