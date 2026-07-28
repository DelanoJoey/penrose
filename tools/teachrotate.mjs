#!/usr/bin/env node
/**
 * Search for the SECOND teaching level — the one whose only job is to make
 * *rotate mid-route* inferable from play.
 *
 * WHY THIS IS NEEDED, MEASURED
 * ----------------------------
 * Two of the eight shipping levels are solvable in a standing view: pick a
 * rotation, walk to the goal, never rotate again. From `spur-01` onward none
 * are. The route must be interrupted, rotated mid-way and resumed — and
 * nothing in the game teaches that. `teach-00` gives screen-adjacency an entire
 * level; interleaved rotation simply becomes mandatory at level 3 and stays
 * mandatory.
 *
 * The declared curve `0,0,1,2,3,4,5,6` counts turns, so it reads as a ramp and
 * hides the step. A player who built the mechanic stopped on level 4 at 9 moves
 * of 22 — on a level with ZERO forks and a maximum degree of 2, i.e. a corridor
 * with no decision in it to get wrong. See docs/playtest/OBSERVATIONS.md.
 *
 * WHAT TEACHES IT, AND WHY THE HUD ALREADY DOES HALF THE WORK
 * -----------------------------------------------------------
 * src/ui shows "— nothing to walk to, rotate" exactly when zero movement keys
 * are legal (`elRotateHint.hidden = legal.length > 0`). That is the game
 * stating the lesson in words, and it fires on a state the campaign barely
 * visits: `span-02` has one such cell out of 46 positions and it is not on the
 * route a player walks.
 *
 * So this tool does not look for a clever figure. It looks for a level that
 * WALKS THE PLAYER INTO THAT STATE, early and without a choice on the way:
 *
 *   1. every step from the start is FORCED — exactly one legal walk — so the
 *      player cannot wander off the lesson or blame themselves for a wrong turn;
 *   2. the corridor ends in a cell with ZERO legal walks, so the prompt fires;
 *   3. ONE rotation opens a walk from that cell;
 *   4. the goal is reachable after it, and the whole thing is short.
 *
 * Criterion 1 is the one that matters and it is what `span-02` lacks. A player
 * with two options who picks the wrong one learns nothing about rotation; a
 * player with one option, walked to a wall the game then names, learns exactly
 * one thing.
 *
 * WHAT THIS TOOL CANNOT DO. The same disclaimer tools/search.mjs and
 * tools/teach.mjs carry, and it applies here too: every filter is necessary and
 * none is sufficient. Whether the opened path READS as newly available is
 * perceptual. §P20 put three candidates on the shortlist whose avatar was
 * hidden behind their own figure and no cell-level check saw it. The output is
 * a list to RENDER AND LOOK AT.
 *
 *   node tools/teachrotate.mjs [--max-par=8] [--min-runup=2] [--json]
 */
import { Structure, cellId, screenId } from '../src/geometry/index.js';

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.replace(/^--/, '').split('='))
  .map(([k, v]) => [k, v ?? true]));

const MAX_PAR = Number(args['max-par'] ?? 8);
const MIN_PAR = Number(args['min-par'] ?? 4);
const MIN_RUNUP = Number(args['min-runup'] ?? 2);
const MAX_LEG = Number(args['max-leg'] ?? 5);
const SPUR_MAX = Number(args['spur-max'] ?? 3);

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
const canon = (cells) => {
  const m = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
  return cells.map((c) => `${c[0] - m[0]},${c[1] - m[1]},${c[2] - m[2]}`).sort().join('|');
};

/** Tribars (three equal legs) and four-leg doubled-back circuits. */
function figures() {
  const seen = new Set();
  const out = [];
  const add = (cells) => {
    const k = canon(cells);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(cells);
  };

  // tribar family: every three-leg closed circuit has all legs equal (§P8)
  for (const [d1, d2, d3] of [['+x', '+y', '+z'], ['+z', '+y', '+x'],
    ['+x', '+z', '+y'], ['+y', '+x', '+z']]) {
    for (let n = 3; n <= MAX_LEG; n++) {
      const cells = build([[d1, n], [d2, n], [d3, n]]);
      const net = cells[cells.length - 1];
      if (net[0] === net[1] && net[1] === net[2] && net[0] > 0) add(cells);
    }
  }

  // four-leg circuits that double back, same enumeration search.mjs uses
  for (const d1 of DIRS) for (const d2 of DIRS) for (const d3 of DIRS) for (const d4 of DIRS) {
    if (axis(d1) === axis(d2) || axis(d2) === axis(d3) || axis(d3) === axis(d4)) continue;
    if (!['x', 'y', 'z'].some((ax) => [d1, d2, d3, d4].includes(`+${ax}`)
      && [d1, d2, d3, d4].includes(`-${ax}`))) continue;
    for (let a = 2; a <= MAX_LEG; a++) for (let b = 2; b <= MAX_LEG; b++)
    for (let c = 2; c <= MAX_LEG; c++) for (let d = 2; d <= MAX_LEG; d++) {
      const cells = build([[d1, a], [d2, b], [d3, c], [d4, d]]);
      const net = cells[cells.length - 1];
      if (!(net[0] === net[1] && net[1] === net[2] && net[0] > 0)) continue;
      if (new Set(cells.map((x) => cellId(...x))).size !== cells.length) continue;
      if (cells.length > 20) continue;
      add(cells);
    }
  }
  return out;
}

const stage = {
  shapes: 0, pairs: 0, oneTurn: 0, forcedCorridor: 0, deadEnd: 0,
  rotationOpens: 0, goalVisible: 0, usesIllusion: 0, short: 0,
};
const hits = [];

for (const base of figures()) {
  const solid = new Set(base.map((c) => cellId(...c)));
  const baseScreen = new Set(base.map((c) => screenId(...c)));

  const variants = [{ cells: base, spur: null }];
  for (const anchor of base) {
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
        // A spur at a screen position the base already occupies sits in FRONT
        // of it and silently replaces it in the picture (§P18, §P20).
        if (extra.some((c) => baseScreen.has(screenId(...c)))) continue;
        variants.push({ cells: [...base, ...extra], spur: `${d}x${len}@${anchor.join('.')}` });
      }
    }
  }

  for (const v of variants) {
    const s = new Structure(v.cells);
    if (s.enclosedHoles(0).length === 0) continue;
    stage.shapes += 1;

    const graphs = [0, 1, 2, 3].map((t) => s.pathGraph(t));
    const stand0 = s.standable(0);
    const stand0Ids = new Set(stand0.map((c) => cellId(...c)));

    for (const start of stand0) {
      const sid = cellId(...start);

      /**
       * THE START MUST HAVE NO LEGAL WALK AT ALL.
       *
       * The first draft of this tool looked for a corridor that WALKS the
       * player into a wall. That cannot exist. Screen adjacency is symmetric,
       * so a cell you walked into always has at least the way you came — a
       * cell reached on foot can never have zero legal walks, and the HUD hint
       * fires only at zero (`elRotateHint.hidden = legal.length > 0`).
       *
       * So the only states that say "nothing to walk to, rotate" are ones you
       * START on or ROTATE into. That is why the campaign visits them ten times
       * in 358 positions and why `span-02`'s single one is not on any route a
       * player walks.
       *
       * Starting on one puts the lesson on frame one: four dark arrows, the
       * game naming the answer in words, and the first input a rotation.
       */
      if ((graphs[0].get(sid) ?? []).length !== 0) continue;
      stage.deadEnd += 1;

      // A quarter turn must open a walk. Prefer exactly one so the lesson has a
      // single correct response rather than two equivalent ones.
      const opens = [1, 3].filter((t) => (graphs[t].get(sid) ?? []).length > 0);
      if (opens.length === 0) continue;
      stage.rotationOpens += 1;

      /**
       * After the rotation, the walk should be FORCED — one legal move at each
       * step — so the player cannot wander off the lesson or blame a wrong turn
       * for being stuck. This is what `span-02` lacks.
       */
      const t1 = opens[0];
      let cur = sid, runup = 0, forced = true;
      const visited = new Set([sid]);
      for (;;) {
        const next = [...new Set(graphs[t1].get(cur) ?? [])].filter((n) => !visited.has(n));
        if (next.length === 0) break;
        if (next.length > 1) { forced = false; break; }
        cur = next[0];
        visited.add(cur);
        runup += 1;
        if (runup > 12) { forced = false; break; }
      }
      if (!forced || runup < MIN_RUNUP) continue;
      stage.forcedCorridor += 1;

      for (const goal of stand0) {
        const gid = cellId(...goal);
        if (gid === sid || !stand0Ids.has(gid)) continue;
        stage.pairs += 1;

        // Exactly one rotation for the whole level: the simplest lesson there is.
        if (s.minTurnsBetween(start, goal) !== 1) continue;
        stage.oneTurn += 1;

        const par = s.minWalksBetween(start, goal);
        if (par == null || par > MAX_PAR || par < MIN_PAR) continue;
        stage.short += 1;

        /**
         * THE GOAL MUST BE AT THE END OF THE CORRIDOR THE ROTATION OPENS.
         *
         * Without this the top of the shortlist is par 1 — rotate once, take a
         * single step, win — which is exactly `loop-01`'s recorded failure:
         * "it wins in one move, so the trick fires before the player has
         * registered that anything happened" (§P18). The lesson needs the
         * player to walk the path the rotation revealed, not glance at it.
         */
        if (cur !== gid) continue;

        const p = s.premise(start, goal);
        if (!p.solvable || !p.requiresTurn) continue;
        // The route must OPEN with the rotation — that is the lesson. A route
        // that walks first means the start had somewhere to go after all.
        if (p.route?.[0]?.kind !== 'turn') continue;

        // The premise of the game. A teaching level that does not use the
        // illusion teaches the wrong game.
        if (!p.usesIllusion) continue;
        stage.usesIllusion += 1;

        // §P20: perch-05 shipped with a goal occluded at turn 0.
        stage.goalVisible += 1;

        hits.push({
          cells: v.cells.length, spur: v.spur,
          start: sid, goal: gid, deadEnd: cur,
          runup, par, turnsInRoute: p.turnsInRoute,
          opens: opens.length, illusionWalks: p.illusionWalks,
          screenCells: new Set(v.cells.map((c) => screenId(...c))).size,
          holes: s.enclosedHoles(0).length,
          cellList: v.cells,
        });
      }
    }
  }
}

console.log('\ncascade');
for (const [k, n] of Object.entries(stage)) console.log(`  ${k.padEnd(18)} ${n}`);

// Prefer: short run-up before the wall is fine, but the wall must come EARLY;
// then fewest walks; then smallest figure.
hits.sort((a, b) => a.runup - b.runup || a.par - b.par || a.cells - b.cells);
const uniq = [];
const seenShape = new Set();
for (const h of hits) {
  const k = `${canon(h.cellList)}|${h.start}|${h.goal}`;
  if (seenShape.has(k)) continue;
  seenShape.add(k);
  uniq.push(h);
}
console.log(`\ndistinct candidates: ${uniq.length}\n`);

if (args.json) {
  console.log(JSON.stringify(uniq.slice(0, 40), null, 2));
} else {
  for (const h of uniq.slice(0, 25)) {
    console.log(
      `cells=${String(h.cells).padStart(2)} spur=${String(h.spur ?? '-').padEnd(14)}`,
      `start=${h.start.padEnd(8)} wall=${h.deadEnd.padEnd(8)} goal=${h.goal.padEnd(8)}`,
      `runup=${h.runup} par=${h.par} opens=${h.opens} illusion=${h.illusionWalks}`);
  }
  console.log('\nNOT judged. Render these and look at them.');
}
