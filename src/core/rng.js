/**
 * Seeded deterministic PRNG. Math.random() is forbidden project-wide
 * (ARCHITECTURE.md §1).
 *
 * sfc32 seeded through xmur3. Fast, passes PractRand, and — the property that
 * matters here — reproducible from a string seed.
 *
 * ALWAYS take a fork. `ctx.rng.fork('fx/sparks')` gives an independent stream,
 * so a subsystem that starts consuming a different number of values cannot
 * shift another subsystem's sequence. Sharing the root stream creates
 * cross-subsystem coupling that presents exactly like a nondeterminism bug and
 * is miserable to trace back.
 */

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a, b, c, d) {
  return function () {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function makeRng(seed = 'penrose') {
  const key = String(seed);
  const h = xmur3(key);
  const next = sfc32(h(), h(), h(), h());

  const rng = () => next();

  /** Independent stream derived from this seed + label. */
  rng.fork = (label) => makeRng(`${key}::${label}`);
  /** Float in [min, max). */
  rng.range = (min, max) => min + next() * (max - min);
  /** Integer in [min, max]. */
  rng.int = (min, max) => Math.floor(min + next() * (max - min + 1));
  /** Uniform pick. */
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
  /** Fresh stream from the same seed — same sequence again. */
  rng.reset = () => makeRng(key);
  rng.seed = key;

  return rng;
}
