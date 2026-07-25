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

export default {
  name: 'render',

  async init(ctx) {
    const { config } = ctx;

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

    this._resize();
    this._onResize = () => this._resize();
    globalThis.addEventListener('resize', this._onResize);

    ctx.engine.scene = this.scene;
    ctx.engine.camera = this.camera;
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

  /**
   * Drop any temporal history so accumulation restarts from a known phase.
   * No-op today — there is no TAA or exposure adaptation yet. When a post
   * chain lands, THIS MUST BE IMPLEMENTED: tools/baseline.mjs calls it before
   * pumping, and a silent no-op would let history leak between shots and
   * quietly destroy gate reproducibility.
   */
  resetTemporal() {},

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
    this.renderer.dispose();
    this.canvas.remove();
  },
};
