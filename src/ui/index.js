/**
 * DOM overlay HUD.
 *
 * STUB — the interface and contract are fixed; the behaviour is not implemented.
 *
 * HARD CONSTRAINTS — this subsystem is the single most likely thing in the
 * project to break the pixel gate, because the DOM has its own animation clock
 * that the engine does not control.
 *
 * 1. NO CSS transitions or animations on anything that appears in a capture.
 *    `transition: opacity 200ms` is driven by the browser's timeline, not by
 *    ctx.time, so a captured frame would depend on how long the harness took to
 *    get there. This is exactly the class of bug that cost the upstream project
 *    two remediation phases.
 *
 * 2. NO time display of any kind. No elapsed timer, no clock, no "x seconds
 *    ago". A rendered timestamp is a guaranteed gate failure.
 *
 * 3. Fonts must not be fetched from the network. A webfont that arrives late
 *    changes text metrics between runs. Use a system font stack.
 *
 * 4. In `ctx.config.capture` the HUD must render DETERMINISTICALLY or not at
 *    all. Either is acceptable; hiding it is safer and is the default.
 */

export default {
  name: 'ui',

  async init(ctx) {
    this.ctx = ctx;

    this.root = document.createElement('div');
    this.root.id = 'hud';
    // Hidden during capture by default. If you make the HUD visible in capture,
    // you own proving the gate still passes.
    this.root.style.display = ctx.config.capture ? 'none' : 'block';
    document.body.appendChild(this.root);

    // TODO(P2): level name, rotation indicator, move count, and a solved state.
    // Read player state via ctx.peek('player').state() — never by importing the
    // player module.
    //
    // Also owns keyboard input mapping: four screen-space directions plus
    // rotate-left / rotate-right. Input must be ignored entirely when
    // ctx.config.capture is true, or a stray key event could desync a shot.
  },

  update(ctx) {
    // TODO(P2): refresh from ctx.peek('player').state(). Cheap string compare
    // before writing to the DOM — an unconditional innerHTML write every frame
    // is a layout thrash and will show up in the profiler as a hitch.
  },

  dispose() {
    this.root?.remove();
  },
};
