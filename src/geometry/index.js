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
