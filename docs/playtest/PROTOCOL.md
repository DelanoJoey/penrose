# Play-test protocol

Versioned with the repository so a second session is comparable to the first.

**Why this exists.** Every significant defect in this project was caught by
looking, and the one that mattered most was caught by *somebody else* looking.
P17 records it: a pixel gate, a determinism gate, an adversarial pairwise panel,
a competence control, a four-model rubric panel and a variance ladder, and all
of it missed the fact that a player could not tell what the game was. Thirty
seconds of somebody playing found it.

P18, P19 and P20 were all written against that one observation. **None of them
has been in front of a player.**

---

## 1. What is on trial

Written before the session, with the observation that falsifies each. Deciding
this afterwards is how a session becomes a story about what you already
believed.

| | hypothesis | falsified by |
|---|---|---|
| **H1** | `teach-00` makes *screen-adjacent means walkable* inferable without being told | the player does not cross the gap within 5 minutes, **or** crosses it without registering that anything unusual happened |
| **H2** | the move budget fires on wandering, not on confusion | the player runs out of moves while making sense of the level, or reads the loss as arbitrary |
| **H3** | the curve `0,0,1,2,3,4,5,6` reads as a curve | difficulty is reported as flat, or a later level is called easier than an earlier one |
| **H4** | it reads as a game rather than a demo | recorded verbally. No numeric threshold, and that is stated rather than hidden |

**H1 is the only one that needs a fresh player**, and it is the reason the
session is worth running at all. Someone who already knows the rule cannot
un-know it. H2 and H3 can be tested on anyone.

## 2. Who

A player who has **never seen this game**, in person, on a local dev server.

Not the person who built it. Not the person who played it before P18 — they
know the rule now, so H1 is untestable on them, though H2 and H3 are not.

## 3. Procedure

1. **Fresh page at `?trace=1`.** Call `__TRACE__.clear()` in the console — this
   is what begins a session; the recorder continues whatever is already in the
   store. Confirm `typeof __TRACE__.dump === 'function'` before handing over.

2. **The opening line is scripted**, and it is the only thing you say:

   > *"This is a small game. Have a go. Say what you're thinking if you can."*

   **Do not say, or hint at, any of:** adjacent, adjacency, connected, illusion,
   impossible, Escher, Penrose, the goal marker, rotate, turn, the arrow keys,
   or what the green thing is. Every one of those gives away a hypothesis under
   test. If you find yourself about to explain, that impulse is the finding.

3. **No questions are answered during play.** A question is data. Write it down
   with the wall-clock time so it can be aligned against the trace afterwards.
   "What am I supposed to do" at 0:40 and the same question at 6:00 mean
   different things.

4. **Reloading the page is allowed and is not interference.** P17 records it as
   the only escape from a bad position. A player reaching for it is a finding,
   and the trace survives it — each page load leaves a `boot` entry.

5. **Stop** at `campaign/complete`, or at 15 minutes, whichever comes first.
   Record which, and record it *before* asking anything.

6. **Call `__TRACE__.save()`** to write the file. Do this **before** the
   post-play questions, so nothing depends on the tab surviving the
   conversation.

7. **Then** ask the post-play questions in §4.

## 4. Post-play questions

Fixed, asked in this order, after the trace is saved.

1. What was the game asking you to do?
2. Was there a moment something clicked? What was it?
3. Did anything look wrong, or like a bug?
4. Did you ever feel stuck? What did you do about it?
5. *(if they lost a level)* Why do you think that happened? Was it fair?
6. Which level was hardest? Which was easiest?
7. Would you play more of it? What would you want more of?

Q1 bears on H1 and Q1 alone — if the answer does not describe crossing between
things that are not touching, H1 is in trouble regardless of whether they
finished. Q5 bears on H2, Q6 on H3, Q7 on H4.

## 5. Output

```
~/claude/projects/penrose/PLAYTEST-<YYYY-MM-DD>-<nn>.json      the trace
~/claude/projects/penrose/PLAYTEST-<YYYY-MM-DD>-<nn>-notes.md  observations
```

The notes mark each hypothesis in §1 held or falsified, and name the trace entry
that decides it.

**A hypothesis with no entry bearing on it is recorded as *untested*, not as
held.** A session that ran and produced no evidence about H2 has not confirmed
H2.

## 6. Reading the trace

Entries are `{seq, frame, t, kind, name, payload}`, ordered by `seq`, which is
monotonic across page reloads. `frame` and `t` both reset with the page — a
`kind: 'boot'` entry marks where each load begins.

`kind: 'key'` is a raw keydown, recorded before the engine events it causes.
It is **not** classified as a move or a rotation: interpretation happens here,
not in the recorder.

Three patterns worth looking for:

- **A key with no event after it.** The player pressed something and the game
  did nothing at all — not even a blocked-move sound. This is the state that
  produced "I cant do anything but bounce around", and it is invisible to
  anything except this recorder. Confirmed reachable: four presses during the
  post-loss retry window produce four `key` entries and zero events.
- **`player/blocked` runs.** A player probing every direction from one cell.
  Cheap for them — blocked keys cost no moves — but it means the legend is not
  being read.
- **Long gaps in `t` with no entries.** Thinking, or being stuck, or having
  stopped. The verbal notes are what tell those apart, which is why §3 step 3
  timestamps the questions.
