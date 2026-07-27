import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import player, { MOVE_SLACK } from '../src/player/index.js';
import campaign from '../src/campaign/index.js';
import { LEVELS, ORDER } from '../src/world/levels.js';
import { Structure, cellId, SCREEN_DELTA } from '../src/geometry/index.js';

/**
 * THE FAIL STATE.
 *
 * Until this existed the game had no lose condition anywhere — no move limit,
 * no timer, nothing — and `MOVES` was displayed unbounded. A game you cannot be
 * wrong in has no tension to resolve and no reason for a second attempt.
 *
 * What these guard is not "does a counter count". It is the set of decisions
 * that make the budget survivable for the player it would otherwise punish
 * hardest: turning is free, blocked keys are free, and a final walk onto the
 * goal wins even when it is the last one allowed. Each of those is one `if`
 * away from being silently reversed, and none of them would show up as a
 * failure in any other test — the level would still load, still be solvable,
 * and still advance.
 */

const FRAME = 1 / 60;
const RETRY_FRAMES = 72;
const ADVANCE_FRAMES = 48;

function harness({ capture = false, order = ORDER } = {}) {
  const listeners = new Map();
  const events = [];
  const ctx = {
    config: { capture, lockstep: true, seed: 'penrose', fixedDt: FRAME },
    time: { frame: 0, dt: FRAME, raw: 0, elapsed: 0, scale: 1 },
    engine: { scene: new THREE.Scene() },
    peek: (n) => (n === 'world' ? { order } : null),
    on: (e, fn) => { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(fn); },
    emit: (e, p) => { events.push({ event: e, payload: p }); for (const fn of listeners.get(e) ?? []) fn(p, ctx); },
  };
  return {
    ctx, events,
    of: (n) => events.filter((e) => e.event === n),
    pumpPlayer: (n = 1) => { for (let i = 0; i < n; i++) { ctx.time.frame += 1; player.update(ctx); } },
    pumpCampaign: (n = 1) => { for (let i = 0; i < n; i++) { ctx.time.frame += 1; campaign.update(ctx); } },
  };
}

async function bootPlayer(level = LEVELS['loop-01']) {
  const h = harness();
  await player.init(h.ctx);
  h.ctx.emit('level/loaded', level);
  return h;
}

/** Distinct platforms standable in any rotation — the figure's walkable size. */
function reachable(level) {
  const st = new Structure(level.cells);
  const out = new Set();
  for (let t = 0; t < 4; t++) for (const c of st.standable(t)) out.add(cellId(...c));
  return out.size;
}

/** Walk anywhere legal, avoiding the goal, until `n` moves have been spent. */
function wander(n) {
  for (let i = 0; i < n; i++) {
    const dirs = player.available();
    if (!dirs.length) return i;
    // Prefer a direction that does not land on the goal, so the wander does not
    // accidentally solve the level and stop the budget ever being reached.
    const safe = dirs.find((d) => player._resolve(d) !== player.goalId) ?? dirs[0];
    if (!player.step(safe)) return i;
  }
  return n;
}

// ------------------------------------------------------------------ the formula

test('the budget scales with the FIGURE, not with par alone', async () => {
  // The first version of this was par + MOVE_SLACK, which gave loop-01 — par 1
  // on a ten-platform tribar — a budget of 1.1x its own size. A player walking
  // once round the figure to look at it would have lost on level two, for doing
  // the thing the game is about. Every other level sat at 1.5x-1.9x.
  //
  // Reads the budget from the PLAYER. An earlier version recomputed the formula
  // here, so it asserted this test's arithmetic rather than the engine's — a
  // mutant that reverted the implementation to par + MOVE_SLACK survived it.
  for (const name of ORDER) {
    const level = LEVELS[name];
    const size = reachable(level);
    await bootPlayer(level);
    const budget = player.budget();

    assert.ok(budget >= level.premise.par + MOVE_SLACK,
      `${name}: budget ${budget} is below par + slack — a level could become unwinnable`);
    assert.ok(budget >= size * 1.5,
      `${name}: budget ${budget} is only ${(budget / size).toFixed(2)}x its ${size} platforms — ` +
      'walking the figure once to look at it must never cost the level');
  }
});

test('every level is solvable well inside its budget', async () => {
  for (const name of ORDER) {
    const level = LEVELS[name];
    const st = new Structure(level.cells);
    const h = await bootPlayer(level);
    const budget = player.budget();
    assert.ok(st.minWalksBetween(level.start, level.goal) < budget,
      `${name}: par is not inside its own budget`);
    h.ctx.emit('level/loaded', level);   // reset
  }
});

// ------------------------------------------------------------------ what costs

test('a blocked key costs nothing — probing a wall is free', async () => {
  await bootPlayer();
  const before = player.state().moves;
  // Every direction that is NOT currently legal.
  const legal = new Set(player.available().map(([a, b]) => `${a},${b}`));
  const blocked = Object.values(SCREEN_DELTA)
    .filter(([a, b]) => a !== 0 && b !== 0)
    .filter(([a, b]) => !legal.has(`${a},${b}`));
  assert.ok(blocked.length > 0, 'no blocked direction to test with');
  for (const d of blocked) assert.equal(player.step(d), false);
  assert.equal(player.state().moves, before,
    'a refused step charged the budget — a lost player pressing walls would be punished');
});

test('turning costs nothing — looking at the figure is free', async () => {
  const h = await bootPlayer();
  const before = player.state().moves;
  for (let i = 0; i < 12; i++) h.ctx.emit('world/rotated', { from: i % 4, to: (i + 1) % 4 });
  assert.equal(player.state().moves, before,
    'rotation charged the budget — crook-06 needs 6 turns against 5 walks, and a ' +
    'keypress budget would have taxed exactly the exploration this game is about');
  assert.equal(player.state().failed, false);
});

// ------------------------------------------------------------------ the failure

test('spending the budget without solving fails the level', async () => {
  const h = await bootPlayer(LEVELS['crook-06']);
  const budget = player.budget();
  assert.ok(budget > 0);

  const spent = wander(budget);
  assert.equal(spent, budget, `only ${spent} of ${budget} moves were walkable`);
  assert.equal(player.state().failed, true);
  assert.equal(player.state().solved, false);

  const failures = h.of('level/failed');
  assert.equal(failures.length, 1, 'level/failed must be emitted exactly once');
  assert.equal(failures[0].payload.budget, budget);
  assert.equal(failures[0].payload.moves, budget);
});

test('a failed level refuses further movement', async () => {
  await bootPlayer(LEVELS['crook-06']);
  wander(player.budget());
  assert.equal(player.state().failed, true);

  const cell = player.state().cell;
  const moves = player.state().moves;
  for (const d of Object.values(SCREEN_DELTA)) {
    if (d[0] === 0 || d[1] === 0) continue;
    assert.equal(player.step(d), false, 'a lost level still moved the avatar');
  }
  assert.equal(player.state().cell, cell);
  assert.equal(player.state().moves, moves,
    'moves kept climbing after the fail — the player could stroll onto the goal ' +
    'during the retry countdown, which would make the fail state advisory');
});

test('THE LAST MOVE ONTO THE GOAL WINS — the solve is checked before the fail', async () => {
  // The single most reversible decision in the feature. Swap the two checks and
  // the budget is one move tighter than it reads, on exactly the move that
  // matters most: a player who spends every allowed walk and lands the last one
  // on the goal would lose the level they just solved.
  // Set up the boundary EXACTLY rather than wandering towards it and hoping to
  // land on it. An earlier version of this test walked budget-1 moves and then
  // asserted only `if` the next route step happened to be the goal — which it
  // was not, so the test passed while exercising nothing. Poking `moves`
  // directly is the intrusive option and it is the one that actually pins the
  // off-by-one.
  const level = LEVELS['loop-01'];
  const h = await bootPlayer(level);
  const budget = player.budget();

  // loop-01's start is one illusion step from its goal, so this move both
  // solves the level and is the last one the budget permits.
  player.moves = budget - 1;
  const dir = Object.values(SCREEN_DELTA)
    .filter(([a, b]) => a !== 0 && b !== 0)
    .find((d) => player._resolve(d) === cellId(...level.goal));
  assert.ok(dir, 'loop-01 no longer offers its goal in one step — re-derive this test');

  assert.equal(player.step(dir), true, 'the winning move was refused');
  assert.equal(player.state().moves, budget, 'this must be the last permitted move');
  assert.equal(player.state().solved, true);
  assert.equal(player.state().failed, false,
    'the level was lost on the move that solved it — the fail check ran before the solve');
  assert.equal(h.of('level/failed').length, 0);
  assert.equal(h.of('level/solved').length, 1);
});

// ------------------------------------------------------------------ the retry

test('failing reloads the SAME level and does not advance the campaign', async () => {
  const h = harness();
  await campaign.init(h.ctx);
  h.ctx.emit('level/loaded', LEVELS[ORDER[2]]);
  assert.equal(campaign.state().index, 2);

  h.ctx.emit('level/failed', { moves: 20, budget: 20, turns: 0 });
  h.pumpCampaign(RETRY_FRAMES - 1);
  assert.equal(h.of('level/load-request').length, 0, 'the retry fired early');

  h.pumpCampaign(1);
  const requests = h.of('level/load-request');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.name, ORDER[2],
    'failing advanced the campaign instead of retrying — the player would be ' +
    'skipped past a level for losing it');
  assert.equal(campaign.state().index, 2);
  campaign.dispose();
});

test('the last level can be failed and retried, not just completed', async () => {
  // `level/solved` is guarded on `this.complete` because there is nothing to
  // advance to. Guarding the failure the same way would make the final level
  // unloseable, which is the one place a fail state most needs to work.
  //
  // The run must actually be COMPLETE for this to test anything. An earlier
  // version just loaded the last level and failed it, leaving `complete` false
  // — so a mutant that added `this.complete ||` to the failure guard survived.
  // The reachable path is: finish the game, press R on the last level (which
  // clears the player's solved flag but not the campaign's complete flag), then
  // run out of moves.
  const h = harness();
  await campaign.init(h.ctx);
  h.ctx.emit('level/loaded', LEVELS[ORDER.at(-1)]);

  h.ctx.emit('level/solved', { moves: 1, turns: 0 });
  h.pumpCampaign(ADVANCE_FRAMES);
  assert.equal(campaign.state().complete, true, 'the run did not complete — setup is wrong');
  assert.equal(h.of('campaign/complete').length, 1);

  h.ctx.emit('level/failed', { moves: 20, budget: 20, turns: 0 });
  h.pumpCampaign(RETRY_FRAMES);
  const requests = h.of('level/load-request');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.name, ORDER.at(-1));
  campaign.dispose();
});

test('INERT IN CAPTURE MODE — failing must not reload anything', async () => {
  // Same reason solving is inert: a level change during a capture would make the
  // pixel gate depend on how many frames the shutter waited.
  const h = harness({ capture: true });
  await campaign.init(h.ctx);
  h.ctx.emit('level/failed', { moves: 20, budget: 20, turns: 0 });
  h.pumpCampaign(RETRY_FRAMES * 3);
  assert.equal(h.of('level/load-request').length, 0);
  campaign.dispose();
});

test('a reload clears the failure', async () => {
  const h = await bootPlayer(LEVELS['crook-06']);
  wander(player.budget());
  assert.equal(player.state().failed, true);

  h.ctx.emit('level/loaded', LEVELS['crook-06']);
  assert.equal(player.state().failed, false);
  assert.equal(player.state().moves, 0);
  assert.equal(player.step(player.available()[0]), true, 'still refusing input after a reload');
});
