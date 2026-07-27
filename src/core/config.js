/**
 * Boot configuration, parsed once from the query string.
 *
 * Capture and profile runs drive the engine through here rather than through
 * any runtime toggle, so a captured frame is a pure function of (config, frame).
 */

const QUALITY = {
  low:    { renderScale: 0.75, msaa: 0, shadows: false },
  medium: { renderScale: 1.0,  msaa: 4, shadows: true },
  ultra:  { renderScale: 1.0,  msaa: 8, shadows: true },
};

export function makeConfig(search = globalThis.location?.search ?? '') {
  const p = new URLSearchParams(search);
  const flag = (name, dflt = false) => {
    const v = p.get(name);
    if (v === null) return dflt;
    return v !== '0' && v !== 'false';
  };

  const quality = QUALITY[p.get('quality')] ? p.get('quality') : 'ultra';

  return {
    /** Capture mode: deterministic pixel ratio, no input, no autoplay. */
    capture: flag('capture'),
    /**
     * Force the HUD on THROUGH capture mode. Off by default, so every existing
     * capture — and therefore the whole determinism gate — is byte-unchanged.
     *
     * This exists because P9 scored the project 4.22/10 on plates that
     * deliberately carry no HUD, and the storefront critic marked it down for
     * exactly that absence. So 4.22 is a floor on the game as played rather
     * than an estimate of it, and there was no way to capture the frames that
     * would settle it (METHODOLOGY §P9).
     *
     * src/ui owns the consequence noted at its init: the HUD is DOM, and DOM
     * text renders with system fonts, so a HUD-bearing capture is NOT promised
     * to be reproducible across machines the way the WebGL frame is. That is
     * why this is opt-in per capture and never the default — the gate must keep
     * comparing frames that are a pure function of (config, frame).
     */
    hud: flag('hud'),
    /**
     * Play-session recording (src/dev/trace.js). Off by default and never set
     * by any capture, so the gate sees an unchanged program — nothing is
     * registered and no listener is attached unless this is on.
     *
     * It exists because P18, P19 and P20 each shipped against one person
     * playing, and the whole of that observation was a sentence. See
     * METHODOLOGY §P21 and
     * docs/superpowers/specs/2026-07-27-playtest-and-frame-rate-design.md §3.
     */
    trace: flag('trace'),
    /** Lockstep: the page runs NO frame loop. Only __PUMP__ advances state. */
    lockstep: flag('lockstep'),
    /** Named shot to apply at boot, if any. */
    shot: p.get('shot') ?? null,
    /** Named level to load. Falls back to the default if unknown. */
    level: p.get('level') ?? null,
    /** Seed for every rng fork. Fixed by default — never seed from time. */
    seed: p.get('seed') ?? 'penrose',
    quality,
    q: QUALITY[quality],
    /**
     * Fixed timestep. Capture correctness depends on this being constant;
     * do not derive it from display refresh rate.
     */
    fixedDt: 1 / 60,
  };
}
