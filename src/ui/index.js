/**
 * DOM overlay HUD + keyboard input.
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
 *
 * 5. NO INPUT PATH IN LOCKSTEP. ARCHITECTURE.md §4: "Nothing advances during
 *    harness round trips... If you add a code path that advances state outside
 *    __PUMP__, you have broken the gate." A keydown listener is exactly such a
 *    path, and `capture` is the wrong flag to guard it with — `?lockstep=1`
 *    without `capture=1` is a legitimate debugging load, and a keypress there
 *    advanced world.turns and player.moves with ctx.time.frame pinned. Input is
 *    therefore gated on `!(capture || lockstep)`, independently of whether the
 *    HUD itself is built.
 *
 * HOW THOSE ARE HONOURED HERE
 *
 * - The stylesheet below contains no `transition`, no `animation`, no
 *   `@keyframes` and no `@font-face`/`@import`. Every font named is a local
 *   system face; nothing is fetched. State changes are instantaneous class and
 *   textContent swaps, so a captured frame is a pure function of engine state.
 * - Nothing here reads a clock. The only numbers displayed are the move count
 *   and the rotation index, both of which are engine state.
 * - In capture mode this subsystem goes fully inert: the root node is created
 *   and hidden, and then init returns before building any child node, before
 *   injecting the stylesheet, and before attaching any listener. update() also
 *   returns immediately. There is nothing to lay out, nothing to paint and no
 *   input path at all, so no capture can depend on it. Making the HUD visible
 *   in capture means owning the proof that the gate still passes.
 */

import { HORIZONTAL_STEPS } from '../geometry/index.js';

/**
 * SCREEN-SPACE DIRECTIONS
 *
 * geometry's screen invariant is (a, b) with a = x - z and b = x + z - 2y.
 * Against the render camera (position (30,30,30), lookAt origin, three.js
 * lookAt convention) the basis vectors come out as
 *
 *     right = ( 1, 0, -1)/sqrt2   ->  screen_x =  a / sqrt2
 *     up    = (-1, 2, -1)/sqrt6   ->  screen_y = -b / sqrt6
 *
 * measured, not assumed. So +a is RIGHT on screen and +b is DOWN on screen.
 * Every horizontal move therefore reads as a screen diagonal:
 *
 *     -z = (+1,-1) up-right     +x = (+1,+1) down-right
 *     -x = (-1,-1) up-left      +z = (-1,+1) down-left
 *
 * Selecting each direction out of HORIZONTAL_STEPS by its screen signs rather
 * than by array index means the mapping survives a reordering of that array: if
 * geometry ever changes the set, pick() returns undefined and init warns,
 * instead of the avatar silently walking the wrong way.
 */
const pick = (da, db) => HORIZONTAL_STEPS.find(([a, b]) => a === da && b === db);

const SCREEN_DIR = {
  upRight:   pick(1, -1),   // -z
  downRight: pick(1, 1),    // +x
  downLeft:  pick(-1, 1),   // +z
  upLeft:    pick(-1, -1),  // -x
};

/**
 * Fail CLOSED, at module load, if geometry ever stops providing one of the four
 * screen diagonals.
 *
 * A console.warn was not loud enough: it was emitted after the capture-mode
 * early return (so never in a capture), and it left a KEY_ACTIONS entry whose
 * `.move` was undefined — _handleKey would then resolve the action, call
 * preventDefault(), match neither branch, and silently swallow the keypress. A
 * throw here is a hard, immediate, testable failure instead of a dead arrow key.
 */
for (const [name, step] of Object.entries(SCREEN_DIR)) {
  if (!step) {
    throw new Error(
      `[ui] geometry HORIZONTAL_STEPS has no entry for screen direction ${name}; ` +
      'the keymap cannot be built. Fix src/geometry or this mapping — do not ship ' +
      'a keymap with a hole in it.');
  }
}

/**
 * KEY MAPPING
 *
 * The arrow cross is rotated 45 degrees clockwise onto the four screen
 * diagonals. That particular 45 (rather than the anticlockwise one) is chosen
 * because it lines the horizontal keys up with the x axis and the vertical keys
 * up with the z axis: Right/Left drive +x/-x, Down/Up drive +z/-z. The other
 * choice puts x on the vertical keys, which is harder to hold in your head.
 *
 * Q/E rotate. A +1 turn sweeps the structure ANTICLOCKWISE on screen — measured
 * by projecting cell (3,0,0) through the render camera across the four rotation
 * states, which gives screen angles -30, +30, +150, +210 degrees. Anticlockwise
 * is "left", so Q (the left-hand key) is +1 and E is -1.
 *
 * Keyed on KeyboardEvent.code so the physical WASD/QE cluster works on
 * non-QWERTY layouts, with a KeyboardEvent.key fallback for the arrows and for
 * any environment that does not populate `code`.
 */
const KEY_ACTIONS = {
  // move — screen-space
  ArrowUp:      { move: SCREEN_DIR.upRight },
  ArrowRight:   { move: SCREEN_DIR.downRight },
  ArrowDown:    { move: SCREEN_DIR.downLeft },
  ArrowLeft:    { move: SCREEN_DIR.upLeft },
  KeyW:         { move: SCREEN_DIR.upRight },
  KeyD:         { move: SCREEN_DIR.downRight },
  KeyS:         { move: SCREEN_DIR.downLeft },
  KeyA:         { move: SCREEN_DIR.upLeft },
  w:            { move: SCREEN_DIR.upRight },
  d:            { move: SCREEN_DIR.downRight },
  s:            { move: SCREEN_DIR.downLeft },
  a:            { move: SCREEN_DIR.upLeft },

  // rotate — quarter turns
  KeyQ:         { rotate: +1 },
  KeyE:         { rotate: -1 },
  q:            { rotate: +1 },
  e:            { rotate: -1 },
  BracketLeft:  { rotate: +1 },
  BracketRight: { rotate: -1 },
  '[':          { rotate: +1 },
  ']':          { rotate: -1 },
};

/**
 * Resolve a keydown to an action. Pure — exported so it can be unit tested.
 *
 * Own-property lookup only. A bare `KEY_ACTIONS[k]` walks the prototype chain,
 * so a key named "constructor" or "toString" would resolve to an inherited
 * function and be treated as an action.
 */
const lookup = (k) =>
  (typeof k === 'string' && Object.hasOwn(KEY_ACTIONS, k) ? KEY_ACTIONS[k] : null);

export function resolveKey(code, key) {
  return lookup(code) ?? lookup(key) ?? lookup(typeof key === 'string' ? key.toLowerCase() : null) ?? null;
}

export { SCREEN_DIR, KEY_ACTIONS };

const ROTATIONS = 4;

// ---------------------------------------------------------------- styling
// Colours are read from the render palette rather than duplicated, so a palette
// change moves the HUD with the scene instead of leaving it stale. The palette
// arrives as an argument, read at init via ctx.peek('render').palette — src/ui
// is an INDEPENDENT directory (ARCHITECTURE.md §3.2) and may not import another
// subsystem (§3.3). Every colour below has a literal fallback, so a missing or
// partial palette degrades to the shipped scheme instead of throwing.
const hexOf = (n, fallback) => (typeof n === 'number' ? n : fallback) >>> 0;
const css = (n, fallback) => `#${hexOf(n, fallback).toString(16).padStart(6, '0')}`;
const rgba = (n, alpha, fallback) => {
  const v = hexOf(n, fallback);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
};

/**
 * The whole stylesheet. Scoped under #hud so nothing leaks onto the canvas.
 *
 * Deliberately absent: transition, animation, @keyframes, @font-face, @import,
 * url(), backdrop-filter. The first three are browser-timeline driven and would
 * make a captured frame depend on wall-clock; the next three fetch from the
 * network. Every font named below is a local system face.
 */
function stylesheet(PALETTE) {
  const top = css(PALETTE?.faceTop, 0xf2b880);
  const left = css(PALETTE?.faceLeft, 0xd98e73);
  const right = css(PALETTE?.faceRight, 0xa9678a);
  const accent = css(PALETTE?.accent, 0x6dd3c4);

  return `
#hud {
  position: fixed;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
               Helvetica, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.35;
  -webkit-font-smoothing: antialiased;
  color: ${top};
}
#hud [hidden] { display: none !important; }

#hud .panel {
  position: absolute;
  top: 28px;
  left: 28px;
  min-width: 208px;
  padding: 16px 18px 14px;
  background: ${rgba(PALETTE?.bg, 0.72, 0x2a1b3d)};
  border: 1px solid ${rgba(PALETTE?.faceRight, 0.45, 0xa9678a)};
  border-radius: 3px;
}

#hud .progress {
  margin: -8px 0 12px;
  font-size: 11px;
  letter-spacing: 0.24em;
  opacity: 0.55;
}

#hud .level {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: ${top};
}

#hud .rule {
  height: 1px;
  margin: 0 0 11px;
  background: ${rgba(PALETTE?.faceRight, 0.4, 0xa9678a)};
}

#hud .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
#hud .row + .row { margin-top: 6px; }

#hud .label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: ${rgba(PALETTE?.faceLeft, 0.7, 0xd98e73)};
}

#hud .value {
  display: flex;
  align-items: center;
  gap: 9px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
               "Liberation Mono", monospace;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  color: ${top};
}

#hud .pips { display: flex; gap: 5px; }
#hud .pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid ${rgba(PALETTE?.faceLeft, 0.55, 0xd98e73)};
}
#hud .pip.on {
  background: ${accent};
  border-color: ${accent};
}

#hud .solved {
  margin-top: 13px;
  padding-top: 11px;
  border-top: 1px solid ${rgba(PALETTE?.accent, 0.45, 0x6dd3c4)};
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: ${accent};
}

#hud .keys {
  position: absolute;
  left: 28px;
  bottom: 24px;
  display: flex;
  gap: 22px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: ${rgba(PALETTE?.faceLeft, 0.62, 0xd98e73)};
}
#hud .keys b {
  margin-right: 7px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
               "Liberation Mono", monospace;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: ${right};
}
`;
}

// ---------------------------------------------------------------- subsystem
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

    /**
     * Capture mode stops here. No stylesheet, no children, no listeners — the
     * subsystem contributes literally nothing to a captured frame.
     */
    this.active = !ctx.config.capture;

    /**
     * Input is gated SEPARATELY and more tightly than the HUD, on lockstep as
     * well as capture (constraint 5 in the header). The HUD is a passive mirror
     * of engine state; the keydown listener is a write path, and in lockstep
     * mode the engine must only advance inside __PUMP__.
     */
    this.inputEnabled = !(ctx.config.capture || ctx.config.lockstep);

    if (!this.active) return;

    // Colours come from render's exposed palette via the one permitted direct
    // reach, ctx.peek(name). Read once — the palette is a constant.
    this.style = document.createElement('style');
    this.style.id = 'hud-style';
    this.style.textContent = stylesheet(ctx.peek('render')?.palette ?? null);
    document.head.appendChild(this.style);

    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };

    const panel = el('div', 'panel');

    this.elLevel = el('div', 'level', '—');
    // Its OWN element, not a child of elLevel: update() writes elLevel.textContent,
    // which replaces all children and would silently delete a nested span.
    this.elProgress = el('div', 'progress', '');
    panel.append(this.elLevel, this.elProgress, el('div', 'rule'));

    const movesRow = el('div', 'row');
    this.elMoves = el('span', null, '0');
    const movesValue = el('div', 'value');
    movesValue.append(this.elMoves);
    movesRow.append(el('div', 'label', 'Moves'), movesValue);

    const viewRow = el('div', 'row');
    const pips = el('div', 'pips');
    this.pips = [];
    for (let i = 0; i < ROTATIONS; i++) {
      const pip = el('span', 'pip');
      this.pips.push(pip);
      pips.append(pip);
    }
    this.elTurns = el('span', null, `1/${ROTATIONS}`);
    const viewValue = el('div', 'value');
    viewValue.append(pips, this.elTurns);
    viewRow.append(el('div', 'label', 'View'), viewValue);

    this.elSolved = el('div', 'solved', 'Solved');
    this.elSolved.hidden = true;

    panel.append(movesRow, viewRow, this.elSolved);

    const keys = el('div', 'keys');
    const legend = (combo, what) => {
      const item = el('div');
      item.append(el('b', null, combo), document.createTextNode(what));
      return item;
    };
    keys.append(legend('↑ ← ↓ →', 'Move'), legend('Q E', 'Rotate'));

    this.root.append(panel, keys);

    /**
     * Last values written to the DOM. Seeded with values no engine state can
     * produce, so the first update() writes every field exactly once and every
     * update after that writes only what actually moved.
     */
    this.shown = { level: null, moves: -1, turns: -1, solved: null, progress: null, complete: null };

    if (this.inputEnabled) {
      this._onKeyDown = (event) => this._handleKey(event);
      globalThis.addEventListener('keydown', this._onKeyDown);
    }
  },

  /**
   * Keyboard input. Never reached in capture OR lockstep mode — the listener is
   * not attached at all there, and this guard is a second line of defence.
   *
   * `event.repeat` is dropped so a held key does not stream moves at the OS
   * auto-repeat rate. That rate is a wall-clock property of the machine, which
   * is exactly the kind of thing that must never drive engine state.
   *
   * Rotation goes out as `world/rotate-request` rather than calling
   * world.setRotation directly. src/render subscribes and performs the quarter
   * turn as a camera orbit, committing the discrete world rotation on the frame
   * the camera arrives. Emitting an event rather than reaching into another
   * subsystem is the ARCHITECTURE.md §3.3 seam; it also means the transition is
   * render's to own, and ui does not need to know it exists.
   */
  _handleKey(event) {
    if (!this.inputEnabled) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) return;

    const action = resolveKey(event.code, event.key);
    if (!action) return;
    event.preventDefault();

    if (action.move) {
      this.ctx.peek('player')?.step?.(action.move);
      return;
    }
    if (action.rotate) {
      this.ctx.emit('world/rotate-request', { delta: action.rotate });
    }
  },

  /**
   * Refresh from engine state.
   *
   * Every field is compared against what is already on screen before anything
   * is written. After the first frame a steady state costs four scalar
   * comparisons and zero DOM writes — an unconditional innerHTML rebuild here
   * would relayout the overlay 60 times a second and show up in the profiler
   * as a hitch.
   *
   * Polls rather than subscribing to events so the HUD cannot drift out of
   * agreement with the authoritative state. player.state() is one small
   * short-lived object per frame; it is only ever called outside capture.
   */
  update(ctx) {
    if (!this.active) return;

    const player = ctx.peek('player');
    const world = ctx.peek('world');
    const state = player?.state?.();

    const level = state?.level ?? world?.level?.name ?? '—';
    const moves = state?.moves ?? 0;
    const solved = state?.solved === true;
    // Integer check, not `?? 0`: a NaN rotation would index this.pips[NaN] and
    // throw on every frame for the rest of the run.
    const raw = world?.turns;
    const turns = Number.isInteger(raw) ? ((raw % ROTATIONS) + ROTATIONS) % ROTATIONS : 0;

    const shown = this.shown;

    if (level !== shown.level) {
      this.elLevel.textContent = level;
      shown.level = level;
    }

    if (moves !== shown.moves) {
      this.elMoves.textContent = String(moves);
      shown.moves = moves;
    }

    if (turns !== shown.turns) {
      if (shown.turns >= 0) this.pips[shown.turns].className = 'pip';
      this.pips[turns].className = 'pip on';
      this.elTurns.textContent = `${turns + 1}/${ROTATIONS}`;
      shown.turns = turns;
    }

    // Campaign position. Read through peek like everything else here, and absent
    // entirely when the campaign is inert (capture) or the level is off-campaign.
    const run = ctx.peek('campaign')?.state?.();
    const progress = run && run.enabled && run.total > 0
      ? `${Math.min(run.index + 1, run.total)} / ${run.total}`
      : '';
    const complete = run?.complete === true;

    if (progress !== shown.progress) {
      this.elProgress.textContent = progress;
      shown.progress = progress;
    }

    if (solved !== shown.solved || complete !== shown.complete) {
      this.elSolved.textContent = complete ? 'All levels complete' : 'Solved';
      this.elSolved.hidden = !(solved || complete);
      shown.solved = solved;
      shown.complete = complete;
    }
  },

  dispose() {
    if (this._onKeyDown) globalThis.removeEventListener('keydown', this._onKeyDown);
    this._onKeyDown = null;
    this.style?.remove();
    this.root?.remove();
  },
};
