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
