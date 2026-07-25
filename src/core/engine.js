import { Clock } from './clock.js';
import { makeRng } from './rng.js';

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

  /** Interactive loop. Never started in lockstep mode. */
  start() {
    if (this._running || this.config.lockstep) return;
    this._running = true;
    const tick = () => {
      if (!this._running) return;
      this.step();
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
