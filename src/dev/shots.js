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
 */

export function makeShots(ctx) {
  const cam = ctx.engine.camera;
  const CENTRE = [2.5, 2.5, 2.5];

  const place = (pos, frustum, target = CENTRE, turns = 0) => () => {
    ctx.peek('world')?.setRotation(turns);
    cam.position.set(...pos);
    cam.lookAt(target[0], target[1], target[2]);
    const render = ctx.peek('render');
    render.frustumSize = frustum;
    render._resize();
  };

  /** Canonical isometric placement — the view the illusion is built for. */
  const iso = (dist, frustum, turns = 0) => place([dist, dist, dist], frustum, CENTRE, turns);

  return {
    /** The read the whole level is designed around. The loop closes here. */
    hero: iso(40, 16),

    /** Tight on the seam where the two ends of the loop alias. */
    seam: place([40, 40, 40], 7, [0.5, 0.5, 0.5]),

    /** Wide, lots of clear colour — catches any clear/background shift. */
    wide: iso(40, 30),

    /**
     * Off-axis. Breaks exact isometric, so the illusion visibly falls apart —
     * which is the point: this shot catches projection regressions that the
     * on-axis shots cannot, because on-axis everything aliases by design.
     */
    offaxis: () => {
      ctx.peek('world')?.setRotation(0);
      cam.position.set(44, 26, 30);
      cam.lookAt(...CENTRE);
      const render = ctx.peek('render');
      render.frustumSize = 22;
      render._resize();
    },

    /** One quarter turn. Rotation regressions are invisible in the default view. */
    rot1: iso(40, 18, 1),

    /** Two quarter turns. */
    rot2: iso(40, 18, 2),

    /**
     * Three quarter turns, with the avatar. The fourth rotation state was the
     * only one no shot covered, and it is also the cheapest place to catch an
     * avatar whose placement depends on rotation: the avatar's occlusion bias
     * is recomputed per rotation, so a rotation-dependent bug in it shows here
     * and nowhere else in the set.
     */
    rot3: iso(40, 18, 3),

    /**
     * Tight on the avatar at the level's start cell.
     *
     * This is the one shot that magnifies the avatar's VIEW BIAS. At the start
     * cell the avatar is pushed 5 lattice steps along (1,1,1) to clear the
     * walkway block that aliases it; that translation is a screen no-op only
     * because the projection collapses the view diagonal exactly. If the camera
     * basis, the frustum maths or the bias rule ever drift apart, the avatar
     * moves on screen — invisible at 16 units of frustum, obvious at 6.
     *
     * lookAt is the avatar's TRUE cell (1,1,0), not its biased draw position,
     * which is the assertion: those two must project to the same point.
     */
    avatar: place([40, 40, 40], 6, [1, 1, 0]),

    /**
     * The avatar partway along the level, on the upper walkway rather than at
     * the start. Placed with `player.placeAt`, which settles instantly and
     * emits nothing — a shot may not start an animation, so `step()` is not an
     * option here. Bias is 0 at this cell, so this frames the avatar drawn at
     * its honest position, which the start-cell shot deliberately does not.
     */
    avatarmid: () => {
      ctx.peek('world')?.setRotation(0);
      ctx.peek('player')?.placeAt('5,5,2');
      cam.position.set(40, 40, 40);
      cam.lookAt(5, 6, 2);
      const render = ctx.peek('render');
      render.frustumSize = 11;
      render._resize();
    },
  };
}
