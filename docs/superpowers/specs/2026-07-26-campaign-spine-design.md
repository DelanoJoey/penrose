# The campaign spine — making it a game you can play through

**2026-07-26** · branch `feat/campaign-spine` off `main` @ `d45db28`

## What is actually missing

The mechanic is proven and gated. What is missing is everything between one level and
the next.

| gap | today |
|---|---|
| you cannot reach level 2 from level 1 | `?level=` URL param is the only route |
| three real puzzles | plus a one-move demo and a two-cell fixture |
| one figure | four of five levels are tribars |
| nothing teaches the controls | no onboarding of any kind |
| solving the last level does nothing | `level/solved` fires into a HUD badge |
| refresh loses everything | no persistence anywhere in `src/` |

This spec covers **only the spine** — the first two rows. Content and finish are P8/P9.

## The blocker, precisely

`src/world/index.js:42–51` resolves the level from boot config and sizes the
`InstancedMesh` to `level.cells.length * IMPRESSIONS` at `init`. **There is no runtime
level switch**, and this was scoped out of P5 deliberately.

The blast radius of adding one is smaller than it looks, because the event already
exists and the other subsystems already handle it correctly:

- `src/player` listens to `level/loaded` and resets cell, moves, rotations, solved,
  its derived caches, and any in-flight move.
- `src/render` listens to `level/loaded` and cancels any in-flight transition.

So a correct `loadLevel` is: rebuild the mesh, reset rotation, re-emit `level/loaded`.
Nothing else needs to know.

## 1. `world.loadLevel(name)`

Disposes the existing `InstancedMesh` geometry and material, removes it from the scene,
rebuilds at the new cell count, resets `turns` to 0, updates `ctx.engine.level` and
`ctx.engine.structure`, and emits `level/loaded`.

Rebuilding rather than sizing to a global maximum is the right trade here: a level change
happens once per completed puzzle, never per frame, and a max-sized buffer would make
every level pay for the largest one in instance count and in `instanceColor` upload.

## 2. A `campaign` subsystem, driven by request events

Progression does **not** live in `world` (which owns geometry, not sequencing) and not in
`player` (which owns traversal). It is its own subsystem that listens for `level/solved`
and emits a request:

```
level/solved  →  campaign  →  level/load-request { name }  →  world.loadLevel
```

This mirrors the existing `world/rotate-request` contract (`src/render/index.js:724`),
where `src/ui` asks for a rotation and `src/render` decides how to serve it. Using the
same shape means no new architectural concept, and it keeps `ARCHITECTURE.md` §3.3
intact — subsystems still do not import one another.

`src/world/levels.js` gains an exported **ORDER**, separate from the `LEVELS` map:

```js
export const ORDER = ['spur-01', 'span-02', 'shelf-03'];
```

`LEVELS` stays the complete registry, so `probe-01` and any future fixture remain
reachable by `?level=` without appearing in the campaign. A level in `ORDER` that is not
in `LEVELS` is a build error, asserted by test.

Solving the last level in `ORDER` sets a **complete** state rather than wrapping.

## 3. Progression is inert under `config.capture`

**This is the most consequential decision in the spec and it is a genuine trade.**

Progression adds a path that advances state in response to an event. That is exactly the
shape that makes captures nondeterministic, and the pixel gate is this project's actual
artifact — `README` says so: *the harness is the artifact; the game proves it works.*

So `campaign` does nothing when `ctx.config.capture` is true, with a test asserting the
inertness. A shot can therefore never trip a level change mid-capture.

**The honest cost:** the progression path is then not pixel-gated at all. It is covered by
unit tests only. That is the same class of gap P6 just closed for motion, reopened
deliberately somewhere else — and it is the right call only because the alternative risks
the gate itself.

There is a real argument for the opposite choice: today's motion shot `stepmid` calls
`player.step()`, and if a future motion shot ever stepped **onto a goal**, it would solve
a level and — without this guard — trigger a load mid-capture. The guard removes a whole
class of future foot-gun, not just a present one.

## 4. Onboarding, and why it lands in its own commit

Level 1 must teach two things without prose: arrows/WASD move, Q/E turn. The minimum is a
per-level `hint` string rendered in the HUD.

**Hints render in capture mode, deliberately.** The gate is a *self-consistency* check —
it captures twice on the same machine and compares the two. A hint changes both captures
identically, so the gate stays green and the hint gets covered. What a hint does break is
the **manual before/after discipline** used throughout P5 and P6 to prove a harness change
moved nothing.

So the sequencing rule for this branch: **every non-visual change lands and is proven
pixel-neutral first; the hint lands afterwards as an expected, reviewed visual change.**
Mixing them would forfeit the ability to attribute a pixel shift.

## 5. `loop-01` is the wrong level 1

`loop-01` is `DEFAULT_LEVEL` and is solvable in **one move with zero turns** — measured in
P5. As the opening level of a game it teaches nothing and wins itself.

It stays in `LEVELS` as the pure figure, and stays `DEFAULT_LEVEL` so all 15 existing shots
are untouched, but it does **not** open the campaign. `ORDER` starts at the level that
actually teaches walking.

## 6. Explicitly not in this phase

- Persistence (P9). Refresh restarts the campaign; that is acceptable for a spine.
- Level select (rejected — linear auto-advance was chosen).
- The second figure family and the 8–12 level curve (P8).
- Any ending beyond a `complete` state.

## 7. Verification

| check | bar |
|---|---|
| `npm test` | 0 failures, full suite, no path scope |
| campaign inertness under capture | asserted by test |
| `ORDER` ⊆ `LEVELS` | asserted by test |
| `loadLevel` disposes and rebuilds | asserted by test, including no instance-count leak |
| `npm run gate` | `identical: true` across 15 shots |
| existing 15 references, before the hint lands | `maxDelta: 0` |
| played end to end by a human | solve every level in `ORDER`, reach `complete` |

The last row is the one that matters and no test replaces it. Three times in this
repository a change has passed every automated check and been wrong in a way only looking
could catch — the black `vertexColors` material, three visually-meaningless levels, and an
orbit shot with a third of its subject out of frame.

## Risks

1. **Progression threatens the gate.** Mitigated by capture-inertness plus a test, at the
   cost of leaving that path un-gated.
2. **`loadLevel` must not leak GPU resources.** A level change that disposes nothing would
   grow `geometries`/`textures` per transition; `render.info()` already reports both, so
   the test can assert it directly.
3. **The hint is a visual change.** Sequenced last, deliberately.
