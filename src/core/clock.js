/**
 * The only clock in the project.
 *
 * Nothing that affects rendered output may read wall-clock time. See
 * ARCHITECTURE.md §1. In lockstep mode `advance()` is always called with the
 * same fixed dt, which is what makes frame N reproducible across runs and
 * machines: harness round-trip latency cannot leak into simulation state.
 */
export class Clock {
  constructor({ fixedDt = 1 / 60 } = {}) {
    this.fixedDt = fixedDt;
    /** Integer frame index. Starts at 0, incremented by advance(). */
    this.frame = 0;
    /** Scaled seconds elapsed this frame. */
    this.dt = fixedDt;
    /** Unscaled seconds since boot. */
    this.raw = 0;
    /** Scaled seconds since boot. */
    this.elapsed = 0;
    /** Time scale. 1.0 normally; 0 freezes simulation without stopping render. */
    this.scale = 1;
  }

  advance(dt = this.fixedDt) {
    this.dt = dt * this.scale;
    this.raw += dt;
    this.elapsed += this.dt;
    this.frame += 1;
  }

  reset() {
    this.frame = 0;
    this.raw = 0;
    this.elapsed = 0;
    this.dt = this.fixedDt;
  }
}
