#!/usr/bin/env node
/** MEASUREMENT ONLY — report the WebGL context's depth precision. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';
import { captureArgs } from './_browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PORT = Number(args.port ?? 5173);
const ROOT = resolve(import.meta.dirname, '..');

const portOpen = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
  s.setTimeout(400, () => (s.destroy(), res(false)));
});

let server = null;
if (!(await portOpen(PORT))) {
  server = spawn(resolve(ROOT, 'node_modules/.bin/vite'),
    ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OW_NO_HMR: '1' } });
  let up = false;
  for (let i = 0; i < 160 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await portOpen(PORT); }
  if (!up) { server.kill(); throw new Error('vite failed to start'); }
}

const browser = await chromium.launch({ headless: true, args: captureArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1&shot=hero`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
console.log(await page.evaluate(() => {
  const r = window.__ENGINE__.ctx.peek('render');
  const gl = r.renderer.getContext();
  return JSON.stringify({
    depthBits: gl.getParameter(gl.DEPTH_BITS),
    stencilBits: gl.getParameter(gl.STENCIL_BITS),
    samples: gl.getParameter(gl.SAMPLES),
    version: gl.getParameter(gl.VERSION),
    near: r.camera.near, far: r.camera.far, frustum: r.frustumSize,
  }, null, 2);
}));
await browser.close();
if (server) server.kill();
