import { readFileSync } from "node:fs";
import { bicubicGray } from "./img.js";
function loadF32(path) {
  const b = readFileSync(path);
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}
function loadU8(path) {
  const b = readFileSync(path);
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}
const inp = loadF32("./tmp/smooth_in.raw");
const ref = loadU8("./tmp/smooth_ref_dump.raw");
const g = new Float32Array(90 * 80);
for (let i = 0; i < 90 * 80; i++) g[i] = inp[i];
const o = bicubicGray(g, 90, 80, 103, 92, -0.5);
let mx = 0;
for (let i = 0; i < 103 * 92; i++) { const d = Math.abs(o[i] - ref[i * 3]); if (d > mx) mx = d; }
console.log("smooth maxdiff", mx.toFixed(3));
