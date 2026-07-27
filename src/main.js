import { makeConfig } from './core/config.js';
import { Engine } from './core/engine.js';
import render from './render/index.js';
import world from './world/index.js';
import campaign from './campaign/index.js';
import player from './player/index.js';
import ui from './ui/index.js';
import audio from './audio/index.js';
import { makeShots } from './dev/shots.js';
import { createTrace } from './dev/trace.js';

/**
 * Boot + lockstep harness hooks (ARCHITECTURE.md §4).
 *
 * The invariant the whole gate rests on: in lockstep mode this module starts NO
 * frame loop. State advances only inside __PUMP__. Nothing moves during the
 * harness's round trips, and nothing moves during the screenshot, so
 * ctx.time.frame at the shutter is BOOT_FRAMES + settle on every run and every
 * machine.
 */

/** Frames pumped during boot. MUST be a constant — never "pump until stable". */
const BOOT_FRAMES = 2;

const config = makeConfig();
const engine = new Engine(config);

// Registration order is the update order. render is first so ctx.engine.scene
// exists for everyone else; world emits level/loaded, so it must be added after
// player has had a chance to subscribe.
// FIRST, when enabled. addEventListener fires in registration order, so the
// recorder's keydown entry precedes the engine events that keypress causes and
// the trace reads in causal order. It consumes ctx.on and ctx.time only — both
// exist from the Engine constructor — so it does not need the scene the comment
// above is about. With the flag unset nothing is registered, no listener is
// attached, and the gate sees an unchanged program.
if (config.trace) globalThis.__TRACE__ = await engine.add(createTrace());

await engine.add(render);
await engine.add(player);
await engine.add(ui);
await engine.add(audio);
// BEFORE world, for the same reason player is: world emits `level/loaded` inside
// its own init, and a subscriber added afterwards never sees the opening level.
// Registered after it, the campaign sat at index 0 while the HUD played level 2.
await engine.add(campaign);
await engine.add(world);

const shots = makeShots(engine.ctx);

// ---------------------------------------------------------------- hooks
globalThis.__ENGINE__ = engine;
globalThis.__SHOTS__ = shots;

globalThis.__APPLY_SHOT__ = (name, opts = {}) => {
  const shot = shots[name];
  if (!shot) return { error: `unknown shot: ${name}`, available: Object.keys(shots) };
  shot(opts);
  return { ok: true, shot: name, frame: engine.time.frame };
};

/** Advance EXACTLY n engine frames, synchronously. */
globalThis.__PUMP__ = (n = 1) => engine.pump(n);

/**
 * Yield n animation frames with the simulation frozen, re-presenting the same
 * state, so the compositor has certainly picked up the final rendered frame
 * before the shutter. Does NOT advance the clock.
 */
globalThis.__PRESENT__ = (n = 2) =>
  new Promise((resolve) => {
    let left = n;
    const tick = () => {
      render.draw(engine.ctx);
      if (--left <= 0) return resolve(engine.time.frame);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

Object.defineProperty(globalThis, '__RENDER_INFO__', {
  get: () => ({ ...render.info(), frame: engine.time.frame }),
});

// ---------------------------------------------------------------- boot
if (config.shot) globalThis.__APPLY_SHOT__(config.shot);

engine.pump(BOOT_FRAMES);

if (!config.lockstep) engine.start();

globalThis.__READY__ = true;
