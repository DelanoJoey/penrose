/**
 * Procedural audio. No sound files, ever — everything is synthesised from
 * oscillators, generated noise buffers and filters.
 *
 * HARD CONSTRAINTS (from the stub, unchanged)
 *
 * 1. Completely inert when `ctx.config.capture` is true. init() sets its fields
 *    and returns before subscribing to anything, before registering a gesture
 *    listener and before touching any Web Audio constructor. A capture run
 *    executes zero audio code after that early return.
 *
 * 2. Never touches ctx.time and never writes a value any other subsystem reads.
 *    This module has no update() and no fixedUpdate(), so the engine's frame
 *    loop does not call into it at all. `ctx.time` appears nowhere in this file
 *    outside these comments — audio.test.js asserts that mechanically against
 *    the comment-stripped source.
 *
 * 3. audioCtx.currentTime is used for exactly one thing: as the epoch for
 *    AudioParam automation and node start/stop times. It is never returned,
 *    never stored where a visual can read it, and never compared against
 *    ctx.time. The voice-budget prune in _take() is the only other reader and
 *    it feeds nothing but the decision to drop an inaudible extra voice.
 *
 * 4. The AudioContext is constructed lazily, on the first user gesture (or on
 *    the first game event, which is itself downstream of one).
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN PROBLEM
 *
 * An illusion step LOOKS like an ordinary step. Screen-wise it IS an ordinary
 * step — that is the whole mechanic, and src/geometry proves it with exact
 * integer arithmetic: two cells sharing (a, b) = (x-z, x+z-2y) occupy the same
 * screen position no matter how far apart they are in 3D. In `loop-01` the
 * illusion edge spans a Manhattan distance of 14 while costing one keypress.
 *
 * So audio is the only channel that can report it, and the report has to be
 * *legible*, not merely different. The sound chosen here is beating between two
 * near-unison detuned layers, hard-panned and Haas-offset:
 *
 *   - Beating is literally the acoustic signature of two sources being mistaken
 *     for one. Two tones a few cents apart fuse into a single perceived pitch
 *     that pulses at their difference frequency. That is the same error the
 *     player's eye is making, rendered in the one modality that can expose it.
 *   - The detune depth is a function of how far the step actually travelled in
 *     3D (9 cents at one unit → 47 cents at 24+). A near-miss shimmers; a
 *     14-unit leap wobbles hard. The magnitude of the lie is audible.
 *   - Hard L/R placement plus a 4–16 ms interchannel delay (below the echo
 *     threshold, so it widens rather than doubles) puts the two layers in
 *     different places in the stereo field: one event, two locations.
 *   - Tail 1.5–2.3 s against 0.34 s, with a 0.55 reverb send against 0.08. An
 *     ordinary step is a dry click in a small room; an illusion step opens into
 *     a much larger one that is not the room you can see.
 *   - A sub-octave adds weight, and a late 4th-harmonic partial arrives 90 ms
 *     afterwards panned to the OPPOSITE side — the other place answering.
 *
 * Five independent axes (detune/beating, duration, width, spectrum, reverb
 * depth) all move together, so the difference survives bad laptop speakers,
 * mono downmix, and a player who is not listening carefully.
 * ---------------------------------------------------------------------------
 */

// src/geometry is a pure module with no engine state and is the one direct
// import ARCHITECTURE.md §3.3 permits. Nothing here reimplements it.
import { parseCell, rotateY } from '../geometry/index.js';

// ------------------------------------------------------------------ tuning

/** C4. Everything is a scale degree above this. */
const TONIC_HZ = 261.6255653005986;

/** Minor pentatonic. No semitone clashes, so any two steps overlap gracefully. */
const SCALE = [0, 3, 5, 7, 10];

/** Screen-a units mapped to full stereo width. */
const PAN_SPAN = 7;

/** Scheduling lead. One render quantum is ~2.7 ms at 48 kHz; this clears it. */
const LEAD = 0.012;

/** Hard cap on simultaneous logical voices. Prevents a held key from piling up. */
const MAX_VOICES = 24;

/** Output trim, ahead of the limiter. */
const MASTER_GAIN = 0.5;

/** Gestures that are allowed to construct the AudioContext. */
const GESTURES = ['pointerdown', 'keydown', 'touchstart'];

/** Generated reverb impulse: length in seconds and decay exponent. */
const IR_SECONDS = 2.6;
const IR_DECAY = 3.4;

/** Generated white-noise source buffer, in seconds. */
const NOISE_SECONDS = 1.5;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------ pure helpers
// Exported so they can be unit-tested without a browser or an AudioContext.

/** Scale degree -> frequency. Negative degrees walk down through octaves. */
export function scaleHz(degree) {
  const d = Math.round(degree);
  const oct = Math.floor(d / SCALE.length);
  const semis = SCALE[d - oct * SCALE.length] + 12 * oct;
  return TONIC_HZ * Math.pow(2, semis / 12);
}

/** Accepts a cell id string ("x,y,z") or a [x,y,z] array. Null if neither. */
export function toCell(v) {
  if (Array.isArray(v) && v.length >= 3) {
    const c = [Number(v[0]), Number(v[1]), Number(v[2])];
    return c.every(Number.isFinite) ? c : null;
  }
  if (typeof v === 'string') {
    const p = parseCell(v);
    return p.length === 3 && p.every(Number.isFinite) ? p : null;
  }
  return null;
}

/** 3D Manhattan distance between two cells — how far the step REALLY went. */
export function span(fromCell, toCell_) {
  if (!fromCell || !toCell_) return 1;
  return Math.abs(fromCell[0] - toCell_[0])
    + Math.abs(fromCell[1] - toCell_[1])
    + Math.abs(fromCell[2] - toCell_[2]);
}

/**
 * Pitch for a cell. Height is the dominant term (a staircase game should sound
 * like one) and the screen-x invariant contributes a smaller lateral term so
 * walking flat still moves the melody. rotateY leaves y alone, so rotating the
 * world transposes laterally without changing the elevation reading.
 */
export function cellDegree(cell, turns = 0) {
  const [x, y, z] = rotateY(cell, turns);
  const lift = clamp(y, 0, 6);
  const lateral = (((x - z) % 3) + 3) % 3;
  return lift + lateral;
}

/**
 * Stereo position from the screen-x invariant a = x - z. This is the same
 * quantity src/geometry uses to decide what overlaps, so a sound lands where
 * its cell is drawn — and an illusion step pans to where it LOOKS like it
 * landed, not to where the destination cell actually is in 3D.
 */
export function cellPan(cell, turns = 0) {
  const [x, , z] = rotateY(cell, turns);
  return clamp((x - z) / PAN_SPAN, -1, 1);
}

/** Deterministic [0,1) from integers. Used for per-event variation instead of
 *  rng, so replaying the same route produces byte-identical scheduling. */
export function hash01(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    const v = Math.imul(Math.round(Number(n) || 0) | 0, 2654435761) >>> 0;
    h = Math.imul(h ^ v, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * The whole point of this subsystem, as a parameter table.
 *
 * `reach` is the 3D Manhattan distance the step covered. An ordinary step has
 * reach 1 by definition; an illusion step has reach > 1 and every parameter
 * below scales with it.
 */
export function stepVoice({ reach = 1, viaIllusion = false } = {}) {
  if (!viaIllusion) {
    return {
      kind: 'step',
      tail: 0.34,          // short, dry, unremarkable
      detuneCents: 0,      // one source, one place
      haasMs: 0,
      spread: 0.0,
      send: 0.08,          // barely any room
      sub: 0,
      shimmerDelay: 0,
      cutoff: 3200,
      level: 0.55,
    };
  }
  const r = clamp(reach, 1, 24);
  return {
    kind: 'step/illusion',
    tail: 1.45 + r * 0.035,        // 1.49 – 2.29 s
    detuneCents: 9 + r * 1.6,      // 10.6 – 47.4 cents -> ~3–15 Hz of beating
    haasMs: 4 + r * 0.5,           // 4.5 – 16 ms, below the echo threshold
    spread: 0.92,                  // near hard L/R
    send: 0.55,
    sub: 0.30,
    shimmerDelay: 0.09,
    cutoff: 5600,
    level: 0.50,
  };
}

/** Fill a Float32Array with white noise from a seeded stream. */
export function fillNoise(out, rng) {
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/**
 * Procedural reverb impulse: decorrelated noise under an exponential envelope.
 * No file is fetched; ARCHITECTURE.md §1 forbids it and a reverb tail is one of
 * the few things people are tempted to ship as a .wav.
 */
export function fillImpulse(channels, rng, { decay = IR_DECAY, predelaySamples = 0 } = {}) {
  for (const data of channels) {
    const n = data.length;
    const pre = clamp(predelaySamples | 0, 0, Math.max(0, n - 1));
    for (let i = 0; i < n; i++) {
      if (i < pre) { data[i] = 0; continue; }
      const t = (i - pre) / Math.max(1, n - pre);
      data[i] = (rng() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return channels;
}

/**
 * Safety soft-clip curve, generated (not tabulated from a file).
 *
 * Bit-transparent below `knee` and asymptotic to 1 above it, so the output can
 * never exceed full scale no matter how many voices land on the same sample.
 * The compressor ahead of it has a 4 ms attack and lets the very first
 * transient of a dense burst through; measured, a 24-voice pile-up peaked at
 * 1.136 before this existed.
 */
export function softClipCurve(n = 2048, knee = 0.75) {
  const curve = new Float32Array(n);
  const span = 1 - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= knee
      ? x
      : Math.sign(x) * (knee + span * Math.tanh((a - knee) / span));
  }
  return curve;
}

/** Exponential AR envelope. Web Audio cannot ramp to exactly 0. */
function envelope(param, t0, peak, attack, tail) {
  const p = Math.max(0.0002, peak);
  param.setValueAtTime(0.0001, t0);
  param.exponentialRampToValueAtTime(p, t0 + attack);
  param.exponentialRampToValueAtTime(0.0001, t0 + attack + tail);
  param.setValueAtTime(0, t0 + attack + tail + 0.002);
}

// --------------------------------------------------------------- subsystem

export default {
  name: 'audio',

  async init(ctx) {
    this.ctx = ctx;
    this.enabled = !ctx.config.capture;
    this.audio = null;
    this.bus = null;
    this.muted = false;
    this._unsub = [];
    this._voices = [];
    this._turns = 0;
    this._rng = null;
    this._onGesture = null;

    // (1) Inert in capture. Nothing below this line runs during a gate run.
    if (!this.enabled) return;

    // A fork, never the root stream (ARCHITECTURE.md §2). It is consumed only
    // by the noise and impulse buffers, and only once, at AudioContext
    // construction — so those buffers are a pure function of config.seed.
    this._rng = ctx.rng.fork('audio');

    // (4) Lazy construction on a real gesture. Kept registered rather than
    // once-only, so a context suspended by a backgrounded tab resumes on the
    // next interaction.
    if (typeof globalThis.addEventListener === 'function') {
      this._onGesture = () => { this._ensure(); };
      for (const e of GESTURES) {
        globalThis.addEventListener(e, this._onGesture, { passive: true });
      }
    }

    this._unsub.push(
      ctx.on('player/moved', (p) => this._onMoved(p)),
      ctx.on('player/blocked', (p) => this._onBlocked(p)),
      ctx.on('world/rotated', (p) => this._onRotated(p)),
      ctx.on('level/solved', (p) => this._onSolved(p)),
    );
  },

  /** Read-only, and deliberately free of anything that changes with time. */
  state() {
    return { enabled: this.enabled, ready: !!this.audio, muted: this.muted };
  },

  setMuted(on) {
    this.muted = !!on;
    if (this.bus) this.bus.master.gain.value = this.muted ? 0 : MASTER_GAIN;
    return this.muted;
  },

  // ------------------------------------------------------------- lifecycle

  /** Lazily construct the AudioContext. Browsers require a gesture first. */
  _ensure() {
    if (!this.enabled) return null;
    if (this.audio) {
      if (this.audio.state === 'suspended') this.audio.resume?.().catch(() => {});
      return this.audio;
    }

    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (typeof AC !== 'function') { this.enabled = false; return null; }

    let ac;
    try {
      ac = new AC({ latencyHint: 'interactive' });
      this.bus = this._buildBus(ac);
    } catch {
      // No output device, or a policy that refuses construction. Disable
      // permanently rather than retrying on every keypress.
      this.enabled = false;
      this.bus = null;
      return null;
    }

    this.audio = ac;
    if (ac.state === 'suspended') ac.resume?.().catch(() => {});
    return ac;
  },

  /**
   *   voice ─┬──────────────────────► dry ─┐
   *          └─ send ─► verb ─► wet ───────┴─► master ─► comp ─► softclip ─► out
   */
  _buildBus(ac) {
    const master = ac.createGain();
    master.gain.value = this.muted ? 0 : MASTER_GAIN;

    // Level control for dense passages (the solved arpeggio, mostly).
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;

    // Hard guarantee against full-scale overshoot, since the compressor's
    // attack lets the first transient of a burst past it.
    const clip = ac.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '4x';

    master.connect(limiter);
    limiter.connect(clip);
    clip.connect(ac.destination);

    const dry = ac.createGain();
    dry.gain.value = 1;
    dry.connect(master);

    const send = ac.createGain();
    send.gain.value = 1;

    const verb = ac.createConvolver();
    verb.normalize = true;
    const irLen = Math.max(1, Math.floor(ac.sampleRate * IR_SECONDS));
    const ir = ac.createBuffer(2, irLen, ac.sampleRate);
    fillImpulse([ir.getChannelData(0), ir.getChannelData(1)], this._rng.fork('ir'), {
      decay: IR_DECAY,
      predelaySamples: Math.floor(ac.sampleRate * 0.006),
    });
    verb.buffer = ir;

    const wet = ac.createGain();
    wet.gain.value = 0.9;
    send.connect(verb);
    verb.connect(wet);
    wet.connect(master);

    const noise = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * NOISE_SECONDS)), ac.sampleRate);
    fillNoise(noise.getChannelData(0), this._rng.fork('noise'));

    return { master, limiter, clip, dry, send, noise };
  },

  dispose() {
    for (const off of this._unsub ?? []) { try { off(); } catch { /* already gone */ } }
    this._unsub = [];
    if (this._onGesture && typeof globalThis.removeEventListener === 'function') {
      for (const e of GESTURES) globalThis.removeEventListener(e, this._onGesture);
    }
    this._onGesture = null;
    this._voices = [];
    try { this.audio?.close?.(); } catch { /* already closed */ }
    this.audio = null;
    this.bus = null;
  },

  // ---------------------------------------------------------------- events

  _onMoved(p) {
    const ac = this._ensure();
    if (!ac) return;
    const to = toCell(p?.to);
    if (!to) return;
    const from = toCell(p?.from);
    const v = stepVoice({ reach: span(from, to), viaIllusion: !!p?.viaIllusion });
    this._playStep(ac, to, from, v);
  },

  _onBlocked(p) {
    const ac = this._ensure();
    if (!ac) return;
    const t0 = ac.currentTime + LEAD;
    if (!this._take(t0, t0 + 0.3)) return;

    // Pan toward the direction that failed, so the refusal has a location.
    const d = p?.direction;
    const pan = Array.isArray(d)
      ? clamp(Number(d[0]) || 0, -1, 1) * 0.5
      : (hash01(String(d ?? '').length, String(d ?? '').charCodeAt(0) || 0) - 0.5);

    // Dull, dry, short. No reverb send at all: the world did not respond, so
    // there is no room for it to respond in.
    this._tone(ac, {
      type: 'sine', hz: 118, glideTo: 74, glideTime: 0.07,
      t0, peak: 0.40, attack: 0.002, tail: 0.11, pan, send: 0, cutoff: 520,
    });
    this._noise(ac, {
      t0, dur: 0.032, peak: 0.16, pan, send: 0,
      filter: 'lowpass', freq: 700, q: 0.9, offset: hash01(pan * 1000) * 1.2,
    });
  },

  _onRotated(p) {
    const to = Number(p?.to);
    const from = Number(p?.from);
    if (Number.isFinite(to)) this._turns = ((to % 4) + 4) % 4;

    const ac = this._ensure();
    if (!ac) return;
    const t0 = ac.currentTime + LEAD;
    if (!this._take(t0, t0 + 1.4)) return;

    const step = Number.isFinite(to) && Number.isFinite(from)
      ? (((to - from) % 4) + 4) % 4
      : 1;
    const dir = step === 3 ? -1 : 1;

    // Band-swept noise: the sound of the whole scene re-sorting itself. Rising
    // for a right turn, falling for a left one, so the ear knows which way the
    // path graph just rewired.
    this._noise(ac, {
      t0, dur: 0.55, peak: 0.22, pan: 0, send: 0.28,
      filter: 'bandpass', q: 4.2,
      freq: dir > 0 ? 380 : 2600, freqTo: dir > 0 ? 2600 : 380,
      attack: 0.08, offset: hash01(this._turns, step) * 1.2,
    });
    this._tone(ac, {
      type: 'sine', hz: 130.81, glideTo: 130.81 * Math.pow(2, (dir * 2) / 12), glideTime: 0.34,
      t0, peak: 0.13, attack: 0.03, tail: 0.5, pan: 0, send: 0.25, cutoff: 900,
    });
  },

  _onSolved(p) {
    const ac = this._ensure();
    if (!ac) return;
    const t0 = ac.currentTime + LEAD;
    if (!this._take(t0, t0 + 4.2)) return;

    // Voicing from the payload, never from the clock: the same solve always
    // sounds the same, and a tidier solve is voiced differently from a messy one.
    const moves = Number(p?.moves);
    const turns = Number(p?.turns);
    const root = Number.isFinite(moves) ? ((moves % 3) + 3) % 3 : 0;
    const cutoff = 4200 + (Number.isFinite(turns) ? clamp(turns, 0, 8) : 0) * 600;

    const degrees = [root, root + 2, root + 4, root + 6, root + 9];
    degrees.forEach((deg, i) => {
      this._tone(ac, {
        type: 'triangle', hz: scaleHz(deg), t0: t0 + i * 0.105,
        peak: 0.34 - i * 0.03, attack: 0.006, tail: 1.6 + i * 0.12,
        pan: (i % 2 ? 0.35 : -0.35) * (1 - i * 0.12), send: 0.5, cutoff,
      });
    });
    // Low root underneath, arriving after the arpeggio has started.
    this._tone(ac, {
      type: 'sine', hz: scaleHz(root) / 2, t0: t0 + 0.5,
      peak: 0.30, attack: 0.02, tail: 2.6, pan: 0, send: 0.45, cutoff: 1400,
    });
  },

  // ---------------------------------------------------------------- voices

  /**
   * Voice budget. Prunes finished voices and refuses new ones past the cap.
   * This is the only place other than scheduling that reads currentTime, and
   * its result feeds nothing but "drop this extra voice".
   */
  _take(now, until) {
    const live = this._voices;
    let n = 0;
    for (let i = 0; i < live.length; i++) if (live[i] > now) live[n++] = live[i];
    live.length = n;
    if (n >= MAX_VOICES) return false;
    live.push(until);
    return true;
  },

  _playStep(ac, cell, fromCell, v) {
    const t0 = ac.currentTime + LEAD;
    if (!this._take(t0, t0 + v.tail + 0.4)) return;

    const hz = scaleHz(cellDegree(cell, this._turns));
    const pan = cellPan(cell, this._turns);
    const grain = hash01(cell[0], cell[1], cell[2]);

    if (v.kind === 'step') {
      // Marimba-ish: fundamental plus the tuned 4th-harmonic partial that bar
      // undercutting produces, plus a short mallet transient.
      this._tone(ac, {
        type: 'triangle', hz, t0, peak: v.level, attack: 0.004,
        tail: v.tail, pan, send: v.send, cutoff: v.cutoff,
      });
      this._tone(ac, {
        type: 'sine', hz: hz * 4, t0, peak: v.level * 0.16, attack: 0.003,
        tail: v.tail * 0.45, pan, send: v.send, cutoff: v.cutoff * 2.5,
      });
      this._noise(ac, {
        t0, dur: 0.014, peak: v.level * 0.5, pan, send: v.send,
        filter: 'bandpass', freq: clamp(hz * 6, 200, 9000), q: 1.2,
        attack: 0.001, offset: grain * 1.2,
      });
      return;
    }

    // Illusion. See the header comment for why each of these is here.
    const half = v.detuneCents / 2;
    this._tone(ac, {
      type: 'triangle', hz, t0, peak: v.level * 0.72, attack: 0.006,
      tail: v.tail, pan: -v.spread, send: v.send, cutoff: v.cutoff, detune: -half,
    });
    this._tone(ac, {
      type: 'triangle', hz, t0: t0 + v.haasMs / 1000, peak: v.level * 0.72, attack: 0.006,
      tail: v.tail, pan: v.spread, send: v.send, cutoff: v.cutoff, detune: half,
    });
    this._tone(ac, {
      type: 'sine', hz: hz / 2, t0, peak: v.level * v.sub, attack: 0.012,
      tail: v.tail * 0.8, pan: 0, send: v.send * 0.6, cutoff: 900,
    });
    // The other place answering, from the opposite side.
    this._tone(ac, {
      type: 'sine', hz: hz * 4, t0: t0 + v.shimmerDelay, peak: v.level * 0.13,
      attack: 0.02, tail: v.tail * 0.7, pan: -pan, send: Math.min(1, v.send * 1.4),
      cutoff: v.cutoff * 2, detune: v.detuneCents,
    });
    this._noise(ac, {
      t0, dur: 0.02, peak: v.level * 0.35, pan, send: v.send,
      filter: 'bandpass', freq: clamp(hz * 5, 200, 9000), q: 1.6,
      attack: 0.002, offset: grain * 1.2,
    });
  },

  /** One oscillator voice: osc -> gain env -> lowpass -> pan -> dry + send. */
  _tone(ac, {
    type = 'sine', hz = 440, t0 = 0, peak = 0.3, attack = 0.004, tail = 0.3,
    pan = 0, send = 0, cutoff = 4000, detune = 0, glideTo = null, glideTime = 0.05,
  }) {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(clamp(hz, 20, 18000), t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(clamp(glideTo, 20, 18000), t0 + glideTime);
    osc.detune.setValueAtTime(detune, t0);

    const g = ac.createGain();
    envelope(g.gain, t0, peak, attack, tail);

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(clamp(cutoff, 60, 20000), t0);
    lp.Q.value = 0.7;

    osc.connect(g);
    g.connect(lp);
    this._land(ac, lp, pan, send, [osc, g, lp]);

    const stop = t0 + attack + tail + 0.06;
    osc.start(t0);
    osc.stop(stop);
    osc.onended = () => { for (const n of osc.__chain) { try { n.disconnect(); } catch { /* torn down */ } } };
  },

  /** One noise voice from the generated buffer. Optionally sweeps its filter. */
  _noise(ac, {
    t0 = 0, dur = 0.05, peak = 0.2, pan = 0, send = 0, attack = 0.002,
    filter = 'bandpass', freq = 2000, freqTo = null, q = 1, offset = 0,
  }) {
    const src = ac.createBufferSource();
    src.buffer = this.bus.noise;
    src.loop = true;
    const dt = Math.max(0.001, dur);

    const bq = ac.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(clamp(freq, 40, 20000), t0);
    if (freqTo) bq.frequency.exponentialRampToValueAtTime(clamp(freqTo, 40, 20000), t0 + dt * 0.85);
    bq.Q.value = q;

    const g = ac.createGain();
    envelope(g.gain, t0, peak, Math.min(attack, dt * 0.5), Math.max(0.005, dt - attack));

    src.connect(bq);
    bq.connect(g);
    this._land(ac, g, pan, send, [src, bq, g]);

    const start = clamp(offset, 0, Math.max(0, NOISE_SECONDS - 0.01));
    src.start(t0, start);
    src.stop(t0 + dt + 0.06);
    src.onended = () => { for (const n of src.__chain) { try { n.disconnect(); } catch { /* torn down */ } } };
  },

  /** Pan a finished voice chain into the dry bus and the reverb send. */
  _land(ac, tailNode, pan, send, chain) {
    let out = tailNode;
    if (typeof ac.createStereoPanner === 'function') {
      const p = ac.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      tailNode.connect(p);
      chain.push(p);
      out = p;
    }
    out.connect(this.bus.dry);
    if (send > 0) {
      const s = ac.createGain();
      s.gain.value = clamp(send, 0, 1);
      out.connect(s);
      s.connect(this.bus.send);
      chain.push(s);
    }
    // The source node is chain[0]; it carries the teardown list.
    chain[0].__chain = chain;
  },
};
