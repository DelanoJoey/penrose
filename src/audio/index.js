/**
 * Procedural audio. No sound files, ever — everything is synthesised.
 *
 * STUB — the interface and contract are fixed; the behaviour is not implemented.
 *
 * HARD CONSTRAINTS
 *
 * 1. MUST be completely inert when `ctx.config.capture` is true. Capture runs
 *    are headless and muted, but an AudioContext that throws on construction
 *    would fail every shot in the gate. Bail out of init early.
 *
 * 2. MUST NOT touch ctx.time or affect any rendered value. Audio is downstream
 *    of everything. If audio scheduling ever influences a visual, the pixel gate
 *    becomes dependent on the audio clock, which is a separate hardware clock
 *    that this project does not control.
 *
 * 3. Web Audio has its OWN clock (audioCtx.currentTime). Using it to schedule
 *    sound is correct and expected. Using it for anything else is a violation of
 *    ARCHITECTURE.md §1.
 *
 * 4. Do not construct the AudioContext at init. Browsers block it until a user
 *    gesture; construct lazily on first real interaction.
 */

export default {
  name: 'audio',

  async init(ctx) {
    this.ctx = ctx;
    this.enabled = !ctx.config.capture;
    this.audio = null;
    if (!this.enabled) return;

    // TODO(P2): subscribe to player/moved, player/blocked, world/rotated,
    // level/solved. See ARCHITECTURE.md §3.3 for payloads.
    //
    // Suggested character, to be argued with rather than followed: a soft
    // marimba-ish tone for an ordinary step, the same tone detuned and
    // reverberant for a step taken across an illusion edge — the sound is the
    // only channel that can tell the player something impossible just happened,
    // since the whole point is that it looks normal.
  },

  /** Lazily construct the AudioContext. Browsers require a gesture first. */
  _ensure() {
    if (!this.enabled || this.audio) return this.audio;
    // TODO(P2)
    return null;
  },

  dispose() {
    this.audio?.close?.();
  },
};
