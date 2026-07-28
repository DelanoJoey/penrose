#!/usr/bin/env node
/**
 * Does one simulated second take one real second?
 *
 * COMMITTED ON PURPOSE, for the reason tools/search.mjs's header gives about
 * the measurement the previous phase threw away: METHODOLOGY §P21 quotes 1.844
 * before the fix and 1.000 after, and a number that cannot be re-derived is a
 * number nobody can diff.
 *
 * WHAT IT IS FOR. Engine.step() advances a CONSTANT fixedDt. Before §P21 it was
 * called once per requestAnimationFrame with no accumulator, so simulation rate
 * was proportional to display refresh rate and the game ran at 1.844x on a
 * 120 Hz panel -- which made every wall-clock number in METHODOLOGY true at
 * 60 Hz and true nowhere it was actually being read. This is the check that
 * says whether that is still fixed.
 *
 * HEADED ON PURPOSE. Headless Chromium composites at 60 Hz whatever the display
 * does, so a headless run reports 1.000 on a machine where the real browser
 * reports 1.844. A headless version of this tool would have passed throughout
 * the entire period the defect existed. It therefore opens a window, which is
 * also why it is not part of `npm test` or the gate.
 *
 * NOT A DETERMINISM CHECK. Nothing here touches rendered pixels; frame N was
 * always reproducible, before the fix and after. This measures PACING, which
 * ARCHITECTURE §1 deliberately says nothing about.
 *
 *   node tools/framerate.mjs [--url=http://localhost:5173/] [--seconds=3]
 *
 * Exits 1 if the ratio is outside tolerance, so it can gate a release by hand.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.replace(/^--/, '').split('='))
  .map(([k, v]) => [k, v ?? true]));

const URL_ = args.url ?? 'http://localhost:5173/';
const SECONDS = Number(args.seconds ?? 3);
const TOL = Number(args.tol ?? 0.02);

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

let sample;
try {
  await page.goto(URL_);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 20000 });

  sample = await page.evaluate(async (ms) => {
    const t0 = performance.now();
    const f0 = window.__ENGINE__.time.frame;
    const r0 = window.__ENGINE__.time.raw;
    await new Promise((r) => setTimeout(r, ms));
    const t1 = performance.now();
    return {
      wallSeconds: (t1 - t0) / 1000,
      frames: window.__ENGINE__.time.frame - f0,
      simSeconds: window.__ENGINE__.time.raw - r0,
    };
  }, SECONDS * 1000);
} finally {
  await browser.close();
}

const ratio = sample.simSeconds / sample.wallSeconds;
const report = {
  url: URL_,
  wallSeconds: +sample.wallSeconds.toFixed(3),
  frames: sample.frames,
  simSeconds: +sample.simSeconds.toFixed(3),
  framesPerWallSecond: +(sample.frames / sample.wallSeconds).toFixed(1),
  simSecondsPerWallSecond: +ratio.toFixed(3),
  tolerance: TOL,
  pass: Math.abs(ratio - 1) <= TOL,
};
console.log(JSON.stringify(report, null, 2));

if (!report.pass) {
  console.error(
    `\n[framerate] FAIL — one simulated second takes ${report.simSecondsPerWallSecond} real seconds.\n` +
    '            The loop is advancing per animation frame rather than per fixed step.\n' +
    '            See METHODOLOGY §P21 and Engine.start().');
  process.exit(1);
}
console.error('\n[framerate] OK — simulated time and real time agree.');
