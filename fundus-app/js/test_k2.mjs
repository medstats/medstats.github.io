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
let bi = 0, bd = 0;
for (let i = 0; i < 103 * 92; i++) { const d = Math.abs(o[i] - ref[i * 3]); if (d > bd) { bd = d; bi = i; } }
const y = (bi / 92) | 0, x = bi % 92;
console.log("worst y", y, "x", x, "mine", o[bi].toFixed(1), "ref", ref[bi * 3]);
const iy = (y + 0.5) * 90 / 103, ix = (x + 0.5) * 80 / 92;
console.log("center", iy.toFixed(3), ix.toFixed(3));
for (let j = -1; j <= 2; j++) {
  let row = [];
  for (let i = -1; i <= 2; i++) row.push(Math.round(g[(Math.floor(iy) + j) * 80 + (Math.floor(ix) + i)]));
  console.log(row.join(" "));
}
