import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPairs, manifestFor, keyFor, tally, agreementStats, sideBalance } from 'blind-panel';

const SHOTS = ['hero', 'seam', 'wide', 'offaxis'];
const CANDS = ['alpha', 'beta'];

// ---------------------------------------------------------------- blinding

test('blinding is reproducible from the seed', () => {
  const a = buildPairs(CANDS, SHOTS, 'seed-1');
  const b = buildPairs(CANDS, SHOTS, 'seed-1');
  assert.deepEqual(a, b);
});

test('a different seed produces a different assignment', () => {
  const a = buildPairs(CANDS, SHOTS, 'seed-1');
  const b = buildPairs(CANDS, SHOTS, 'seed-2');
  assert.notDeepEqual(a.map((p) => p.candidateSide), b.map((p) => p.candidateSide));
});

test('blinding does not depend on input ORDER — only on content', () => {
  const a = buildPairs(['alpha', 'beta'], ['hero', 'wide'], 's');
  const b = buildPairs(['beta', 'alpha'], ['wide', 'hero'], 's');
  assert.deepEqual(a, b, 'directory listing order must not change the blinding');
});

test('every pair assigns the two sides to different images', () => {
  for (const p of buildPairs(CANDS, SHOTS, 's')) {
    assert.notEqual(p.candidateSide, p.referenceSide);
    assert.ok(['left', 'right'].includes(p.candidateSide));
  }
});

test('side assignment is balanced by construction, not by luck', () => {
  // The original tools/lib/blind.js copy flipped an independent coin per pair
  // and produced candidateLeft: 6 / candidateRight: 0 on its first real run.
  // The package builds the half-left/half-right list and shuffles it, so an
  // even item count must split exactly — on every seed, not on average.
  for (const seed of ['s', 'seed-1', 'audit', 'x']) {
    assert.equal(sideBalance(buildPairs(CANDS, SHOTS, seed)).worstSkew, 0);
  }
});

test('the manifest leaks nothing about which side is which', () => {
  const pairs = buildPairs(CANDS, SHOTS, 's');
  const json = JSON.stringify(manifestFor(pairs));
  assert.ok(!json.includes('candidateSide'));
  assert.ok(!json.includes('referenceSide'));
  // pairId contains the candidate name by design (judges compare against a
  // reference, not against each other), but never the side.
  assert.ok(!/"(left|right)"/.test(json));
});

test('the key round-trips the seed so a result can be re-derived', () => {
  const pairs = buildPairs(CANDS, SHOTS, 'audit-me');
  const key = keyFor(pairs, 'audit-me');
  assert.equal(key.seed, 'audit-me');
  assert.deepEqual(buildPairs(CANDS, SHOTS, key.seed), key.pairs);
});

// ---------------------------------------------------------------- tally

const keyOf = (cands = CANDS, shots = SHOTS, seed = 's') =>
  keyFor(buildPairs(cands, shots, seed), seed);

/** Verdicts where `winners` always beat the reference and others always lose. */
function verdictsWhere(key, judges, winners) {
  const out = [];
  for (const judge of judges) {
    for (const p of key.pairs) {
      const wins = winners.includes(p.candidate);
      out.push({ pairId: p.pairId, judge, choice: wins ? p.candidateSide : p.referenceSide });
    }
  }
  return out;
}

test('a candidate that always wins scores 1.0 and one that always loses scores 0', () => {
  const key = keyOf();
  const r = tally(key, verdictsWhere(key, ['j1', 'j2'], ['alpha']));
  const alpha = r.candidates.find((c) => c.name === 'alpha');
  const beta = r.candidates.find((c) => c.name === 'beta');
  assert.equal(alpha.winRate, 1);
  assert.equal(beta.winRate, 0);
  assert.equal(alpha.n, SHOTS.length * 2);
});

test('the confidence interval narrows as n grows', () => {
  const small = keyOf(['a'], ['hero'], 's');
  const large = keyOf(['a'], SHOTS, 's');
  const rs = tally(small, verdictsWhere(small, ['j1'], ['a']));
  const rl = tally(large, verdictsWhere(large, ['j1', 'j2', 'j3'], ['a']));
  // ci95 is a Wilson interval object; width is the comparable quantity.
  assert.ok(rl.candidates[0].ci95.width < rs.candidates[0].ci95.width);
});

test('unknown pairIds and invalid choices are reported, not silently dropped', () => {
  const key = keyOf();
  const r = tally(key, [
    { pairId: 'nope--hero', judge: 'j', choice: 'left' },
    { pairId: key.pairs[0].pairId, judge: 'j', choice: 'sideways' },
    { pairId: key.pairs[1].pairId, judge: 'j', choice: 'left' },
  ]);
  assert.equal(r.unknownPairIds.length, 2);
});

// ---------------------------------------------------------------- the checks that matter

test('position bias fires when judges always pick left regardless of content', () => {
  const key = keyOf();
  const verdicts = key.pairs.map((p) => ({ pairId: p.pairId, judge: 'j1', choice: 'left' }));
  const r = tally(key, verdicts);
  assert.equal(r.positionBias.leftRate, 1);
  assert.equal(r.positionBias.suspect, true,
    'a panel that always picks left must be flagged — its win rates are meaningless');
});

test('position bias does NOT fire on a balanced run', () => {
  const key = keyOf();
  const r = tally(key, verdictsWhere(key, ['j1', 'j2'], ['alpha']));
  assert.equal(r.positionBias.suspect, false);
});

test('agreement near chance is flagged', () => {
  // Two judges answering in exact opposition: agreement 0, which is as far from
  // a shared signal as it gets — but the mean is 0, not 0.5, so nearChance is
  // false. Perfect disagreement is itself a signal (of an inverted rubric), and
  // conflating it with noise would hide that.
  const key = keyOf();
  const verdicts = [];
  for (const p of key.pairs) {
    verdicts.push({ pairId: p.pairId, judge: 'j1', choice: 'left' });
    verdicts.push({ pairId: p.pairId, judge: 'j2', choice: 'right' });
  }
  const r = tally(key, verdicts);
  assert.equal(r.agreement.meanPairwiseAgreement, 0);
  assert.equal(r.agreement.nearChance, false);
});

test('a coin-flipping panel is flagged as near chance', () => {
  const key = keyOf(['a'], ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'], 'x');
  const verdicts = [];
  key.pairs.forEach((p, i) => {
    verdicts.push({ pairId: p.pairId, judge: 'j1', choice: 'left' });
    // j2 agrees on exactly half — the definition of no shared signal.
    verdicts.push({ pairId: p.pairId, judge: 'j2', choice: i % 2 ? 'left' : 'right' });
  });
  const r = tally(key, verdicts);
  assert.equal(r.agreement.meanPairwiseAgreement, 0.5);
  assert.equal(r.agreement.nearChance, true);
});

test('agreement is computed only over pairs both judges actually answered', () => {
  const perJudge = new Map([
    ['j1', new Map([['p1', true], ['p2', false], ['p3', true]])],
    ['j2', new Map([['p1', true], ['p2', false]])],
  ]);
  const s = agreementStats(perJudge);
  assert.equal(s.pairwise[0].overlap, 2, 'p3 was not answered by j2 and must not count');
  assert.equal(s.pairwise[0].agreement, 1);
});

test('a single judge yields no agreement statistic rather than a fake one', () => {
  const key = keyOf();
  const r = tally(key, verdictsWhere(key, ['solo'], ['alpha']));
  assert.equal(r.agreement.pairwise.length, 0);
  assert.equal(r.agreement.meanPairwiseAgreement, null);
  assert.equal(r.agreement.nearChance, false);
});
