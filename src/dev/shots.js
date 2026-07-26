import * as THREE from 'three';
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
 * COMPOSITION IS COMPUTED, NOT TYPED
 * ----------------------------------
 * Every shot here used to be `camera at (40,40,40), lookAt (2.5,2.5,2.5)` with a
 * hand-picked frustum. That target is the centre of the level's BOUNDING CUBE,
 * which is not where the figure lands on screen: the tribar's screen bounding box
 * at rotation 0 is 4.95 x 5.72 world units centred 1.77 units to the RIGHT of it,
 * and at rotation 2 it is 4.95 x 9.80 centred 4.08 units ABOVE it. So every plate
 * was off-centre by a different amount, and at frustum 16-18 the figure occupied
 * about a third of the frame height. The rest was dead paper.
 *
 * The fix is a framing RULE rather than better numbers. `plate()` takes the
 * points that must be in frame, measures their screen-space bounding box in the
 * camera's own basis, and returns the lookAt target and frustum that centre that
 * box at a stated fill fraction. Change the level, change the rotation, change
 * the capture aspect ratio, and the plates stay composed.
 *
 * TWO RULES THE FRAMING OBEYS, BOTH LOAD-BEARING
 *
 *  1. THE CAMERA MOVES WITH THE TARGET. An orthographic camera cannot be panned
 *     by moving its lookAt: doing that ROTATES it, and this projection is only
 *     the isometric one while the view direction is exactly along (1,1,1). Every
 *     unit of screen recentring is therefore applied to the camera POSITION and
 *     the target together, so the view direction is bit-identical no matter how
 *     the frame is composed. Getting this wrong does not look like a framing bug;
 *     it silently destroys the projection collapse the whole game rests on.
 *  2. FILL IS THE SAME NUMBER FOR EVERY FULL-FIGURE PLATE. The four rotation
 *     states have genuinely different silhouettes — 5.7 units tall at rotation 0,
 *     9.8 at rotation 2 — so a shared SCALE would leave rotation 0 tiny. A shared
 *     FILL gives every plate the same compositional weight instead, which is what
 *     makes them read as a series of figures in one paper.
 */

/** Fraction of the limiting frame dimension the subject fills. */
const FILL = {
  /** Full-figure plates: hero and the three rotation states. */
  plate: 0.74,
  /** The wide plate is deliberately loose — its job is to expose clear ground. */
  wide: 0.52,
  /** Close plates. Each names its own; these are the two that recur. */
  detail: 0.58,
  close: 0.50,
};

/**
 * Optical-centre rise, as a fraction of frustum height.
 *
 * A figure centred on the geometric centre of a frame reads as sitting slightly
 * low. Everything here is lifted by this much. It is small on purpose: this is a
 * typographic correction, not a compositional gesture.
 */
const RISE = 0.03;

/** Distance the camera is pulled back along its view offset. Ortho: taste only. */
const EYE_ISO = [40, 40, 40];
/** The deliberately non-isometric viewpoint. Same vector, kept as one constant. */
const EYE_OFF = [41.5, 23.5, 27.5];

export function makeShots(ctx) {
  const cam = ctx.engine.camera;

  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _v = new THREE.Vector3();

  /** The camera's screen basis for a given view offset. Direction only. */
  const basis = (eye) => {
    cam.position.set(eye[0], eye[1], eye[2]);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
  };

  /** The 8 corners of the unit cell at `c`, rotated into the current turn. */
  const cellCorners = (c, turns) => {
    const [x, y, z] = rotateY(c, turns);
    const out = [];
    for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5])
      out.push([x + dx, y + dy, z + dz]);
    return out;
  };

  /** Every cell of the loaded level, as corner points, in the current turn. */
  const levelCorners = (turns) =>
    (ctx.peek('world')?.level?.cells ?? []).flatMap((c) => cellCorners(c, turns));

  /**
   * The pawn's silhouette at a standable cell, as corner points.
   * Uses the cell it STANDS ON, not the mesh position: on-axis the two project
   * to the same place, and the true cell is the honest thing to compose around.
   */
  const pawnCorners = (cell, turns) => {
    const [x, y, z] = rotateY(cell, turns);
    const out = [];
    for (const dx of [-0.34, 0.34]) for (const dz of [-0.34, 0.34]) {
      out.push([x + dx, y + 0.5, z + dz]);
      out.push([x + dx, y + 1.3, z + dz]);
    }
    return out;
  };

  /**
   * Compose a plate: centre `points` in frame at `fill`, from view offset `eye`.
   *
   * `bias` displaces the subject from the frame centre, in units of the frame's
   * own half-width / half-height, and it is the one place a judgement call lives
   * rather than a rule. It exists because a CLOSE plate cannot be balanced by
   * centring alone: when the subject is at an extremity of the figure — the
   * seam and the start cell are both at the tribar's left tip — centring the
   * subject centres the empty half of the frame too. Those plates put the
   * subject on the left third and let the beams carry the eye out of frame to the
   * right, which is a composition rather than an accident. The full-figure plates
   * take no bias at all: nothing there needs one.
   *
   * Returns nothing — it writes the camera pose and the frustum, which is what a
   * shot is. Pure function of (points, eye, fill, viewport); no clock, no rng.
   */
  const plate = (points, { eye = EYE_ISO, fill = FILL.plate, bias = [0, 0] } = {}) => {
    basis(eye);

    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const p of points) {
      _v.set(p[0], p[1], p[2]);
      const sx = _v.dot(_right), sy = _v.dot(_up);
      if (sx < minx) minx = sx;
      if (sx > maxx) maxx = sx;
      if (sy < miny) miny = sy;
      if (sy > maxy) maxy = sy;
    }
    if (!Number.isFinite(minx)) return;

    const aspect = globalThis.innerWidth / globalThis.innerHeight;
    const w = maxx - minx, h = maxy - miny;
    const frustum = Math.max(h / fill, w / (fill * aspect));

    // Target = the subject's screen centre, dropped by RISE so the figure sits
    // on the optical centre rather than the geometric one, then displaced by the
    // plate's own `bias` (see below).
    const cx = (minx + maxx) / 2 - bias[0] * (frustum * aspect) / 2;
    const cy = (miny + maxy) / 2 - RISE * frustum - bias[1] * frustum / 2;

    const target = _right.clone().multiplyScalar(cx).add(_up.clone().multiplyScalar(cy));

    // Rule 1: the position moves WITH the target, so the view direction is
    // untouched by the recentring.
    cam.position.set(target.x + eye[0], target.y + eye[1], target.z + eye[2]);
    cam.lookAt(target.x, target.y, target.z);

    const render = ctx.peek('render');
    render.frustumSize = frustum;
    render._resize();
  };

  /** Put the world in a known rotation, then compose. */
  const at = (turns, points, opts) => () => {
    ctx.peek('world')?.setRotation(turns);
    plate(typeof points === 'function' ? points(turns) : points, opts);
  };

  return {
    /** The read the whole level is designed around. The loop closes here. */
    hero: at(0, (t) => levelCorners(t)),

    /**
     * Tight on the seam where the two ends of the loop alias: the far end of the
     * +z leg lands on the screen position the +x leg starts from, 14 units away
     * in 3D and directly in front of it. Framed on exactly those cells, so the
     * plate is about the junction rather than about the corner of the figure.
     */
    seam: at(0, (t) => [
      [0, 0, 0], [1, 0, 0], [5, 5, 5], [5, 5, 4],
    ].flatMap((c) => cellCorners(c, t)), { fill: FILL.close, bias: [-0.26, 0] }),

    /** Wide, lots of clear ground — catches any clear/background shift. */
    wide: at(0, (t) => levelCorners(t), { fill: FILL.wide }),

    /**
     * Off-axis. Breaks exact isometric, so the illusion visibly falls apart —
     * which is the point: this shot catches projection regressions that the
     * on-axis shots cannot, because on-axis everything aliases by design.
     * Composed by the same rule, from the same subject, so what changed between
     * this plate and `hero` is the viewpoint and nothing else.
     */
    offaxis: at(0, (t) => levelCorners(t), { eye: EYE_OFF }),

    /** One quarter turn. Rotation regressions are invisible in the default view. */
    rot1: at(1, (t) => levelCorners(t)),

    /** Two quarter turns. */
    rot2: at(2, (t) => levelCorners(t)),

    /**
     * Three quarter turns, with the avatar. The fourth rotation state was the
     * only one no shot covered, and it is also the cheapest place to catch an
     * avatar whose placement depends on rotation: the avatar's occlusion bias
     * is recomputed per rotation, so a rotation-dependent bug in it shows here
     * and nowhere else in the set.
     */
    rot3: at(3, (t) => levelCorners(t)),

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
     * The plate is composed around the avatar's TRUE cell, not its biased draw
     * position, which is the assertion: those two must project to the same point,
     * so a correctly-composed plate is one where the pawn lands where the rule
     * put it.
     */
    avatar: at(0, (t) => [
      ...[[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]].flatMap((c) => cellCorners(c, t)),
      ...pawnCorners([1, 0, 0], t),
    ], { fill: FILL.close, bias: [-0.34, 0] }),

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
      plate([
        ...[[5, 5, 0], [5, 5, 1], [5, 5, 2], [5, 5, 3], [5, 5, 4]]
          .flatMap((c) => cellCorners(c, 0)),
        ...pawnCorners([5, 5, 2], 0),
      ], { fill: FILL.detail, bias: [0, 0.12] });
    },
  };
}
