import { readFileSync } from "node:fs";
import { bicubicGray } from "./img.js";
function loadF32(path) {
  const b = readFileSync(path);
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}
function loadU8(path) {
  const b = readFileSync(path);
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}
const inp = loadF32("./tmp/zoom_in.raw");
const ref = loadU8("./tmp/zoom_ref_dump.raw");
const g = new Float32Array(90 * 80);
for (let i = 0; i < 90 * 80; i++) g[i] = inp[i * 3];
const o = bicubicGray(g, 90, 80, 103, 92, -0.5);
const pos = {};
for (let i = 0; i < 103 * 92; i++) {
  if (Math.abs(o[i] - ref[i * 3]) > 3) {
    const y = (i / 92) | 0, x = i % 92;
    const k = (y / 26 | 0) + "x" + (x / 23 | 0);
    pos[k] = (pos[k] || 0) + 1;
  }
}
console.log(JSON.stringify(pos));
