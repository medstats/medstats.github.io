import { readFileSync } from "node:fs";
import { bicubicGray } from "./img.js";
function loadNpy(path, F) {
  const b = readFileSync(path);
  const v = b[6];
  let o;
  if (v === 1) o = 10 + b.readUInt16LE(8);
  else o = 12 + b.readUInt32LE(8);
  const n = 36 * 36;
  return new F(b.buffer, b.byteOffset + o, n);
}
const g = new Float32Array(32 * 32);
g[16 * 32 + 16] = 255;
const o = bicubicGray(g, 32, 32, 36, 36, -0.5);
const r = loadNpy("./tmp/imp_ref.npy", Uint8Array);
let mx = 0;
for (let i = 0; i < 36 * 36; i++) { const d = Math.abs(o[i] - r[i]); if (d > mx) mx = d; }
console.log("impulse maxdiff", mx);
for (let y = 17; y < 20; y++) {
  let s1 = [], s2 = [];
  for (let x = 17; x < 20; x++) { s1.push(o[y * 36 + x].toFixed(1)); s2.push(r[y * 36 + x]); }
  console.log("mine", s1.join(" "), "| py", s2.join(" "));
}
