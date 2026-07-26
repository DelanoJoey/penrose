import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import player from './index.js';
import { LEVELS } from '../world/levels.js';
import {
  Structure, cellId, screenKey, rotateY, SCREEN_DELTA,
} from '../geometry/index.js';

/**
 * Traversal tests for the avatar.
 *
 * Lives in src/player because that is this subsystem's directory; `npm test`
 * globs test/*.test.js, so integration should either widen that glob or move
 * this file. Until then:  node --test src/player/traversal.test.js
 *
 * No renderer is needed — the avatar is a plain scene object and nothing here
 * touches WebGL or the DOM.
 */

const LEVEL = LEVELS['loop-01'];
const FRAME = 1 / 60;
/** Frames for a 0.22 s step at 1/60. */
const MOVE_FRAMES = 16;

function harness() {
  const listeners = new Map();
  const events = [];
  const ctx = {
    config: { capture: false, lockstep: true, seed: 'penrose', fixedDt: FRAME },
    time: { frame: 0, dt: FRAME, raw: 0, elapsed: 0, scale: 1 },
    engine: { scene: new THREE.Scene() },
    peek: () => null,
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    emit: (event, payload) => {
      events.push({ event, payload });
      for (const fn of listeners.get(event) ?? []) fn(payload, ctx);
    },
  };
  const pump = (n = 1) => {
    for (let i = 0; i < n; i++) { ctx.time.frame += 1; player.update(ctx); }
  };
  return { ctx, events, pump, of: (name) => events.filter((e) => e.event === name) };
}

async function boot(level = LEVEL) {
  const h = harness();
  await player.init(h.ctx);
  h.ctx.emit('level/loaded', level);
  return h;
}

// ---------------------------------------------------------------- the premise

test('the premise: start and goal are ONE screen step apart and 14 units apart in 3D', async () => {
  const h = await boot();
  assert.equal(player.state().cell, '1,0,0');

  // The direction is derived from the level, not hardcoded: where does the goal
  // sit on screen relative to the start?
  const [a0, b0] = screenKey(...LEVEL.start);
  const [a1, b1] = screenKey(...LEVEL.goal);
  const delta = [a1 - a0, b1 - b0];
  assert.deepEqual(delta, SCREEN_DELTA['-x'], 'goal should be one screen step from start');

  const manhattan = LEVEL.goal.reduce((s, v, i) => s + Math.abs(v - LEVEL.start[i]), 0);
  assert.equal(manhattan, 14);

  assert.ok(player.available().some(([x, y]) => x === delta[0] && y === delta[1]),
    'the illusion step must be offered from the start cell');

  assert.equal(player.step(delta), true, 'the avatar must be able to walk the illusion edge');
  assert.equal(player.state().cell, cellId(...LEVEL.goal));
  assert.equal(player.state().moves, 1);
  assert.equal(player.state().solved, true);

  const moved = h.of('player/moved');
  assert.equal(moved.length, 1);
  assert.deepEqual(moved[0].payload, { from: '1,0,0', to: '5,5,5', viaIllusion: true });

  const solved = h.of('level/solved');
  assert.equal(solved.length, 1);
  assert.equal(solved[0].payload.moves, 1);
  assert.equal(solved[0].payload.turns, 0);

  assert.equal(h.of('player/blocked').length, 0);
});

test('an ordinary neighbour is NOT flagged as an illusion', async () => {
  const h = await boot();
  assert.equal(player.step(SCREEN_DELTA['+x']), true);
  assert.deepEqual(h.of('player/moved')[0].payload,
    { from: '1,0,0', to: '2,0,0', viaIllusion: false });
  assert.equal(h.of('level/solved').length, 0);
  assert.equal(player.state().solved, false);
});

test('a direction with no edge emits player/blocked and does not move', async () => {
  const h = await boot();
  assert.equal(player.step(SCREEN_DELTA['+z']), false);
  assert.equal(player.state().cell, '1,0,0');
  assert.equal(player.state().moves, 0);
  assert.equal(h.of('player/moved').length, 0);
  assert.deepEqual(h.of('player/blocked')[0].payload,
    { from: '1,0,0', direction: SCREEN_DELTA['+z'] });
});

// ------------------------------------------------- agreement with the analyser

test('legal directions match the path graph exactly, in every rotation', async () => {
  const h = await boot();
  const structure = new Structure(LEVEL.cells);

  for (let turns = 0; turns < 4; turns++) {
    h.ctx.emit('world/rotated', { from: (turns + 3) % 4, to: turns });
    const edges = structure.pathGraph(turns).get(player.state().cell) ?? [];
    assert.equal(player.available().length, edges.length,
      `rotation ${turns}: avatar offers ${player.available().length} directions, ` +
      `the path graph has ${edges.length} edges`);

    // And every direction the avatar accepts must land on a graph neighbour.
    for (const dir of player.available()) {
      const before = player.state().cell;
      assert.equal(player.step(dir), true);
      assert.ok(edges.includes(player.state().cell),
        `stepped to ${player.state().cell}, which is not a neighbour of ${before}`);
      // Walk back, so each rotation is probed from the same cell.
      assert.equal(player.step([-dir[0], -dir[1]]), true);
      assert.equal(player.state().cell, before);
    }
  }
});

test('rotation rewires the illusion edge rather than teleporting the player', async () => {
  const h = await boot();
  const structure = new Structure(LEVEL.cells);
  const goal = cellId(...LEVEL.goal);
  const illusionDir = SCREEN_DELTA['-x'];

  // The whole point of the level: the start-to-goal edge exists in exactly one
  // rotation. Assert that from the graph, then check the avatar agrees.
  const withEdge = [0, 1, 2, 3]
    .filter((t) => (structure.pathGraph(t).get('1,0,0') ?? []).includes(goal));
  assert.deepEqual(withEdge, [0], 'the illusion edge must be rotation-dependent');

  for (const turns of [1, 2, 3]) {
    h.ctx.emit('world/rotated', { from: (turns + 3) % 4, to: turns });
    assert.equal(player.state().cell, '1,0,0', 'rotation must not move the player');
    // Ordinary neighbours survive — rotation rewires, it does not strand. But
    // NOTHING reachable in one step is the goal, and nothing is an illusion.
    assert.ok(player.available().length > 0);
    for (const dir of player.available()) {
      assert.equal(player.step(dir), true);
      assert.notEqual(player.state().cell, goal, `rotation ${turns} reached the goal`);
      const last = h.of('player/moved').at(-1).payload;
      assert.equal(last.viaIllusion, false, `rotation ${turns} exposed an illusion edge`);
      assert.equal(player.step([-dir[0], -dir[1]]), true);
    }
    assert.equal(player.state().cell, '1,0,0');
    assert.equal(structure.findPath(LEVEL.start, LEVEL.goal, turns), null,
      `rotation ${turns} should not reach the goal at all`);
  }
  assert.equal(player.state().solved, false);

  h.ctx.emit('world/rotated', { from: 3, to: 0 });
  assert.equal(player.step(illusionDir), true, 'rotating back must reopen it');
  assert.equal(player.state().cell, goal);
  assert.equal(h.of('level/solved')[0].payload.turns, 4, 'four quarter-turns were spent');
});

// ---------------------------------------------------------------- the mesh

test('the avatar is one instanced draw call sharing the level kit program', async () => {
  await boot();
  const mesh = player.mesh;
  assert.ok(mesh.isInstancedMesh, 'must be an InstancedMesh');
  assert.equal(mesh.count, 1);
  assert.ok(mesh.instanceColor, 'instanceColor is part of the program cache key');
  assert.equal(mesh.material.vertexColors, true);
  assert.equal(mesh.material.type, 'MeshBasicMaterial');
  assert.ok(mesh.geometry.getAttribute('color'), 'three-tone read comes from vertex colours');
  assert.equal(mesh.visible, true);
});

test('the avatar sits one unit above its platform, feet on the surface', async () => {
  await boot();
  // Goal cell is unoccluded, so no view bias is applied there and the position
  // is the plain one.
  player.step(SCREEN_DELTA['-x']);
  for (let i = 0; i < MOVE_FRAMES; i++) player.update({ time: { dt: FRAME } });

  assert.deepEqual(
    [player.mesh.position.x, player.mesh.position.y, player.mesh.position.z],
    [5, 6, 5], 'avatar cell is exactly one unit above the platform cell');

  player.mesh.geometry.computeBoundingBox();
  assert.equal(player.mesh.geometry.boundingBox.min.y, -0.5,
    'feet must sit on the top face of the platform below');
});

test('the view bias moves the avatar nowhere on screen', async () => {
  await boot();
  // At loop-01's start the avatar's cell is aliased by a block twelve units
  // nearer the camera, so a bias is applied. It must be invisible: same screen
  // key, greater depth.
  const p = player.mesh.position;
  assert.deepEqual(screenKey(p.x, p.y, p.z), screenKey(1, 1, 0),
    'the bias must be a pure (t,t,t) shift');
  assert.ok(p.x + p.y + p.z > 1 + 1 + 0, 'the bias must move the avatar toward the camera');
  assert.equal(p.x - 1, p.y - 1, 'shift must be equal on all three axes');
  assert.equal(p.y - 1, p.z - 0);
});

// ---------------------------------------------------------------- determinism

test('movement is driven by dt alone and lands exactly on the target', async () => {
  await boot();
  player.step(SCREEN_DELTA['+x']);

  const path = [];
  for (let i = 0; i < MOVE_FRAMES; i++) {
    player.update({ time: { dt: FRAME } });
    path.push(player.mesh.position.toArray());
  }
  // Strictly monotone screen travel, then a hard stop at the resting position.
  assert.deepEqual(path.at(-1), [2, 1, 0]);
  assert.notDeepEqual(path[0], path[1], 'the avatar must actually interpolate');

  // Zero dt must freeze it: nothing here may consult a wall clock.
  const frozen = player.mesh.position.toArray();
  for (let i = 0; i < 5; i++) player.update({ time: { dt: 0 } });
  assert.deepEqual(player.mesh.position.toArray(), frozen);
});

test('the same dt sequence produces the same positions, twice', async () => {
  const run = async () => {
    await boot();
    const out = [];
    for (const dir of [SCREEN_DELTA['+x'], SCREEN_DELTA['+x'], SCREEN_DELTA['-x']]) {
      player.step(dir);
      for (let i = 0; i < MOVE_FRAMES; i++) {
        player.update({ time: { dt: FRAME } });
        out.push(player.mesh.position.toArray().join(','));
      }
    }
    return out.join('|');
  };
  assert.equal(await run(), await run(), 'avatar motion drifted between identical runs');
});

test('state() is discrete: advancing time changes nothing in it', async () => {
  await boot();
  player.step(SCREEN_DELTA['+x']);
  const before = player.state();
  assert.deepEqual(Object.keys(before).sort(), ['cell', 'level', 'moves', 'solved']);
  for (let i = 0; i < 120; i++) player.update({ time: { dt: FRAME } });
  assert.deepEqual(player.state(), before);
  assert.equal(before.cell, '2,0,0', 'the logical cell commits at step(), not at arrival');
});

// ---------------------------------------------------------------- robustness

test('stepping before a level loads is a no-op, not a throw', async () => {
  const h = harness();
  await player.init(h.ctx);
  assert.equal(player.step(SCREEN_DELTA['+x']), false);
  assert.deepEqual(player.available(), []);
  assert.equal(h.events.length, 0);
  assert.deepEqual(player.state(), { cell: null, moves: 0, solved: false, level: null });
});

test('malformed directions are rejected without moving', async () => {
  const h = await boot();
  for (const bad of [null, undefined, [], [1], [NaN, 1], 'left', 7]) {
    assert.equal(player.step(bad), false);
  }
  assert.equal(player.state().cell, '1,0,0');
  assert.equal(h.of('player/moved').length, 0);
});

test('an interrupted move retargets instead of stranding the avatar', async () => {
  await boot();
  player.step(SCREEN_DELTA['+x']);
  player.update({ time: { dt: FRAME * 3 } });
  player.step(SCREEN_DELTA['+x']);           // interrupt mid-flight
  for (let i = 0; i < MOVE_FRAMES; i++) player.update({ time: { dt: FRAME } });
  assert.equal(player.state().cell, '3,0,0');
  assert.deepEqual(player.mesh.position.toArray(), [3, 1, 0]);
});

test('rotation completes an in-flight move instantly at the new orientation', async () => {
  const h = await boot();
  player.step(SCREEN_DELTA['+x']);
  player.update({ time: { dt: FRAME } });
  h.ctx.emit('world/rotated', { from: 0, to: 1 });

  const [x, y, z] = rotateY([2, 0, 0], 1);
  const p = player.mesh.position;
  assert.deepEqual(screenKey(p.x, p.y, p.z), screenKey(x, y + 1, z),
    'after rotating, the avatar must be on its own cell in the new orientation');
  assert.equal(player.state().cell, '2,0,0');
});
