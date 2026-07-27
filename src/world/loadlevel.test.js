import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import world from './index.js';
import { LEVELS, DEFAULT_LEVEL } from './levels.js';
import { rotateY } from '../geometry/index.js';

/**
 * Runtime level switching.
 *
 * Until this existed the level was fixed at init from boot config and `?level=`
 * was the only way to see a different one — which is why the game could not be
 * played through. See docs/superpowers/specs/2026-07-26-campaign-spine-design.md.
 */

const IMPRESSIONS = 2;

function harness({ level = null, capture = false } = {}) {
  const listeners = new Map();
  const events = [];
  const scene = new THREE.Scene();
  const ctx = {
    config: { capture, lockstep: true, seed: 'penrose', fixedDt: 1 / 60, level },
    time: { frame: 0, dt: 1 / 60, raw: 0, elapsed: 0, scale: 1 },
    engine: { scene },
    peek: () => null,
    on: (e, fn) => { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(fn); },
    emit: (e, p) => { events.push({ event: e, payload: p }); for (const fn of listeners.get(e) ?? []) fn(p, ctx); },
  };
  return { ctx, scene, events, of: (n) => events.filter((e) => e.event === n) };
}

test('init loads DEFAULT_LEVEL when config names none', async () => {
  const h = harness();
  await world.init(h.ctx);
  assert.equal(world.level.name, DEFAULT_LEVEL);
  assert.equal(h.of('level/loaded').length, 1);
  world.dispose();
});

test('loadLevel swaps the level and re-announces it', async () => {
  const h = harness();
  await world.init(h.ctx);
  const before = h.of('level/loaded').length;

  assert.equal(world.loadLevel('spur-01'), true);
  assert.equal(world.level.name, 'spur-01');
  assert.equal(world.structure.cells.length, LEVELS['spur-01'].cells.length);
  assert.equal(h.of('level/loaded').length, before + 1,
    'every load must announce itself — player and render reset off this event');
  world.dispose();
});

test('the mesh is rebuilt at the new cell count', async () => {
  const h = harness();
  await world.init(h.ctx);
  world.loadLevel('shelf-03');
  assert.equal(world.mesh.count, LEVELS['shelf-03'].cells.length * IMPRESSIONS);
  world.loadLevel('spur-01');
  assert.equal(world.mesh.count, LEVELS['spur-01'].cells.length * IMPRESSIONS);
  world.dispose();
});

test('loadLevel disposes the old mesh — a leak here grows on every level change', async () => {
  const h = harness();
  await world.init(h.ctx);

  const old = world.mesh;
  let geometryDisposed = 0, materialDisposed = 0;
  const g = old.geometry.dispose.bind(old.geometry);
  const m = old.material.dispose.bind(old.material);
  old.geometry.dispose = () => { geometryDisposed++; g(); };
  old.material.dispose = () => { materialDisposed++; m(); };

  world.loadLevel('span-02');

  assert.equal(geometryDisposed, 1, 'old geometry was not disposed');
  assert.equal(materialDisposed, 1, 'old material was not disposed');
  assert.equal(old.parent, null, 'old mesh was not removed from the scene');
  world.dispose();
});

test('the scene holds exactly one of each world mesh after repeated loads', async () => {
  /**
   * BY NAME, NOT BY COUNT. This asserted `length === 1` until the goal marker
   * arrived and legitimately made it 2 — and the obvious repair, changing the 1
   * to a 2, is satisfied just as happily by two level kits and no marker. That
   * is the leak this test exists to catch, so it would have gone quiet at the
   * exact moment it acquired a second thing to watch.
   */
  const h = harness();
  await world.init(h.ctx);
  for (const n of ['spur-01', 'span-02', 'shelf-03', 'loop-01']) world.loadLevel(n);

  const meshes = h.scene.children.filter((c) => c.isInstancedMesh);
  const byName = meshes.reduce((m, c) => m.set(c.name, (m.get(c.name) ?? 0) + 1), new Map());

  assert.equal(byName.get('level-kit'), 1,
    `scene holds ${byName.get('level-kit') ?? 0} level kits after 4 loads`);
  assert.equal(byName.get('goal-marker'), 1,
    `scene holds ${byName.get('goal-marker') ?? 0} goal markers after 4 loads`);
  assert.equal(meshes.length, 2,
    `scene holds an unexpected instanced mesh: ${meshes.map((c) => c.name || '(unnamed)').join(', ')}`);
  world.dispose();
});

test('rotation resets to 0 on load, so a level never opens mid-turn', async () => {
  const h = harness();
  await world.init(h.ctx);
  world.setRotation(2);
  assert.equal(world.turns, 2);
  world.loadLevel('spur-01');
  assert.equal(world.turns, 0);
  world.dispose();
});

test('an unknown level is refused, not loaded as undefined', async () => {
  const h = harness();
  await world.init(h.ctx);
  const was = world.level.name;
  assert.equal(world.loadLevel('no-such-level'), false);
  assert.equal(world.loadLevel(null), false);
  assert.equal(world.loadLevel(undefined), false);
  assert.equal(world.level.name, was, 'a refused load must not disturb the current level');
  world.dispose();
});

test('level/load-request drives it, accepting a name or a payload', async () => {
  const h = harness();
  await world.init(h.ctx);

  h.ctx.emit('level/load-request', { name: 'shelf-03' });
  assert.equal(world.level.name, 'shelf-03');

  h.ctx.emit('level/load-request', 'spur-01');
  assert.equal(world.level.name, 'spur-01');
  world.dispose();
});

test('the goal marker follows the world through all four rotations', async () => {
  /**
   * The marker is a SEPARATE mesh from the level kit, so nothing about the kit's
   * instance matrices carries it. Placed once at install it would sit at the
   * unrotated goal and drift off its own cell the moment the player pressed Q —
   * visible instantly in play, and invisible to every static shot in the set.
   *
   * The + 1 is the occupant convention, not a nudge: a cell is a solid block and
   * whatever stands on it sits a cell higher (src/player `_restPosition`).
   * Placed at plain y the first time, which buried the ring inside the block and
   * rendered nothing while the HUD told the player to walk to it.
   */
  const h = harness();
  await world.init(h.ctx);
  world.loadLevel('span-02');

  const marker = h.scene.children.find((c) => c.name === 'goal-marker');
  assert.ok(marker, 'no goal marker in the scene');

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (const turns of [0, 1, 2, 3]) {
    world.setRotation(turns);
    marker.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    const [gx, gy, gz] = rotateY(world.level.goal, turns);
    assert.equal(p.x, gx, `marker x wrong at turn ${turns}`);
    assert.equal(p.z, gz, `marker z wrong at turn ${turns}`);
    assert.equal(p.y, gy + 1,
      `marker y is ${p.y} at turn ${turns}, expected ${gy + 1} — an occupant sits ON the block, ` +
      'and at plain y the ring renders inside it and is never seen');
  }
  world.dispose();
});
