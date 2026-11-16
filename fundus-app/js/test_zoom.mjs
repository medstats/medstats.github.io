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
let mx = 0;
for (let c = 0; c < 3; c++) {
  const g = new Float32Array(90 * 80);
  for (let i = 0; i < 90 * 80; i++) g[i] = inp[i * 3 + c];
  const o = bicubicGray(g, 90, 80, 103, 92, -0.5);
  for (let i = 0; i < 103 * 92; i++) { const d = Math.abs(o[i] - ref[i * 3 + c]); if (d > mx) mx = d; }
}
console.log("zoom maxdiff", mx);
