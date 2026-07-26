/**
 * Blind pairwise comparison — the pure logic.
 *
 * WHY THIS EXISTS. The interesting part of an adversarial visual grading run is
 * not the judging. It is the rigour around the judging: that the judge cannot
 * tell which image is the candidate, that left/right assignment is balanced, that
 * the unblinding is auditable after the fact, and that you can tell the
 * difference between "the judges agree because there is a real difference" and
 * "the judges agree because they share a bias".
 *
 * Upstream (mshumer/Claude-of-Duty) ran eleven critics in blind A/B against real
 * Call of Duty frames and reported the result honestly, but shipped no tooling
 * for it — the procedure lives only in prose in its README. This module is that
 * procedure made executable and checkable.
 *
 * Everything here is pure and seeded. Given the same seed and the same inputs,
 * the same blinding is produced, so a published result can be re-derived by
 * anyone rather than taken on trust.
 */

import { makeRng } from '../../src/core/rng.js';

/**
 * Build the blinded pair list.
 *
 * One pair per (candidate, shot): the candidate image against the reference
 * image of the same shot. Which side the candidate lands on is decided by a
 * seeded stream, so it is random to the judge and reproducible to the auditor.
 *
 * @param {string[]} candidates candidate names
 * @param {string[]} shots shot names present in every directory
 * @param {string} seed
 */
export function buildPairs(candidates, shots, seed = 'blind') {
  const rng = makeRng(seed).fork('side-assignment');
  const pairs = [];

  // Sorted so pair order — and therefore the rng consumption order — does not
  // depend on directory listing order. Without this the "same seed reproduces
  // the same blinding" guarantee silently depends on the filesystem.
  for (const candidate of [...candidates].sort()) {
    for (const shot of [...shots].sort()) {
      const candidateSide = rng() < 0.5 ? 'left' : 'right';
      pairs.push({
        pairId: `${candidate}--${shot}`,
        candidate,
        shot,
        candidateSide,
        referenceSide: candidateSide === 'left' ? 'right' : 'left',
      });
    }
  }
  return pairs;
}

/** What the judge is allowed to see. Carries no hint of which side is which. */
export function manifestFor(pairs) {
  return {
    pairs: pairs.map((p) => ({ pairId: p.pairId, image: `pairs/${p.pairId}.png` })),
    instructions:
      'For each image, two renders are shown side by side. Decide which side is better ' +
      'against the stated criterion and answer "left" or "right". You are not told which ' +
      'is which, and the assignment differs per image. Answer every pair.',
  };
}

/** The sealed key. Written separately so it can be withheld until verdicts are in. */
export function keyFor(pairs, seed) {
  return { seed, pairs };
}

/**
 * Resolve verdicts against the key.
 *
 * @param {object} key from keyFor
 * @param {Array<{pairId:string, judge:string, choice:'left'|'right'}>} verdicts
 */
export function tally(key, verdicts) {
  const byId = new Map(key.pairs.map((p) => [p.pairId, p]));

  const perCandidate = new Map();
  const perJudge = new Map();
  const unknown = [];
  let leftPicks = 0, total = 0;

  for (const v of verdicts) {
    const pair = byId.get(v.pairId);
    if (!pair) { unknown.push(v.pairId); continue; }
    if (v.choice !== 'left' && v.choice !== 'right') { unknown.push(v.pairId); continue; }

    const candidateWon = v.choice === pair.candidateSide;
    total += 1;
    if (v.choice === 'left') leftPicks += 1;

    if (!perCandidate.has(pair.candidate)) perCandidate.set(pair.candidate, { wins: 0, n: 0 });
    const c = perCandidate.get(pair.candidate);
    c.n += 1;
    if (candidateWon) c.wins += 1;

    if (!perJudge.has(v.judge)) perJudge.set(v.judge, new Map());
    perJudge.get(v.judge).set(v.pairId, candidateWon);
  }

  const candidates = [...perCandidate.entries()]
    .map(([name, { wins, n }]) => ({
      name, wins, n,
      winRate: n ? +(wins / n).toFixed(4) : 0,
      // Normal-approximation half-width at 95%. Reported so a 3-of-4 result is
      // visibly not the same thing as a 30-of-40 result.
      ci95: n ? +(1.96 * Math.sqrt(0.25 / n)).toFixed(4) : 1,
    }))
    .sort((a, b) => b.winRate - a.winRate || a.name.localeCompare(b.name));

  return {
    candidates,
    /**
     * POSITION BIAS. If judges pick "left" far from half the time, they are
     * responding to position rather than to content and every score above is
     * suspect. Cheap to compute, almost never reported, and it invalidates a
     * whole run when it fires.
     */
    positionBias: {
      leftPicks, total,
      leftRate: total ? +(leftPicks / total).toFixed(4) : 0,
      suspect: total >= 8 && Math.abs(leftPicks / total - 0.5) > 0.25,
    },
    agreement: agreementStats(perJudge),
    unknownPairIds: unknown,
  };
}

/**
 * Pairwise inter-judge agreement on the UNBLINDED outcome.
 *
 * Agreement near chance means the judges are not detecting a shared signal, and
 * a win rate computed from them is noise no matter how decisive it looks.
 * Agreement near 1 means either a real difference or a bias the judges share —
 * this statistic cannot distinguish those, and pretending otherwise is the
 * standard way blind panels get oversold.
 */
export function agreementStats(perJudge) {
  const judges = [...perJudge.keys()].sort();
  const pairsOfJudges = [];

  for (let i = 0; i < judges.length; i++) {
    for (let j = i + 1; j < judges.length; j++) {
      const a = perJudge.get(judges[i]);
      const b = perJudge.get(judges[j]);
      let same = 0, n = 0;
      for (const [pairId, outcome] of a) {
        if (!b.has(pairId)) continue;
        n += 1;
        if (b.get(pairId) === outcome) same += 1;
      }
      pairsOfJudges.push({
        judges: [judges[i], judges[j]],
        overlap: n,
        agreement: n ? +(same / n).toFixed(4) : null,
      });
    }
  }

  const scored = pairsOfJudges.filter((p) => p.agreement != null);
  const mean = scored.length
    ? +(scored.reduce((s, p) => s + p.agreement, 0) / scored.length).toFixed(4)
    : null;

  return {
    judges,
    pairwise: pairsOfJudges,
    meanPairwiseAgreement: mean,
    /** Below this, the panel is not discriminating and the run should be discarded. */
    nearChance: mean != null && Math.abs(mean - 0.5) < 0.1,
  };
}
