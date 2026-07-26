/**
 * Shot registry — the fixed camera setups the gate captures.
 *
 * A shot is a pure function of the scene: it puts the world in a known state and
 * returns. It must not start animations, spawn transients, or read wall-clock
 * time. Everything time-varying is advanced afterwards by an exact number of
 * pumped frames, so the shutter always lands on the same frame index.
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
 */

import { rotateY } from '../geometry/index.js';

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

  return {
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
  };
}
