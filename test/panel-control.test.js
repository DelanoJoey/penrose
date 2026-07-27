import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

/**
 * THE CONTROL PAIR, AND WHY IT IS WORTH MORE THAN ANY SINGLE VERDICT.
 *
 * P10 ran five differentiated lenses over a real change. Three of them were not
 * resolving the stimulus at all — one justified its picks with "tighter corner
 * joint" and "better proportioned" on pairs whose two sides were pixel-identical
 * in geometry, another cited "shading depth" in a renderer that has no lighting
 * term. Nothing in the harness noticed. Their noise pulled mean pairwise
 * agreement to near chance and made the run uncertifiable, and the only reason
 * it was caught at all is that someone read the justifications afterwards.
 *
 * A control pair is the same file on both sides. The honest answer is "same".
 * Any other answer is a confabulation, with no interpretation required — which
 * is what makes this a gate rather than a heuristic.
 */

const ROOT = resolve(import.meta.dirname, '..');
const GRADE = join(ROOT, 'tools', 'grade.mjs');

/** A tiny solid PNG. Content is irrelevant; only sameness/difference matters. */
function png(path, rgb) {
  const p = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = rgb[0]; p.data[i + 1] = rgb[1]; p.data[i + 2] = rgb[2]; p.data[i + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(p));
}

function fixture(shots = ['alpha', 'beta', 'gamma', 'delta']) {
  const dir = mkdtempSync(join(tmpdir(), 'penrose-control-'));
  const ref = join(dir, 'ref'), cand = join(dir, 'variant-a');
  mkdirSync(ref); mkdirSync(cand);
  for (const s of shots) { png(join(ref, `${s}.png`), [200, 30, 30]); png(join(cand, `${s}.png`), [30, 30, 200]); }
  return { dir, ref, cand };
}

/**
 * spawnSync, not execFileSync: execFileSync only hands back stdout on success,
 * so a test asserting on a WARNING printed to stderr by a zero-exit run saw an
 * empty string and passed vacuously in one direction and failed in the other.
 * Capture both streams and the code, always.
 */
const run = (argv) => {
  const r = spawnSync(process.execPath, [GRADE, ...argv], { encoding: 'utf8' });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
};

const prepare = (f, extra = []) => {
  const out = join(f.dir, 'grade');
  const r = run(['prepare', `--candidates=${f.cand}`, `--reference=${f.ref}`, `--out=${out}`, '--seed=t', ...extra]);
  assert.equal(r.code, 0, `prepare failed: ${r.err ?? ''}`);
  return { out, report: JSON.parse(r.out) };
};

const verdictsFile = (dir, rows) => {
  const p = join(dir, 'verdicts.json');
  writeFileSync(p, JSON.stringify(rows));
  return p;
};

test('a control pair is byte-identical on both sides', () => {
  const f = fixture();
  const { out } = prepare(f, ['--controls=2']);
  const key = JSON.parse(readFileSync(join(out, 'alias-key.json'), 'utf8'));
  const controls = key.aliases.filter((a) => a.control);
  assert.equal(controls.length, 2);

  for (const c of controls) {
    const img = PNG.sync.read(readFileSync(join(out, 'pairs', `${c.alias}.png`)));
    const gutter = 24;
    const half = (img.width - gutter) / 2;
    assert.ok(Number.isInteger(half) && half > 0, 'composite is not two equal halves plus a gutter');
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < half; x++) {
        const l = (y * img.width + x) * 4;
        const r = (y * img.width + (x + half + gutter)) * 4;
        for (let k = 0; k < 3; k++) {
          assert.equal(img.data[l + k], img.data[r + k],
            `control ${c.alias} differs at ${x},${y} — a judge could legitimately prefer a side`);
        }
      }
    }
  }
  rmSync(f.dir, { recursive: true, force: true });
});

test('aliases leak neither the candidate name nor the shot name', () => {
  const f = fixture();
  const { out } = prepare(f, ['--controls=2']);
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  const blob = JSON.stringify(manifest);

  for (const word of ['variant-a', 'alpha', 'beta', 'gamma', 'delta', 'control', 'ref']) {
    assert.ok(!blob.includes(word), `manifest leaks "${word}" — the judge can infer the answer from the filename`);
  }
  // and the files on disk carry the same opaque names
  const files = readdirSync(join(out, 'pairs'));
  assert.ok(files.every((n) => /^image-\d+\.png$/.test(n)), `non-opaque filenames: ${files.join(', ')}`);
  rmSync(f.dir, { recursive: true, force: true });
});

test('controls are interleaved with real pairs, not grouped at the end', () => {
  // A block of controls at the tail is guessable from position alone.
  const f = fixture(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  const { out } = prepare(f, ['--controls=4']);
  const key = JSON.parse(readFileSync(join(out, 'alias-key.json'), 'utf8'));
  const flags = key.aliases.map((a) => a.control);
  const firstControl = flags.indexOf(true);
  const lastReal = flags.lastIndexOf(false);
  assert.ok(firstControl < lastReal,
    'every control sorts after every real pair — position gives them away');
  rmSync(f.dir, { recursive: true, force: true });
});

test('gate DISQUALIFIES a judge that calls a winner on identical images', () => {
  const f = fixture();
  const { out } = prepare(f, ['--controls=2']);
  const key = JSON.parse(readFileSync(join(out, 'alias-key.json'), 'utf8'));

  const rows = key.aliases.flatMap((a) => ([
    { pairId: a.alias, judge: 'honest', choice: a.control ? 'same' : 'left' },
    { pairId: a.alias, judge: 'confabulator', choice: 'left' },
  ]));
  const r = run(['gate', `--dir=${out}`, `--verdicts=${verdictsFile(f.dir, rows)}`]);

  assert.equal(r.code, 1, 'gate passed a judge that reported an impossible difference');
  const res = JSON.parse(r.out);
  assert.deepEqual(res.disqualified, ['confabulator']);
  assert.deepEqual(res.admitted, ['honest']);
  assert.match(r.err, /DISQUALIFIED/);
  rmSync(f.dir, { recursive: true, force: true });
});

test('gate ADMITS a panel that answers "same" on every control', () => {
  const f = fixture();
  const { out } = prepare(f, ['--controls=2']);
  const key = JSON.parse(readFileSync(join(out, 'alias-key.json'), 'utf8'));

  const rows = key.aliases.flatMap((a) => ['j1', 'j2'].map((judge) => ({
    pairId: a.alias, judge, choice: a.control ? 'same' : (judge === 'j1' ? 'left' : 'right'),
  })));
  const r = run(['gate', `--dir=${out}`, `--verdicts=${verdictsFile(f.dir, rows)}`]);

  assert.equal(r.code, 0, `gate rejected an honest panel: ${r.err}`);
  assert.deepEqual(JSON.parse(r.out).disqualified, []);
  rmSync(f.dir, { recursive: true, force: true });
});

test('gate FAILS CLOSED when the panel has no controls at all', () => {
  /**
   * The dangerous outcome is not a gate that fires — it is a gate that passes
   * silently because there was nothing to check. A panel prepared without
   * --controls must not be able to earn a clean bill of health.
   */
  const f = fixture();
  const { out } = prepare(f);                     // no --controls
  const key = JSON.parse(readFileSync(join(out, 'alias-key.json'), 'utf8'));
  assert.ok(key.aliases.every((a) => !a.control), 'fixture unexpectedly has controls');

  const rows = key.aliases.map((a) => ({ pairId: a.alias, judge: 'j1', choice: 'left' }));
  const r = run(['gate', `--dir=${out}`, `--verdicts=${verdictsFile(f.dir, rows)}`]);

  assert.equal(r.code, 1, 'a control-free panel passed the gate — the gate proves nothing and said nothing');
  assert.match(r.err, /no control pairs/);
  rmSync(f.dir, { recursive: true, force: true });
});

test('prepare warns when it builds a panel with no controls', () => {
  const f = fixture();
  const out = join(f.dir, 'grade');
  const r = run(['prepare', `--candidates=${f.cand}`, `--reference=${f.ref}`, `--out=${out}`, '--seed=t']);
  assert.equal(r.code, 0);
  assert.match(r.err ?? '', /no control pairs/,
    'prepare built a gate-proof panel without saying so');
  rmSync(f.dir, { recursive: true, force: true });
});

test('key.json keeps the blind-panel shape so tally is unaffected', () => {
  // The controls live in alias-key.json precisely so tally's contract is not
  // touched. If controls leaked into key.json they would be counted as pairs.
  const f = fixture();
  const { out, report } = prepare(f, ['--controls=2']);
  const key = JSON.parse(readFileSync(join(out, 'key.json'), 'utf8'));
  assert.ok(Array.isArray(key.pairs), 'key.json lost its pairs array');
  assert.equal(key.pairs.length, report.pairs, 'key.json pair count moved');
  assert.ok(key.pairs.every((p) => p.candidate && p.candidateSide && !p.control),
    'a control leaked into key.json and tally would count it as a real comparison');
  assert.ok(existsSync(join(out, 'alias-key.json')));
  rmSync(f.dir, { recursive: true, force: true });
});

test('gate reports a non-discriminating judge without disqualifying it', () => {
  /**
   * The mirror of the control's blind spot, found in the P14 multi-model panel:
   * one model scored 8 or 9 on every frame in the set, including frames three
   * other models called broken. It passed the duplicate control at d=0 and
   * discriminated nothing — perfect self-consistency, zero information.
   *
   * "same" everywhere must NOT be a failure, because it is also the correct
   * answer when the difference genuinely is below threshold. So this asserts it
   * is REPORTED and still ADMITTED.
   */
  const f = fixture();
  const { out } = prepare(f, ['--controls=2']);
  const key = JSON.parse(readFileSync(join(out, 'alias-key.json'), 'utf8'));

  const rows = key.aliases.flatMap((a) => ([
    // says "same" to absolutely everything
    { pairId: a.alias, judge: 'flat', choice: 'same' },
    // actually discriminates on the real pairs
    { pairId: a.alias, judge: 'sharp', choice: a.control ? 'same' : 'left' },
  ]));
  const r = run(['gate', `--dir=${out}`, `--verdicts=${verdictsFile(f.dir, rows)}`]);

  assert.equal(r.code, 0, `gate failed an honest panel: ${r.err}`);
  const res = JSON.parse(r.out);
  assert.deepEqual(res.disqualified, [], 'answering "same" everywhere must not disqualify');
  assert.ok(res.admitted.includes('flat'), 'the flat judge must still be admitted');
  assert.deepEqual(res.nonDiscriminating, ['flat'], 'the flat judge was not reported');

  const flat = res.judges.find((j) => j.judge === 'flat');
  const sharp = res.judges.find((j) => j.judge === 'sharp');
  assert.equal(flat.sameRate, 1, 'sameRate should be 1 for a judge that never picks a side');
  assert.equal(sharp.sameRate, 0, 'sameRate should be 0 for a judge that always picks a side');
  assert.equal(sharp.allSame, false);
  assert.match(r.err, /answered "same" on every real pair/);
  rmSync(f.dir, { recursive: true, force: true });
});
