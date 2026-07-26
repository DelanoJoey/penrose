import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import world from './index.js';
import { LEVELS, DEFAULT_LEVEL } from './levels.js';

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

test('the scene holds exactly one world mesh after repeated loads', async () => {
  const h = harness();
  await world.init(h.ctx);
  for (const n of ['spur-01', 'span-02', 'shelf-03', 'loop-01']) world.loadLevel(n);

  const meshes = h.scene.children.filter((c) => c.isInstancedMesh);
  assert.equal(meshes.length, 1, `scene accumulated ${meshes.length} meshes`);
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
