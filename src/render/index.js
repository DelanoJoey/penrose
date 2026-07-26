import * as THREE from 'three';

/**
 * Renderer + isometric camera rig.
 *
 * Deliberately flat-shaded: face colour comes from the face normal, not from a
 * light. There is no lighting term, no shadow pass, no temporal accumulation
 * and no tonemapping in the P0 stub. That is a target choice, not a shortcut —
 * see METHODOLOGY.md. It removes the two things that most commonly break a
 * pixel gate (auto-exposure adaptation, TAA history) and the thing that most
 * commonly tanks frame rate (a cascaded shadow + AO + TAA stack).
 */

// =====================================================================
//  ART DIRECTION — "riso": a limited-ink print, not a rendered object
// =====================================================================
/**
 * THE PREMISE
 *
 * This is a screen-printed poster of an impossible object, not a photograph of
 * one. Three consequences run through every decision below:
 *
 *   1. THERE IS NO LIGHT. A face's colour says which INK printed it, not which
 *      way it faces a lamp. That is what makes the tone convention decidable
 *      rather than a matter of taste — see THE TONE CONVENTION below.
 *   2. THE INK COUNT IS FIXED. Three inks lay the structure (sunflower, bright
 *      red, federal blue), one more prints the avatar (green), and the paper is
 *      the fifth value. Nothing is blended, nothing is shaded, nothing is
 *      graded — a tone is either laid down or it is not.
 *   3. THE PRESS IS IMPERFECT. Ink density varies block to block, and the
 *      plate is a hair off register. Both are procedural, both are baked once
 *      at load, and neither costs a frame of work or a byte of network.
 *
 * Every colour here is a real Riso drum ink rather than a taste-picked hex:
 * Sunflower FFB511, Bright Red F15060, Federal Blue 00317F, Green 00A95C. The
 * point of naming them is that the three structure inks are separated in VALUE
 * (0.72 / 0.50 / 0.17 relative luminance) as well as hue, so the isometric
 * three-tone read survives even though there is no lighting term to carry it.
 */
export const PALETTE = {
  /** Paper. Warm, slightly toothy cream — the ground everything prints on. */
  bg:        0xf0e7d5,
  /** Sunflower — the up-facing plate. */
  faceTop:   0xffb511,
  /** Federal Blue — the ±z plate, i.e. the screen-left faces. */
  faceLeft:  0x00317f,
  /** Bright Red — the ±x plate, i.e. the screen-right faces. */
  faceRight: 0xf15060,
  /** HUD only (src/ui reads this). The scene marks cells with INK.knockout. */
  accent:    0xffd84d,
};

/**
 * Press behaviour. All multiplicative against the baked face tones, applied
 * per instance through `instanceColor` — so it costs no extra draw call, no
 * extra program and no per-frame work. Values above 1 are legal and are how a
 * multiply-only channel is made to lighten.
 */
export const INK = {
  /**
   * Start and goal print with LESS ink, so they read as a knockout: the same
   * block, the same plates, a lighter pass. A hue shift was tried first and
   * cannot work — multiplying Federal Blue (red channel 0) by anything leaves
   * it blue, so a "tint it green" marker turns two of the three plates to mud.
   * Lifting density works on all three plates at once.
   */
  knockout: [1.60, 1.50, 1.35],
  /**
   * The misregistered plate: a second impression of every block, dropped
   * slightly down the page and pulled toward the red drum.
   */
  ghost: [1.15, 0.62, 0.45],
  /**
   * How far down the page the second impression sits, in world units. A WORLD
   * offset, not a screen one, so zooming into the print magnifies the
   * misregistration exactly as a loupe would. It is along -Y and nothing else,
   * which is the load-bearing part: -Y is the orbit axis, so this offset is
   * invariant under the camera orbit AND under a world quarter turn. The ghost
   * can therefore never slide, parallax or pop during a rotation.
   *
   * It is also what puts the ghost BEHIND: depth is x+y+z, so -Y is uniformly
   * further from the camera and the second impression loses every depth test
   * against its own block. No render order, no depth-state change, no second
   * material — it only shows where the first impression does not cover it.
   */
  ghostDropY: 0.085,
  /**
   * Horizontal inset of the second impression, per side, in world units.
   *
   * NOT a look choice — a correctness one, found by rendering it. A pure -Y
   * offset leaves the ghost's ±x and ±z faces exactly COPLANAR with the plate's,
   * so over ~95% of every side face the two are at the same depth and the
   * result is textbook coplanar z-fighting: soft blotches across the red and
   * blue plates that read as dirt, not as ink. Pulling the ghost in along x and
   * z separates every visible face in depth (only +x, +y, +z are ever drawn —
   * the rest are back-facing and culled), which resolves it with no depth-state
   * change, no polygon offset and no second material.
   *
   * The inset costs nothing visually: the second impression is only ever seen
   * along the BOTTOM of the silhouette, where the -Y drop puts it, and the drop
   * is unaffected by an x/z inset.
   *
   * Sized against MEASURED depth precision rather than guessed. The context is
   * 24-bit depth over a 0.1..200 ortho range (tools/glinfo.mjs), i.e. 1.19e-5
   * world units per step; an inset of 0.006 separates the visible faces by
   * 0.006/sqrt(3) = 0.0035, which is ~290 depth steps — orders of magnitude
   * past interpolation error, while leaving only a ~1.5 px break between
   * consecutive second impressions along a run of cells. An earlier 0.03 was
   * fully robust but left visible paper-coloured notches at every cell join.
   */
  ghostInset: 0.006,
  /** Peak per-block ink density variation. Uneven lay-down, not noise. */
  densityJitter: 0.055,
};

/**
 * Deterministic hash in [0,1). Integer-only mixing (Math.imul + unsigned
 * shifts) so it is bit-identical on every machine, and a pure function of its
 * arguments so it consumes no rng stream and cannot drift when another
 * subsystem's call count changes (ARCHITECTURE.md §2).
 */
export function hash01(a, b = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e3779b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Paint vertex colours by face normal: up-facing gets the light tone, the two
 * horizontal axes get the mid and dark tones. This is what produces the
 * isometric three-tone read with zero lighting maths — and therefore with
 * bit-identical output across runs.
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
 *      ===== CLOSED BY THE "riso" ART DIRECTION. TONE IS FIXED TO THE WORLD. =====
 *      paintByNormal bakes tone onto WORLD-space normals, and src/world's
 *      _applyRotation used to only translate its instances. A world turn
 *      therefore left the tone-to-screen-side mapping fixed, while a 90 deg
 *      camera orbit exchanged the +-x and +-z families.
 *
 *      src/world now composes makeRotationY(turns * PI/2) into the instance
 *      matrix, so a world turn is a true rigid rotation and the face tones
 *      rotate with the cell. The full argument for choosing this convention
 *      over the screen-fixed one — a print has inks, not a key light — is in
 *      src/world/_applyRotation, together with the structural argument: the
 *      screen-fixed convention cannot be held through a 90 deg orbit without a
 *      per-frame vertex-colour repaint or a second shader program, and this one
 *      is one matrix op per instance at rotation time only.
 *
 *      Two consequential decisions elsewhere fall out of the same choice, and
 *      are recorded where they live: the avatar's ±x and ±z tones are now the
 *      SAME ink (src/player), because the pawn's mesh is not rotated and would
 *      otherwise be the last object in the scene still keyed to the screen; and
 *      the misregistered second impression is displaced along -Y only
 *      (INK.ghostDropY), the one axis invariant under both the orbit and the
 *      turn.
 *
 *      RE-MEASURED after the change, same method, tools/commitframe.mjs, 1600x1000:
 *
 *        hero,   avatar visible at the biased start cell .. 0%, max 0, mean 0
 *        avatar, same transition at frustum 3.27 .......... 0%, max 0, mean 0
 *
 *      i.e. the end-swap is now provably pixel-clean through the real renderer,
 *      which is exactly what the control capture above predicted. Nothing about
 *      the swap's placement changed; the residual it was carrying is gone.
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
 * BOTH RESIDUALS ARE NOW CLOSED, and neither was ever a reason to move the
 * swap. That was the standing argument — "once (1) lands, the end-swap is
 * provably clean, which the control above already demonstrates" — and (1) has
 * now landed and the measurement agrees with the control exactly.
 */

// =====================================================================
//  THE PAPER — procedural, vertex-data only, one extra draw call
// =====================================================================
/**
 * The ground the ink prints on.
 *
 * A flat clear colour is a background; PAPER is a surface. The difference is
 * the tooth, and the tooth is the whole reason this direction is called riso
 * rather than "flat colours". It is generated once at load from an integer
 * hash — no image file, no network fetch, no canvas texture, and therefore no
 * second program from a background pass.
 *
 * HOW IT STAYS INSIDE THE BUDGET
 *
 *   - It is an InstancedMesh of count 1 with an instanceColor attribute, not a
 *     plain Mesh. That is deliberate and load-bearing: USE_INSTANCING and
 *     USE_INSTANCING_COLOR are part of three.js's program cache key, so a plain
 *     Mesh here would compile a SECOND program. src/player already documents
 *     this trick for the avatar; the paper uses the same one, and the measured
 *     program count stays at 1.
 *   - It is parented to the CAMERA and scaled in _resize() to exactly the ortho
 *     frustum, so it needs no per-frame work at all — not a matrix write, not a
 *     colour upload. It moves because the camera moves.
 *   - Grain is therefore fixed in SCREEN space while the misregistered plate is
 *     fixed in WORLD space. That asymmetry is chosen, not accidental: each shot
 *     is its own print, so the paper tooth is the same size on every one of
 *     them, while a loupe held over the print magnifies the off-register. The
 *     alternative — world-scaled grain — cannot hold a legible tooth across the
 *     set's 6:1 zoom range without a vertex count an order of magnitude larger.
 *
 * Cost, stated plainly: +1 draw call, +0 programs, +0 per-frame work.
 */
const PAPER = {
  /** Grid cells across the frame. 320 x 200 is ~5 px per cell at 1600x1000. */
  cols: 320,
  rows: 200,
  /** Distance behind the camera plane. Inside the 0.1..200 ortho depth range. */
  depth: 140,
  /** Overscan so no seam can show at the frame edge. */
  bleed: 1.03,
  /** Mottle octaves: [cell size in grid units, amplitude]. */
  octaves: [[38, 0.030], [11, 0.020], [3, 0.013]],
  /** Per-vertex tooth, at the grid's own frequency. */
  tooth: 0.026,
  /** How much cooler the darker fibres run, as a fraction of the mottle. */
  fibre: 0.45,
};

/** Bilinear value noise on the integer lattice. Pure, deterministic, no rng. */
function valueNoise(x, y, cell, salt) {
  const fx = x / cell, fy = y / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const n00 = hash01(ix * 73856093 + iy * 19349663, salt);
  const n10 = hash01((ix + 1) * 73856093 + iy * 19349663, salt);
  const n01 = hash01(ix * 73856093 + (iy + 1) * 19349663, salt);
  const n11 = hash01((ix + 1) * 73856093 + (iy + 1) * 19349663, salt);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

/**
 * A unit quad, subdivided, with paper tooth baked into its vertex colours.
 * Returns geometry whose colours are already multiplied against PALETTE.bg, so
 * the mesh needs no tint and the clear colour behind it matches exactly.
 */
function paperGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, PAPER.cols, PAPER.rows);
  const pos = g.getAttribute('position');
  const base = new THREE.Color(PALETTE.bg);
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const gx = i % (PAPER.cols + 1);
    const gy = (i / (PAPER.cols + 1)) | 0;

    let n = 0;
    for (let o = 0; o < PAPER.octaves.length; o++) {
      const [cell, amp] = PAPER.octaves[o];
      n += (valueNoise(gx, gy, cell, o * 977 + 13) - 0.5) * 2 * amp;
    }
    n += (hash01(gx * 92837111 + gy * 689287499, 7717) - 0.5) * 2 * PAPER.tooth;

    // Darker fibres run cooler, lighter ones warmer — the same shift a warm
    // stock shows under uneven coverage. One expression, no branch.
    const warm = 1 + n * (1 + PAPER.fibre);
    const cool = 1 + n * (1 - PAPER.fibre);
    colors[i * 3 + 0] = base.r * warm;
    colors[i * 3 + 1] = base.g * (1 + n);
    colors[i * 3 + 2] = base.b * cool;
  }

  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

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

const WORLD_UP = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);
const ORBIT_AXIS = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);
const ORIGIN = /* @__PURE__ */ new THREE.Vector3(0, 0, 0);
const _q = /* @__PURE__ */ new THREE.Quaternion();

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

    // True isometric: orthographic projection with the camera on the (1,1,1)
    // diagonal gives equal foreshortening on all three axes, which is the
    // precondition for the projection-collapse trick the geometry subsystem
    // will rely on.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.set(30, 30, 30);
    this.camera.lookAt(0, 0, 0);
    this.frustumSize = 26;

    // The paper rides with the camera, so the camera has to be in the scene
    // graph for its children's world matrices to be updated by the traversal.
    //
    // BAKED, not drawn every frame. The tooth is still generated from the same
    // 320x200 vertex-coloured mesh — the art is unchanged — but that mesh is now
    // rasterised ONCE into a render target and the scene draws a two-triangle
    // quad sampling it. See _bakePaper.
    // vertexColors is kept so the program cache key differs from the structure's
    // by USE_MAP alone — but PlaneGeometry ships no colour attribute, and a
    // material that declares vertexColors without one renders BLACK. Supply an
    // explicit white so map * vertexColor * instanceColor == map exactly.
    const paperQuad = new THREE.PlaneGeometry(1, 1);
    paperQuad.setAttribute('color', new THREE.BufferAttribute(
      new Float32Array(paperQuad.getAttribute('position').count * 3).fill(1), 3));

    this.paper = new THREE.InstancedMesh(
      paperQuad, new THREE.MeshBasicMaterial({ vertexColors: true }), 1);
    this.paper.name = 'paper';
    this.paper.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
    this.paper.setMatrixAt(0, new THREE.Matrix4());
    this.paper.instanceMatrix.needsUpdate = true;
    this.paper.frustumCulled = false;
    this.paper.position.set(0, 0, -PAPER.depth);
    this.camera.add(this.paper);
    this.scene.add(this.camera);

    // Source mesh for the bake. Lives in its own scene, never in the main one.
    //
    // InstancedMesh with an instanceColor rather than a plain Mesh, matching the
    // structure's material key on the theory that it would then share the
    // structure's program.
    //
    // IT DOES NOT. Measured both ways: the program count is 3 either way. Some
    // other part of the key differs for a render-target pass — plausibly the
    // output colour-space handling, which this has not chased further. The claim
    // is left here as a corrected one rather than deleted, because the obvious
    // next move is to re-try exactly this and it does not work.
    //
    // Kept anyway: it is consistent with how every other mesh in the project is
    // built, and it costs nothing. The number that actually predicts stalls,
    // programsCompiledDuringPlay, is 0 — all three compile during boot.
    this._paperSource = new THREE.InstancedMesh(
      paperGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), 1);
    this._paperSource.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
    this._paperSource.setMatrixAt(0, new THREE.Matrix4());
    this._paperSource.instanceMatrix.needsUpdate = true;
    this._paperSource.frustumCulled = false;
    this._paperScene = new THREE.Scene();
    this._paperScene.add(this._paperSource);
    // Frames the unit quad exactly, so a texel of the target maps to the pixel
    // the 320x200 mesh would have covered.
    this._paperCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 2);
    this._paperCamera.position.set(0, 0, 1);
    this._paperTarget = null;

    this._initTransitions(ctx);

    /**
     * Frame the level the moment it exists. Camera framing being off-centre
     * was a known deferred item through P0 and P1; composition is part of this
     * art direction, so the default view is now derived from the level's own
     * screen bounds rather than from a hand-placed camera that happened to
     * point near the structure. Dev shots run after this and override it.
     */
    ctx.on('level/loaded', (level) => {
      if (Array.isArray(level?.cells)) this.frameCells(level.cells, { fillY: 0.70, fillX: 0.80 });
    });

    this._resize();
    this._onResize = () => this._resize();
    globalThis.addEventListener('resize', this._onResize);

    ctx.engine.scene = this.scene;
    ctx.engine.camera = this.camera;
  },

  // ------------------------------------------------------------- composition
  /**
   * COMPOSITION IS A RENDER CONCERN, NOT A PER-SHOT ONE.
   *
   * Every shot in the set used to be a hand-placed camera position plus a
   * hand-tuned frustum, and every one of them was mis-framed: the structure sat
   * off to one side with most of the canvas empty, and two of them
   * (`avatar`, `avatarmid`) were not even exactly isometric, because a lookAt
   * target off the (1,1,1) diagonal tilts the view direction off the diagonal
   * by a degree or two. That silently weakened the one assertion the `avatar`
   * shot exists to make.
   *
   * So framing is derived instead. Given the cells to be shown and a view
   * DIRECTION, this projects all eight corners of every cell onto the screen
   * basis, takes the bounding box, and solves for the orthographic frustum and
   * the lookAt target that place that box where the composition asks for it.
   * The camera position is then target + distance * (-direction), which keeps
   * the view direction EXACTLY as specified — so an isometric shot is exactly
   * isometric no matter where its subject sits in the world.
   *
   * @param cells   world positions of unit cells, already rotated for the view
   * @param dir     view direction, camera toward subject. Default: isometric.
   * @param fillX   fraction of frame width the subject may occupy
   * @param fillY   fraction of frame height the subject may occupy
   * @param liftY   fraction of frame height to raise the subject. Optical
   *                centring: a mass placed at true centre reads as sagging.
   * @param shiftX  fraction of frame width to move the subject right
   */
  frameCells(cells, {
    dir = [-1, -1, -1],
    fillX = 0.84, fillY = 0.76,
    liftY = 0.02, shiftX = 0,
    distance = 60,
    extent = 0.5,
  } = {}) {
    if (!Array.isArray(cells) || cells.length === 0) return null;

    const z = new THREE.Vector3(-dir[0], -dir[1], -dir[2]).normalize();
    const x = new THREE.Vector3().crossVectors(WORLD_UP, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const p = new THREE.Vector3();
    for (const c of cells) {
      for (let k = 0; k < 8; k++) {
        p.set(
          c[0] + (k & 1 ? extent : -extent),
          c[1] + (k & 2 ? extent : -extent),
          c[2] + (k & 4 ? extent : -extent),
        );
        const px = p.dot(x), py = p.dot(y);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }

    const aspect = (globalThis.innerWidth || 1) / (globalThis.innerHeight || 1);
    const frustum = Math.max((maxY - minY) / fillY, (maxX - minX) / (fillX * aspect));

    // The subject appears at (subject - target), so raising it on screen means
    // lowering the TARGET. Sign errors here are silent and look like sag.
    const cx = (minX + maxX) / 2 - shiftX * frustum * aspect;
    const cy = (minY + maxY) / 2 - liftY * frustum;

    const target = new THREE.Vector3()
      .addScaledVector(x, cx)
      .addScaledVector(y, cy);

    this.camera.position.copy(target).addScaledVector(z, distance);
    this.camera.lookAt(target);
    this.frustumSize = frustum;
    this._resize();
    return { frustum, target };
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
    // The paper is a unit quad: scaling it to the frustum here is the entire
    // reason it needs no per-frame work, and it is what keeps the grain the
    // same size on screen in a 5-unit close-up and a 30-unit wide shot.
    this.paper?.scale.set(s * aspect * PAPER.bleed, s * PAPER.bleed, 1);
    this.renderer.setSize(w, h, false);
    this._bakePaper();
  },

  /**
   * Rasterise the paper ONCE into a render target.
   *
   * WHY. The tooth is carried by a 320x200 vertex-coloured grid — 128,000
   * triangles. On a GPU that is free and it stayed inside every structural
   * budget this project tracks: draw calls, program count, heap growth were all
   * unchanged. It was still a 20x wall-clock regression, because CI has no GPU
   * and rasterises via SwiftShader, and the gate re-renders that static backdrop
   * for all 90 settle frames of each of 9 shots, twice. The determinism gate
   * went from ~30s to 10m41s.
   *
   * The lesson is in METHODOLOGY: the structural budget counts OBJECTS, not the
   * cost of rasterising them, so it could not see this. Neither could three
   * profiler runs on a machine that has a GPU.
   *
   * The art is untouched. The same mesh, generated by the same hash, is drawn —
   * once, into a target the size of the drawing buffer, then sampled 1:1 by a
   * two-triangle quad. 128,000 triangles per frame becomes 2.
   *
   * MEASURED WIN, under --use-gl=swiftshader to reproduce CI's conditions:
   *   pump(90) + screenshot, hero shot, 1600x1000:  4394 ms -> 1023 ms
   *   triangles per frame:                          128,400 -> 402
   *
   * WHAT THIS COSTS, stated plainly rather than buried:
   *   - programs 1 -> 3, ALL COMPILED AT BOOT. Two was the prediction and three
   *     is the measurement; see the note on _paperSource for what was tried to
   *     get it back to two and why it did not work. programsCompiledDuringPlay —
   *     the number that actually predicts stalls — stays 0.
   *   - textures 0 -> 1.
   *   - NOT PIXEL-IDENTICAL: maxDelta 1 over 2.8% of the widest shot. Three
   *     separate causes were found and fixed on the way down from maxDelta 2 /
   *     30.9% (a material declaring vertexColors with no colour attribute; a
   *     target sized to the viewport rather than to the bleed, which magnified
   *     by 1.03; an 8-bit colour-space round trip). What remains is last-bit
   *     difference on the paper's internal triangle edges. Handled the way
   *     ARCHITECTURE.md §5 requires — a deliberate reference re-capture in this
   *     commit, NOT a relaxed tolerance.
   *
   * The target is multisampled to the same count as the main framebuffer.
   * Without that, the paper's internal triangle edges resolve differently here
   * than they did when drawn directly, and the bake would shift pixels for no
   * reason other than a mismatched sample count.
   */
  _bakePaper() {
    if (!this._paperSource || !this.renderer) return;

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());

    // SIZED TO THE BLEED, not to the viewport — this is what makes it 1:1.
    //
    // The paper quad is scaled to PAPER.bleed times the frustum, so it covers
    // bleed * drawingBuffer pixels on screen. A target the size of the viewport
    // would therefore be magnified by 1.03 when sampled, which is a resample,
    // and it measured as maxDelta 2 over 30.9% of the widest shot. Baking at the
    // bleed-scaled extent puts one texel under one pixel again.
    const w = Math.max(1, Math.round(size.x * PAPER.bleed));
    const h = Math.max(1, Math.round(size.y * PAPER.bleed));

    if (this._paperTarget?.width === w && this._paperTarget?.height === h) return;

    this._paperTarget?.dispose();
    this._paperTarget = new THREE.WebGLRenderTarget(w, h, {
      // NEAREST + no mips: the quad covers exactly this many pixels, so every
      // texel is sampled at its own centre and the resample is the identity.
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
      // LINEAR + HALF FLOAT, deliberately, and this is what makes the bake
      // pixel-exact rather than merely close.
      //
      // An 8-bit sRGB target round-trips every texel through encode -> quantise
      // -> decode before the final output encode, and that middle quantisation
      // showed up as maxDelta 2 across 29.7% of the widest shot. Measured, not
      // assumed. Keeping the target linear and half-float removes the extra
      // encode/decode entirely: the paper's linear colour goes in, comes back
      // out linear, and is encoded exactly once by the output pass — the same
      // path it took when drawn directly.
      colorSpace: THREE.SRGBColorSpace,
      samples: this._ctx?.config?.q?.msaa ?? 0,
    });

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this._paperTarget);
    this.renderer.render(this._paperScene, this._paperCamera);
    this.renderer.setRenderTarget(prevTarget);

    this.paper.material.map = this._paperTarget.texture;
    this.paper.material.needsUpdate = true;
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
   *   The counter-argument that used to be stated here — that while face tones
   *   were baked to world axes the swap frame carried a visible tone exchange,
   *   and the end is the worst place to put a flicker because everything has
   *   just resolved — is now MOOT rather than merely outweighed. The tone
   *   convention above is resolved, and the commit frame measures 0% changed,
   *   maxDelta 0 with the avatar visible at its biased start cell. There is
   *   nothing left at the end of the orbit to hide, so the argument for moving
   *   the swap mid-orbit to camouflage it has lost its premise as well as
   *   having always lost on the merits.
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
    this.paper?.removeFromParent();
    this.paper?.geometry?.dispose();
    this.paper?.material?.dispose();
    this.paper = null;
    this.renderer.dispose();
    this.canvas.remove();
  },
};
