/**
 * Shot registry — the fixed camera setups the gate captures.
 *
 * A shot is a pure function of the scene: it puts the world in a known state and
 * returns. It must not start animations, spawn transients, or read wall-clock
 * time. Everything time-varying is advanced afterwards by an exact number of
 * pumped frames, so the shutter always lands on the same frame index.
 *
 * MOTION SHOTS — the one exception, and why it is not a loophole.
 *
 * The no-animation rule above is about LEGIBILITY, not determinism. Motion under
 * lockstep is perfectly reproducible: the page runs no frame loop, so a shot that
 * starts an animation and is then pumped a fixed number of frames lands on the
 * same frame index on every run and every machine. What such a shot loses is that
 * it no longer describes a STATE — it describes a state plus a frame count.
 *
 * So a shot MAY start an animation if it declares the `settle` it needs, which
 * makes that frame count part of what the shot describes rather than an accident
 * of the harness default:
 *
 *     orbitmid: Object.assign(fn, { settle: 14 })
 *
 * tools/baseline.mjs then pumps that many frames instead of its default, and
 * REFUSES any shot that declared a settle and is not actually in motion at the
 * shutter. That refusal is the load-bearing part: a motion shot that quietly
 * landed on a settled frame would be perfectly reproducible, pass the gate
 * forever, and cover nothing at all.
 *
 * Each shot is a separate page load in the gate, so cost is linear in shot
 * count — but rotation states are cheap to cover and worth covering, since a
 * rotation regression is invisible in the default view.
 *
 * ============================ COMPOSITION ============================
 *
 * Every shot in this set used to be a hand-placed camera position plus a
 * hand-tuned frustum aimed at a fixed point (2.5, 2.5, 2.5), and every one of
 * them was mis-framed. The structure's screen bounding box is nowhere near that
 * point — loop-01's centroid is (4.06, 2.5, 0.94), and the rotated states are
 * further off still — so the emblem sat well right of centre with two thirds of
 * the canvas empty, worst of all in `rot1`, where it hung in the top-right
 * corner. `wide` compounded it by using a frustum nearly six times the
 * structure's height.
 *
 * Two of the shots were also NOT EXACTLY ISOMETRIC, which is a correctness
 * problem rather than a taste one. An orthographic camera at (40,40,40) aimed
 * at (1,1,0) looks along (-39,-39,-40), about 1.4 degrees off the (1,1,1)
 * diagonal. The `avatar` shot exists precisely to assert that the avatar's
 * (1,1,1) view bias cancels on screen, and that cancellation is exact only ON
 * the diagonal — so the shot was quietly undermining its own assertion, and the
 * `avatarmid` shot had the same flaw.
 *
 * Framing is therefore DERIVED, not placed. `render.frameCells` takes the cells
 * to be shown and a view DIRECTION, projects all eight corners of each cell
 * onto the screen basis, and solves for the frustum and lookAt target that put
 * that bounding box where the composition asks. The camera position is then
 * target + distance * (-direction), so the view direction is exactly what was
 * asked for no matter where in the world the subject sits. An isometric shot is
 * now exactly isometric by construction.
 *
 * What each shot then chooses is the DELIBERATE part: how much of the frame the
 * subject fills, and where in the frame it sits. The emblem is centred and
 * lifted about 2% of frame height above true centre in every full-structure
 * shot — optical centring, because a mass placed at the geometric centre of a
 * frame reads as sagging. The fills are chosen so the set has a rhythm: two
 * plates at poster scale, one at print scale with a wide paper margin, and
 * three close reads.
 *
 * DECLARING A LEVEL. A shot may carry a `level` property naming the level it
 * needs; tools/baseline.mjs then boots that page with `&level=<name>`. This is
 * not optional plumbing — src/world reads the level from boot config and sizes
 * its InstancedMesh at init, so a shot function CANNOT switch levels itself.
 * A shot that declares nothing captures DEFAULT_LEVEL, and its URL is byte
 * identical to what it has always been, which is what keeps the existing
 * reference set valid across this change.
 */

import { rotateY, SCREEN_DELTA } from '../geometry/index.js';

export function makeShots(ctx) {
  const world = () => ctx.peek('world');
  const render = () => ctx.peek('render');

  /** The level's cells as they sit on screen at `turns`. */
  const rotated = (turns = 0) =>
    (world()?.level?.cells ?? []).map((c) => rotateY(c, turns));

  /**
   * Set the rotation state, then frame the given cells.
   *
   * Rotation is set FIRST because framing reads the rotated positions — a shot
   * that framed before rotating would compose the previous state.
   */
  const compose = (turns, cells, opts) => {
    world()?.setRotation(turns);
    render()?.frameCells(typeof cells === 'function' ? cells() : cells, opts);
  };

  /** The whole structure at `turns`, composed as a poster plate. */
  const plate = (turns, opts) => () => compose(turns, () => rotated(turns), opts);

  const shots = {
    /**
     * The read the whole level is designed around. The loop closes here.
     * Filled to 78% of frame height — large enough that the tribar is the
     * subject rather than an ornament, with a margin wide enough that it still
     * reads as printed ON something.
     */
    hero: plate(0, { fillY: 0.78, fillX: 0.86, liftY: 0.025 }),

    /**
     * Tight on the seam where the two ends of the loop alias.
     *
     * Framed on the four cells that actually participate in the join — the two
     * that share a screen position, (0,0,0) and (5,5,5), and one neighbour of
     * each — rather than on a guessed point near them. That is what puts the
     * aliasing itself at the optical centre instead of somewhere in the corner.
     */
    seam: () => compose(0, [[0, 0, 0], [1, 0, 0], [5, 5, 5], [5, 5, 4]],
      { fillY: 0.58, fillX: 0.66, liftY: -0.04, shiftX: -0.18 }),

    /**
     * The print at print scale: the emblem small on a wide field of paper.
     * Deliberately generous rather than accidentally empty — this is the shot
     * that has to show the paper as a surface, and it doubles as the one that
     * catches any clear-colour or paper-grain shift.
     */
    wide: plate(0, { fillY: 0.46, fillX: 0.52, liftY: 0.02 }),

    /**
     * Off-axis. Breaks exact isometric, so the illusion visibly falls apart —
     * which is the point: this shot catches projection regressions that the
     * on-axis shots cannot, because on-axis everything aliases by design.
     *
     * The direction is given explicitly and the framing solved against it, so
     * the three separated legs are balanced in the frame instead of drifting
     * out of it as the break angle is tuned.
     */
    offaxis: () => compose(0, () => rotated(0), {
      dir: [-1.55, -0.90, -1.05],
      fillY: 0.70, fillX: 0.82, liftY: 0.02,
    }),

    /** One quarter turn. Rotation regressions are invisible in the default view. */
    rot1: plate(1, { fillY: 0.74, fillX: 0.86, liftY: 0.02 }),

    /** Two quarter turns. */
    rot2: plate(2, { fillY: 0.74, fillX: 0.86, liftY: 0.02 }),

    /**
     * Three quarter turns, with the avatar. The fourth rotation state was the
     * only one no shot covered, and it is also the cheapest place to catch an
     * avatar whose placement depends on rotation: the avatar's occlusion bias
     * is recomputed per rotation, so a rotation-dependent bug in it shows here
     * and nowhere else in the set.
     *
     * The three rotated plates are each framed on their OWN bounding box, so
     * they read as three deliberate impressions of the same emblem rather than
     * as one camera that the structure happens to swing through.
     */
    rot3: plate(3, { fillY: 0.74, fillX: 0.86, liftY: 0.02 }),

    /**
     * Tight on the avatar at the level's start cell.
     *
     * This is the one shot that magnifies the avatar's VIEW BIAS. At the start
     * cell the avatar is pushed 5 lattice steps along (1,1,1) to clear the
     * walkway block that aliases it; that translation is a screen no-op only
     * because the projection collapses the view diagonal exactly. If the camera
     * basis, the frustum maths or the bias rule ever drift apart, the avatar
     * moves on screen — invisible at 16 units of frustum, obvious at 5.
     *
     * The frame is solved from the avatar's TRUE cell (1,1,0), not its biased
     * draw position, which is the assertion: those two must project to the same
     * point. It is now framed by a camera that is EXACTLY on the diagonal,
     * which the hand-placed version was not — so the assertion is finally as
     * strict as its docstring always claimed.
     */
    avatar: () => compose(0, [[1, 1, 0]], { fillY: 0.50, fillX: 0.56, liftY: 0.02 }),

    /**
     * The avatar partway along the level, on the upper walkway rather than at
     * the start. Placed with `player.placeAt`, which settles instantly and
     * emits nothing — a shot may not start an animation, so `step()` is not an
     * option here. Bias is 0 at this cell, so this frames the avatar drawn at
     * its honest position, which the start-cell shot deliberately does not.
     *
     * Framed on the platform, the avatar's cell and the two walkway blocks
     * either side, so the pawn sits in a composed length of walkway instead of
     * dead centre in a void.
     */
    avatarmid: () => {
      world()?.setRotation(0);
      ctx.peek('player')?.placeAt('5,5,2');
      render()?.frameCells([[5, 5, 1], [5, 5, 2], [5, 5, 3], [5, 6, 2]],
        { fillY: 0.64, fillX: 0.72, liftY: 0.01, shiftX: -0.06 });
    },

    /**
     * The three rotation-required levels, one plate each.
     *
     * Each declares the level it needs, because src/world fixes the level at
     * init from boot config — a shot function cannot switch it. Framed at turn
     * 0, the state the level opens in.
     *
     * These exist because a level with no pixel coverage can regress in the
     * renderer and nothing in this repository would notice: tools/analyze.mjs
     * proves a level's ROUTING premise, never its picture.
     */
    spur01: Object.assign(plate(0, { fillY: 0.74, fillX: 0.84, liftY: 0.025 }),
      { level: 'spur-01' }),
    span02: Object.assign(plate(0, { fillY: 0.74, fillX: 0.84, liftY: 0.025 }),
      { level: 'span-02' }),
    shelf03: Object.assign(plate(0, { fillY: 0.74, fillX: 0.84, liftY: 0.025 }),
      { level: 'shelf-03' }),

    /**
     * The three four-leg levels — the second figure family.
     *
     * Same reason as the plates above, with one difference that matters: these
     * figures are not tribars, so the tribar's framing constants are not
     * automatically right for them. Each is filled to its own shape rather than
     * inheriting 0.74/0.84.
     *
     * arm-04 is the widest — the beam driven through its own triangle spans
     * further across the screen than any tribar — so it takes the smallest fill
     * to keep its extremes off the edge. crook-06 is the only upright figure in
     * the project, so it fills more of Y and less of X than anything else here.
     */
    arm04: Object.assign(plate(0, { fillY: 0.74, fillX: 0.84, liftY: 0.025 }),
      { level: 'arm-04' }),
    post05: Object.assign(plate(0, { fillY: 0.72, fillX: 0.80, liftY: 0.02 }),
      { level: 'post-05' }),
    crook06: Object.assign(plate(0, { fillY: 0.74, fillX: 0.70, liftY: 0.02 }),
      { level: 'crook-06' }),

    /**
     * ===================== MOTION SHOTS =====================
     *
     * The only three shots in the set captured MID-FLIGHT. Each declares the
     * `settle` it needs (see the MOTION SHOTS note at the top of this file), and
     * tools/baseline.mjs refuses any of them that lands on a settled frame.
     *
     * Frame counts are MEASURED, not computed. The orbit commits at frame 28 in
     * the real engine, where ceil(ORBIT_SECONDS / fixedDt) says 27 —
     * src/render/camera.test.js derives 27 from the same constants in isolation
     * and the extra frame appears only when the whole engine is driven.
     * test/motion-frames.test.js pins both counts so a timing change fails
     * loudly instead of silently shifting which frame gets captured.
     *
     * The two orbit shots frame the WHOLE structure rather than tight on the
     * avatar. The camera swings 90 degrees about the world origin during an
     * orbit, so a tight frustum would carry the subject out of frame; and the
     * avatar's bias defect this shot exists to catch was originally measured at
     * exactly this scale (3.32% of pixels, maxDelta 228 — see METHODOLOGY P2).
     */

    /**
     * Mid-swing, frame 14 of 28.
     *
     * The avatar is placed at loop-01's START CELL deliberately: its (1,1,1)
     * view bias is 5 there and 0 at every other standable cell in the project,
     * and src/player drops that bias for the duration of an orbit because the
     * bias is only a screen no-op while the camera is ON the isometric axis.
     * This is the only shot in the set where that code path is visible at all.
     */
    orbitmid: Object.assign(() => {
      compose(0, () => [...rotated(0), ...rotated(1)],
        { fillY: 0.62, fillX: 0.74, liftY: 0.02 });
      ctx.peek('player')?.placeAt('1,0,0');
      ctx.emit('world/rotate-request', { delta: 1 });
    }, { settle: 14 }),

    /**
     * The last frame still in flight, 27 of 28.
     *
     * NOT the commit frame. The orbit goes inactive AT 28, so a shot settling
     * there reports `orbiting: false` and the harness rejects it — correctly,
     * because at that point nothing is moving. The committed state is already
     * covered statically by `rot1`, and the DELTA across the commit is what
     * tools/commitframe.mjs exists to measure.
     */
    orbitlate: Object.assign(() => {
      compose(0, () => [...rotated(0), ...rotated(1)],
        { fillY: 0.62, fillX: 0.74, liftY: 0.02 });
      ctx.peek('player')?.placeAt('1,0,0');
      ctx.emit('world/rotate-request', { delta: 1 });
    }, { settle: 27 }),

    /**
     * The SAME sweep in the other direction, frame 14 of 28.
     *
     * Every orbit this project has ever captured is `delta: +1`. That left a set
     * of negative-delta paths with no gated frame anywhere behind them:
     *
     *   - `CameraOrbit.angle` — `CAMERA_TURN_SIGN * this.delta * ...`, whose sign
     *     only flips here (src/render:528);
     *   - `_drain`'s `step = this._pending < 0 ? -1 : 1` and the matching
     *     `this._pending -= step`, which is the only place a negative queue is
     *     drained (src/render:1067);
     *   - `_commit`'s `setRotation(orbit.fromTurns + orbit.delta)`, which relies
     *     on setRotation normalising 0 + -1 to 3 rather than leaving it negative
     *     (src/render:1056).
     *
     * Unit tests reach the arithmetic; nothing reached the PICTURE. A sign error
     * in any of the three would swing the camera the wrong way, and every one of
     * the 18 gated shots would have gone on passing.
     *
     * Framed on the union of turn 0 and turn 3, because that is where a -1 lands
     * — using `rotated(1)` here would compose the wrong destination and quietly
     * frame a state this shot never visits.
     */
    orbitback: Object.assign(() => {
      compose(0, () => [...rotated(0), ...rotated(3)],
        { fillY: 0.62, fillX: 0.74, liftY: 0.02 });
      ctx.peek('player')?.placeAt('1,0,0');
      ctx.emit('world/rotate-request', { delta: -1 });
    }, { settle: 14 }),

    /**
     * A step in flight, frame 7 of 14 — the top of the hop arc.
     *
     * Framed on the upper walkway like `avatarmid`, but the pawn is moving
     * rather than parked, so this covers the interpolation and the HOP that no
     * static shot can see.
     */
    stepmid: Object.assign(() => {
      world()?.setRotation(0);
      const p = ctx.peek('player');
      p?.placeAt('5,5,1');
      render()?.frameCells([[5, 5, 1], [5, 5, 2], [5, 5, 3], [5, 6, 2]],
        { fillY: 0.64, fillX: 0.72, liftY: 0.01, shiftX: -0.06 });
      p?.step(SCREEN_DELTA['+z']);
    }, { settle: 7 }),

    /**
     * teach-00, the campaign opener — a tribar of side 4 with a detached bar.
     *
     * Same reason as the six level plates above: without a shot, a level has no
     * pixel coverage at all. It matters more here than anywhere else in the set,
     * because this is the first thing a player ever sees and the only level
     * whose picture is load-bearing for whether the game is comprehensible.
     *
     * Framed a little tighter than the tribar constant because the detached bar
     * pushes the figure's extremes further right than any bare tribar reaches.
     */
    teach00: Object.assign(plate(0, { fillY: 0.70, fillX: 0.80, liftY: 0.02 }),
      { level: 'teach-00' }),
  };

  /**
   * THE SHOTS BELOW ARE COMPOSED AGAINST loop-01'S GEOMETRY, AND NOW SAY SO.
   *
   * They used to declare no level and capture DEFAULT_LEVEL, which was loop-01
   * — so the dependence was real but invisible, carried by a constant in
   * another file. Several of them name loop-01 cells outright: `seam` frames
   * (5,5,5), `avatar` frames (1,1,0), `avatarmid` and `stepmid` place the pawn
   * at 5,5,x, and the three orbit shots place it at 1,0,0.
   *
   * DEFAULT_LEVEL is now teach-00, whose tribar has side 4 and contains no
   * (5,5,x) cell at all. Left implicit, every shot here would have gone on
   * capturing successfully while framing coordinates that no longer exist —
   * a whole set of green plates composed against nothing.
   */
  for (const name of [
    'hero', 'seam', 'wide', 'offaxis', 'rot1', 'rot2', 'rot3',
    'avatar', 'avatarmid', 'orbitmid', 'orbitlate', 'orbitback', 'stepmid',
  ]) {
    shots[name].level = 'loop-01';
  }

  return shots;
}
