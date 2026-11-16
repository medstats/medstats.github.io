import { readFileSync, writeFileSync } from "node:fs";
import { bicubicGray } from "./img.js";
const MEAN = [0.31561512, 0.20948674, 0.16498742], STD = [0.13639495, 0.08581575, 0.08441529];
for (const fn of ["p001_r", "p034_l", "p067_r", "p099_l"]) {
  const raw = readFileSync("./tmp/" + fn + ".rgb");
  const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
  const h = 3000, w = 3000;
  const t = new Float32Array(3 * 224 * 224);
  for (let c = 0; c < 3; c++) {
    const g = new Float32Array(h * w);
    for (let i = 0; i < h * w; i++) g[i] = rgb[i * 3 + c];
    const r = bicubicGray(g, h, w, 256, 256, -0.5);
    for (let y = 0; y < 224; y++) for (let x = 0; x < 224; x++)
      t[c * 224 * 224 + y * 224 + x] = (r[(y + 16) * 256 + (x + 16)] / 255 - MEAN[c]) / STD[c];
  }
  writeFileSync("./tmp/js_" + fn + ".raw", Buffer.from(t.buffer));
}
console.log("dumped4");
