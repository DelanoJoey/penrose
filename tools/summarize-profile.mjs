#!/usr/bin/env node
/**
 * MEASUREMENT ONLY — reads a profile.mjs JSON blob on stdin and prints the
 * fields ARCHITECTURE.md §6 asks to be reported. Affects no rendered output.
 */
let s = '';
process.stdin.on('data', (d) => (s += d));
process.stdin.on('end', () => {
  const j = JSON.parse(s);
  console.log(JSON.stringify({
    megapixels: j.internal.megapixels,
    bootMs: j.bootMs,
    frameTimeMs: j.frameTimeMs,
    fps: j.fps,
    hitchCount: j.hitchCount,
    programs: j.programs,
    drawCalls: j.drawCalls,
    heapMb: j.heapMb,
    errors: j.errors,
  }));
});
