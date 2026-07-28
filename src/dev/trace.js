/**
 * Play-session recorder. Off unless `?trace=1`.
 *
 * WHY THIS EXISTS. P18, P19 and P20 each shipped against a single observation
 * of one person playing, and the whole of that observation was a sentence: "I
 * dont know, I cant do anything but bounce around." None of the three fixes has
 * been in front of a player since. This subsystem is the difference between the
 * next session producing another sentence and producing something a later phase
 * can argue with.
 *
 * WHY IT LISTENS FOR KEYS AND NOT ONLY FOR EVENTS. src/ui dispatches a movement
 * key by calling `player.step()` directly (src/ui/index.js), not by emitting,
 * and `step()` has two paths that emit nothing at all: it returns early while
 * the level is lost -- the entire 72-frame window before the retry lands -- and
 * it skips `player/blocked` when no level is loaded. An events-only recorder is
 * therefore blind in exactly the two moments worth understanding, and a player
 * mashing keys during a reload would produce a trace showing that nothing
 * happened. The raw key is recorded and NOT classified: `resolveKey` stays in
 * src/ui, and interpretation happens offline. A trace is a record, not an
 * interpreter -- which also keeps this file from needing a dev -> ui import.
 *
 * WALL CLOCK. `now()` is a `performance.now()` pair and this is the only
 * wall-clock read in the subsystem. ARCHITECTURE.md §1.2 permits pure
 * instrumentation to do that and requires the file be named: it is this one.
 * Nothing here feeds rendered output, and init() returns before attaching
 * anything in capture or lockstep, where §4's rule about paths that advance
 * state outside __PUMP__ applies.
 *
 * FAILURE ISOLATION. Engine._emit has no try/catch, so one throwing listener
 * aborts every listener registered after it. Nine subscriptions during the one
 * session this exists to run is nine chances to take the game down with a
 * quota error, so the handler swallows everything and drops entries instead.
 * That is a workaround for open item B3, and it is also the fresh argument B3
 * has been waiting for: the engine's failure isolation is currently supplied by
 * convention among listeners, and every listener added is a place that
 * convention can lapse.
 *
 * SESSIONS. The recorder continues whatever is already in the store, so a
 * reload accumulates into one session rather than starting a new one -- which
 * is what a play-test wants, since the protocol treats reaching for reload as a
 * finding rather than an interruption. `clear()` is what begins a session. That
 * rule needs neither a clock nor an rng, and the recorder could not implement
 * one that did: it cannot tell a reload from a new session on its own.
 */

const PREFIX = 'penrose:trace:';
const PAD = 8;

/** Every event the project emits. ARCHITECTURE §3.3, plus level/failed (P19). */
const EVENTS = [
  'player/moved',
  'player/blocked',
  'world/rotate-request',
  'world/rotated',
  'level/load-request',
  'level/loaded',
  'level/solved',
  'level/failed',
  'campaign/complete',
];

export function createTrace({
  store = globalThis.localStorage,
  target = globalThis,
  now = () => performance.now(),
} = {}) {
  let seq = 0;
  let t0 = 0;
  let ctx = null;
  let onKeyDown = null;

  const keys = () => {
    const out = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(PREFIX)) out.push(k);
    }
    return out.sort();
  };

  /**
   * O(1) per entry. Serialising a growing array on every entry is O(n^2), and
   * the reload that P17 documents as the only escape from a bad position is
   * exactly the event that would otherwise destroy the session.
   */
  const write = (kind, name, payload) => {
    try {
      const entry = {
        seq,
        frame: ctx?.time?.frame ?? 0,
        t: Math.round(now() - t0),
        kind,
        name,
        payload,
      };
      store.setItem(PREFIX + String(seq).padStart(PAD, '0'), JSON.stringify(entry));
      seq += 1;
    } catch {
      // Dropped deliberately. See FAILURE ISOLATION above.
    }
  };

  return {
    name: 'trace',

    init(c) {
      ctx = c;
      // Same rule as src/ui: no input path and no side effects in capture or
      // lockstep, independently of any other flag.
      if (c.config.capture || c.config.lockstep) return;
      t0 = now();

      const existing = keys();
      seq = existing.length
        ? Number(existing[existing.length - 1].slice(PREFIX.length)) + 1
        : 0;

      // frame and t both reset with the page. This marks where each load
      // begins so a reader can interpret them.
      write('boot', 'trace/boot', { frameOrigin: c.time.frame });

      for (const name of EVENTS) {
        c.on(name, (payload) => { write('event', name, payload); });
      }

      onKeyDown = (event) => {
        write('key', 'keydown', {
          code: event.code,
          key: event.key,
          repeat: !!event.repeat,
          modified: !!(event.ctrlKey || event.metaKey || event.altKey),
        });
      };
      target.addEventListener('keydown', onKeyDown);
    },

    /** Every entry in the store, ordered, as JSON. */
    dump() {
      return JSON.stringify(keys().map((k) => JSON.parse(store.getItem(k))), null, 2);
    },

    /**
     * The same string as a downloaded file. Exists because the alternative is
     * asking somebody to select several thousand lines out of a devtools
     * console at the end of a session, and losing a session to a mis-click is
     * worth ten lines of code. Called explicitly; never automatic.
     */
    save(document = globalThis.document) {
      const blob = new Blob([this.dump()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'penrose-trace.json';
      a.click();
      URL.revokeObjectURL(url);
      return true;
    },

    /** Empties the store. This is what BEGINS a session -- see the protocol. */
    clear() {
      for (const k of keys()) store.removeItem(k);
      seq = 0;
    },

    dispose() {
      if (onKeyDown) target.removeEventListener('keydown', onKeyDown);
      onKeyDown = null;
    },
  };
}
