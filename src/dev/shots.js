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
  };
}
