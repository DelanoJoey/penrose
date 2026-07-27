/**
 * The campaign: what happens after a level is solved.
 *
 * Sequencing lives here rather than in `world` (which owns geometry, not
 * progression) or in `player` (which owns traversal). It listens for
 * `level/solved` and asks for the next level with `level/load-request`, the same
 * request shape `ui` uses to ask `render` for a rotation.
 *
 * It reads the order through `ctx.peek('world').order` rather than importing
 * `src/world/levels.js`, because ARCHITECTURE.md §3.3 permits subsystems to
 * reach each other only through `ctx.peek` for a read.
 *
 * ============================ TWO DELIBERATE CHOICES ============================
 *
 * 1. INERT IN CAPTURE MODE. This subsystem does nothing when `config.capture` is
 *    set. Progression is a path that advances state in response to an event,
 *    which is exactly the shape that makes captures nondeterministic — and the
 *    pixel gate is this project's actual artifact.
 *
 *    The cost is real and worth stating: the progression path is therefore NOT
 *    pixel-gated, and is covered by unit tests only. It is the right trade only
 *    because the alternative risks the gate itself. It also closes a future
 *    foot-gun: `stepmid` already calls `player.step()` during a capture, and a
 *    motion shot that ever stepped onto a GOAL would otherwise trigger a level
 *    load mid-capture.
 *
 * 2. THE ADVANCE IS FRAME-COUNTED, NOT IMMEDIATE. Loading the next level inside
 *    the `level/solved` handler would re-enter `player.step()` while it is still
 *    executing — `level/loaded` resets the player's cell and counters mid-call —
 *    and would teleport the player the instant they touched the goal, with no
 *    beat to register that they had won.
 *
 *    So the advance is scheduled as a countdown in FRAMES and served from
 *    update(). Frames, never wall-clock: ARCHITECTURE.md §1 forbids setTimeout
 *    and anything else time-derived, and a frame count is a pure function of the
 *    fixed timestep.
 */

/** Frames between solving a level and the next one loading. 0.8 s at 1/60. */
const ADVANCE_FRAMES = 48;

/**
 * Frames between running out of moves and the level reloading. 1.2 s at 1/60.
 *
 * Longer than ADVANCE_FRAMES on purpose: "Solved" confirms something the player
 * already knows they did, and "Out of moves" is news. The extra 0.4 s is time to
 * read it before the board resets under them.
 */
const RETRY_FRAMES = 72;

export default {
  name: 'campaign',

  async init(ctx) {
    this.ctx = ctx;
    /** False in capture mode — see the header. */
    this.enabled = ctx.config.capture !== true;
    this.index = 0;
    this.complete = false;
    this._pending = 0;
    /**
     * What the countdown is counting down TO: 'advance' or 'retry'.
     *
     * One scheduler with an action rather than two counters, because two could
     * both be armed and the order they fired in would decide whether a level
     * advanced or reloaded. Solved and failed are already mutually exclusive in
     * src/player, so this is belt and braces — but the failure it prevents is
     * the campaign silently skipping a level, which no test would read as wrong.
     */
    this._action = null;

    // Seed from world if it has ALREADY loaded, so registration order is not
    // load-bearing. main.js adds this subsystem before world so the event below
    // is heard, but a future reorder must not silently reset the run to level 1.
    this._sync(ctx.peek?.('world')?.level?.name);

    // Keep the index honest when a level arrives by any route, including
    // `?level=` and a direct loadLevel, not only through this subsystem.
    ctx.on('level/loaded', (level) => {
      this._sync(level?.name);
      this._pending = 0;
      this._action = null;
    });

    ctx.on('level/solved', () => {
      if (!this.enabled || this.complete || this._pending > 0) return;
      this._pending = ADVANCE_FRAMES;
      this._action = 'advance';
    });

    /**
     * Out of moves — reload the SAME level rather than advancing.
     *
     * Not `this.complete`-guarded, unlike solved: finishing the run means there
     * is no next level to advance to, but a level can still be failed and
     * retried afterwards. Guarding on it would make the last level unloseable.
     */
    ctx.on('level/failed', () => {
      if (!this.enabled || this._pending > 0) return;
      this._pending = RETRY_FRAMES;
      this._action = 'retry';
    });
  },

  /** Point the index at `name` if it is part of the campaign. */
  _sync(name) {
    const i = this._order().indexOf(name);
    if (i >= 0) this.index = i;
  },

  /** The campaign order, read from world. Empty if world is not present. */
  _order() {
    const order = this.ctx?.peek?.('world')?.order;
    return Array.isArray(order) ? order : [];
  },

  /** Read-only state for the UI. Contains nothing time-derived. */
  state() {
    const order = this._order();
    return {
      index: this.index,
      total: order.length,
      complete: this.complete,
      enabled: this.enabled,
    };
  },

  update(ctx) {
    if (this._pending <= 0) return;
    this._pending -= 1;
    if (this._pending > 0) return;

    const action = this._action;
    this._action = null;
    const order = this._order();

    if (action === 'retry') {
      const again = order[this.index] ?? ctx.peek?.('world')?.level?.name;
      if (again) ctx.emit('level/load-request', { name: again });
      return;
    }

    const next = order[this.index + 1];
    if (next) {
      ctx.emit('level/load-request', { name: next });
      return;
    }
    this.complete = true;
    ctx.emit('campaign/complete', { levels: order.length });
  },

  dispose() {
    this._pending = 0;
    this._action = null;
  },
};
