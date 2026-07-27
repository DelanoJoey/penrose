#!/usr/bin/env node
/**
 * Drive a REAL playthrough through the lockstep pump and capture it.
 *
 *   node tools/playthrough.mjs --level=crook-06 --out=/tmp/play [--port=5173] [--every=2]
 *
 * WHY THIS EXISTS. P11 tried to answer "does crook-06 drag" by driving the real
 * build in a browser and got `document.hidden: true` with 0 frames per second —
 * Chrome throttles requestAnimationFrame in a background tab. The cell still
 * advanced, because `step()` resolves its target immediately, so it LOOKED like
 * play while the clock was stopped. Pacing was the entire question, so that
 * measured nothing.
 *
 * Lockstep has no frame loop at all (src/main.js: state advances only inside
 * __PUMP__), which means the throttle cannot apply. Every frame is asked for
 * explicitly and the timeline is exact rather than observed.
 *
 * WHAT IT MEASURES. Frame counts are POLLED, never assumed: after each input it
 * pumps one frame at a time until the engine reports the motion finished. So the
 * timeline is a measurement even if MOVE_SECONDS or ORBIT_SECONDS change, and it
 * will disagree loudly with test/motion-frames.test.js if they drift apart.
 *
 * Input is disabled under lockstep (src/ui gates the keydown listener on
 * capture||lockstep), which is correct — the engine must only advance inside
 * __PUMP__. So moves are driven through the same subsystem entry points a
 * keypress would reach: player.step for a walk, `world/rotate-request` for a
 * turn. This is a playthrough of the real engine, not a re-implementation of it.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { captureArgs, platformNote } from './_browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

const ROOT = resolve(import.meta.dirname, '..');
const LEVEL = String(args.level ?? 'crook-06');
const OUTDIR = resolve(args.out ?? '/tmp/playthrough');
const EVERY = Math.max(1, Number(args.every ?? 2));
const WIDTH = Number(args.width ?? 1600), HEIGHT = Number(args.height ?? 1000);
let PORT = Number(args.port ?? 5173);

const portOpen = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
  s.setTimeout(400, () => (s.destroy(), res(false)));
});

// Never capture against a server this tool did not start — the same rule
// baseline.mjs enforces, and for the same reason: a dev server left running for
// another worktree will happily serve an entire run of the wrong code.
const REQUESTED = PORT;
let free = false;
for (let i = 0; i < 20; i++) { if (!(await portOpen(PORT))) { free = true; break; } PORT++; }
if (!free) throw new Error(`no free port scanning ${REQUESTED}..${REQUESTED + 19}`);
if (PORT !== REQUESTED) console.log(`[play] port ${REQUESTED} busy — using ${PORT}`);

const server = spawn(resolve(ROOT, 'node_modules/.bin/vite'),
  ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OW_NO_HMR: '1' } });
let up = false;
for (let i = 0; i < 160 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await portOpen(PORT); }
if (!up) { server.kill(); throw new Error('vite failed to start'); }

mkdirSync(OUTDIR, { recursive: true });
const browser = await chromium.launch({ args: captureArgs() });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

const report = { level: LEVEL, platform: platformNote, width: WIDTH, height: HEIGHT, moves: [], errors: [] };
try {
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1&level=${encodeURIComponent(LEVEL)}`,
    { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__ENGINE__ && window.__PUMP__');

  // The route, from the engine's own geometry — not recomputed here.
  const plan = await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const w = ctx.peek('world'), st = w.structure, L = w.level;
    const route = st.findRoute(L.start, L.goal);
    return {
      start: L.start.join(','), goal: L.goal.join(','),
      route: (route ?? []).map((m) => ({ kind: m.kind, from: m.from, to: m.to })),
      minTurnsExact: st.minTurnsBetween ? st.minTurnsBetween(L.start, L.goal) : null,
    };
  });
  report.plan = plan;
  if (!plan.route.length) throw new Error(`no route for ${LEVEL}`);

  let shot = 0, frame = 0;
  const grab = async () => {
    await page.screenshot({ path: join(OUTDIR, `f${String(shot).padStart(4, '0')}.png`) });
    shot++;
  };
  await grab();

  for (const [i, mv] of plan.route.entries()) {
    // Fire the input the same way a keypress would, then pump ONE frame at a
    // time until the engine says the motion is over. Never a fixed count.
    const res = await page.evaluate(({ mv }) => {
      const ctx = window.__ENGINE__.ctx;
      const p = ctx.peek('player'), r = ctx.peek('render');
      if (mv.kind === 'turn') {
        const from = ctx.peek('world').turns;
        const delta = ((mv.to - mv.from) + 4) % 4 === 1 ? 1 : -1;
        ctx.emit('world/rotate-request', { delta });
        return { ok: r.transitionState().active, kind: 'turn', delta, from };
      }
      // Find which screen direction resolves to the move's target cell.
      //
      // The four screen directions are the (+-1, +-1) pairs — the diagonal cross
      // src/ui maps the arrow keys onto. Asking the PLAYER to resolve each one
      // and taking the match means this drives the same code a keypress does,
      // rather than deciding for itself which cell a direction leads to.
      for (const d of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (p._resolve(d) === mv.to) { const ok = p.step(d); return { ok, kind: 'walk', dir: d.join(',') }; }
      }
      return { ok: false, kind: 'walk', dir: null, error: 'no screen direction resolves to target' };
    }, { mv });

    if (!res.ok) { report.errors.push({ move: i, mv, res }); break; }

    let n = 0;
    for (; n < 240; n++) {
      await page.evaluate(() => window.__PUMP__(1));
      frame++;
      if (frame % EVERY === 0) await grab();
      const busy = await page.evaluate(() => {
        const ctx = window.__ENGINE__.ctx;
        return (ctx.peek('player').motionState?.().moving === true)
          || (ctx.peek('render').transitionState().active === true);
      });
      if (!busy) break;
    }
    const state = await page.evaluate(() => {
      const ctx = window.__ENGINE__.ctx;
      return { cell: ctx.peek('player').cell, turns: ctx.peek('world').turns };
    });
    report.moves.push({ i, kind: mv.kind, frames: n + 1, atFrame: frame, ...state });
  }

  report.totalFrames = frame;
  report.totalSeconds = Number((frame / 60).toFixed(3));
  report.shots = shot;
  const turns = report.moves.filter((m) => m.kind === 'turn');
  const walks = report.moves.filter((m) => m.kind === 'walk');
  const tf = turns.reduce((a, m) => a + m.frames, 0), wf = walks.reduce((a, m) => a + m.frames, 0);
  report.summary = {
    turns: turns.length, walks: walks.length,
    framesInTurns: tf, framesInWalks: wf,
    pctTimeRotating: Number((tf / (tf + wf) * 100).toFixed(1)),
    pctInputsRotating: Number((turns.length / (turns.length + walks.length) * 100).toFixed(1)),
    solved: report.moves.at(-1)?.cell === plan.goal,
  };
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(join(OUTDIR, 'playthrough.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exit(1);
