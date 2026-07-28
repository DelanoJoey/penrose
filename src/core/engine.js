import { Clock } from './clock.js';
import { makeRng } from './rng.js';

/**
 * Seconds of real time a single tick may absorb. A tab that was backgrounded
 * for thirty seconds must not return and fast-forward 1,800 steps.
 */
const MAX_CATCHUP = 0.25;

/** Hard bound on the inner loop, whatever the accumulator says. */
const MAX_STEPS = 5;

/**
 * The engine owns the ONLY frame loop in the project (ARCHITECTURE.md §3.1).
 * Subsystems never call requestAnimationFrame.
 *
 * In lockstep mode no loop is started at all — state advances only when the
 * harness calls step(), via window.__PUMP__. That is the property the pixel
 * gate rests on.
 */
export class Engine {
  constructor(config) {
    this.config = config;
    this.time = new Clock({ fixedDt: config.fixedDt });
    this.rng = makeRng(config.seed);
    this.subsystems = [];
    this._byName = new Map();
    this._running = false;
    this._rafId = null;

    /** Context handed to every subsystem. */
    this.ctx = {
      config,
      time: this.time,
      rng: this.rng,
      engine: this,
      peek: (name) => this._byName.get(name) ?? null,
      emit: (event, payload) => this._emit(event, payload),
      on: (event, fn) => this._on(event, fn),
    };

    this._listeners = new Map();
  }

  _on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  _emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of set) fn(payload, this.ctx);
  }

  async add(subsystem) {
    this.subsystems.push(subsystem);
    this._byName.set(subsystem.name, subsystem);
    await subsystem.init?.(this.ctx);
    return subsystem;
  }

  /**
   * Advance exactly one frame. dt is always the fixed timestep — real elapsed
   * time is never consulted. This is deliberate and load-bearing: see
   * ARCHITECTURE.md §1.
   */
  step() {
    this.time.advance(this.time.fixedDt);
    for (const s of this.subsystems) s.fixedUpdate?.(this.ctx, this.time.fixedDt);
    for (const s of this.subsystems) s.update?.(this.ctx);
    this._byName.get('render')?.draw?.(this.ctx);
  }

  /** Advance n frames synchronously. Used by window.__PUMP__. */
  pump(n = 1) {
    for (let i = 0; i < n; i++) this.step();
    return this.time.frame;
  }

  /**
   * Interactive loop. Never started in lockstep mode.
   *
   * WHY THIS IS AN ACCUMULATOR AND NOT ONE STEP PER FRAME. step() advances a
   * CONSTANT fixedDt, so calling it once per animation frame ties simulation
   * speed to display refresh rate: measured 1.844 sim-seconds per wall-second
   * on a 120 Hz panel, which made every wall-clock number in METHODOLOGY --
   * "1.633 s", "21.5 seconds of optimal play" -- true only at 60 Hz, and true
   * nowhere it was actually being read. See METHODOLOGY §P21.
   *
   * The timestamp comes from requestAnimationFrame's own argument, so this file
   * still reads no clock and src/core/engine.test.js can ban clock calls
   * outright rather than carve out an exception a later change could widen.
   *
   * Both clamps drop time rather than repaying it: after a stall the simulation
   * is permanently behind wall time, which is correct for a game with no
   * network and nothing to reconcile, and is what stops a returning tab from
   * animating a burst nobody can follow.
   */
  start() {
    if (this._running || this.config.lockstep) return;
    this._running = true;
    let last = null;
    let acc = 0;
    const tick = (now) => {
      if (!this._running) return;
      if (last === null) last = now;
      acc += Math.min((now - last) / 1000, MAX_CATCHUP);
      last = now;
      let steps = 0;
      while (acc >= this.time.fixedDt && steps < MAX_STEPS) {
        this.step();
        acc -= this.time.fixedDt;
        steps += 1;
      }
      // Hitting the bound means we are behind by more than we will ever repay.
      // Keeping the remainder would spend the next several frames draining it.
      if (steps === MAX_STEPS) acc = 0;
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  dispose() {
    this.stop();
    for (const s of this.subsystems) s.dispose?.();
  }
}
