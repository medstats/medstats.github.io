import { readFileSync } from "node:fs";
import { bicubicGray } from "./img.js";
function rawF32(path) {
  const b = readFileSync(path);
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}
function rawU8(path) {
  const b = readFileSync(path);
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}
const inp = rawF32("./tmp/vin.raw");
const ref = rawU8("./tmp/vref_dump.raw");
const g = new Float32Array(90 * 80);
for (let i = 0; i < 90 * 80; i++) g[i] = inp[i * 3];
const o = bicubicGray(g, 90, 80, 103, 80, -0.5);
let mx = 0;
for (let i = 0; i < 103 * 80; i++) { const d = Math.abs(o[i] - ref[i * 3]); if (d > mx) mx = d; }
console.log("vertical-only maxdiff", mx.toFixed(2));
