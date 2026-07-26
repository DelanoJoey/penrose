#!/usr/bin/env node
/**
 * Blind pairwise visual grading harness.
 *
 *   node tools/grade.mjs prepare --candidates=/tmp/a,/tmp/b --reference=/tmp/ref \
 *                                --out=/tmp/grade [--seed=penrose]
 *   node tools/grade.mjs tally   --dir=/tmp/grade --verdicts=/tmp/verdicts.json
 *
 * PREPARE builds one side-by-side composite per (candidate, shot), with the
 * candidate randomly placed left or right by a seeded stream. Judges see
 * `manifest.json` and the images; they never see `key.json`.
 *
 * TALLY unblinds, and reports win rate per candidate WITH a confidence interval,
 * a position-bias check, and inter-judge agreement.
 *
 * The last two are the point. A win rate on its own is the number everyone
 * quotes and the number that means least: if judges picked "left" 80% of the
 * time they were responding to position, and if they agree at chance they were
 * not detecting anything at all. Both conditions invalidate the headline and
 * both are cheap to detect.
 *
 * Judging itself is deliberately NOT done here. This tool handles blinding,
 * randomisation, unblinding and statistics; who or what looks at the images is
 * the caller's business. That separation is what makes the procedure auditable —
 * anyone with the seed can re-derive the blinding and check the arithmetic.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { buildPairs, manifestFor, keyFor, tally } from './lib/blind.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = Object.fromEntries(argv.slice(1).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

const shotsIn = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png'))
    .map((f) => f.replace(/\.png$/, '')).sort();

/** Side-by-side composite with a neutral gutter. No labels — a label would leak. */
function composite(leftPath, rightPath, gutter = 24, gutterRgb = [24, 24, 28]) {
  const l = PNG.sync.read(readFileSync(leftPath));
  const r = PNG.sync.read(readFileSync(rightPath));
  const height = Math.max(l.height, r.height);
  const width = l.width + gutter + r.width;
  const out = new PNG({ width, height });

  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = gutterRgb[0];
    out.data[i + 1] = gutterRgb[1];
    out.data[i + 2] = gutterRgb[2];
    out.data[i + 3] = 255;
  }

  const blit = (src, dx) => {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const s = (src.width * y + x) << 2;
        const d = (width * y + (x + dx)) << 2;
        out.data[d] = src.data[s];
        out.data[d + 1] = src.data[s + 1];
        out.data[d + 2] = src.data[s + 2];
        out.data[d + 3] = 255;
      }
    }
  };
  blit(l, 0);
  blit(r, l.width + gutter);
  return out;
}

// ---------------------------------------------------------------- prepare
if (cmd === 'prepare') {
  const candidateDirs = String(args.candidates ?? '').split(',').filter(Boolean).map((d) => resolve(d));
  const referenceDir = args.reference ? resolve(args.reference) : null;
  const outDir = resolve(args.out ?? '/tmp/grade');
  const seed = String(args.seed ?? 'penrose');

  if (!candidateDirs.length) die('--candidates=dirA,dirB is required');
  if (!referenceDir) die('--reference=dir is required');
  for (const d of [...candidateDirs, referenceDir]) if (!existsSync(d)) die(`missing directory: ${d}`);

  const names = candidateDirs.map((d) => basename(d));
  const refShots = shotsIn(referenceDir);

  // Only shots present EVERYWHERE. Comparing a candidate on a shot another
  // candidate does not have would silently weight the panel.
  const common = refShots.filter((s) => candidateDirs.every((d) => existsSync(join(d, `${s}.png`))));
  const dropped = refShots.filter((s) => !common.includes(s));
  if (!common.length) die('no shot names common to the reference and every candidate');

  const pairs = buildPairs(names, common, seed);

  mkdirSync(join(outDir, 'pairs'), { recursive: true });
  for (const p of pairs) {
    const candPath = join(candidateDirs[names.indexOf(p.candidate)], `${p.shot}.png`);
    const refPath = join(referenceDir, `${p.shot}.png`);
    const [leftPath, rightPath] = p.candidateSide === 'left' ? [candPath, refPath] : [refPath, candPath];
    writeFileSync(join(outDir, 'pairs', `${p.pairId}.png`), PNG.sync.write(composite(leftPath, rightPath)));
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifestFor(pairs), null, 2));
  writeFileSync(join(outDir, 'key.json'), JSON.stringify(keyFor(pairs, seed), null, 2));

  const leftCount = pairs.filter((p) => p.candidateSide === 'left').length;
  console.log(JSON.stringify({
    out: outDir,
    candidates: names,
    shots: common,
    droppedShots: dropped,
    pairs: pairs.length,
    sideBalance: { candidateLeft: leftCount, candidateRight: pairs.length - leftCount },
    seed,
    note: 'Judges get manifest.json and pairs/. Withhold key.json until verdicts are in.',
  }, null, 2));
  if (dropped.length) console.error(`\nNOTE: dropped ${dropped.length} shot(s) not present in every candidate: ${dropped.join(', ')}`);
  process.exit(0);
}

// ---------------------------------------------------------------- tally
if (cmd === 'tally') {
  const dir = args.dir ? resolve(args.dir) : null;
  const keyPath = args.key ? resolve(args.key) : (dir ? join(dir, 'key.json') : null);
  if (!keyPath || !existsSync(keyPath)) die('--key=key.json (or --dir=) is required');
  if (!args.verdicts) die('--verdicts=verdicts.json is required');

  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const verdicts = JSON.parse(readFileSync(resolve(args.verdicts), 'utf8'));
  if (!Array.isArray(verdicts)) die('verdicts.json must be an array of {pairId, judge, choice}');

  const result = tally(key, verdicts);
  console.log(JSON.stringify(result, null, 2));

  const problems = [];
  if (result.unknownPairIds.length) problems.push(`${result.unknownPairIds.length} verdict(s) referenced an unknown pairId or an invalid choice`);
  if (result.positionBias.suspect) problems.push(`POSITION BIAS: judges chose left ${(result.positionBias.leftRate * 100).toFixed(1)}% of the time — they may be responding to position rather than content, which invalidates the win rates above`);
  if (result.agreement.nearChance) problems.push(`AGREEMENT NEAR CHANCE (${result.agreement.meanPairwiseAgreement}): the panel is not detecting a shared signal, so these win rates are noise however decisive they look`);

  if (problems.length) {
    console.error('\nPROBLEMS:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.error('\nOK: no position bias, agreement above chance.');
  process.exit(0);
}

die(`usage:
  node tools/grade.mjs prepare --candidates=dirA,dirB --reference=dirRef --out=DIR [--seed=S]
  node tools/grade.mjs tally --dir=DIR --verdicts=verdicts.json`);
