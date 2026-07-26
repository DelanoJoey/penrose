/**
 * The capture URL for one shot.
 *
 * Extracted from baseline.mjs so it can be tested: baseline.mjs spawns Vite at
 * import time, so importing it from a test would start a dev server.
 *
 * A shot with no declared level MUST produce exactly the URL this harness has
 * always produced. That is what keeps the existing reference set valid across
 * this change — see docs/superpowers/specs/2026-07-26-penrose-levels-design.md §4.
 */
export function shotUrl({ port, shot, level = null, extra = '' }) {
  let url = `http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=${encodeURIComponent(shot)}`;
  if (level != null) url += `&level=${encodeURIComponent(level)}`;
  if (extra) url += `&${extra}`;
  return url;
}
