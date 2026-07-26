import { rotateY } from '../geometry/index.js';

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
 * ---------------------------------------------------------------------------
 * COMPOSITION (art direction "dusk")
 * ---------------------------------------------------------------------------
 * These shots used to be framed by guessed camera positions and guessed frustum
 * sizes, and every one of them was badly composed in the same way: the camera
 * targeted (2.5,2.5,2.5), which projects to the ORIGIN's screen position rather
 * than to the structure's, so the subject sat off to one side of a mostly empty
 * canvas. Measured on the old `hero`: a 4.95 x 5.72 subject in a 25.6 x 16
 * frame — 19% of the width and 36% of the height — with its centre 1.77 units
 * right of frame centre. `rot1` was worse again, because rotation pivots at the
 * world origin and loop-01's origin is its corner, so a quarter turn threw the
 * structure into the top-right corner.
 *
 * Every shot below is now SOLVED rather than guessed: `render.frameCamera`
 * projects the points that matter, takes their bounding box in the camera's own
 * screen basis, and returns the pose that puts that box at a stated fraction of
 * the frame and a stated position within it. The numbers in each shot are
 * therefore compositional intent — "80% of the frame height, centre sitting at
 * 52% down" — and not coordinates. Change the level, the rotation or the aspect
 * ratio and the intent survives.
 *
 * Two consequences worth naming:
 *
 *  - The solved poses are off the (1,1,1) diagonal. That is just panning for an
 *    orthographic camera; the view DIRECTION is still exactly the diagonal, so
 *    the projection collapse the whole illusion rests on is untouched. The
 *    off-axis shot is the one that deliberately breaks it.
 *  - Every solved pose sits at the same view depth from the world origin, so
 *    the atmospheric haze band lands identically in all of them. A wide shot and
 *    a close-up are differently magnified, not differently hazy.
 */

/** Frame fractions used by more than one shot, named so the intent is visible. */
const HERO_FILL = 0.84;
const ROT_FILL = 0.78;

export function makeShots(ctx) {
  const render = () => ctx.peek('render');
  const world = () => ctx.peek('world');

  /** Every cell of the current level, rotated into world space for `turns`. */
  const cellsAt = (turns) =>
    (world()?.level?.cells ?? []).map((c) => rotateY(c, turns));

  /**
   * Canonical isometric shot: set the rotation state, then frame that state.
   *
   * Framing per rotation is the whole point of doing it this way. The four
   * states have genuinely different silhouettes — turns 0 is a wide triangle,
   * turns 2 is a tall zigzag — so one frustum size cannot serve all four, and
   * one camera target certainly cannot.
   */
  const iso = (turns, opts = {}) => () => {
    world()?.setRotation(turns);
    render().frameCamera(cellsAt(turns), { fill: ROT_FILL, cy: 0.52, ...opts });
  };

  return {
    /**
     * The read the whole level is designed around. The loop closes here.
     *
     * Centred and large: the tribar is close to symmetric about its own screen
     * centre, so any off-centre placement reads as a mistake rather than as a
     * choice. `cy` 0.53 drops it a hair below the middle, which leaves a little
     * more sky above than ground below — the standard way to make a static
     * object read as standing rather than floating.
     */
    hero: iso(0, { fill: HERO_FILL, cy: 0.53 }),

    /**
     * Tight on the seam where the two ends of the loop alias.
     *
     * Framed on the two cells that share a screen position — (0,0,0) at the far
     * end of the near leg and (5,5,5) at the near end of the far one. Both legs
     * leave the seam toward the RIGHT of frame (screen +x for one, screen -z
     * for the other), so the junction is placed at 36% across: the composition
     * gives the legs the room they actually need instead of splitting it evenly
     * around a centred subject.
     *
     * This is also the shot where the atmosphere is doing the most work. The
     * two cells at this junction are 15 lattice units apart in depth, so one is
     * hazed and the other is not, and the seam is where you can see that the
     * thing which "connects" is 14 units of air.
     */
    seam: () => {
      world()?.setRotation(0);
      const goal = world()?.level?.goal ?? [5, 5, 5];
      render().frameCamera([[0, 0, 0], goal], { fill: 0.44, cx: 0.38, cy: 0.5 });
    },

    /**
     * Wide, lots of clear colour — catches any clear/background or fog shift.
     *
     * Deliberately the one asymmetric composition in the set: the monument sits
     * low and left, and most of the frame is open twilight. That is the shot
     * that has to earn the palette — if the background is dull, this is where it
     * shows — and it doubles as the gate's large flat-colour sample.
     */
    wide: iso(0, { fill: 0.56, cx: 0.44, cy: 0.56 }),

    /**
     * Off-axis. Breaks exact isometric, so the illusion visibly falls apart —
     * which is the point: this shot catches projection regressions that the
     * on-axis shots cannot, because on-axis everything aliases by design.
     *
     * The view DIRECTION is kept as it was (the vector from the old hand-placed
     * (44,26,30) to the old target), because that angle is the diagnostic and
     * changing it would change what the shot tests. Only the framing is solved,
     * which is what makes the three floating legs large enough to actually read
     * as separated instead of being a smudge in the corner.
     */
    offaxis: () => {
      world()?.setRotation(0);
      render().frameCamera(cellsAt(0), {
        dir: [2.5 - 44, 2.5 - 26, 2.5 - 30],
        fill: 0.80,
        cy: 0.52,
      });
    },

    /** One quarter turn. Rotation regressions are invisible in the default view. */
    rot1: iso(1),

    /**
     * Two quarter turns. This state is a tall "C" that opens to the right, so
     * it is placed left of centre and the open side is given the empty half of
     * the frame — a subject facing INTO its negative space rather than sitting
     * marooned in the middle of it. That is the whole reason `cx` exists as a
     * per-shot number instead of a constant 0.5.
     */
    rot2: iso(2, { cx: 0.44 }),

    /**
     * Three quarter turns, with the avatar. The fourth rotation state was the
     * only one no shot covered, and it is also the cheapest place to catch an
     * avatar whose placement depends on rotation: the avatar's occlusion bias
     * is recomputed per rotation, so a rotation-dependent bug in it shows here
     * and nowhere else in the set.
     *
     * These three shots carry a second job under this art direction. The light
     * is fixed in the WORLD, so the key rakes the screen-right faces at turns 0
     * and 2 and the screen-left faces at turns 1 and 3. That alternation is the
     * stated cost of the convention, and rot1/rot2/rot3 are where the claim
     * "every state still reads as the same monument from another corner" is
     * either true or visibly false.
     */
    rot3: iso(3),

    /**
     * Tight on the avatar at the level's start cell.
     *
     * This is the one shot that magnifies the avatar's VIEW BIAS. At the start
     * cell the avatar is pushed 5 lattice steps along (1,1,1) to clear the
     * walkway block that aliases it; that translation is a screen no-op only
     * because the projection collapses the view diagonal exactly. If the camera
     * basis, the frustum maths or the bias rule ever drift apart, the avatar
     * moves on screen — invisible at 16 units of frustum, obvious at 4.
     *
     * Framed on the avatar's TRUE cell (1,1,0), not its biased draw position,
     * which is the assertion: those two must project to the same point. Centred
     * on purpose — this is a measurement, and an off-centre subject makes a
     * displacement harder to see, not easier.
     *
     * The bias has one new visible consequence under this direction, disclosed
     * rather than hidden: haze is keyed to view depth, so pushing the avatar 5
     * steps toward the camera also pulls it out of the haze. It is a screen
     * no-op in POSITION and not in ATMOSPHERE. That is the same claim the bias
     * was already making to the depth buffer, now also made in air.
     */
    avatar: () => {
      world()?.setRotation(0);
      const start = world()?.level?.start ?? [1, 0, 0];
      render().frameCamera([[start[0], start[1] + 1, start[2]]],
        { fill: 0.62, extent: 0.75, cy: 0.5 });
    },

    /**
     * The avatar partway along the level, on the upper walkway rather than at
     * the start. Placed with `player.placeAt`, which settles instantly and
     * emits nothing — a shot may not start an animation, so `step()` is not an
     * option here. Bias is 0 at this cell, so this frames the avatar drawn at
     * its honest position, which the start-cell shot deliberately does not.
     *
     * Framed on a three-cell run of the walkway rather than on the pawn alone,
     * so the composition has a direction to it: the beam leads out of frame at
     * both ends and the pawn stands on it, instead of a pawn hanging in a void.
     */
    avatarmid: () => {
      world()?.setRotation(0);
      ctx.peek('player')?.placeAt('5,5,2');
      render().frameCamera([[5, 5, 1], [5, 5, 3]], { fill: 0.58, extent: 0.5, cy: 0.54 });
    },
  };
}
