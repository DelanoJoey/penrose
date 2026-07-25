#!/usr/bin/env node
/**
 * Harness self-consistency check — "is the gate itself reproducible right now?"
 *
 * Captures the full shot set twice, back to back, into two temp directories and
 * diffs them. Any difference is nondeterminism in the ENGINE, not a regression
 * in the work, and it means every downstream pixel-gate result is meaningless
 * until it is fixed.
 *
 * This is the P0 exit criterion and should be run before trusting any gate
 * verdict, especially after adding a subsystem.
 *
 *   node tools/gate.mjs [--port=5173] [--keep]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

const ROOT = resolve(import.meta.dirname, '..');
const PORT = String(args.port ?? 5173);

const run = (script, extra) => new Promise((res) => {
  const p = spawn(process.execPath, [join(ROOT, 'tools', script), ...extra], {
    cwd: ROOT, env: { ...process.env, OW_NO_HMR: '1' },
  });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => res({ code, out }));
});

const a = mkdtempSync(join(tmpdir(), 'penrose-gate-a-'));
const b = mkdtempSync(join(tmpdir(), 'penrose-gate-b-'));

console.log(`[gate] capture 1/2 -> ${a}`);
const r1 = await run('baseline.mjs', [`--out=${a}`, `--port=${PORT}`]);
if (r1.code !== 0) { console.error(r1.out); console.error('[gate] FAIL: first capture errored'); process.exit(1); }

console.log(`[gate] capture 2/2 -> ${b}`);
const r2 = await run('baseline.mjs', [`--out=${b}`, `--port=${PORT}`]);
if (r2.code !== 0) { console.error(r2.out); console.error('[gate] FAIL: second capture errored'); process.exit(1); }

console.log('[gate] diffing');
const d = await run('imagediff.mjs', [`--a=${a}`, `--b=${b}`, '--write-diff']);
console.log(d.out);

if (!args.keep) { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }

if (d.code === 0) {
  console.log('[gate] PASS — two independent captures are pixel-identical. The gate is trustworthy.');
  process.exit(0);
}
console.error('[gate] FAIL — the engine is not deterministic. Fix this before trusting any gate verdict.');
console.error(`[gate] diff images kept in ${b} (re-run with --keep to retain both)`);
process.exit(1);
