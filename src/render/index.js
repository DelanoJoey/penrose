import * as THREE from 'three';
// src/geometry is a pure module with no engine state and is the one direct
// import ARCHITECTURE.md §3.3 permits between subsystems.
import { rotateY } from '../geometry/index.js';

/**
 * Renderer + isometric camera rig.
 *
 * ART DIRECTION: "dusk" — TWILIGHT MONUMENT.
 *
 * The thesis is that this should read as a PLACE, not a diagram: a stone
 * structure standing in deep blue twilight, raked by a single low warm sun,
 * with the far side of it sinking into haze. Three decisions carry that, and
 * they are one coupled system rather than three preferences:
 *
 *   1. PALETTE — a four-step value ladder (sky 17, haze 50, shadow 67, key 154,
 *      sun-struck top 221 in 8-bit relative luminance) so VALUE carries the
 *      form. Hue then does one job only: warm family = the monument, cool
 *      family = the sky, the player, and the two cells that matter.
 *   2. TONE CONVENTION — the light is fixed in the WORLD, so a rotation shows
 *      you the other side of the monument rather than following your head
 *      around. See the long note below; it is measured, not asserted.
 *   3. ATMOSPHERE — linear fog keyed to view depth, which under this projection
 *      IS the lattice depth x+y+z that src/geometry already uses to resolve
 *      occlusion. So the depth cue and the occlusion rule are the same fact
 *      rendered twice, and they cannot disagree.
 *
 * Still deliberately flat-shaded: face colour comes from the face normal, not
 * from a light. There is no lighting term, no shadow pass, no temporal
 * accumulation and no tonemapping. That is a target choice, not a shortcut —
 * see METHODOLOGY.md. It removes the two things that most commonly break a
 * pixel gate (auto-exposure adaptation, TAA history) and the thing that most
 * commonly tanks frame rate (a cascaded shadow + AO + TAA stack). Fog is the
 * one thing added here and it costs neither: it is a define on the material
 * that both meshes already share, so the program count stays at 1 and the draw
 * count stays at 2. Measured, in the report.
 */

/**
 * Stylised palette — deep saturated dusk. Value separation carries the form.
 *
 * Approximate 8-bit relative luminance (0.2126R + 0.7152G + 0.0722B), which is
 * the ladder the composition actually rests on:
 *
 *   faceTop   221   sky-lit upper planes — the brightest surface in frame
 *   faceRight 154   THE KEY: a low warm sun raking the +-x faces
 *   faceLeft   67   cool shadow: the -+z faces, lit only by the violet sky
 *   haze       50   atmospheric target; distant geometry sinks toward this
 *   bg         17   twilight zenith
 *
 * Every step is separated by more than 15 luminance units, so the read survives
 * being printed small, desaturated, or looked at by someone colour-blind.
 *
 * `haze` is LIGHTER than `bg` on purpose. Far geometry therefore does not
 * dissolve into the sky, it flattens toward a pale band and stays legible as
 * silhouette — which is what real atmospheric perspective does at dusk, and
 * which keeps the far leg of the tribar readable rather than swallowed.
 *
 * `accent` is a MULTIPLIER over the face tones — src/world writes it into
 * instanceColor, which three.js multiplies — so it can only darken. There is no
 * additive channel available without a second material, and a second material
 * is a second shader program. That constraint decides the design rather than
 * being fought: start and goal are drawn as a colder, darker stone rather than
 * as a glow. The specific value is picked so the product stays clean against
 * all three face tones — a tint with a mid green channel turns the amber key
 * face olive, which is the one genuinely ugly failure mode here; pulling green
 * down with blue instead gives lilac / brick / deep blue, a coherent second
 * value ladder sitting one step under the monument's.
 *
 * The player's pawn (src/player) is the only saturated mint in the scene, so
 * "where you are" and "where the level begins and ends" never compete.
 */
export const PALETTE = {
  bg:        0x120e2e,
  haze:      0x342c68,
  faceTop:   0xffd9a2,
  faceRight: 0xef8a44,
  faceLeft:  0x4a3b80,
  accent:    0x8a86ff,
};

// =====================================================================
//  ATMOSPHERE — a depth cue that cannot disagree with the occlusion rule
// =====================================================================
/**
 * Under an orthographic camera looking along -(1,1,1), a point's view depth is
 *
 *     depth(p) = ORIGIN_DEPTH - (x + y + z) / sqrt(3)
 *
 * and `x + y + z` is exactly `src/geometry`'s `depth()`, the quantity that
 * decides which of two aliased cells you actually see. So the haze band is
 * specified in LATTICE units and converted, rather than tuned in view units:
 * the thing that fades is the thing that loses the depth test.
 *
 * Consequence worth stating plainly, because it is an art decision and not an
 * accident: loop-01's near leg (x+y+z near 0) is the FAR one, so the leg the
 * player starts on is the hazy one and the goal corner at x+y+z = 15 is clear.
 * The impossible edge 1,0,0 -> 5,5,5 therefore visibly crosses 14 units of
 * atmosphere in one step. That makes the trick MORE legible, not less, which is
 * the same choice the `offaxis` shot already makes: this project shows its
 * working.
 *
 * ORIGIN_DEPTH is the view depth every framed camera puts the world origin at.
 * Pinning it is what makes the haze a property of the WORLD instead of a
 * property of how far back a particular shot happens to sit — without it, the
 * `wide` shot and the `seam` shot would be differently hazy for no reason.
 * 40*sqrt(3) is the depth of the (40,40,40) placement the shots used before.
 */
const SQRT3 = Math.sqrt(3);
export const ORIGIN_DEPTH = 40 * SQRT3;
/** Lattice depth at which haze starts. Just in front of loop-01's near face. */
export const HAZE_SUM_NEAR = 17;
/** Lattice depth at which haze would saturate. Placed well BEHIND the structure
 *  so the band the level actually occupies is the shallow, gentle part of the
 *  curve: loop-01's deepest face reaches ~39% haze and nothing is ever
 *  dissolved. Pulling this closer reads as fog rather than as distance. */
export const HAZE_SUM_FAR = -27;

export const FOG_NEAR = ORIGIN_DEPTH - HAZE_SUM_NEAR / SQRT3;
export const FOG_FAR = ORIGIN_DEPTH - HAZE_SUM_FAR / SQRT3;

/**
 * Paint vertex colours by face normal: up-facing gets the light tone, the two
 * horizontal axes get the mid and dark tones. This is what produces the
 * isometric three-tone read with zero lighting maths — and therefore with
 * bit-identical output across runs.
 *
 * The tone is baked onto the LOCAL normal, so it travels with the geometry. See
 * the tone-convention note below: that is what makes "the light is fixed in the
 * world" the cheap convention and its opposite the expensive one.
 */
export function paintByNormal(geometry, { top, left, right } = {}) {
  const cTop   = new THREE.Color(top   ?? PALETTE.faceTop);
  const cLeft  = new THREE.Color(left  ?? PALETTE.faceLeft);
  const cRight = new THREE.Color(right ?? PALETTE.faceRight);

  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(normal.count * 3);

  for (let i = 0; i < normal.count; i++) {
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    const c = Math.abs(ny) > 0.5 ? cTop : Math.abs(nx) > 0.5 ? cRight : cLeft;
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// =====================================================================
//  ROTATION TRANSITIONS — orbit the camera, never interpolate the world
// =====================================================================
/**
 * THE CONSTRAINT THAT DECIDES THIS DESIGN
 *
 * World rotation is four discrete quarter-turn states. It cannot be
 * interpolated: src/geometry is built on integer lattice positions, and the
 * screen-position invariant
 *
 *     a = x - z        b = x + z - 2y
 *
 * is only a complete invariant for integers. A cell at a fractional coordinate
 * has no exact screen identity, so `visibility()` could not decide which of two
 * aliased cells is in front — the resolution would become a float comparison
 * with an epsilon, i.e. exactly the nondeterminism the project forbids. Halfway
 * through a rotation the illusion would not be "partly there"; it would be
 * undefined.
 *
 * So nothing in the world moves. The CAMERA moves.
 *
 * THE IDENTITY THIS RESTS ON
 *
 * src/geometry rotates a cell with `rotateY`, which is Ry(+90 deg) about the
 * world Y axis THROUGH THE ORIGIN:  (x,y,z) -> (z, y, -x).
 *
 * Rotating every point of a scene by R and rotating the camera pose by R^-1 are
 * the same transform of view space:
 *
 *     view = (R^-1 C)^-1 = C^-1 R      applied to p   ==    V0 (R p)
 *
 * So ONE world turn (+1) is EXACTLY a camera orbit of -90 deg about the same
 * axis. Same pixels, by construction, not by tuning. Two consequences:
 *
 *   - CAMERA_TURN_SIGN is -1, and it is derivable, not tasted. There is a unit
 *     test that projects a cell both ways and asserts the screen positions
 *     agree (src/render/camera.test.js).
 *   - The orbit pivot MUST be the axis `rotateY` uses — the world origin, not
 *     the structure's centroid. Orbiting about the centroid differs from the
 *     equivalent camera pose by the translation (C - R C), which is zero at the
 *     start of the sweep and 5 world units at the end: a 5-unit lateral pop at
 *     the exact moment the transition is supposed to disappear. `orbitPivot` is
 *     exposed so that if src/world ever rotates about something else, this
 *     moves with it. They must agree.
 *
 * WHERE THE DISCRETE SWAP HAPPENS: AT THE END. See the note on `_commit`.
 *
 * MEASURED: THE IDENTITY IS PIXEL-EXACT, AND TWO OTHER CONVENTIONS ARE NOT
 *
 * Captured at 800x500, `hero` shot, one +1 transition, comparing the last orbit
 * frame against the commit frame (tools/imagediff.mjs, strict):
 *
 *   world geometry, side tones made equal, avatar hidden ...  IDENTICAL, max 0
 *   world geometry as shipped, avatar hidden ..............  3.0987%, max 48
 *   as shipped, avatar visible ............................  3.3373%, max 228
 *
 * Re-measured at integration, 1600x1000, same method, after src/player learned
 * to drop its view bias while `transitionState().active`:
 *
 *   as shipped, avatar visible, bias dropped during orbit .  3.1891%, max 48
 *
 * maxDelta 228 -> 48 is the avatar residual going to zero: 48 is exactly
 * |faceLeft.r - faceRight.r|, so what remains is entirely residual 1 below.
 *
 * So the camera-orbit == world-turn identity holds BIT-EXACTLY through the real
 * renderer — silhouette, depth resolution and rasterisation all agree. The whole
 * residual belongs to two conventions elsewhere that are only view-invariant at
 * the exact isometric angle, and both are named in the report:
 *
 *   1. FACE TONES (3.0987%, max 48 — exactly |faceLeft.r - faceRight.r|).
 *      paintByNormal bakes tone onto WORLD-space normals, and src/world's
 *      _applyRotation only translates its instances. A world turn therefore
 *      leaves the tone-to-screen-side mapping fixed, while a 90 deg camera orbit
 *      exchanges the +-x and +-z families. Fix (src/world, one line): compose
 *      makeRotationY(turns * PI/2) into the instance matrix so tone rotates with
 *      the cell. That makes a world turn a true rigid rotation and the swap
 *      exactly pixel-clean — it is an intentional art change and needs a
 *      deliberate reference re-capture (ARCHITECTURE.md §5).
 *   2. AVATAR VIEW BIAS (0.24%, max 228) — FIXED AT INTEGRATION, in src/player.
 *      src/player pushed the avatar t steps along world (1,1,1) to win the depth
 *      test; that is a screen no-op only on-axis, so off-axis it read as a
 *      diagonal displacement and snapped back at the commit. src/player now
 *      polls `ctx.peek('render').transitionState().active` and takes a bias of 0
 *      for the duration of an orbit, restoring it when the camera arrives. Cost,
 *      measured: at loop-01's start cell the avatar is honestly occluded for the
 *      first 6 frames of the orbit (100 ms) before the camera separates it from
 *      the walkway; at the other 9 standable cells the bias was already 0 and
 *      nothing changes. The commit frame no longer moves it at all — centroid
 *      843.7, 431.5 on both sides of the swap.
 *
 * Residual 1 is not fixable from src/render, and neither residual is a reason to
 * move the swap:
 * once (1) lands, the end-swap is provably clean, which the control above
 * already demonstrates.
 */

// =====================================================================
//  THE TONE CONVENTION — RESOLVED. LIGHT IS FIXED IN THE WORLD.
// =====================================================================
/**
 * The clash documented above is now closed, in favour of convention (A):
 * src/world composes an exact quarter-turn rotation into every instance matrix,
 * so a world turn is a true rigid rotation and the baked face tones travel with
 * the geometry.
 *
 * WHY (A) AND NOT (B), ON ART GROUNDS FIRST
 *
 * The two conventions are not cosmetically equivalent, they say different
 * things about what this scene IS.
 *
 *   (A) light fixed in the world  -> orbiting shows you the shadowed side of a
 *       monument whose sun has not moved. It is a place.
 *   (B) light fixed to the screen -> the key light follows the viewer's head.
 *       Nothing casts light; the shading is a diagram's convention.
 *
 * (B) is the right answer for a direction whose thesis is "this is a
 * screen-space trick". It is the wrong answer for "twilight monument", where
 * the entire point of a rotation is that the far side of the thing was always
 * there and always in shadow. So (A) is chosen for what it means, and the fact
 * that it is also the cheap one is a bonus rather than the argument.
 *
 * WHAT (A) COSTS, STATED HONESTLY
 *
 * The apparent key direction alternates between the four static rotation
 * states: the sun rakes the screen-right faces at turns 0 and 2 and the
 * screen-left faces at turns 1 and 3, because the +-x and +-z face families
 * exchange under a quarter turn. Every state is individually coherent — it is
 * the same monument seen from another corner — but there is no single "the sun
 * is over there" that holds across all four. That cost was accepted, and the
 * palette was built to absorb it: BOTH side tones are plausible daylight
 * (a saturated warm key and a saturated cool shadow, not a lit face and a black
 * one), so no rotation state reads as broken. The `rot1`/`rot2`/`rot3` shots
 * exist to prove that claim rather than to assert it.
 *
 * WHAT (B) WOULD HAVE COST, ALSO HONESTLY
 *
 * (B) is cheap to hold across a static world TURN (do nothing — the current
 * bug is that it already behaves this way) and expensive to hold THROUGH THE
 * ORBIT, which is where it actually has to hold: mid-orbit the camera is off
 * axis and screen-space tone is not a function of any baked attribute. The two
 * ways to buy it are a per-frame vertex-colour repaint of the box geometry
 * (a per-frame CPU write to a shared BufferAttribute — allocation-free only if
 * carefully done, and it destroys the "nothing writes buffers per frame"
 * property) or a custom ShaderMaterial keying tone off the view-space normal
 * (a SECOND SHADER PROGRAM, which is exactly the compile-stall failure mode
 * ARCHITECTURE.md §6 exists to prevent). Neither was measured, because neither
 * was going to be shipped for this direction — that is stated so the comparison
 * is not read as a measured one.
 *
 * MEASURED CONSEQUENCE
 *
 * Commit frame vs last orbit frame, `hero` shot at 1600x1000, one +1 turn, via
 * two isolated captures pumped to exactly frame 27 and frame 28 (the orbit runs
 * 28 frames; at frame 27 `progress` is already exactly 1, so the last rendered
 * orbit frame sits at a full 90 degrees and the identity applies exactly):
 *
 *   before (tones baked to world axes) ....  3.1891% of pixels, maxDelta 48
 *   after  (convention A, this build) .....  0.0000% of pixels, maxDelta 0
 *
 * maxDelta 48 was exactly |faceLeft.r - faceRight.r| in the old palette, i.e.
 * the whole residual was this convention; it is now zero. The rotation commit
 * is pixel-clean, which is what the control capture predicted.
 *
 * The atmosphere added by this direction does NOT reopen it. Fog is keyed to
 * view depth, and the orbit-equals-turn identity is a statement about the view
 * matrix, so `-mvPosition.z` is identical on both sides of the swap by the same
 * argument that makes the silhouette identical. That was the one thing about a
 * camera-distance depth cue that had to be checked, and the 0.0000% above is
 * the check.
 */

/** One quarter turn. */
export const TURN_RADIANS = Math.PI / 2;

/**
 * Camera azimuth per +1 world turn. Negative because the camera must apply the
 * INVERSE of the world's rotation to produce the same image. Verified by test,
 * not asserted.
 */
export const CAMERA_TURN_SIGN = -1;

/** Seconds one quarter-turn orbit takes. Multiplied by dt only. */
export const ORBIT_SECONDS = 0.45;

/**
 * Quarter turns that may sit in the queue behind the one in flight. Four turns
 * is the identity, so anything past three is a longer route than going the
 * other way and is dropped rather than buffered.
 */
export const MAX_QUEUED_TURNS = 3;

const ORBIT_AXIS = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);
const ORIGIN = /* @__PURE__ */ new THREE.Vector3(0, 0, 0);
const _q = /* @__PURE__ */ new THREE.Quaternion();

// =====================================================================
//  FRAMING — composition is computed from the structure, not hand-tuned
// =====================================================================
/**
 * WHY THIS EXISTS
 *
 * Every shot in this project used to be framed by a literal camera position and
 * a literal frustum size, both guessed. The result was measurable and bad: at
 * `hero` the structure's projected bounding box was 4.95 x 5.72 screen units
 * inside a 25.6 x 16 frame — 19% of the width, 36% of the height — and its
 * centre sat 1.77 units right of the frame centre, because the camera targeted
 * (2.5,2.5,2.5) which projects to the ORIGIN's screen position rather than to
 * the structure's. `rot1` was worse: rotation pivots at the world origin, which
 * is loop-01's corner, so a quarter turn threw the whole structure into the top
 * right of the frame.
 *
 * Hand-fixing eight camera positions would fix those eight numbers and nothing
 * else. Instead the framing is DERIVED: project the level, take the bounding
 * box in the camera's own screen basis, and solve for the camera pose that puts
 * that box where the composition wants it. A new level, a new rotation state or
 * a new aspect ratio is then framed correctly without anyone re-guessing.
 *
 * It is pure arithmetic on level data — no clock, no rng, no DOM read beyond
 * the viewport size the renderer already reads — so it cannot affect
 * determinism (ARCHITECTURE.md §1).
 *
 * WHY IT DOES NOT DISTURB THE ORBIT
 *
 * The solved pose is generally NOT on the (1,1,1) diagonal: it is the diagonal
 * plus a shift perpendicular to the view direction, which is what panning is
 * for an orthographic camera. The orbit identity survives that untouched,
 * because `view = (R^-1 C)^-1 = C^-1 R` holds for ANY camera pose C — the orbit
 * rotates the whole pose rigidly about the world origin, and the origin is
 * still the axis `rotateY` uses. What must NEVER happen is re-framing on
 * `world/rotated`: that would move the camera on the commit frame and turn a
 * provably clean swap into a jump. Framing happens on `level/loaded` and in dev
 * shots, and nowhere else.
 */

/** View direction of the canonical isometric camera (camera -> scene). */
export const ISO_VIEW_DIR = /* @__PURE__ */ Object.freeze([-1, -1, -1]);

const _f = /* @__PURE__ */ new THREE.Vector3();
const _z = /* @__PURE__ */ new THREE.Vector3();
const _r = /* @__PURE__ */ new THREE.Vector3();
const _u = /* @__PURE__ */ new THREE.Vector3();
const _UP = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);

/**
 * The orthonormal camera basis for a view direction, as three fresh vectors.
 *
 * Matches THREE's own `Matrix4.lookAt` convention exactly (x = up cross z,
 * y = z cross x), which is what makes a pose solved here identical to the pose
 * `camera.lookAt` produces. For the isometric direction it comes out as
 * right = (1,0,-1)/sqrt2 and up = (-1,2,-1)/sqrt6, i.e. literally the basis
 * src/geometry derives its screen invariant from.
 */
export function viewBasis(dir = ISO_VIEW_DIR) {
  const forward = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const z = forward.clone().negate();
  const right = new THREE.Vector3().crossVectors(_UP, z);
  if (right.lengthSq() < 1e-12) throw new Error('[render] viewBasis: direction is parallel to up');
  right.normalize();
  return { right, up: new THREE.Vector3().crossVectors(z, right), forward };
}

/**
 * Solve for an orthographic camera pose that frames `points`.
 *
 * @param {number[][]} points   world-space centres of unit cells
 * @param {object} opts
 * @param {number[]} opts.dir   view direction, camera -> scene
 * @param {number} opts.aspect  viewport width / height
 * @param {number} opts.fill    fraction of the frame the box should occupy
 * @param {number} opts.cx      where the box centre lands, 0 = left, 1 = right
 * @param {number} opts.cy      where the box centre lands, 0 = top, 1 = bottom
 * @param {number} opts.extent  half-size of each cell, world units
 * @returns {{position:number[], target:number[], frustumSize:number,
 *            box:{w:number,h:number}}}
 *
 * Pure: allocates nothing the caller can see and touches no engine state, so it
 * is unit-testable with no renderer and no DOM.
 *
 * The cell half-extent is expanded ANALYTICALLY rather than by projecting eight
 * corners each: the projection is linear, so the widest a cube can push its
 * centre's screen position is `extent * (|r.x| + |r.y| + |r.z|)`, the L1 norm of
 * the screen basis vector. For the isometric basis that is 0.7071 across and
 * 0.8165 up, which is the exact half-width and half-height of the hexagon a
 * unit cube projects to.
 */
export function fitView(points, {
  dir = ISO_VIEW_DIR, aspect = 1.6, fill = 0.78, cx = 0.5, cy = 0.5, extent = 0.5,
} = {}) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('[render] fitView needs at least one point to frame');
  }

  const f = _f.set(dir[0], dir[1], dir[2]).normalize();
  const z = _z.copy(f).negate();
  // Camera +X. Degenerate only for a straight-down view, which nothing here
  // uses; fail loudly rather than silently producing a NaN pose.
  const r = _r.crossVectors(_UP, z);
  if (r.lengthSq() < 1e-12) throw new Error('[render] fitView: view direction is parallel to up');
  r.normalize();
  const u = _u.crossVectors(z, r);

  const padX = extent * (Math.abs(r.x) + Math.abs(r.y) + Math.abs(r.z));
  const padY = extent * (Math.abs(u.x) + Math.abs(u.y) + Math.abs(u.z));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    const X = p[0] * r.x + p[1] * r.y + p[2] * r.z;
    const Y = p[0] * u.x + p[1] * u.y + p[2] * u.z;
    if (X < minX) minX = X;
    if (X > maxX) maxX = X;
    if (Y < minY) minY = Y;
    if (Y > maxY) maxY = Y;
  }
  const w = (maxX - minX) + 2 * padX;
  const h = (maxY - minY) + 2 * padY;

  // Vertical frustum that satisfies `fill` on BOTH axes — whichever axis is
  // tighter wins, so `fill` is a floor on how much of the frame is used and
  // never an overflow.
  const F = Math.max(h / fill, w / (fill * aspect));
  const W = F * aspect;

  // Where the box centre must sit in camera screen coords for it to land at
  // (cx, cy) in the frame. y is up, cy is measured from the top.
  const sx = (cx - 0.5) * W;
  const sy = (0.5 - cy) * F;
  const mX = (minX + maxX) / 2;
  const mY = (minY + maxY) / 2;

  // Screen X of a point p is dot(p - P, r), so P.dot(r) = mX - sx puts the box
  // centre exactly where the composition asked. (r, u, f) is orthonormal, so
  // the pose is just the sum of its three components. The f component is pinned
  // to ORIGIN_DEPTH, which is what keeps the haze band identical in every shot.
  const px = r.x * (mX - sx) + u.x * (mY - sy) - f.x * ORIGIN_DEPTH;
  const py = r.y * (mX - sx) + u.y * (mY - sy) - f.y * ORIGIN_DEPTH;
  const pz = r.z * (mX - sx) + u.z * (mY - sy) - f.z * ORIGIN_DEPTH;

  return {
    position: [px, py, pz],
    target: [px + f.x, py + f.y, pz + f.z],
    frustumSize: F,
    box: { w, h },
  };
}

/**
 * Smootherstep, 6u^5 - 15u^4 + 10u^3. Zero first AND second derivative at both
 * ends. Over a 90 degree sweep, smoothstep's nonzero endpoint acceleration is
 * visible as a small kick on the frame the illusion resolves, which is the one
 * frame that has to look settled. Pure function of u — no state, no clock.
 */
export function smootherstep(u) {
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * One quarter-turn camera orbit.
 *
 * Deliberately DOM-free and renderer-free so it can be unit tested in node, and
 * deliberately absolute rather than incremental: every frame recomputes the
 * pose from the SAVED START POSE and the current progress. Accumulating a small
 * rotation onto the live camera each frame would drift, and drift means the
 * pose at u=1 is no longer bit-equal to the pose the swap restores.
 *
 * The only clock is the dt handed to `advance()`.
 */
export class CameraOrbit {
  constructor({ position, quaternion, delta = 1, fromTurns = 0, duration = ORBIT_SECONDS } = {}) {
    /** Pose the orbit started from. Restored verbatim when it completes. */
    this.startPosition = new THREE.Vector3().copy(position ?? ORIGIN);
    this.startQuaternion = new THREE.Quaternion().copy(quaternion ?? new THREE.Quaternion());
    /** Quarter turns this orbit commits, signed. */
    this.delta = Math.trunc(delta) || 1;
    /** World rotation state this orbit started from. The commit target is from+delta. */
    this.fromTurns = fromTurns | 0;
    this.duration = Number.isFinite(duration) && duration > 0 ? duration : ORBIT_SECONDS;
    /** Seconds accumulated from ctx.time.dt. Never a timestamp. */
    this.elapsed = 0;
  }

  /** Linear progress in [0,1]. */
  get progress() {
    return Math.min(this.elapsed / this.duration, 1);
  }

  get done() {
    return this.elapsed >= this.duration;
  }

  /** Signed camera azimuth, radians, at the current progress. */
  get angle() {
    return CAMERA_TURN_SIGN * this.delta * TURN_RADIANS * smootherstep(this.progress);
  }

  /** Advance by seconds. Non-finite or negative dt is ignored, never trusted. */
  advance(dt) {
    if (Number.isFinite(dt) && dt > 0) this.elapsed += dt;
    return this;
  }

  /**
   * Write the pose for the current progress onto a camera.
   *
   * At progress 0 this is bit-identical to the start pose: setFromAxisAngle(_,0)
   * is exactly the identity quaternion, and multiplying by it is exact in
   * floating point. So beginning an orbit moves no pixels on the frame it
   * begins.
   */
  applyTo(camera, pivot = ORIGIN) {
    _q.setFromAxisAngle(ORBIT_AXIS, this.angle);
    camera.position.copy(this.startPosition).sub(pivot).applyQuaternion(_q).add(pivot);
    camera.quaternion.copy(this.startQuaternion).premultiply(_q);
    return camera;
  }

  /** Put the camera back exactly where the orbit found it. */
  restore(camera) {
    camera.position.copy(this.startPosition);
    camera.quaternion.copy(this.startQuaternion);
    return camera;
  }

  /** Restart from phase zero without changing the destination. */
  rewind() {
    this.elapsed = 0;
    return this;
  }
}

export default {
  name: 'render',

  /**
   * The palette, exposed as a READ on the subsystem instance.
   *
   * ARCHITECTURE.md §3.3 permits exactly one direct reach between subsystems:
   * `ctx.peek(name)`. `src/world` is declared coupled with render and imports
   * PALETTE directly; `src/ui` is declared independent and must not, so it
   * reads this instead of duplicating the hexes or importing this module.
   */
  palette: PALETTE,

  async init(ctx) {
    const { config } = ctx;
    this._ctx = ctx;

    this.canvas = document.createElement('canvas');
    document.body.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      // Screenshots read a composited frame; preserving the buffer removes any
      // dependence on when the compositor happens to sample. Capture only —
      // it costs bandwidth we do not want to pay during a profile run.
      preserveDrawingBuffer: config.capture,
      powerPreference: 'high-performance',
    });

    // NEVER read devicePixelRatio in capture mode — the harness fixes the
    // device scale factor, and reading it here would make output depend on the
    // machine rather than on the frame index.
    this.renderer.setPixelRatio(config.capture ? 1 : Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.setClearColor(PALETTE.bg, 1);

    this.scene = new THREE.Scene();

    /**
     * ATMOSPHERE. Linear fog, set BEFORE any material exists, because fog is a
     * compile-time define on the shader: enabling it after first render would
     * recompile every material mid-play, which is the exact stall
     * ARCHITECTURE.md §6 exists to catch. Both meshes in this project use the
     * same MeshBasicMaterial{vertexColors} parameter set, so they still share
     * ONE program with fog on — verified by tools/profile.mjs, not assumed.
     *
     * Fog is also the only "post" in the project and it is not temporal, so
     * resetTemporal() has nothing extra to drop.
     */
    this.scene.fog = new THREE.Fog(PALETTE.haze, FOG_NEAR, FOG_FAR);

    // True isometric: orthographic projection with the camera on the (1,1,1)
    // diagonal gives equal foreshortening on all three axes, which is the
    // precondition for the projection-collapse trick the geometry subsystem
    // will rely on.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.set(40, 40, 40);
    this.camera.lookAt(0, 0, 0);
    this.frustumSize = 26;

    this._initTransitions(ctx);

    /**
     * Frame the live camera once the level is known.
     *
     * Subscribed HERE rather than in _initTransitions() because framing needs a
     * viewport and a renderer, and _initTransitions is deliberately DOM-free so
     * src/render/camera.test.js can drive the real wiring in node.
     *
     * The live view is framed on the UNION of all four rotation states, not on
     * the state it happens to be in. Framing turns 0 tightly would look better
     * for one second and then throw the structure into a corner the first time
     * the player presses Q, because rotation pivots at the world origin and
     * loop-01's origin is its corner. A frame that holds all four is the honest
     * composition for a view you can rotate. Dev shots do the opposite and
     * frame each state tightly, because each of those is a still.
     */
    ctx.on('level/loaded', (level) => this._frameLevel(level));

    this._resize();
    this._onResize = () => this._resize();
    globalThis.addEventListener('resize', this._onResize);

    ctx.engine.scene = this.scene;
    ctx.engine.camera = this.camera;
  },

  // ---------------------------------------------------------------- framing

  /** Viewport aspect, from the same source _resize uses. */
  _aspect() {
    const w = globalThis.innerWidth || 1600;
    const h = globalThis.innerHeight || 1000;
    return h > 0 ? w / h : 1.6;
  },

  /**
   * Apply a solved framing to the live camera. `points` are world-space cell
   * centres; see fitView for the options.
   */
  frameCamera(points, opts = {}) {
    const fit = fitView(points, { aspect: this._aspect(), ...opts });
    this.camera.position.set(...fit.position);
    this.camera.lookAt(...fit.target);
    this.frustumSize = fit.frustumSize;
    this._resize();
    return fit;
  },

  /**
   * Frame the live camera on a level across every rotation state it can be in.
   *
   * TWO REQUIREMENTS THAT PULL AGAINST EACH OTHER
   *
   * The live view is not a still. It must (a) never let a rotation throw the
   * structure off screen, which argues for framing the UNION of the four
   * states, and (b) look composed in the state the player is actually in most
   * of the time, which is turns 0 — the state every level opens in and, for
   * loop-01, the only one it is solvable in. Framing the union alone satisfies
   * (a) and fails (b) badly: loop-01's union is dominated by the rotated states
   * (rotation pivots at the world origin, which is the structure's corner), so
   * the home state renders 69% of the way down the frame and off to one side.
   *
   * So: SIZE from the union, AIM biased toward home by exactly as much as the
   * union's leftover margin allows. Nothing can leave the frame — the bias is
   * clamped to the slack, by construction — and the home state comes back to
   * 56% down instead of 69%. That is the composition doing real work rather
   * than a number someone liked.
   *
   * Rotating the cell list here rather than asking src/world for its instance
   * matrices keeps this a pure function of level DATA, so the live camera
   * cannot end up framed against a stale draw state.
   */
  _frameLevel(level, { fill = 0.70 } = {}) {
    const cells = level?.cells;
    if (!Array.isArray(cells) || cells.length === 0) return null;

    const every = [];
    for (let t = 0; t < 4; t++) {
      for (const [x, y, z] of cells) every.push(rotateY([x, y, z], t));
    }

    const aspect = this._aspect();
    // `fill` is deliberately looser than the stills use. A camera orbit sweeps
    // CONTINUOUSLY between two of the four states and bulges slightly outside
    // the union of them at 45 degrees, so the union needs headroom that a still
    // does not.
    const spread = fitView(every, { aspect, fill });
    const home = fitView(cells, { aspect, fill });

    const { right, up, forward } = viewBasis();
    const F = spread.frustumSize;
    const slackX = Math.max(0, (F * aspect - spread.box.w) / 2);
    const slackY = Math.max(0, (F - spread.box.h) / 2);

    const P = new THREE.Vector3(...spread.position);
    const d = new THREE.Vector3(...home.position).sub(P);
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    P.addScaledVector(right, clamp(d.dot(right), slackX))
      .addScaledVector(up, clamp(d.dot(up), slackY));

    this.camera.position.copy(P);
    this.camera.lookAt(P.x + forward.x, P.y + forward.y, P.z + forward.z);
    this.frustumSize = F;
    this._resize();
    return { position: P.toArray(), frustumSize: F };
  },

  /**
   * Rotation-transition state and its event wiring.
   *
   * Split out of init() so it can be exercised with no WebGL context and no
   * DOM: src/render/camera.test.js builds a rig with Object.create(render), a
   * bare OrthographicCamera and a stub ctx, then calls this. The tests
   * therefore drive the SAME wiring the engine does rather than a copy of it.
   */
  _initTransitions(ctx) {
    this._ctx = ctx;

    /**
     * Vertical axis the camera orbits. MUST match the axis src/geometry's
     * rotateY uses, which is the world origin — see the note above.
     */
    this.orbitPivot = new THREE.Vector3(0, 0, 0);
    /** Seconds per quarter turn. Tunable; never read from a clock. */
    this.orbitSeconds = ORBIT_SECONDS;
    /** The orbit in flight, or null. */
    this._orbit = null;
    /** Signed quarter turns waiting behind it. */
    this._pending = 0;
    /** True only inside our own setRotation call, so we do not self-abort. */
    this._committing = false;

    /**
     * If anything else rotates the world while an orbit is in flight — a dev
     * shot, a level reset — the end-swap this orbit promised is stale. Abandon
     * it and put the camera back rather than committing a turn the world has
     * already taken.
     */
    ctx.on('world/rotated', () => {
      if (!this._committing) this.cancelTransition();
    });
    ctx.on('level/loaded', () => this.cancelTransition());
    /**
     * Preferred integration seam (ARCHITECTURE.md §3.3: subsystems talk through
     * events, never imports). Inert until something emits it; src/ui rotating
     * through this instead of calling world.setRotation directly is what turns
     * the snap into a transition. Payload: `{ delta }` or a bare integer.
     */
    ctx.on('world/rotate-request', (payload) =>
      this.requestRotation(typeof payload === 'number' ? payload : payload?.delta ?? 1));
  },

  _resize() {
    const w = globalThis.innerWidth, h = globalThis.innerHeight;
    const aspect = w / h;
    const s = this.frustumSize;
    this.camera.left = (-s * aspect) / 2;
    this.camera.right = (s * aspect) / 2;
    this.camera.top = s / 2;
    this.camera.bottom = -s / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  },

  // ------------------------------------------------------------ transitions

  /**
   * Ask for `delta` quarter turns of world rotation, as camera orbits.
   *
   * Each quarter turn is its own orbit that begins and ends on the isometric
   * axis, because every intermediate rotation state is a legal game state and
   * deserves to be seen resolved — sweeping 180 degrees in one go would skip
   * past a state the player may have wanted.
   *
   * Requests arriving during an orbit are queued rather than interrupting it.
   * Interrupting means either jumping to the target state (a visible pop of up
   * to 90 degrees) or unwinding a partly-committed turn; a 0.45 s wait is
   * better than both. Opposite-signed requests cancel queued ones, so Q then E
   * nets to nothing.
   *
   * @returns {boolean} whether the request changed anything.
   */
  requestRotation(delta = 1) {
    const n = Math.trunc(Number(delta));
    if (!Number.isFinite(n) || n === 0) return false;

    const before = this._pending;
    const want = this._pending + n;
    this._pending = Math.max(-MAX_QUEUED_TURNS, Math.min(MAX_QUEUED_TURNS, want));
    if (this._pending === before) return false;

    if (!this._orbit) this._drain();
    return true;
  },

  /** Abandon any orbit in flight, restore the camera, drop the queue. */
  cancelTransition() {
    this._pending = 0;
    if (!this._orbit) return false;
    this._orbit.restore(this.camera);
    this._orbit = null;
    return true;
  },

  /** Read-only transition state. Frame-derived only — nothing wall-clock. */
  transitionState() {
    const o = this._orbit;
    return {
      active: o !== null,
      delta: o ? o.delta : 0,
      from: o ? o.fromTurns : null,
      to: o ? (((o.fromTurns + o.delta) % 4) + 4) % 4 : null,
      progress: o ? o.progress : 0,
      queued: this._pending,
    };
  },

  /**
   * Per-frame. ctx.time.dt is the ONLY clock consulted in this subsystem.
   *
   * When no orbit is in flight this touches nothing — which is what keeps the
   * dev shots working: they set `camera.position` / `camera.lookAt` directly and
   * nothing here overwrites them.
   */
  update(ctx) {
    const orbit = this._orbit;
    if (!orbit) return;

    orbit.advance(ctx.time.dt);

    if (orbit.done) this._commit(ctx, orbit);
    else orbit.applyTo(this.camera, this.orbitPivot);
  },

  /**
   * THE SWAP HAPPENS AT THE END OF THE ORBIT. This is the whole argument:
   *
   * The camera arriving at start + (-90 deg) with the world still at T renders
   * the SAME image as the camera back at start with the world at T+1 — that is
   * the identity at the top of this section. So the discrete state change can
   * be applied at exactly the moment the camera completes the arc, together
   * with an exact restore of the saved start pose, and the picture does not
   * move. The frame this runs on is rendered once, in the destination state.
   *
   * The alternatives both put the discrete state ahead of the picture:
   *
   *   START. To keep the image continuous, swapping at the start also has to
   *   teleport the camera back by -delta. The pixels are then the same as the
   *   end-swap's, but for the entire orbit `world.turns` is T+1 while the frame
   *   the player is looking at is the T arrangement — and at u=0 that frame is
   *   ON-AXIS and fully resolved, so it reads as authoritative. Everything that
   *   consumes `world.turns` — pathGraph, visibility, the avatar's occlusion
   *   bias, the HUD pips — is answering questions about a configuration the
   *   player has not been shown. A step accepted at u=0.1 resolves against
   *   edges with no visual evidence. That is the damaging sense of "the
   *   illusion is broken": not a structure that visibly comes apart off-axis,
   *   which is honest, but an on-axis frame whose picture and whose rules
   *   disagree.
   *
   *   MIDPOINT. Strictly worse. Either the structure takes a hard 90-degree
   *   apparent cut at u=0.5, or you teleport the camera to hide it — which is
   *   all the work of the end-swap plus one more discontinuity to get right,
   *   and still leaves half a transition where logic leads picture. It does not
   *   even shorten the off-axis interval: peak deviation from the nearest
   *   isometric axis is 45 degrees either way.
   *
   *   The honest counter-argument, stated because it is real: while the face
   *   tones are baked to world axes (residual 1 above), the swap frame carries
   *   a visible tone exchange, and the end is the WORST place to put it —
   *   everything has just resolved, so the eye is on it. Mid-orbit, at peak
   *   disassembly, it would hide better. That is still not a reason to move the
   *   swap. It would buy a temporary cosmetic win by permanently desynchronising
   *   state from picture for half of every transition, to camouflage a defect
   *   that is one line from being fixed — and once fixed, the end-swap is
   *   provably clean, which the control capture above already demonstrates.
   *
   * The end-swap is also the fail-safe direction. An orbit abandoned partway
   * (level reload, a dev shot, an opposing rotate) has committed nothing: the
   * world is still at T and the camera restores to a pose that was always
   * valid. A start-swap that is abandoned must be UNDONE, which is a second
   * discrete write in the one place it must not go wrong.
   *
   * What the player does see broken is the interval u in (0,1), where the
   * camera is genuinely off the isometric axis and the aliased cells separate.
   * That is not a defect being hidden — it is the same thing the `offaxis` shot
   * exists to show, and it resolves exactly at both ends.
   */
  _commit(ctx, orbit) {
    // Restore and clear BEFORE the world write: setRotation emits
    // world/rotated, our own listener would otherwise cancel an orbit that has
    // already succeeded.
    orbit.restore(this.camera);
    this._orbit = null;

    this._committing = true;
    try {
      // setRotation normalises, so from+delta is safe for negative deltas.
      ctx.peek('world')?.setRotation?.(orbit.fromTurns + orbit.delta);
    } finally {
      this._committing = false;
    }

    this._drain();
  },

  /** Start the next queued quarter turn, if any. */
  _drain() {
    if (this._orbit || this._pending === 0) return false;
    const step = this._pending < 0 ? -1 : 1;
    this._pending -= step;

    const world = this._ctx?.peek?.('world');
    this._orbit = new CameraOrbit({
      position: this.camera.position,
      quaternion: this.camera.quaternion,
      delta: step,
      fromTurns: Number.isInteger(world?.turns) ? world.turns : 0,
      duration: this.orbitSeconds,
    });
    // Progress 0 reproduces the start pose exactly, so this moves nothing.
    this._orbit.applyTo(this.camera, this.orbitPivot);
    return true;
  },

  /**
   * Drop any temporal history so accumulation restarts from a known phase.
   * tools/baseline.mjs calls this before pumping.
   *
   * A camera orbit IS temporal history, so it is rewound to phase zero here —
   * not cancelled. Rewinding matches the documented contract ("restarts from a
   * known phase") and keeps a future mid-transition shot capturable: a shot may
   * request a rotation, and the captured frame is then a pure function of the
   * settle count. Cancelling would silently make such a shot impossible.
   *
   * There is still no TAA or exposure adaptation. When a post chain lands, ITS
   * HISTORY MUST BE DROPPED HERE TOO — a silent no-op would let history leak
   * between shots and quietly destroy gate reproducibility.
   */
  resetTemporal() {
    if (this._orbit) this._orbit.rewind().applyTo(this.camera, this.orbitPivot);
  },

  draw(ctx) {
    this.renderer.render(this.scene, this.camera);
  },

  info() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      programs: i.programs?.length ?? 0,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  },

  dispose() {
    globalThis.removeEventListener('resize', this._onResize);
    this._orbit = null;
    this._pending = 0;
    this.renderer.dispose();
    this.canvas.remove();
  },
};
