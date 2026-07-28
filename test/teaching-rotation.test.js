import test from 'node:test';
import assert from 'node:assert/strict';
import { Structure, cellId } from '../src/geometry/index.js';
import { LEVELS, ORDER } from '../src/world/levels.js';

/**
 * `teach-01` exists to teach ONE thing: that rotating changes what you can walk
 * on. Every assertion here re-applies a filter `tools/teachrotate.mjs` used to
 * FIND the level, in order to KEEP it — each is a property a later edit could
 * destroy while leaving the level solvable and every other test green.
 *
 * The property being defended is not "this level is solvable". It is "a player
 * who does not know rotation exists will be told, and then shown."
 */

const L = LEVELS['teach-01'];
const S = new Structure(L.cells);
const graphs = [0, 1, 2, 3].map((t) => S.pathGraph(t));
const startId = cellId(...L.start);
const goalId = cellId(...L.goal);

test('teach-01 is in the campaign, before the first level that needs a rotation', () => {
  const i = ORDER.indexOf('teach-01');
  assert.ok(i > 0, 'teach-01 is not in ORDER');
  // Everything from spur-01 on is unsolvable in a standing view. The lesson has
  // to land before the first level that assumes it.
  assert.ok(i < ORDER.indexOf('spur-01'),
    'teach-01 must come before spur-01, the first level that cannot be solved standing still');
});

test('THE LESSON: the start has no legal walk, so the HUD says to rotate', () => {
  // src/ui shows "nothing to walk to, rotate" exactly when zero movement keys
  // are legal (elRotateHint.hidden = legal.length > 0). If the start acquires a
  // single walkable neighbour the prompt never fires and the level teaches
  // nothing — while remaining perfectly solvable.
  assert.deepEqual(graphs[0].get(startId), [],
    'the opening view must offer no walk at all');
});

test('a start you can walk into could never have taught this', () => {
  // Screen adjacency is symmetric, so any cell reached on foot retains the way
  // back and can never have zero legal walks. That is why this state has to be
  // a START, and why no amount of level design produces "walk into a wall".
  // Recorded as an assertion because it is the reason the level is shaped this
  // way, and a future author will otherwise try the corridor version first.
  for (const [id, tos] of graphs[0]) {
    if (tos.length !== 0) continue;
    for (const [other, others] of graphs[0]) {
      assert.ok(!others.includes(id),
        `${id} has no exit yet ${other} claims an edge to it — adjacency is not symmetric`);
    }
  }
});

test('BOTH quarter turns open a walk', () => {
  // Added after looking at plates. A candidate that opened in one direction
  // only is, pressed the other way, pixel-identical to the dead state it
  // started in — still saying "nothing to walk to, rotate". A first rotation
  // that changes nothing teaches that rotating does not help.
  const opens = [1, 3].filter((t) => (graphs[t].get(startId) ?? []).length > 0);
  assert.deepEqual(opens, [1, 3],
    'a rotation that opens nothing teaches the opposite of the lesson');
  assert.equal(L.teaches.opens, 2, 'the declared `opens` no longer matches');
});

test('after the rotation the route is FORCED, all the way to the goal', () => {
  // One legal walk at every step. span-02 is what happens without it: a player
  // with two options and no way to tell them apart cannot learn which of the
  // two things they did was the one that helped.
  const t = 1;
  let cur = startId, steps = 0;
  const seen = new Set([startId]);
  for (;;) {
    const next = [...new Set(graphs[t].get(cur) ?? [])].filter((n) => !seen.has(n));
    if (next.length === 0) break;
    assert.equal(next.length, 1,
      `a choice appeared at ${cur} after ${steps} walks — the lesson can be walked away from`);
    cur = next[0];
    seen.add(cur);
    steps += 1;
  }
  assert.equal(cur, goalId, 'the forced corridor does not end at the goal');
  assert.equal(steps, L.teaches.runUp, `walked ${steps}, declares ${L.teaches.runUp}`);
});

test('the level is short enough to be a lesson and long enough to register', () => {
  // loop-01 was meant to carry the adjacency lesson and could not: it wins in
  // one move, so the trick fires before the player registers that anything
  // happened (§P18). The first shortlist here had par 1 for the same reason.
  assert.equal(S.minWalksBetween(L.start, L.goal), L.premise.par);
  assert.ok(L.premise.par >= 4, `par ${L.premise.par} is too short to register`);
  assert.ok(L.premise.par <= 10, `par ${L.premise.par} is longer than a lesson needs`);
});

test('exactly one rotation is required — no more of the lesson than the lesson', () => {
  assert.equal(S.minTurnsBetween(L.start, L.goal), 1);
  assert.equal(L.premise.minTurns, 1);
});

test('it opens with a turn, and says so', () => {
  // The only level in the campaign that declares openWithWalk false.
  // tools/analyze.mjs calls a route opening with a turn "unplayable on frame
  // one", which is right everywhere else and is the point here.
  assert.equal(L.premise.openWithWalk, false);
  assert.equal(S.premise(L.start, L.goal).route?.[0]?.kind, 'turn');
  for (const name of ORDER) {
    if (name === 'teach-01') continue;
    assert.notEqual(LEVELS[name].premise?.openWithWalk, false,
      `${name} also opens with a turn — the exception is supposed to be unique`);
  }
});

test('the goal is standable in the opening view, so the player can see where they are going', () => {
  // §P20: perch-05 shipped with a goal occluded at turn 0 and nothing caught
  // it. Being told to rotate is only useful if there is a visible reason to.
  const standable0 = new Set(S.standable(0).map((c) => cellId(...c)));
  assert.ok(standable0.has(goalId), 'the goal is not visible in the view the level opens in');
});

test('it uses the illusion, like every other level', () => {
  const p = S.premise(L.start, L.goal);
  assert.ok(p.usesIllusion, 'a teaching level that avoids the mechanic teaches the wrong game');
  assert.equal(L.premise.illusion, true);
});

test('the campaign curve does not go backwards', () => {
  const turns = ORDER.map((n) => LEVELS[n].premise?.minTurns ?? 0);
  for (let i = 1; i < turns.length; i++) {
    assert.ok(turns[i] >= turns[i - 1],
      `${ORDER[i]} requires fewer turns than ${ORDER[i - 1]}`);
  }
});
