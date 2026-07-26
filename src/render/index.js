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

/** Stylised palette. Value separation carries the form, not lighting. */
export const PALETTE = {
  bg:        0x2a1b3d,
  faceTop:   0xf2b880,
  faceLeft:  0xd98e73,
  faceRight: 0xa9678a,
  accent:    0x6dd3c4,
};

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

    this._initTransitions(ctx);

    this._resize();
    this._onResize = () => this._resize();
    globalThis.addEventListener('resize', this._onResize);

    ctx.engine.scene = this.scene;
    ctx.engine.camera = this.camera;
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
