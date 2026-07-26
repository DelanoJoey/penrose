# Motion Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the camera orbit, the avatar's step interpolation, and the avatar's bias-drop-during-orbit under the pixel gate.

**Architecture:** A shot may declare the `settle` it needs, and only then may it start an animation. The capture **fails** if a shot that declared `settle` reports no motion at the shutter — that assertion is what stops this change being theatre.

**Tech Stack:** Node 22 (`node --test`), Three.js r180, Vite 7, Playwright/Chromium.

**Spec:** `docs/superpowers/specs/2026-07-26-motion-coverage-design.md`

---

## Read first

`ARCHITECTURE.md` §1 (determinism), §4 (lockstep hooks), §5 (the gate). Then the header block of `src/dev/shots.js`.

**Measured, not computed** — the arithmetic is wrong for one of these:

| | frames | `ceil(seconds/dt)` |
|---|---|---|
| orbit, request → commit | **28** | 27 ✗ |
| step, `step()` → settled | **14** | 14 ✓ |

**The failure mode to design against:** a motion shot that silently captures a *settled* frame. It would be perfectly reproducible, pass the gate forever, and cover nothing.

## File structure

| File | Responsibility |
|---|---|
| `src/render/index.js` *(modify)* | `info()` reports whether an orbit is in flight |
| `src/player/index.js` *(modify)* | `motionState()` reports whether a step is in flight |
| `tools/baseline.mjs` *(modify)* | per-shot `settle`; **fail** a declared-motion shot that isn't moving |
| `src/dev/shots.js` *(modify)* | the contract note, then three motion shots |
| `test/motion-frames.test.js` *(create)* | pin the measured frame counts, driving the engine |

---

### Task 1: Setup and the before-picture

- [ ] **Step 1: Install**

```bash
cd ~/penrose/.worktrees/motion-coverage
npm install && npx playwright install chromium
```

- [ ] **Step 2: Confirm green before changing anything**

```bash
npm test
```

Expected: 142 pass, 0 fail.

- [ ] **Step 3: Capture the 12 references Task 3 must not move**

```bash
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/mo-before --port=5711
ls -1 /tmp/mo-before/*.png | wc -l
```

Expected: `"ok": true`, 12 PNGs. **Use a port nothing else is on** — a stale dev server from another worktree silently serves the wrong code and makes this comparison meaningless (see `METHODOLOGY.md` §P5). The harness now refuses to reuse a foreign server and will announce if it moves ports; read that line if it appears.

---

### Task 2: Expose whether anything is moving

Without this, a motion shot cannot be distinguished from a settled one and the whole change is unverifiable.

**Files:** Modify `src/render/index.js`, `src/player/index.js`

- [ ] **Step 1: Report orbit state from the renderer**

In `src/render/index.js`, in `info()`, add one field:

```js
      pixelRatio: this.renderer.getPixelRatio(),
      /**
       * Whether a camera orbit is in flight AT THE SHUTTER.
       *
       * Reported so a capture is self-describing: tools/baseline.mjs refuses a
       * shot that declared a settle count but landed on a settled frame. Such a
       * shot would be perfectly reproducible, pass the gate forever, and cover
       * nothing -- the same shape as a green result that measured the wrong
       * thing.
       */
      orbiting: this.transitionState().active,
```

- [ ] **Step 2: Report step state from the player**

**CORRECTED DURING IMPLEMENTATION.** This originally said to add `moving` to `state()`. That is
wrong and two existing tests catch it: `traversal.test.js:255` asserts `state()` is unchanged
after 120 frames, because `state()` is the UI-facing snapshot and must be time-invariant or the
HUD becomes frame-dependent. `moving` flips true → false as frames advance.

Add a **separate** method instead, mirroring `render.transitionState()`:

```js
  motionState() {
    return {
      moving: this._duration > 0,
      progress: this._duration > 0 ? Math.min(this._elapsed / this._duration, 1) : 0,
    };
  },
```

placed immediately after `state()`, with a comment recording why it is not part of `state()`.

- [ ] **Step 3: Verify both are false at rest and true in flight**

```bash
node --test test/*.test.js src/*/*.test.js
```

Expected: 0 failures (nothing asserts these yet; this only proves nothing broke).

- [ ] **Step 4: Commit**

```bash
git add src/render/index.js src/player/index.js
git commit -m "engine: report whether an orbit or a step is in flight

Needed so a capture can be self-describing. A motion shot that silently
landed on a settled frame would be reproducible, pass the gate forever,
and cover nothing."
```

---

### Task 3: Per-shot settle, and refusing a motionless motion shot

Lands **before any motion shot exists**, so a reference shift can only be the harness.

**Files:** Modify `tools/baseline.mjs`, `src/dev/shots.js` (comment only)

- [ ] **Step 1: Discover `settle` alongside `level`**

In `tools/baseline.mjs`, extend the probe evaluate:

```js
const all = await probe.evaluate(
  'Object.entries(window.__SHOTS__ ?? {}).map(([name, fn]) => ({ name, level: fn.level ?? null, settle: fn.settle ?? null }))');
```

and the `--shots` filter fallback object to `{ name: n, level: null, settle: null }`.

- [ ] **Step 2: Use it, and enforce the motion assertion**

Change the loop header to `for (const { name, level, settle } of wanted) {`.

Replace the pump/screenshot section so the declared settle wins, and a declared-motion shot that isn't moving fails the run:

```js
    const frames = settle ?? SETTLE;
    await page.evaluate((n) => window.__PUMP__(n), frames);
    await page.evaluate(() => window.__PRESENT__(2));

    // A shot that declared a settle count is a MOTION shot. If nothing is
    // actually in flight at the shutter it captured a settled frame -- which
    // would be reproducible, pass the gate forever, and cover nothing. Fail
    // loudly instead. See the spec, §6.
    const motion = await page.evaluate(() => ({
      orbiting: window.__ENGINE__?.ctx?.peek?.('render')?.info?.().orbiting === true,
      moving: window.__ENGINE__?.ctx?.peek?.('player')?.motionState?.().moving === true,
    }));
    if (settle != null && !motion.orbiting && !motion.moving) {
      report.ok = false;
      report.shots.push({ shot: name, level, settle, ok: false,
        error: `declared settle ${frames} but nothing was in motion at the shutter` });
      await page.close();
      continue;
    }

    await page.screenshot({ path: `${OUTDIR}/${name}.png`, type: 'png' });
```

Record `settle` and `motion` in the success `report.shots.push({...})` too.

Keep the existing `resetTemporal` call and its position — it drops temporal history before pumping.

- [ ] **Step 3: Update the contract in `src/dev/shots.js`**

Amend the header block where it says a shot must not start animations:

```
 * MOTION SHOTS. The rule above -- a shot may not start an animation -- is about
 * LEGIBILITY, not determinism: motion under lockstep is perfectly reproducible,
 * it just means the shot describes a state PLUS a frame count instead of a
 * state. So a shot MAY start an animation if it declares the `settle` it needs,
 * making that frame count part of what the shot describes rather than an
 * accident of the harness default. tools/baseline.mjs fails any shot that
 * declares a settle and is not actually in motion at the shutter.
```

- [ ] **Step 4: Prove the 12 existing references did not move**

```bash
npm test
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/mo-after --port=5711
node tools/imagediff.mjs --a=/tmp/mo-before --b=/tmp/mo-after
```

Required: `"identical": true`, `"missing": 0`, worst `maxDelta: 0`, exit 0.

**If this reports anything else, stop.** Do not widen tolerance, do not re-capture a reference. Read the diff image.

- [ ] **Step 5: Gate**

```bash
npm run gate
```

Expected `[gate] PASS`.

- [ ] **Step 6: Commit**

```bash
git add tools/baseline.mjs src/dev/shots.js
git commit -m "harness: a shot may declare its settle, and must then be in motion

The no-animation rule was about legibility, not determinism -- motion under
lockstep is reproducible, it just makes the shot describe a state plus a
frame count. Declaring the count makes that explicit.

The capture now FAILS a shot that declared a settle and landed on a settled
frame. Without that, a motion shot covering nothing would pass forever.

Landed before any motion shot exists: 12 references verified maxDelta 0."
```

---

### Task 4: Pin the measured frame counts

**Files:** Create `test/motion-frames.test.js`

A hardcoded `settle: 28` silently captures a different phase if `ORBIT_SECONDS` or `MOVE_SECONDS` changes. The constants do **not** determine the count in the obvious way — the orbit commits at 28 where `ceil(0.45 × 60)` says 27 — so pin the *derived counts*, not just the constants.

- [ ] **Step 1: Write the failing test**

Create `test/motion-frames.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORBIT_SECONDS } from '../src/render/index.js';

/**
 * The motion shots in src/dev/shots.js hardcode the frame they capture. If the
 * animation timings change, those shots silently capture a DIFFERENT PHASE and
 * the gate goes on passing against a picture nobody chose.
 *
 * These constants are pinned so that change fails loudly instead. The frame
 * counts themselves are asserted end-to-end by tools/baseline.mjs, which
 * refuses a motion shot that is not in motion at the shutter.
 *
 * MEASURED counts at the time of pinning, with fixedDt = 1/60:
 *   orbit, rotate-request -> commit : 28 frames   (ceil(0.45*60) predicts 27 — WRONG)
 *   step,  step() -> settled        : 14 frames
 *
 * If you change either constant: re-measure with
 *   node tools/commitframe.mjs --port=5701 --shot=hero --out=/tmp/cf
 * and re-pick the `settle` values in src/dev/shots.js.
 */
test('ORBIT_SECONDS is what the motion shots were picked against', () => {
  assert.equal(ORBIT_SECONDS, 0.45,
    'ORBIT_SECONDS changed — re-measure orbitFrames and re-pick the motion shot settles');
});

test('MOVE_SECONDS is what the motion shots were picked against', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/player/index.js', import.meta.url), 'utf8'));
  const m = src.match(/const MOVE_SECONDS = ([\d.]+);/);
  assert.ok(m, 'MOVE_SECONDS declaration not found in src/player/index.js');
  assert.equal(Number(m[1]), 0.22,
    'MOVE_SECONDS changed — re-measure moveFrames and re-pick the motion shot settles');
});

test('the fixed timestep is what the frame counts were derived from', async () => {
  const { makeConfig } = await import('../src/core/config.js');
  assert.equal(makeConfig('').fixedDt, 1 / 60,
    'fixedDt changed — every motion shot frame count is now wrong');
});
```

`MOVE_SECONDS` is module-private in `src/player/index.js`, hence the source read. Do **not** export it just for a test — the constant is an implementation detail and exporting it widens the subsystem's surface for no gameplay reason.

- [ ] **Step 2: Run and confirm it PASSES** (it pins current values)

```bash
node --test test/motion-frames.test.js
```

Expected: 3 pass.

- [ ] **Step 3: PROVE THE GUARD CAN FAIL — mandatory**

Temporarily change `ORBIT_SECONDS` to `0.5` in `src/render/index.js`:

```bash
node --test test/motion-frames.test.js
```

Required: 1 failure naming `re-measure orbitFrames`. **Revert**, confirm 3 pass, verify `git diff` is empty before committing.

- [ ] **Step 4: Commit**

```bash
git add test/motion-frames.test.js
git commit -m "test: pin the timings the motion shot frames were picked against

The constants do not determine the frame count in the obvious way -- the
orbit commits at 28 where ceil(0.45*60) says 27 -- so a change to either
constant must fail loudly rather than shift which frame gets captured.

Guard verified to fail: ORBIT_SECONDS 0.45 -> 0.5 fails the pin."
```

---

### Task 5: The three motion shots

**Files:** Modify `src/dev/shots.js`

All three use `loop-01` (the default) and its **start cell**. The avatar's view bias is 5 lattice steps there and **zero at every other standable cell in the project**, so a mid-orbit shot framed anywhere else would prove nothing about the bias-drop logic — the subtlest code in `src/player`.

- [ ] **Step 1: Add the shots**

```js
    /**
     * MOTION SHOTS — the only three in the set that capture a frame mid-flight.
     *
     * Each declares the settle it needs (see the contract note at the top of
     * this file), and tools/baseline.mjs refuses any of them that lands on a
     * settled frame.
     *
     * All three frame loop-01's START CELL deliberately. The avatar's (1,1,1)
     * view bias is 5 there and 0 at every other standable cell in the project,
     * and src/player drops that bias for the duration of an orbit. This is the
     * only place in the shot set where that code path is visible at all.
     */
    orbitmid: Object.assign(() => {
      world()?.setRotation(0);
      ctx.peek('player')?.placeAt('1,0,0');
      render()?.frameCells([[1, 1, 0]], { fillY: 0.50, fillX: 0.56, liftY: 0.02 });
      ctx.emit('world/rotate-request', { delta: 1 });
    }, { settle: 14 }),

    orbitlate: Object.assign(() => {
      world()?.setRotation(0);
      ctx.peek('player')?.placeAt('1,0,0');
      render()?.frameCells([[1, 1, 0]], { fillY: 0.50, fillX: 0.56, liftY: 0.02 });
      ctx.emit('world/rotate-request', { delta: 1 });
    }, { settle: 27 }),

    stepmid: Object.assign(() => {
      world()?.setRotation(0);
      const p = ctx.peek('player');
      p?.placeAt('5,5,1');
      render()?.frameCells([[5, 5, 1], [5, 5, 2], [5, 5, 3], [5, 6, 2]],
        { fillY: 0.64, fillX: 0.72, liftY: 0.01, shiftX: -0.06 });
      p?.step(SCREEN_DELTA['+z']);
    }, { settle: 7 }),
```

Import what the step shot needs at the top of `src/dev/shots.js`:

```js
import { rotateY, SCREEN_DELTA } from '../geometry/index.js';
```

**There is deliberately no `orbitcommit` shot, and the reason is worth reading before you add one.**

The obvious third shot is "the commit frame". It cannot be a motion shot: the orbit goes
inactive *at* frame 28, so a shot settling there reports `orbiting: false` and the harness
rejects it — correctly, because at that point nothing is moving. Settling at 27 instead gives
the **last in-flight frame**, which is what `commitframe.mjs` calls the last orbit frame, not
the commit.

So the two orbit shots are `orbitmid` (frame 14, mid-swing) and `orbitlate` (frame 27, the last
moving frame), covering the orbit path at two phases including the one immediately before the
swap. The committed state itself is already covered statically by `rot1`, and the *delta*
across the commit — the question that settled the tone convention in P3 — is what
`commitframe.mjs` exists to measure. Gating it again as a "motion" shot would either weaken the
motion assertion or capture a frame that is not the one the name promises.

If a future change makes the committed frame worth gating, add it as an ordinary **static**
shot with no `settle` — the world is at `turns: 1` and at rest, which is exactly what a static
shot describes.

- [ ] **Step 2: Capture and confirm all three are genuinely in motion**

```bash
OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/mo15 --port=5712
node -e "const r=require('/tmp/mo15/report.json'); console.log('ok:', r.ok); console.table(r.shots.filter(s=>s.settle!=null).map(s=>({shot:s.shot,settle:s.settle,orbiting:s.motion&&s.motion.orbiting,moving:s.motion&&s.motion.moving})))"
ls -1 /tmp/mo15/*.png | wc -l
md5 /tmp/mo15/orbitmid.png /tmp/mo15/orbitlate.png /tmp/mo15/stepmid.png
```

Required: 15 PNGs; `ok: true`; `orbitmid` and `orbitlate` report `orbiting: true`; `stepmid` reports `moving: true`; **all three md5s differ from each other**.

If the harness rejects any of them, the declared settle is wrong — re-measure, do not raise the settle until it passes by settling.

- [ ] **Step 3: Look at them.** Open all three PNGs. A mid-orbit frame should be visibly off-axis; a mid-step frame should show the pawn between cells and lifted by the hop arc. Numbers cannot tell you this.

- [ ] **Step 4: Gate**

```bash
npm run gate
```

Expected `[gate] PASS`, `identical: true` across 15 shots. **This is the real test of the whole change** — it proves motion is reproducible frame-for-frame across independent captures.

- [ ] **Step 5: Commit**

---

### Task 6: Measure, record, ship

- [ ] **Step 1: Re-measure CI cost under CI's rasteriser**

```bash
rm -rf /tmp/mo-sw15 /tmp/mo-sw12
time PENROSE_GL=swiftshader OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/mo-sw15 --port=5713 > /dev/null 2>&1
time PENROSE_GL=swiftshader OW_NO_HMR=1 node tools/baseline.mjs --out=/tmp/mo-sw12 --port=5714 --shots=hero,seam,wide,offaxis,rot1,rot2,rot3,avatar,avatarmid,spur01,span02,shelf03 > /dev/null 2>&1
```

The spec predicts ≈ +2.8s at the gate. **Report the measured number and say plainly if it disagrees** — the last estimate in this repo was wrong by 8×.

- [ ] **Step 2: Full verification**

```bash
npm test
for l in $(node -e "import('./src/world/levels.js').then(m=>console.log(Object.keys(m.LEVELS).join(' ')))"); do node tools/analyze.mjs "$l" >/dev/null 2>&1 || echo "FAILED: $l"; done
npx vite build
npm run gate
```

- [ ] **Step 3: `METHODOLOGY.md` — add a P6 section**

Must state: what was ungated and why it mattered more after P5; that determinism was never the blocker; the measured 28-vs-27 off-by-one and what it would have cost; that the harness refuses a motionless motion shot and why that assertion is the load-bearing part; the measured CI delta; and that the gate now depends on animation timing, so a red gate after an easing change is expected and the response is a reviewed re-capture, never a widened tolerance.

- [ ] **Step 4: Push, PR, confirm CI the reliable way**

```bash
git push -u origin feat/motion-coverage
gh pr create --fill
gh run view --json status,conclusion
```

`gh run watch --exit-status` is unreliable — use `gh run view --json status,conclusion`.

---

## Definition of done

- [ ] `npm test` passes in full, unscoped
- [ ] The frame-count pin was proven able to fail
- [ ] `npm run gate` reports `identical: true` across 15 shots
- [ ] The 12 pre-existing shots were proven unmoved by the harness change (`maxDelta: 0`)
- [ ] All three motion shots report motion at the shutter, and a human has looked at them
- [ ] CI cost re-measured under SwiftShader and recorded
