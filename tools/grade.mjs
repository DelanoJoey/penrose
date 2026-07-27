#!/usr/bin/env node
/**
 * Blind pairwise visual grading harness.
 *
 *   node tools/grade.mjs prepare --candidates=/tmp/a,/tmp/b --reference=/tmp/ref \
 *                                --out=/tmp/grade [--seed=penrose] [--controls=3]
 *   node tools/grade.mjs gate    --dir=/tmp/grade --verdicts=/tmp/verdicts.json
 *   node tools/grade.mjs tally   --dir=/tmp/grade --verdicts=/tmp/verdicts.json
 *
 * GATE RUNS BEFORE TALLY and is the answer to P10's finding that three of five
 * lenses were not resolving the stimulus at all. `--controls=N` mixes in pairs
 * whose two sides are the SAME FILE; a judge that calls a winner on one of those
 * has confabulated, and `gate` disqualifies it before its other verdicts are
 * allowed to move a win rate. Composites are also written under opaque aliases,
 * because blind-panel names a pair `<candidate>--<item>` and P9 had to
 * neutralise those by hand.
 *
 * PREPARE builds one side-by-side composite per (candidate, shot), with the
 * candidate's side assigned balanced-by-construction from a seeded stream.
 * Judges see `manifest.json` and the images; they never see `key.json`.
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
 * Judging itself is deliberately NOT done here. This tool handles the images —
 * compositing and file layout. Blinding, unblinding and statistics come from
 * the `blind-panel` package, which was extracted FROM this repo and then fixed
 * two defects the local copy still had: independent coin-flip side assignment
 * (which produced a candidateLeft: 6 / candidateRight: 0 run on first use) and
 * a normal-approximation interval that collapses to ±0 at 0/n and n/n wins.
 * Depending on the package instead of keeping a parallel copy is what stops
 * the buggy version looking authoritative ever again.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { buildPairs, keyFor, tally, problemsWith, sideBalance } from 'blind-panel';

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

  /**
   * CONTROL PAIRS — the same image on both sides.
   *
   * P10 ran five differentiated lenses and three of them were not resolving the
   * stimulus at all. That was only discoverable afterwards, by noticing that
   * their written justifications described things which could not differ: one
   * cited "tighter corner joint" and "better proportioned" on a pair whose two
   * sides were pixel-identical in geometry, another cited "shading depth" in a
   * renderer with no lighting term. Their noise dragged mean pairwise agreement
   * to near chance and made the whole panel uncertifiable.
   *
   * A control makes that failure detectable DURING the run instead of by
   * forensics after it. Both sides are the same file, so the honest answer is
   * "same" and any other answer is a confabulation — no interpretation needed.
   *
   * This is the cheapest possible version of a rule worth more than any single
   * verdict: A LENS MUST BE SHOWN CAPABLE OF RESOLVING THE STIMULUS BEFORE ITS
   * VERDICT COUNTS. Hand it a difference that cannot exist and see if it
   * reports one.
   */
  const nControls = Math.max(0, Math.trunc(Number(args.controls ?? 0)) || 0);
  if (nControls > common.length) die(`--controls=${nControls} exceeds ${common.length} available shots`);
  const controls = common.slice(0, nControls).map((item) => ({
    pairId: `control--${item}`, item, control: true,
  }));

  /**
   * OPAQUE ALIASES. blind-panel names a pair `<candidate>--<item>`, which puts
   * the candidate's directory name in front of the judge. P9 hit this and
   * neutralised the filenames by hand; doing it by hand is a step that gets
   * skipped, so the tool does it.
   *
   * Order is by a salted hash of the pairId, not by pair order, so the sequence
   * carries nothing either — and controls land indistinguishably among the real
   * pairs rather than in a block at the end.
   */
  const salt = `${seed}::alias`;
  /**
   * FNV-1a, THEN AN AVALANCHE. The finalizer is not optional and it is not
   * decoration.
   *
   * Plain FNV-1a leaves strings that share a long prefix adjacent in value,
   * because the last character only perturbs the low bits. Every real pair is
   * named `<candidate>--<item>` and every control `control--<item>`, so sorting
   * on the raw hash sorted BY PREFIX: all eight real pairs landed in one band
   * and all four controls in the next, putting the controls in a contiguous
   * block at the end where their position alone gives them away.
   *
   * Caught by test/panel-control.test.js rather than by reading this code. The
   * mix below is the same integer-only avalanche src/render's hash01 uses, for
   * the same reason it uses it.
   */
  const hashOf = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const all = [...pairs, ...controls]
    .map((p) => ({ ...p, _h: hashOf(`${salt}::${p.pairId}`) }))
    .sort((a, b) => (a._h - b._h) || (a.pairId < b.pairId ? -1 : 1));
  const width = String(all.length).length;
  all.forEach((p, i) => { p.alias = `image-${String(i + 1).padStart(width, '0')}`; });

  mkdirSync(join(outDir, 'pairs'), { recursive: true });
  for (const p of all) {
    const refPath = join(referenceDir, `${p.item}.png`);
    // A control is the reference against ITSELF — byte-identical, both sides.
    const candPath = p.control
      ? refPath
      : join(candidateDirs[names.indexOf(p.candidate)], `${p.item}.png`);
    const [leftPath, rightPath] = p.candidateSide === 'right' ? [refPath, candPath] : [candPath, refPath];
    writeFileSync(join(outDir, 'pairs', `${p.alias}.png`), PNG.sync.write(composite(leftPath, rightPath)));
  }

  // The image manifest is presentation, not statistics: the package's manifest
  // carries pairIds only, and where the composite lives is this tool's business.
  const manifest = {
    pairs: all.map((p) => ({ pairId: p.alias, image: `pairs/${p.alias}.png` })),
    instructions:
      'For each image, two renders are shown side by side. Decide which side is better ' +
      'against the stated criterion and answer "left" or "right". You are not told which ' +
      'is which, and the assignment differs per image. Answer every pair. ' +
      'If the two sides are genuinely indistinguishable on your criterion, answer "same" — ' +
      'that is a real answer, not an abstention, and guessing instead of using it counts against you.',
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // key.json stays exactly the blind-panel shape, over the REAL pairs only, so
  // tally's contract is untouched. Aliases and controls live beside it.
  writeFileSync(join(outDir, 'key.json'), JSON.stringify(keyFor(pairs, seed), null, 2));
  writeFileSync(join(outDir, 'alias-key.json'), JSON.stringify({
    seed,
    aliases: all.map((p) => ({
      alias: p.alias, pairId: p.pairId, item: p.item, control: !!p.control,
    })),
  }, null, 2));

  console.log(JSON.stringify({
    out: outDir,
    candidates: names,
    shots: common,
    droppedShots: dropped,
    pairs: pairs.length,
    controls: controls.length,
    total: all.length,
    // Per-candidate left/right counts with worstSkew — reported so a degenerate
    // assignment is visible BEFORE judging starts. This is the number that
    // caught the original coin-flip bug.
    sideBalance: sideBalance(pairs),
    seed,
    note: 'Judges get manifest.json and pairs/. Withhold key.json AND alias-key.json until verdicts are in.',
  }, null, 2));
  if (dropped.length) console.error(`\nNOTE: dropped ${dropped.length} shot(s) not present in every candidate: ${dropped.join(', ')}`);
  if (!nControls) console.error('\nNOTE: no control pairs. Nothing will detect a judge that cannot resolve the stimulus — see --controls=N.');
  process.exit(0);
}

// ------------------------------------------------------------------- gate
/**
 * Disqualify judges that reported a difference which cannot exist.
 *
 * Run this BEFORE tally. A judge that fails here has not produced weak
 * evidence, it has produced no evidence, and averaging it in is what made P10's
 * panel uncertifiable.
 */
if (cmd === 'gate') {
  const aliasKeyPath = args['alias-key'] ? resolve(args['alias-key'])
    : (args.dir ? join(resolve(args.dir), 'alias-key.json') : null);
  if (!aliasKeyPath || !existsSync(aliasKeyPath)) die('--alias-key=alias-key.json (or --dir=) is required');
  if (!args.verdicts) die('--verdicts=verdicts.json is required');

  const aliasKey = JSON.parse(readFileSync(aliasKeyPath, 'utf8'));
  const verdicts = JSON.parse(readFileSync(resolve(args.verdicts), 'utf8'));
  if (!Array.isArray(verdicts)) die('verdicts.json must be an array of {pairId, judge, choice}');

  const isControl = new Map(aliasKey.aliases.map((a) => [a.alias, a.control]));
  const unknown = [...new Set(verdicts.map((v) => v.pairId).filter((p) => !isControl.has(p)))];
  const nControls = aliasKey.aliases.filter((a) => a.control).length;

  const byJudge = new Map();
  for (const v of verdicts) {
    if (!isControl.get(v.pairId)) continue;
    const j = byJudge.get(v.judge) ?? { judge: v.judge, controls: 0, confabulated: 0, calls: [] };
    j.controls += 1;
    if (String(v.choice).toLowerCase() !== 'same') { j.confabulated += 1; j.calls.push(v.pairId); }
    byJudge.set(v.judge, j);
  }

  const judges = [...byJudge.values()].map((j) => ({
    ...j,
    // ANY confident call on an identical pair is a failure. Not a rate, not a
    // threshold — the images are the same file, so one is one too many.
    pass: j.confabulated === 0,
  })).sort((a, b) => a.judge < b.judge ? -1 : 1);

  const failed = judges.filter((j) => !j.pass).map((j) => j.judge);
  const result = {
    controlsInPanel: nControls,
    judges,
    disqualified: failed,
    admitted: judges.filter((j) => j.pass).map((j) => j.judge),
    unknownPairIds: unknown,
  };
  console.log(JSON.stringify(result, null, 2));

  if (!nControls) { console.error('\nFAIL: the panel contains no control pairs, so this gate proves nothing.'); process.exit(1); }
  if (!judges.length) { console.error('\nFAIL: no judge answered any control pair.'); process.exit(1); }
  if (failed.length) {
    console.error(`\nDISQUALIFIED: ${failed.join(', ')} — reported a difference between identical images. ` +
      'Exclude these judges before tallying; their verdicts are not weak evidence, they are none.');
    process.exit(1);
  }
  console.error('\nOK: every judge answered "same" on every control. The panel can resolve what it was shown.');
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

  const problems = problemsWith(result);

  if (problems.length) {
    console.error('\nPROBLEMS:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.error('\nOK: no position bias, agreement above chance.');
  process.exit(0);
}

die(`usage:
  node tools/grade.mjs prepare --candidates=dirA,dirB --reference=dirRef --out=DIR [--seed=S] [--controls=N]
  node tools/grade.mjs gate    --dir=DIR --verdicts=verdicts.json
  node tools/grade.mjs tally   --dir=DIR --verdicts=verdicts.json

  Run gate BEFORE tally. It disqualifies any judge that reported a difference
  between two identical images — see the note on control pairs in prepare.`);
