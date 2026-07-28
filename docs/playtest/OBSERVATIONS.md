# Play observations

A running log. Newest first. `PROTOCOL.md` is how a full session is run; this
file is where what came out of one gets recorded, including the partial and
informal ones.

---

## 2026-07-27 — the first play since P17, and it stopped at level 4

**Who:** the project owner, who built the mechanic. **Not a protocol session** —
no `?trace=1`, no scripted opening, no post-play questions. So H1 (does
`teach-00` teach screen-adjacency) is **untested**, and remains untested: the
one person who cannot answer it is the one who played.

**What happened:** cleared `teach-00`, `loop-01` and `spur-01` — reported as
"easy" — and stopped on `span-02` at **9 moves of 22, par 8**, in view 1/4.

The question asked was: *"if you hit the wrong moves are you just stuck in the
abyss, or can you make it back to solve?"*

### The answer, measured

**You cannot be stranded.** `span-02` has 12 standable cells and **zero** from
which the goal is unreachable. The furthest cell in the level is 10 walks from
the ring, against 13 moves remaining. Generally, and not just here: a wrong step
always costs exactly two walks to undo — one back, one to retake — which is the
proof recorded in §P21. Wandering costs budget, never reachability.

**That the question was asked at all is the finding.** A player nine moves into a
level, with an accurate move counter on screen, could not tell whether they had
ruined the run. The budget is legible; its *consequences* are not.

### Why it stopped, which is not difficulty

| level | par | minTurns | solvable in a standing view | forks | maxDegree | zero-move cells |
|---|---|---|---|---|---|---|
| `teach-00` | 7 | 0 | **yes** (view 1) | 0 | 2 | 0 |
| `loop-01` | 1 | 0 | **yes** (view 1) | 0 | 2 | 0 |
| `spur-01` | 7 | 1 | no | 0 | 2 | 0 |
| `span-02` | 8 | 2 | no | 0 | 2 | 1 |
| `shelf-03` | 8 | 3 | no | 0 | 2 | 0 |
| `arm-04` | 12 | 4 | no | 0 | 2 | 0 |
| `post-05` | 5 | 5 | no | **1** | 2 | 6 |
| `crook-06` | 5 | 6 | no | 0 | **3** | 3 |

"Solvable in a standing view" means: pick a rotation, then walk to the goal
without rotating again. **Two of eight levels can be played that way.** From
`spur-01` onward, no rotation of the figure lets you walk from start to goal —
the route must be interrupted, rotated mid-way, and resumed.

**The declared curve `0,0,1,2,3,4,5,6` hides a step change.** It counts turns, so
it reads as a smooth ramp. What actually happens is one hard jump at level 3,
from *walk* to *walk, rotate mid-route, walk* — and **nothing anywhere teaches
that.** `teach-00` teaches screen-adjacency and teaches it well, with a whole
level built around a single forced crossing. Interleaved rotation gets no
equivalent; it simply becomes mandatory at level 3 and stays mandatory.

This is the same shape of defect P18 closed, one level up: a rule the game rests
on, stated nowhere, that a player who owns the project did not infer. **It was
found the same way, too — by somebody playing.**

`spur-01` was cleared without the player registering that they had rotated
mid-route, which is why level 4 read as a sudden wall rather than the second
instance of something.

### What it is not

**It is not the game being challenging.** `span-02` has **0 forks**, a maximum
degree of 2, and 25 positions offering any choice at all — it is a corridor.
There is no decision in it to get wrong. The player did not lose a puzzle; they
could not find the door.

That distinction is load-bearing for what gets built next. Difficulty that comes
from an untaught mechanic is opacity, and **more levels multiply it** — six of
the eight already require the untaught skill.

### The legend was checked and is fine

The bottom-left legend did not appear in the screenshot, which looked like a
regression. It is not: queried against the live DOM at `?level=span-02`, `#hud
.keys` is present, `visibility: visible`, `opacity: 1`, at x=28 y=863, reading
`↑←↓→ MOVE   Q E ROTATE   R RESTART LEVEL`. The screenshot had cropped it.

Worth keeping anyway: it is 10px type at 62% opacity, at the bottom edge, while
everything the player is looking at is in the middle of the screen. It was
present and it was not read.

### What this changes

A rotation teaching level moves **ahead of** more content in the open items. The
argument is the same one P18 made and it now has a second instance: content
built on an unintroduced mechanic inherits the mechanic's opacity, and there are
six levels of it already.

### Still untested

H1, H2 and H4 from `PROTOCOL.md`. H3 (does the curve read as a curve) is
**falsified in part** — it does not, and the reason is not the turn counts it
declares.
