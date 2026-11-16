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
const inp = rawF32("./tmp/in1d.raw");
const ref = rawU8("./tmp/ref1d.raw");
const g = new Float32Array(80);
for (let i = 0; i < 80; i++) g[i] = inp[i * 3];
const o = bicubicGray(g, 1, 80, 1, 92, -0.5);
let mx = 0, mi = 0;
for (let i = 0; i < 92; i++) { const d = Math.abs(o[i] - ref[i * 3]); if (d > mx) { mx = d; mi = i; } }
console.log("1d maxdiff", mx.toFixed(2), "at", mi, "mine", o[mi].toFixed(1), "ref", ref[mi * 3]);
let row = [];
for (let i = Math.max(0, mi - 3); i < Math.min(92, mi + 4); i++) row.push(ref[i * 3] + "/" + o[i].toFixed(0));
console.log(row.join(" "));
