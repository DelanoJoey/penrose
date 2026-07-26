#!/usr/bin/env node
/** MEASUREMENT ONLY — crop a region of a PNG at 1:1 so detail can be eyeballed. */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const a = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = s.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [s, true];
}));
const src = PNG.sync.read(readFileSync(a.in));
const x0 = Number(a.x ?? 0), y0 = Number(a.y ?? 0);
const w = Math.min(Number(a.w ?? 400), src.width - x0);
const h = Math.min(Number(a.h ?? 300), src.height - y0);
const out = new PNG({ width: w, height: h });
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const s = ((y0 + y) * src.width + (x0 + x)) * 4;
    const d = (y * w + x) * 4;
    out.data[d] = src.data[s];
    out.data[d + 1] = src.data[s + 1];
    out.data[d + 2] = src.data[s + 2];
    out.data[d + 3] = 255;
  }
}
writeFileSync(a.out, PNG.sync.write(out));
console.log(`${a.out} ${w}x${h} from ${x0},${y0}`);
