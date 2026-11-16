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
let mx = 0, mi = 0;
for (let i = 0; i < 103 * 92; i++) { const d = Math.abs(o[i] - ref[i * 3]); if (d > mx) { mx = d; mi = i; } }
const y = (mi / 92) | 0, x = mi % 92;
console.log("worst y", y, "x", x, "mine", o[mi].toFixed(2), "ref", ref[mi * 3]);
console.log("in coords", ((y + 0.5) * 90 / 103).toFixed(2), ((x + 0.5) * 80 / 92).toFixed(2));
