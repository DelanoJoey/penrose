import * as THREE from 'three';
import { cellId, parseCell, screenKey, rotateY, HORIZONTAL_STEPS } from '../geometry/index.js';

/**
 * The avatar and its traversal of the path graph.
 *
 * STUB — the interface and contract are fixed; the behaviour is not implemented.
 *
 * This subsystem CONSUMES src/geometry and must not reimplement any of it. The
 * path graph, visibility and adjacency rules already exist and are unit-tested;
 * duplicating that logic here is the single easiest way to introduce a bug where
 * the avatar disagrees with the analyser about what the level is.
 *
 * Read ARCHITECTURE.md §1 before touching this file. Movement animation is the
 * most likely place in this project for wall-clock time to sneak in.
 */

export default {
  name: 'player',

  async init(ctx) {
    this.ctx = ctx;
    this.level = null;
    this.cell = null;
    this.moves = 0;
    this.solved = false;

    ctx.on('level/loaded', (level) => {
      this.level = level;
      this.cell = cellId(...level.start);
      this.moves = 0;
      this.solved = false;
    });

    // TODO(P2): avatar mesh. Keep it to ONE draw call and no new material
    // variants if possible — every distinct program is a compile stall waiting
    // to happen (ARCHITECTURE.md §6).
    this.mesh = null;
  },

  /**
   * Attempt a step in a screen-space direction.
   *
   * @param {[number,number]} screenDelta one of geometry's HORIZONTAL_STEPS
   * @returns {boolean} whether the move was legal
   *
   * TODO(P2): resolve the target via the CURRENT rotation's path graph, not by
   * 3D adjacency. Emit `player/moved` with viaIllusion set when the edge spans
   * more than one unit in 3D, and `player/blocked` otherwise. Emit
   * `level/solved` when the goal is reached.
   */
  step(screenDelta) {
    return false;
  },

  /** Read-only state for the UI. Must contain nothing time-derived. */
  state() {
    return {
      cell: this.cell,
      moves: this.moves,
      solved: this.solved,
      level: this.level?.name ?? null,
    };
  },

  update(ctx) {
    // TODO(P2): drive movement interpolation from ctx.time.dt ONLY.
    // performance.now() here would make every capture in the repository
    // non-reproducible and would not be caught by the unit tests.
  },

  dispose() {
    this.mesh?.geometry?.dispose();
    this.mesh?.material?.dispose();
  },
};
