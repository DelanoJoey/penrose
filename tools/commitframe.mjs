#!/usr/bin/env node
/**
 * MEASUREMENT ONLY — the rotation commit-frame delta.
 *
 * The tone-convention question in src/render's long comment is settled by one
 * number: how many pixels move between the LAST ORBIT FRAME (camera at
 * -90 degrees, world still at turn T) and the FIRST COMMITTED FRAME (camera
 * restored, world at turn T+1). Under a coherent convention those two frames
 * are the same picture and the delta is zero.
 *
 * This tool captures exactly those two frames and hands them to imagediff.mjs.
 * It renders nothing of its own and changes no engine code path — it drives the
 * documented lockstep hooks and the documented `world/rotate-request` event.
 *
 *   node tools/commitframe.mjs --port=5400 --shot=hero --out=/tmp/cf
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';
import { captureArgs } from './_browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1600);
const H = Number(args.h ?? 1000);
const SETTLE = Number(args.settle ?? 90);
const SHOT = String(args.shot ?? 'hero');
const OUTDIR = resolve(args.out ?? '/tmp/penrose-commitframe');
const ROOT = resolve(import.meta.dirname, '..');

const portOpen = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
  s.setTimeout(400, () => (s.destroy(), res(false)));
});

let server = null;
if (!(await portOpen(PORT))) {
  server = spawn(resolve(ROOT, 'node_modules/.bin/vite'),
    ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, OW_NO_HMR: '1' },
  });
  let up = false;
  for (let i = 0; i < 160 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await portOpen(PORT); }
  if (!up) { server.kill(); throw new Error('vite failed to start'); }
}

const browser = await chromium.launch({ headless: true, args: captureArgs() });
mkdirSync(`${OUTDIR}/a`, { recursive: true });
mkdirSync(`${OUTDIR}/b`, { recursive: true });

const open = async () => {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1&shot=${encodeURIComponent(SHOT)}`,
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  await page.evaluate(({ s, settle }) => window.__APPLY_SHOT__(s, { grabFrame: settle }), { s: SHOT, settle: SETTLE });
  await page.evaluate(() => window.__ENGINE__?.ctx?.peek?.('render')?.resetTemporal?.());
  await page.evaluate((n) => window.__PUMP__(n), SETTLE);
  return page;
};

// 1. How many frames does one quarter turn take? Derived from the engine, not
//    assumed, so a change to ORBIT_SECONDS cannot silently invalidate this.
const probe = await open();
const orbitFrames = await probe.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.emit('world/rotate-request', { delta: 1 });
  const r = e.ctx.peek('render');
  let n = 0;
  while (r.transitionState().active && n < 600) { window.__PUMP__(1); n++; }
  return n;
});
await probe.close();

// 2. Last orbit frame: pump one short of the commit.
const pageA = await open();
await pageA.evaluate((n) => {
  window.__ENGINE__.ctx.emit('world/rotate-request', { delta: 1 });
  window.__PUMP__(n);
}, orbitFrames - 1);
const stateA = await pageA.evaluate(() => ({
  active: window.__ENGINE__.ctx.peek('render').transitionState().active,
  turns: window.__ENGINE__.ctx.peek('world').turns,
}));
await pageA.evaluate(() => window.__PRESENT__(2));
await pageA.screenshot({ path: `${OUTDIR}/a/commit.png`, type: 'png' });

// 3. Commit frame: one more pump, in the SAME page, so the only difference is
//    the swap itself.
await pageA.evaluate(() => window.__PUMP__(1));
const stateB = await pageA.evaluate(() => ({
  active: window.__ENGINE__.ctx.peek('render').transitionState().active,
  turns: window.__ENGINE__.ctx.peek('world').turns,
}));
await pageA.evaluate(() => window.__PRESENT__(2));
await pageA.screenshot({ path: `${OUTDIR}/b/commit.png`, type: 'png' });
await pageA.close();

await browser.close();
if (server) server.kill();

console.log(JSON.stringify({ shot: SHOT, orbitFrames, lastOrbitFrame: stateA, commitFrame: stateB, out: OUTDIR }, null, 2));
if (stateA.active !== true || stateB.active !== false || stateB.turns !== 1) {
  console.error('[commitframe] FAIL: the two frames are not the ones intended');
  process.exit(2);
}
