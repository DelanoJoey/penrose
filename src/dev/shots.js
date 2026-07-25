/**
 * Shot registry — the fixed camera setups the gate captures.
 *
 * A shot is a pure function of the scene: given a name, it puts the camera in a
 * known place and returns. It must not start animations, spawn transients, or
 * read wall-clock time. Everything time-varying is advanced afterwards by an
 * exact number of pumped frames, so the shutter always lands on the same frame
 * index.
 *
 * Keep this set small and diverse. Each shot is a separate page load in the
 * gate, so cost is linear in shot count.
 */

export function makeShots(ctx) {
  const cam = ctx.engine.camera;

  /** Standard isometric placement at a given distance and frustum width. */
  const iso = (dist, frustum, target = [0, 0, 0]) => () => {
    cam.position.set(dist, dist, dist);
    cam.lookAt(target[0], target[1], target[2]);
    const render = ctx.peek('render');
    render.frustumSize = frustum;
    render._resize();
  };

  return {
    /** The canonical read of the whole structure. */
    hero: iso(30, 26),

    /** Tight on the stair treads — catches silhouette and MSAA edge changes. */
    treads: iso(18, 11, [0, 1.5, 0]),

    /** Wide, lots of clear colour — catches any clear/background shift. */
    wide: iso(40, 44),

    /** Off-axis. Breaks exact isometric, so it catches projection regressions. */
    offaxis: () => {
      cam.position.set(34, 18, 26);
      cam.lookAt(0, 1, 0);
      const render = ctx.peek('render');
      render.frustumSize = 30;
      render._resize();
    },

    /** Looking up from below the base platform. */
    under: () => {
      cam.position.set(20, -14, 20);
      cam.lookAt(0, 0, 0);
      const render = ctx.peek('render');
      render.frustumSize = 24;
      render._resize();
    },
  };
}
