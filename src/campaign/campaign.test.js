import test from 'node:test';
import assert from 'node:assert/strict';

import campaign from './index.js';
import { LEVELS, ORDER } from '../world/levels.js';

/**
 * Progression is the biggest thing ever added to this project that the pixel
 * gate does not cover, by design. These tests are the whole of its coverage —
 * see the header of src/campaign/index.js for why that trade was taken.
 */

const ADVANCE_FRAMES = 48;

function harness({ capture = false, order = ORDER } = {}) {
  const listeners = new Map();
  const events = [];
  const ctx = {
    config: { capture, lockstep: true, seed: 'penrose', fixedDt: 1 / 60 },
    time: { frame: 0, dt: 1 / 60, raw: 0, elapsed: 0, scale: 1 },
    engine: {},
    peek: (n) => (n === 'world' ? { order } : null),
    on: (e, fn) => { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(fn); },
    emit: (e, p) => { events.push({ event: e, payload: p }); for (const fn of listeners.get(e) ?? []) fn(p, ctx); },
  };
  const pump = (n = 1) => { for (let i = 0; i < n; i++) { ctx.time.frame += 1; campaign.update(ctx); } };
  return { ctx, events, pump, of: (n) => events.filter((e) => e.event === n) };
}

// ------------------------------------------------------------ the premise

test('ORDER is a subset of LEVELS — a campaign cannot name a level that does not exist', () => {
  for (const name of ORDER) {
    assert.ok(LEVELS[name], `ORDER names "${name}" which is not in LEVELS`);
  }
  assert.equal(new Set(ORDER).size, ORDER.length, 'ORDER contains a duplicate');
});

test('the campaign curve is non-decreasing in required turns', () => {
  const turns = ORDER.map((n) => LEVELS[n].premise?.minTurns ?? 0);
  for (let i = 1; i < turns.length; i++) {
    assert.ok(turns[i] >= turns[i - 1],
      `${ORDER[i]} requires fewer turns than ${ORDER[i - 1]} — the curve goes backwards`);
  }
});

// ------------------------------------------------------------ capture inertness

test('INERT IN CAPTURE MODE — solving must not advance anything', async () => {
  const h = harness({ capture: true });
  await campaign.init(h.ctx);
  assert.equal(campaign.state().enabled, false);

  h.ctx.emit('level/solved', { moves: 1, turns: 0 });
  h.pump(ADVANCE_FRAMES * 3);

  assert.equal(h.of('level/load-request').length, 0,
    'a capture must never trigger a level change — the gate depends on it');
  assert.equal(h.of('campaign/complete').length, 0);
});

// ------------------------------------------------------------ advancing

test('the advance is FRAME-COUNTED, not immediate', async () => {
  const h = harness();
  await campaign.init(h.ctx);
  h.ctx.emit('level/loaded', { name: ORDER[0] });

  h.ctx.emit('level/solved', { moves: 1, turns: 0 });
  assert.equal(h.of('level/load-request').length, 0,
    'loading inside the solved handler would re-enter player.step()');

  h.pump(ADVANCE_FRAMES - 1);
  assert.equal(h.of('level/load-request').length, 0, 'advanced early');

  h.pump(1);
  assert.equal(h.of('level/load-request').length, 1);
  assert.deepEqual(h.of('level/load-request')[0].payload, { name: ORDER[1] });
});

test('each solve advances one step through the order', async () => {
  const h = harness();
  await campaign.init(h.ctx);

  for (let i = 0; i < ORDER.length - 1; i++) {
    h.ctx.emit('level/loaded', { name: ORDER[i] });
    h.ctx.emit('level/solved', { moves: 1, turns: 0 });
    h.pump(ADVANCE_FRAMES);
    const reqs = h.of('level/load-request');
    assert.deepEqual(reqs[reqs.length - 1].payload, { name: ORDER[i + 1] });
  }
});

test('solving the last level completes the campaign instead of wrapping', async () => {
  const h = harness();
  await campaign.init(h.ctx);
  h.ctx.emit('level/loaded', { name: ORDER[ORDER.length - 1] });

  h.ctx.emit('level/solved', { moves: 1, turns: 0 });
  h.pump(ADVANCE_FRAMES);

  assert.equal(h.of('level/load-request').length, 0, 'wrapped instead of completing');
  assert.equal(h.of('campaign/complete').length, 1);
  assert.equal(campaign.state().complete, true);
});

test('a second solve after completion does nothing', async () => {
  const h = harness();
  await campaign.init(h.ctx);
  h.ctx.emit('level/loaded', { name: ORDER[ORDER.length - 1] });
  h.ctx.emit('level/solved', { moves: 1, turns: 0 });
  h.pump(ADVANCE_FRAMES);

  h.ctx.emit('level/solved', { moves: 1, turns: 0 });
  h.pump(ADVANCE_FRAMES * 2);
  assert.equal(h.of('campaign/complete').length, 1, 'completed twice');
});

// ------------------------------------------------------------ robustness

test('the index follows any level load, including ?level= and a direct call', async () => {
  const h = harness();
  await campaign.init(h.ctx);

  h.ctx.emit('level/loaded', { name: ORDER[2] });
  assert.equal(campaign.state().index, 2);

  h.ctx.emit('level/solved', { moves: 1, turns: 0 });
  h.pump(ADVANCE_FRAMES);
  assert.deepEqual(h.of('level/load-request')[0].payload, { name: ORDER[3] });
});

test('a level outside the campaign leaves the index alone', async () => {
  const h = harness();
  await campaign.init(h.ctx);
  h.ctx.emit('level/loaded', { name: ORDER[1] });
  h.ctx.emit('level/loaded', { name: 'probe-01' });
  assert.equal(campaign.state().index, 1, 'a fixture must not move the campaign position');
});

test('loading a level cancels a pending advance', async () => {
  const h = harness();
  await campaign.init(h.ctx);
  h.ctx.emit('level/loaded', { name: ORDER[0] });
  h.ctx.emit('level/solved', { moves: 1, turns: 0 });

  h.ctx.emit('level/loaded', { name: ORDER[0] });   // e.g. a restart
  h.pump(ADVANCE_FRAMES * 2);
  assert.equal(h.of('level/load-request').length, 0,
    'a queued advance survived a level reload and would have double-skipped');
});

test('it survives world being absent', async () => {
  const h = harness();
  h.ctx.peek = () => null;
  await campaign.init(h.ctx);
  h.ctx.emit('level/solved', { moves: 1, turns: 0 });
  h.pump(ADVANCE_FRAMES);
  assert.equal(campaign.state().total, 0);
  assert.equal(h.of('campaign/complete').length, 1, 'an empty order completes rather than throwing');
});
