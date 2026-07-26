/**
 * Isometric projection and the impossible-geometry path graph.
 *
 * THE ONE FACT THIS WHOLE SUBSYSTEM RESTS ON
 * -----------------------------------------
 * In an orthographic projection viewed along (1,1,1), the points
 *
 *     (x, y, z)   and   (x + t, y + t, z + t)
 *
 * project to exactly the same screen point, for every t. The view direction
 * collapses to nothing on screen.
 *
 * Derivation. With screen basis u = (1,0,-1)/sqrt2 and v = (-1,2,-1)/sqrt6:
 *
 *     screen_x = dot(p, u) = (x - z) / sqrt2
 *     screen_y = dot(p, v) = (2y - x - z) / sqrt6
 *
 * Substituting (x+t, y+t, z+t) leaves both expressions unchanged. So the pair
 *
 *     a = x - z          b = x + z - 2y
 *
 * is a COMPLETE INVARIANT of screen position: two cells overlap on screen if
 * and only if they share (a, b). This is exact integer arithmetic on a lattice —
 * no float comparison, no epsilon, and therefore no nondeterminism.
 *
 * Every Escher/Penrose connection is a consequence. Two cells arbitrarily far
 * apart in 3D can be visually adjacent, and the engine can prove it rather than
 * approximate it.
 *
 * A worked case: stepping +x changes (a,b) by (+1,+1); stepping +y changes it by
 * (0,-2). Their sum is (+1,-1) — which is exactly the change from stepping -z.
 * So "walk one east and climb one" is indistinguishable on screen from "walk one
 * north". That is the Penrose staircase, and it falls out of the algebra rather
 * than being drawn by hand.
 *
 * DEPTH. Distance toward the camera is proportional to x + y + z. Where several
 * cells share a screen position, the largest sum is the one you actually see.
 */

/** Screen-position invariant. Cells overlap on screen iff these are equal. */
export function screenKey(x, y, z) {
  return [x - z, x + z - 2 * y];
}

/** String form for Map/Set keys. */
export function screenId(x, y, z) {
  return `${x - z},${x + z - 2 * y}`;
}

/** Toward-camera depth. Larger occludes smaller at the same screen position. */
export function depth(x, y, z) {
  return x + y + z;
}

export const cellId = (x, y, z) => `${x},${y},${z}`;
export const parseCell = (id) => id.split(',').map(Number);

/** Split a "x,y,z@t" search state. Uses lastIndexOf so negative coords are safe. */
const splitState = (s) => {
  const i = s.lastIndexOf('@');
  return [s.slice(0, i), Number(s.slice(i + 1))];
};

/**
 * Screen-lattice deltas produced by each unit move in 3D.
 * Note a + b is always even, so the reachable lattice is a checkerboard.
 */
export const SCREEN_DELTA = {
  '+x': [1, 1],   '-x': [-1, -1],
  '+y': [0, -2],  '-y': [0, 2],
  '+z': [-1, 1],  '-z': [1, -1],
};

/** The four horizontal moves, i.e. what walking looks like on screen. */
export const HORIZONTAL_STEPS = [
  SCREEN_DELTA['+x'], SCREEN_DELTA['-x'],
  SCREEN_DELTA['+z'], SCREEN_DELTA['-z'],
];

/**
 * All six screen-lattice neighbours.
 *
 * Because a + b is always even, the reachable screen lattice is a HEX grid and
 * not a 4-connected square one. A flood fill using only HORIZONTAL_STEPS leaks
 * through the +/-y gaps and reports that nothing is enclosed — which is why
 * enclosedHoles below uses all six and holes.test.js pins the counts.
 */
export const SCREEN_NEIGHBOURS = Object.values(SCREEN_DELTA);

/** Rotate a cell by quarter turns about Y. (x,y,z) -> (z, y, -x) per turn. */
export function rotateY([x, y, z], turns) {
  let cx = x, cz = z;
  const t = ((turns % 4) + 4) % 4;
  for (let i = 0; i < t; i++) {
    const nx = cz, nz = -cx;
    cx = nx; cz = nz;
  }
  return [cx, y, cz];
}

/**
 * The world: a set of solid unit cells, plus the derived visibility and
 * traversal structure for a given rotation.
 */
export class Structure {
  /** @param {Array<[number,number,number]>} cells */
  constructor(cells = []) {
    this.cells = cells.map(([x, y, z]) => [x | 0, y | 0, z | 0]);
    this._solid = new Set(this.cells.map(([x, y, z]) => cellId(x, y, z)));
  }

  isSolid(x, y, z) {
    return this._solid.has(cellId(x, y, z));
  }

  /**
   * For one rotation state, resolve what is actually visible.
   *
   * Returns a Map from screen id to the frontmost cell at that screen position.
   * Ties are impossible: two distinct cells sharing a screen id differ by a
   * nonzero multiple of (1,1,1), so their depths differ by 3t != 0.
   */
  visibility(turns = 0) {
    const visible = new Map();
    for (const cell of this.cells) {
      const [x, y, z] = rotateY(cell, turns);
      const sid = screenId(x, y, z);
      const d = depth(x, y, z);
      const prev = visible.get(sid);
      if (!prev || d > prev.depth) visible.set(sid, { cell, rotated: [x, y, z], depth: d });
    }
    return visible;
  }

  /**
   * Cells you could stand on: solid, nothing solid directly above, and actually
   * visible at their screen position. An occluded platform is not a platform —
   * the player has no way to see or reach it.
   */
  standable(turns = 0) {
    const visible = this.visibility(turns);
    const out = [];
    for (const cell of this.cells) {
      const [x, y, z] = cell;
      if (this.isSolid(x, y + 1, z)) continue;
      const rot = rotateY(cell, turns);
      const sid = screenId(...rot);
      const front = visible.get(sid);
      if (front && cellId(...front.cell) === cellId(x, y, z)) out.push(cell);
    }
    return out;
  }

  /**
   * The traversal graph, built from VISUAL adjacency rather than 3D adjacency.
   * That inversion is the entire mechanic: an edge exists because two platforms
   * look next to each other, not because they are.
   *
   * The avatar stands one cell above its platform, which shifts every screen
   * position by the same (0,-2), so platform-to-platform adjacency and
   * avatar-to-avatar adjacency are the same relation.
   */
  pathGraph(turns = 0) {
    const stand = this.standable(turns);
    const byScreen = new Map();
    for (const cell of stand) {
      byScreen.set(screenId(...rotateY(cell, turns)), cell);
    }

    const graph = new Map();
    for (const cell of stand) graph.set(cellId(...cell), []);

    for (const cell of stand) {
      const [a, b] = screenKey(...rotateY(cell, turns));
      for (const [da, db] of HORIZONTAL_STEPS) {
        const neighbour = byScreen.get(`${a + da},${b + db}`);
        if (neighbour) graph.get(cellId(...cell)).push(cellId(...neighbour));
      }
    }
    return graph;
  }

  /**
   * Edges that only exist because of the illusion: visually adjacent, but not
   * adjacent in 3D. If a level has none of these it is an ordinary staircase
   * and the premise of the game is absent — so this doubles as a design assert.
   */
  impossibleEdges(turns = 0) {
    const graph = this.pathGraph(turns);
    const out = [];
    for (const [from, tos] of graph) {
      const a = parseCell(from);
      for (const to of tos) {
        const b = parseCell(to);
        const manhattan = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        if (manhattan > 1) out.push({ from, to, manhattan });
      }
    }
    return out.sort((p, q) => (p.from < q.from ? -1 : p.from > q.from ? 1 : p.to < q.to ? -1 : 1));
  }

  /**
   * Screen positions the figure ENCLOSES: empty, and unable to reach the
   * outside of the bounding box.
   *
   * WHY THIS EXISTS. An impossible figure needs somewhere for the eye to trace
   * the loop. A closed circuit that folds back on itself projects as a filled
   * slab and reads as an ordinary solid however good its routing premise is —
   * which is exactly how a previous phase rendered a four-leg circuit and got
   * a rectangular bar. Closure is necessary and not sufficient; this is the
   * other necessary condition.
   *
   * NECESSARY, NOT SUFFICIENT EITHER. holes.test.js pins a figure with three
   * enclosed cells that still reads as an ordinary staircase. This is a filter
   * that removes most of the garbage before a render is spent. It is not a
   * judge, and it does not replace looking at the image.
   */
  enclosedHoles(turns = 0) {
    if (!this.cells.length) return [];
    const rot = this.cells.map((c) => rotateY(c, turns));
    const occupied = new Set(rot.map((c) => screenId(...c)));

    const keys = rot.map((c) => screenKey(...c));
    const minA = Math.min(...keys.map((k) => k[0])) - 2;
    const maxA = Math.max(...keys.map((k) => k[0])) + 2;
    const minB = Math.min(...keys.map((k) => k[1])) - 2;
    const maxB = Math.max(...keys.map((k) => k[1])) + 2;

    // Flood the empty complement inward from the border ring. Two rows deep on
    // the b axis because the +/-y step is (0,+/-2) and a one-row seed would
    // leave the opposite parity unreachable.
    const outside = new Set();
    const queue = [];
    const visit = (a, b) => {
      if (((a + b) % 2 + 2) % 2 !== 0) return;      // odd cells are off-lattice
      const k = `${a},${b}`;
      if (occupied.has(k) || outside.has(k)) return;
      outside.add(k);
      queue.push([a, b]);
    };
    for (let a = minA; a <= maxA; a++) {
      visit(a, minB); visit(a, minB + 1); visit(a, maxB); visit(a, maxB - 1);
    }
    for (let b = minB; b <= maxB; b++) { visit(minA, b); visit(maxA, b); }
    while (queue.length) {
      const [a, b] = queue.shift();
      for (const [da, db] of SCREEN_NEIGHBOURS) {
        const na = a + da, nb = b + db;
        if (na < minA || na > maxA || nb < minB || nb > maxB) continue;
        visit(na, nb);
      }
    }

    const enclosed = [];
    for (let a = minA; a <= maxA; a++) {
      for (let b = minB; b <= maxB; b++) {
        if (((a + b) % 2 + 2) % 2 !== 0) continue;
        const k = `${a},${b}`;
        if (!occupied.has(k) && !outside.has(k)) enclosed.push(k);
      }
    }
    return enclosed.sort();
  }

  /** Breadth-first path between two standable cells. Null if unreachable. */
  findPath(fromCell, toCell, turns = 0) {
    const graph = this.pathGraph(turns);
    const start = cellId(...fromCell), goal = cellId(...toCell);
    if (!graph.has(start) || !graph.has(goal)) return null;
    if (start === goal) return [start];

    const prev = new Map([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of graph.get(cur)) {
        if (prev.has(next)) continue;
        prev.set(next, cur);
        if (next === goal) {
          const path = [];
          for (let n = goal; n != null; n = prev.get(n)) path.push(n);
          return path.reverse();
        }
        queue.push(next);
      }
    }
    return null;
  }

  /**
   * Route from one cell to another ACROSS rotation states.
   *
   * findPath answers "is there a path in this one rotation". This answers the
   * question the game actually asks, where turning is itself a move:
   *
   *   walk : (cell, t) -> (neighbour, t)   only between standable cells
   *   turn : (cell, t) -> (cell, t +/- 1)  ALWAYS legal
   *
   * THE UNCONDITIONAL TURN IS NOT AN OVERSIGHT. The intuitive rule -- only turn
   * when the cell is standable in both states, so you cannot strand yourself --
   * contradicts the game. src/world.setRotation has no standability check, and
   * src/player/index.js:366 says so explicitly: "If the current cell is not
   * standable in this rotation it has no entry, and every direction is blocked
   * -- which is correct: rotate back to get out." A legitimate route may pass
   * THROUGH a rotation in which its cell is not a platform. An analyser using
   * the stricter rule would disagree with the player about what the level is,
   * and geometry is supposed to be the one authority both read.
   *
   * A turn and a walk cost the same: both are one keypress. So a "shortest"
   * route may prefer turning to walking. Deliberate, and recorded rather than
   * weighted, because no evidence yet says what a better weighting would be.
   *
   * @returns {Array<{kind:'walk'|'turn'}>|null} ordered moves, [] if already
   *   at the goal, null if unreachable in every rotation.
   */
  findRoute(fromCell, toCell, startTurns = 0) {
    const graphs = [0, 1, 2, 3].map((t) => this.pathGraph(t));
    const goal = cellId(...toCell);
    const t0 = ((startTurns % 4) + 4) % 4;
    const start = `${cellId(...fromCell)}@${t0}`;

    const prev = new Map([[start, null]]);
    const queue = [start];

    while (queue.length) {
      const cur = queue.shift();
      const [id, turns] = splitState(cur);

      if (id === goal) {
        const chain = [];
        for (let n = cur; n != null; n = prev.get(n)) chain.push(n);
        chain.reverse();
        const moves = [];
        for (let i = 1; i < chain.length; i++) {
          const [pc, pt] = splitState(chain[i - 1]);
          const [qc, qt] = splitState(chain[i]);
          moves.push(pc === qc
            ? { kind: 'turn', from: pt, to: qt }
            : { kind: 'walk', from: pc, to: qc, turns: pt });
        }
        return moves;
      }

      for (const next of graphs[turns].get(id) ?? []) {
        const k = `${next}@${turns}`;
        if (!prev.has(k)) { prev.set(k, cur); queue.push(k); }
      }
      for (const d of [1, 3]) {
        const k = `${id}@${(turns + d) % 4}`;
        if (!prev.has(k)) { prev.set(k, cur); queue.push(k); }
      }
    }
    return null;
  }

  /**
   * Everything a level declares about itself, measured.
   *
   * `requiresTurn` is defined against turn 0 alone, because that is the state
   * every level opens in. If a flat path exists there the player never has to
   * turn, whatever the other three rotations do -- which is exactly how
   * loop-01 passed a "requiresRotation" assert while needing zero turns.
   */
  premise(fromCell, toCell) {
    const route = this.findRoute(fromCell, toCell);
    const flat = [0, 1, 2, 3].map((t) => this.findPath(fromCell, toCell, t));
    const illusion = [0, 1, 2, 3].map((t) =>
      new Set(this.impossibleEdges(t).map((e) => `${e.from}>${e.to}`)));

    const walks = (route ?? []).filter((m) => m.kind === 'walk');
    const illusionWalks = walks.filter((m) => illusion[m.turns].has(`${m.from}>${m.to}`));

    return {
      solvable: route !== null,
      requiresTurn: route !== null && flat[0] === null,
      turnsInRoute: (route ?? []).filter((m) => m.kind === 'turn').length,
      walksInRoute: walks.length,
      usesIllusion: illusionWalks.length > 0,
      illusionWalks: illusionWalks.length,
      flatSolvableTurns: [0, 1, 2, 3].filter((t) => flat[t]),
      route,
    };
  }

  /**
   * Is the goal reachable in ANY rotation state, and does reaching it require
   * one? A puzzle solvable without rotating is not a puzzle.
   */
  solvability(fromCell, toCell) {
    const perTurn = [0, 1, 2, 3].map((t) => ({
      turns: t,
      path: this.findPath(fromCell, toCell, t),
      impossibleEdges: this.impossibleEdges(t).length,
    }));
    const solvable = perTurn.filter((r) => r.path);
    return {
      solvable: solvable.length > 0,
      solvableTurns: solvable.map((r) => r.turns),
      /** True if some rotations work and some do not — i.e. rotation matters. */
      requiresRotation: solvable.length > 0 && solvable.length < 4,
      perTurn,
    };
  }
}
