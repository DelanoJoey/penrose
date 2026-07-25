#!/usr/bin/env node
/**
 * Frame-time profiler. See ARCHITECTURE.md §6.
 *
 * Adapted from mshumer/Claude-of-Duty (MIT, Copyright (c) 2026 mshumer).
 * See NOTICE.
 *
 * Reports the frame-time DISTRIBUTION and every hitch, because a median frame
 * time hides exactly the stalls that make an interactive scene feel broken.
 * Upstream, a static-camera benchmark reported 94 fps on a build that ran 12-17
 * fps in real use, with 728-1236 ms stalls from shaders compiling lazily
 * mid-frame. Tracking WebGL program count per frame is what surfaced it: a jump
 * in programs on the same frame as a spike identifies a compilation stall.
 *
 *   node tools/profile.mjs --port=5173 --dpr=2 --frames=900
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1512);
const H = Number(args.h ?? 982);
const DPR = Number(args.dpr ?? 2);
const FRAMES = Number(args.frames ?? 900);
const ROOT = resolve(import.meta.dirname, '..');

const portOpen = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
  s.setTimeout(400, () => (s.destroy(), res(false)));
});

let server = null;
if (!(await portOpen(PORT))) {
  // --host 127.0.0.1: see the note in tools/baseline.mjs. Vite's default
  // `localhost` binds IPv6 only on macOS and the probe below is IPv4.
  server = spawn(resolve(ROOT, 'node_modules/.bin/vite'),
    ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, OW_NO_HMR: '1' },
  });
  let up = false;
  for (let i = 0; i < 160 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await portOpen(PORT); }
  if (!up) { server.kill(); throw new Error('vite failed to start'); }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio',
         '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const t0 = Date.now();
const EXTRA = args.query ? `?${args.query}` : '';
await page.goto(`http://127.0.0.1:${PORT}/${EXTRA}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
const bootMs = Date.now() - t0;

const bootMarks = await page.evaluate(() =>
  performance.getEntriesByType('measure').map((m) => ({ name: m.name, ms: +m.duration.toFixed(1) }))
    .sort((a, b) => b.ms - a.ms).slice(0, 25));

const internal = await page.evaluate(() => {
  const r = window.__ENGINE__.ctx.peek('render');
  const gl = r.renderer.getContext();
  return {
    pixelRatio: r.renderer.getPixelRatio(),
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    megapixels: +((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6).toFixed(2),
    quality: window.__ENGINE__.config.quality,
    renderScale: window.__ENGINE__.config.q.renderScale,
  };
});

const result = await page.evaluate((FRAMES) => new Promise((done) => {
  const e = window.__ENGINE__;
  const r = e.ctx.peek('render');
  const samples = [];
  let last = performance.now(), i = 0;

  const tick = () => {
    const now = performance.now();
    const dt = now - last; last = now;

    samples.push({
      i, dt,
      progs: r.renderer.info.programs?.length ?? 0,
      calls: r.renderer.info.render.calls,
      tris: r.renderer.info.render.triangles,
      geos: r.renderer.info.memory.geometries,
      texs: r.renderer.info.memory.textures,
      heap: performance.memory ? performance.memory.usedJSHeapSize >> 20 : 0,
    });

    if (++i >= FRAMES) return done(samples);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), FRAMES);

// Discard warmup frames: first-load one-time costs are not steady state.
// --warmup=0 keeps them, which is how you see the COLD first-load experience.
// A lazily-compiled program lands in exactly those discarded frames, so the
// default view is blind to the stall a pre-warm would exist to remove.
const WARMUP = Number(args.warmup ?? 60);
const warm = result.slice(WARMUP);
if (warm.length < 10) { console.error('not enough frames after warmup'); process.exit(2); }

const dts = warm.map((s) => s.dt).sort((a, b) => a - b);
const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(2);
const med = q(0.5);

const hitches = warm
  .filter((s) => s.dt > Math.max(2 * med, med + 8))
  .map((s) => {
    const prev = warm[warm.indexOf(s) - 1];
    return {
      frame: s.i, ms: +s.dt.toFixed(1),
      progDelta: prev ? s.progs - prev.progs : 0,
      geoDelta: prev ? s.geos - prev.geos : 0,
      texDelta: prev ? s.texs - prev.texs : 0,
    };
  });

const first = warm[0], lastS = warm[warm.length - 1];
console.log(JSON.stringify({
  bootMs,
  bootMarks,
  internal,
  frames: warm.length,
  frameTimeMs: { p1: q(0.01), p50: med, p90: q(0.9), p95: q(0.95), p99: q(0.99), max: q(1) },
  fps: { p50: +(1000 / med).toFixed(0), p95: +(1000 / q(0.95)).toFixed(0), p99: +(1000 / q(0.99)).toFixed(0) },
  hitchCount: hitches.length,
  hitchPctOfFrames: +((hitches.length / warm.length) * 100).toFixed(2),
  worstHitches: hitches.sort((a, b) => b.ms - a.ms).slice(0, 15),
  programs: { start: first.progs, end: lastS.progs, compiledDuringPlay: lastS.progs - first.progs },
  resources: { geosStart: first.geos, geosEnd: lastS.geos, texStart: first.texs, texEnd: lastS.texs },
  heapMb: { start: first.heap, end: lastS.heap, growth: lastS.heap - first.heap },
  drawCalls: { min: Math.min(...warm.map((s) => s.calls)), max: Math.max(...warm.map((s) => s.calls)) },
  errors: errs.slice(0, 6),
}, null, 2));

await browser.close();
if (server) server.kill();
