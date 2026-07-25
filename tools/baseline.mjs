#!/usr/bin/env node
/**
 * Reproducible shot capture — the regression gate for all optimisation and
 * refactor work. See ARCHITECTURE.md §5.
 *
 * Adapted from mshumer/Claude-of-Duty (MIT, Copyright (c) 2026 mshumer).
 * See NOTICE.
 *
 * Three properties make the output bit-comparable:
 *
 *  1. ISOLATION — each shot gets a brand new page. Sharing one page across
 *     shots leaks transient state (particle age, accumulation buffers,
 *     auto-exposure) forward, so repeated runs diverge on every shot after the
 *     first.
 *  2. FIXED FRAME BUDGET — exactly `settle` frames are pumped, so any temporal
 *     accumulator converges from the same starting phase every time.
 *  3. TEMPORAL RESET — the renderer is asked to drop history before pumping.
 *
 *   node tools/baseline.mjs --out=shots/base --port=5173
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1600);
const H = Number(args.h ?? 1000);
const SETTLE = Number(args.settle ?? 90);
const OUTDIR = resolve(args.out ?? 'shots/base');
const ROOT = resolve(import.meta.dirname, '..');
const EXTRA = args.query ? `&${args.query}` : '';

const portOpen = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
  s.setTimeout(400, () => (s.destroy(), res(false)));
});

let server = null;
if (!(await portOpen(PORT))) {
  // --host 127.0.0.1 is not optional. Vite's default `localhost` resolves to
  // ::1 on macOS, binding IPv6 only, while everything below talks IPv4.
  // Passing it here as well as in vite.config.js means the harness does not
  // silently depend on the config file being correct.
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
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--force-color-profile=srgb',
         '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio', '--disable-frame-rate-limit'],
});

mkdirSync(OUTDIR, { recursive: true });
const report = { ok: true, outDir: OUTDIR, size: `${W}x${H}`, isolated: true, settle: SETTLE, shots: [], errors: [] };

// Discover the shot list from a throwaway page.
const probe = await browser.newPage({ viewport: { width: W, height: H } });
await probe.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await probe.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
const all = await probe.evaluate('Object.keys(window.__SHOTS__ ?? {})');
await probe.close();

const wanted = args.shots ? String(args.shots).split(',').map((s) => s.trim()) : all;

for (const name of wanted) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => m.type() !== 'debug' && logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1&shot=${encodeURIComponent(name)}${EXTRA}`,
      { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });

    const applied = await page.evaluate(
      ({ s, settle }) => window.__APPLY_SHOT__(s, { grabFrame: settle }), { s: name, settle: SETTLE });

    // Drop temporal history so accumulation starts from a known phase.
    await page.evaluate(() => {
      const r = window.__ENGINE__?.ctx?.peek?.('render');
      r?.resetTemporal?.();
    });

    // LOCKSTEP: advance exactly SETTLE engine frames. The page runs no frame
    // loop of its own, so nothing advances during any of the round trips above
    // or during the screenshot below.
    await page.evaluate((n) => window.__PUMP__(n), SETTLE);
    await page.evaluate(() => window.__PRESENT__(2));

    await page.screenshot({ path: `${OUTDIR}/${name}.png`, type: 'png' });
    const info = await page.evaluate('window.__RENDER_INFO__ ?? null');
    report.shots.push({ shot: name, ok: !applied?.error, info, logs: logs.filter((l) => /pageerror|\[error\]/.test(l)) });
    if (applied?.error) report.ok = false;
  } catch (e) {
    report.ok = false;
    report.shots.push({ shot: name, ok: false, error: e.message });
  } finally {
    await page.close();
  }
}

report.errors = report.shots.flatMap((s) => s.logs ?? []);
await browser.close();
if (server) server.kill();

writeFileSync(`${OUTDIR}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
