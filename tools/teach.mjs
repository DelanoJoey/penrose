#!/usr/bin/env node
/**
 * Search for a TEACHING level — a level whose only job is to make the central
 * rule inferable from play.
 *
 * THE RULE THIS LOOKS FOR, AND WHY tools/search.mjs CANNOT FIND IT
 * ----------------------------------------------------------------
 * The rule is *screen-adjacent means walkable*. A level teaches it when the
 * player is made to cross a gap that visibly is not crossable, and cannot get
 * anywhere else instead.
 *
 * Measured on the eight shipping figures before this tool existed: there are
 * 212 turn-0 routes whose illusion crossing is forced, and exactly TWO of them
 * join two visually separate objects — both directions of `probe-01`, a
 * two-cell fixture with no run-up that is not in the campaign. Every other
 * figure is a single 3D-connected solid, so its crossings read as walking a
 * closed triangle rather than as stepping across a gap. Nothing that looks
 * impossible ever happens, which is why an hour of play did not surface the
 * rule and a player logged 31 moves on an 8-move level.
 *
 * `tools/search.mjs` cannot produce a fix, and not by oversight: it augments a
 * figure by growing a spur FROM one of its cells, and an attached spur is in
 * the same 3D component by construction. It can only ever build more of the
 * same solid.
 *
 * THE PARAMETRISATION THIS TOOL ADDS
 * ----------------------------------
 * A cell that is screen-adjacent to A but arbitrarily far from it in 3D is
 * exactly
 *
 *     L = A + step + t*(1,1,1),    step in {+x,-x,+z,-z},  t != 0
 *
 * because (1,1,1) is the view direction and collapses to nothing on screen
 * (src/geometry §THE ONE FACT). t is the depth of the illusion and |t| is how
 * far apart the two objects visibly are: t=3 off a +x step is probe-01's ten
 * units. Hanging a DETACHED run at L, rather than a spur off A, is the whole
 * difference between a figure that contains a crossing and a figure that shows
 * one.
 *
 * WHAT THIS TOOL CANNOT DO — the same disclaimer search.mjs carries, and it
 * applies harder here because the property in question is perceptual. Every
 * filter below is necessary and none is sufficient. `enclosedHoles` is pinned
 * in holes.test.js against a figure that passes it and still reads as an
 * ordinary staircase. Cross-component is a proxy for "looks like two objects",
 * not a measurement of it. The shortlist is a list to RENDER AND LOOK AT.
 *
 *   node tools/teach.mjs [--family=all|tribar|circuit] [--max-walks=8]
 *                        [--min-runup=2] [--min-depth=2] [--json]
 */
import { Structure, cellId, parseCell, screenId, screenKey, HORIZONTAL_STEPS }
  from '../src/geometry/index.js';

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.replace(/^--/, '').split('='))
  .map(([k, v]) => [k, v ?? true]));

const FAMILY = String(args.family ?? 'all');
const MAX_WALKS = Number(args['max-walks'] ?? 8);
const MIN_RUNUP = Number(args['min-runup'] ?? 2);
const MIN_DEPTH = Number(args['min-depth'] ?? 2);   // |t|, how deep the illusion is
const MAX_RUN = Number(args['max-run'] ?? 4);       // detached run length
const MAX_DEPTH = Number(args['max-depth'] ?? 5);

const V = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};
const DIRS = Object.keys(V);
/** The four moves a walk can be. Their screen deltas are HORIZONTAL_STEPS. */
const WALK_DIRS = ['+x', '-x', '+z', '-z'];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const manhattan = (a, b) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

// ---------------------------------------------------------------- base figures

/** The tribar of side n — the canonical impossible object, and loop-01's shape. */
function tribar(n) {
  const cells = [];
  for (let i = 0; i <= n; i++) cells.push([i, 0, 0]);
  for (let j = 1; j <= n; j++) cells.push([n, j, 0]);
  for (let k = 1; k <= n; k++) cells.push([n, n, k]);
  return cells;
}

/**
 * Four-leg circuits that double back, re-enumerated from search.mjs's cascade
 * rather than imported, because that file is a script and prints as it goes.
 * Kept to the same filters so the two tools agree about what a figure is.
 */
function circuits({ maxLeg = 5, minLeg = 2 } = {}) {
  const out = [];
  const seen = new Set();
  const axis = (d) => d[1];
  const build = (seq) => {
    const cells = [[0, 0, 0]];
    let cur = [0, 0, 0];
    for (const [dir, len] of seq) for (let i = 0; i < len; i++) {
      cur = add(cur, V[dir]); cells.push([...cur]);
    }
    return cells;
  };
  const canon = (cells) => {
    const m = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
    return cells.map((c) => `${c[0] - m[0]},${c[1] - m[1]},${c[2] - m[2]}`).sort().join('|');
  };

  for (const d1 of DIRS) for (const d2 of DIRS) for (const d3 of DIRS) for (const d4 of DIRS) {
    if (axis(d1) === axis(d2) || axis(d2) === axis(d3) || axis(d3) === axis(d4)) continue;
    const dirs = [d1, d2, d3, d4];
    if (!['x', 'y', 'z'].some((ax) => dirs.includes(`+${ax}`) && dirs.includes(`-${ax}`))) continue;
    for (let a = minLeg; a <= maxLeg; a++)
    for (let b = minLeg; b <= maxLeg; b++)
    for (let c = minLeg; c <= maxLeg; c++)
    for (let d = minLeg; d <= maxLeg; d++) {
      const cells = build([[d1, a], [d2, b], [d3, c], [d4, d]]);
      const net = cells.at(-1);
      if (!(net[0] === net[1] && net[1] === net[2] && net[0] > 0)) continue;
      if (new Set(cells.map((x) => cellId(...x))).size !== cells.length) continue;
      if (cells.length > 20) continue;
      const s = new Structure(cells);
      if (s.impossibleEdges(0).length === 0) continue;
      if (new Set(cells.map((x) => screenId(...x))).size < 9) continue;
      if (s.enclosedHoles(0).length === 0) continue;
      const k = canon(cells);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name: `circuit ${d1}x${a} ${d2}x${b} ${d3}x${c} ${d4}x${d}`, cells });
    }
  }
  return out;
}

const bases = [];
if (FAMILY === 'all' || FAMILY === 'tribar')
  for (let n = 3; n <= 6; n++) bases.push({ name: `tribar-${n}`, cells: tribar(n) });
if (FAMILY === 'all' || FAMILY === 'circuit') bases.push(...circuits());

// ---------------------------------------------------------------------- helpers

/** 3D-connected components, 6-neighbour. Two components read as two objects. */
function components(cells) {
  const solid = new Set(cells.map((c) => cellId(...c)));
  const comp = new Map();
  let id = 0;
  for (const c of cells) {
    const k = cellId(...c);
    if (comp.has(k)) continue;
    const q = [k]; comp.set(k, id);
    while (q.length) {
      const p = parseCell(q.shift());
      for (const d of Object.values(V)) {
        const n = cellId(...add(p, d));
        if (solid.has(n) && !comp.has(n)) { comp.set(n, id); q.push(n); }
      }
    }
    id++;
  }
  return { comp, count: id };
}

/** Shortest walk count between two cells in one graph, restricted to `allowed`. */
function hops(graph, from, to, allowed) {
  if (from === to) return 0;
  const seen = new Set([from]);
  let layer = [from], d = 0;
  while (layer.length) {
    const next = [];
    d++;
    for (const cur of layer) for (const n of graph.get(cur) ?? []) {
      if (seen.has(n) || (allowed && !allowed.has(n))) continue;
      if (n === to) return d;
      seen.add(n); next.push(n);
    }
    layer = next;
  }
  return null;
}

const stage = {
  placed: 0, detached: 0, visible: 0, hole: 0, disjoint: 0, oneContact: 0,
  turnsAway: 0, singleSeam: 0, corridor: 0, runUp: 0, premise: 0,
};
const hits = [];
const seenShape = new Set();

// ------------------------------------------------------------------ the cascade

for (const base of bases) {
  const baseIds = new Set(base.cells.map((c) => cellId(...c)));
  const baseStructure = new Structure(base.cells);
  const anchors = baseStructure.standable(0);

  for (const A of anchors) {
    for (const step of WALK_DIRS) {
      for (let t = -MAX_DEPTH; t <= MAX_DEPTH; t++) {
        if (Math.abs(t) < MIN_DEPTH) continue;          // t=0 is an ordinary step
        const L = add(add(A, V[step]), [t, t, t]);
        if (baseIds.has(cellId(...L))) continue;

        for (const rd of DIRS) {
          for (let len = 0; len < MAX_RUN; len++) {
            // The detached run: L, then `len` more cells along rd.
            const run = [L];
            for (let i = 0; i < len; i++) run.push(add(run.at(-1), V[rd]));
            if (run.some((c) => baseIds.has(cellId(...c)))) continue;
            if (new Set(run.map((c) => cellId(...c))).size !== run.length) continue;
            stage.placed++;

            // DETACHED: no run cell may touch the figure in 3D, or the two are
            // one object and the crossing stops reading as a crossing.
            const touches = run.some((c) =>
              Object.values(V).some((d) => baseIds.has(cellId(...add(c, d)))));
            if (touches) continue;
            stage.detached++;

            const cells = [...base.cells, ...run];
            const st = new Structure(cells);
            const runIds = new Set(run.map((c) => cellId(...c)));

            // Every run cell must be standable and frontmost — a platform you
            // cannot see is not somewhere the player can be asked to go.
            const stand = st.standable(0);
            const standIds = new Set(stand.map((c) => cellId(...c)));
            if (!run.every((c) => standIds.has(cellId(...c)))) continue;
            stage.visible++;

            // The figure must still read as impossible after the run is added.
            if (st.enclosedHoles(0).length === 0) continue;
            stage.hole++;

            // NO SCREEN OVERLAP. Two objects that are separate in 3D can still
            // be ONE object in the picture, and cross-component does not catch
            // it. Measured on the first shortlist this tool produced: its top
            // candidate hung a three-cell run at (10,9,9)..(12,9,9), whose
            // screen cells are 1,1 / 2,2 / 3,3 — exactly the tribar's own bottom
            // leg — sitting 27 depth units in front and hiding it completely.
            // The plate is an ordinary tribar whose bottom leg happens to be a
            // separate floating bar. Nothing visibly impossible is on screen,
            // which is the entire defect this tool exists to fix, and every
            // filter above it passed.
            //
            // Requiring disjoint screen cells makes the run ADDITIONAL material
            // rather than a replacement, so the eye has two regions to see.
            const baseScreen = new Set(base.cells.map((c) => screenId(...c)));
            if (run.some((c) => baseScreen.has(screenId(...c)))) continue;
            stage.disjoint++;

            // ONE POINT OF CONTACT IN THE PICTURE.
            //
            // The seam test below counts edges of the TRAVERSAL graph, which is
            // built from standable cells only. The renderer draws every cell,
            // standable or not, so two objects can touch all along an edge in
            // the picture while sharing exactly one graph edge. Measured on the
            // first rendered shortlist: the best-ranked candidate touched the
            // tribar at TWO screen positions and read as welded onto it — a
            // detail no traversal-level check can see, and one that only turned
            // up because the plates were opened.
            //
            // This cannot make the crossing LOOK like a gap. Screen adjacency
            // is visual contact by definition, so the step the player takes will
            // always be drawn as touching — that is the illusion, not a defect
            // in it. What one contact buys is that the two objects read as two
            // objects everywhere ELSE, so the touch reads as a coincidence
            // rather than as a joint.
            const contacts = run.reduce((n, c) => {
              const [a, b] = screenKey(...c);
              return n + HORIZONTAL_STEPS
                .filter(([da, db]) => baseScreen.has(`${a + da},${b + db}`)).length;
            }, 0);
            if (contacts !== 1) continue;
            stage.oneContact++;

            // THE FAR OBJECT MUST TURN AWAY FROM THE CROSSING.
            //
            // A crossing moves the avatar exactly one screen cell, which is what
            // an ordinary walk does. No filter can make the STEP look
            // impossible — that is the mechanic, not a shortcoming of it. What a
            // teaching level can do is make the player see they have ARRIVED
            // somewhere else, and that depends on the shape they land on.
            //
            // Measured by playthrough: a candidate whose detached bar ran in the
            // same screen direction as the crossing rendered as one continuous
            // beam collinear with the arm the player walked in on. Frames 8 and
            // 10 of that run are indistinguishable from ordinary walking, and
            // every filter above passed. If the run instead turns, the far
            // object reads as its own structure and landing on it reads as
            // relocation.
            const [pa, pb] = screenKey(...add(A, V[step]));   // the landing screen cell
            const [aa, ab] = screenKey(...A);
            const crossDir = `${pa - aa},${pb - ab}`;
            const runDir = len === 0 ? null
              : `${screenKey(...run[1])[0] - screenKey(...run[0])[0]},${screenKey(...run[1])[1] - screenKey(...run[0])[1]}`;
            if (runDir !== null && runDir === crossDir) continue;
            stage.turnsAway++;

            // ONE SEAM. Count turn-0 graph edges between the two objects. Exactly
            // one undirected edge means the crossing is the only way across, so
            // it is a bridge for EVERY figure-start/run-goal pair without having
            // to re-search per pair — and it means the eye has one place to look.
            const graph = st.pathGraph(0);
            const seams = [];
            for (const [from, tos] of graph) {
              if (!standIds.has(from)) continue;
              for (const to of tos) {
                if (runIds.has(from) === runIds.has(to)) continue;
                if (runIds.has(from)) continue;           // count each seam once
                seams.push([from, to]);
              }
            }
            if (seams.length !== 1) continue;
            const [pivot, landing] = seams[0];
            // A seam that is not an illusion crossing would be an ordinary step
            // between two things that merely look separate — the detachment test
            // above already rules it out, but assert rather than assume.
            if (manhattan(parseCell(pivot), parseCell(landing)) <= 1) continue;
            stage.singleSeam++;

            // CORRIDOR AT THE PIVOT. Every neighbour of the pivot other than the
            // one the player arrived from must be the crossing. The player is
            // made to try the impossible step because nothing else is offered.
            const pivotNeighbours = graph.get(pivot) ?? [];
            if (pivotNeighbours.length > 2) continue;
            stage.corridor++;

            // RUN-UP: ordinary walking, on the figure, before the gap. This is
            // what loop-01 lacks — it wins in one move, so the trick fires
            // before the player has registered that walking is a thing.
            //
            // Measured on ORDINARY edges only. A figure carries its own illusion
            // seams (a tribar's alias corner is one), and a run-up that crosses
            // one has taught the rule illegibly before the level gets to teach
            // it legibly.
            //
            // AND the ordinary distance must EQUAL the full-graph distance. It
            // is not enough that an ordinary approach exists — if a shorter path
            // across the figure's own seam also exists, that is the one a player
            // heading for the goal will find, and the level teaches nothing. An
            // earlier version of this block took the farthest start and then
            // rejected it if its approach was not ordinary, never trying the
            // next-farthest; it reported ZERO tribar candidates, which was an
            // artifact of the selection rather than a fact about tribars.
            const figureIds = new Set(stand.map((c) => cellId(...c))
              .filter((k) => !runIds.has(k)));
            const ordinary = new Map();
            for (const k of figureIds) {
              ordinary.set(k, (graph.get(k) ?? []).filter((n) =>
                figureIds.has(n) && manhattan(parseCell(k), parseCell(n)) === 1));
            }
            let start = null, runUp = -1;
            for (const k of figureIds) {
              if (k === pivot) continue;
              const dOrd = hops(ordinary, k, pivot, figureIds);
              if (dOrd == null || dOrd < MIN_RUNUP || dOrd <= runUp) continue;
              if (hops(graph, k, pivot, figureIds) !== dOrd) continue;   // no shortcut
              runUp = dOrd; start = k;
            }
            if (start == null) continue;
            stage.runUp++;

            // The goal: the far end of the run, so landing is followed by a
            // step or two that confirms the player is really over there.
            const goal = run.at(-1);
            const p = st.premise(parseCell(start), goal);
            if (!p.solvable || p.requiresTurn || !p.usesIllusion) continue;
            if (p.route[0]?.kind !== 'walk') continue;
            if (p.walksInRoute > MAX_WALKS) continue;
            if (p.turnsInRoute !== 0) continue;
            stage.premise++;

            const m = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
            const key = cells.map((c) => `${c[0] - m[0]},${c[1] - m[1]},${c[2] - m[2]}`)
              .sort().join('|') + `#${start}>${cellId(...goal)}`;
            if (seenShape.has(key)) continue;
            seenShape.add(key);

            hits.push({
              base: base.name,
              run: `${rd}x${len + 1} at ${L.join(',')}  (step ${step}, t=${t})`,
              depth: Math.abs(t),
              jump: manhattan(parseCell(pivot), parseCell(landing)),
              cells: cells.length,
              holes: st.enclosedHoles(0).length,
              start, goal: cellId(...goal),
              pivot, landing,
              runUp, after: len, walks: p.walksInRoute,
              screenCells: new Set(cells.map((c) => screenId(...c))).size,
              cellList: cells,
            });
          }
        }
      }
    }
  }
}

// Widest measured jump first, then the longest run-up.
//
// NOT by `depth`. |t| is the parameter the run was PLACED with, and the seam
// that actually forms need not be at the anchor it was placed against — the
// search finds the seam rather than assuming it, so t=5 placements turn up
// with jumps of 4 and of 16. `jump` is the measurement and `depth` is the
// input; ranking on the input would have ordered this list by a number that
// is not the property being ranked for. Still only a HINT at legibility.
hits.sort((a, b) => (b.jump - a.jump) || (b.runUp - a.runUp) || (a.cells - b.cells));

if (args.json) {
  console.log(JSON.stringify(hits, null, 2));
} else {
  console.log(`teaching candidates — base family: ${FAMILY} (${bases.length} figures)\n`);
  console.log(`  detached run placed, no collision                 ${stage.placed}`);
  console.log(`  not 3D-adjacent to the figure (two objects)       ${stage.detached}`);
  console.log(`  every run cell standable and frontmost            ${stage.visible}`);
  console.log(`  figure still encloses a hole                      ${stage.hole}`);
  console.log(`  run does not OCCLUDE the figure (disjoint screen)  ${stage.disjoint}`);
  console.log(`  the two objects touch at ONE screen point          ${stage.oneContact}`);
  console.log(`  the far object TURNS AWAY (not a collinear beam)   ${stage.turnsAway}`);
  console.log(`  EXACTLY ONE seam between the two objects          ${stage.singleSeam}`);
  console.log(`  the pivot offers no alternative (corridor)        ${stage.corridor}`);
  console.log(`  run-up of >=${MIN_RUNUP} ordinary walks first            ${stage.runUp}`);
  console.log(`  premise: turn-0, no turns, opens with a walk       ${stage.premise}`);
  console.log(`  distinct shapes                                   ${hits.length}\n`);
  for (const h of hits.slice(0, 20)) {
    console.log(`  ${h.base.padEnd(10)} ${h.run.padEnd(34)} cells=${String(h.cells).padStart(2)} holes=${String(h.holes).padStart(2)} walks=${h.walks} (runUp=${h.runUp}+1+${h.after}) jump=${String(h.jump).padStart(2)} start=${h.start.padEnd(9)} goal=${h.goal}`);
  }
  console.log('\n  NOT judged. Cross-component is a proxy for "looks like two objects",');
  console.log('  not a measurement of it. Render these and look at them.');
}
