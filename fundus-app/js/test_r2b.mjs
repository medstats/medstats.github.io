import { readFileSync } from "node:fs";
import { r2v2Tensor } from "./preprocess.js";
import { equalizeAdapthistRGB } from "./img.js";
function readNpy(path, F) {
  const b = readFileSync(path);
  const v = b[6];
  let o;
  if (v === 1) o = 10 + b.readUInt16LE(8);
  else o = 12 + b.readUInt32LE(8);
  const header = b.toString("ascii", v === 1 ? 10 : 12, o);
  const shape = header.split("(")[1].split(")")[0].split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
  const n = shape.reduce((x, y) => x * y, 1);
  return { shape, data: new F(b.buffer, b.byteOffset + o, n) };
}
const raw = readFileSync("./tmp/p001.rgb");
const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
const a = r2v2Tensor(rgb, 3000, 3000);
const rs = readNpy("./tmp/r2_small.npy", Float32Array);
let mx = 0;
for (let i = 0; i < a.small.length; i++) { const d = Math.abs(a.small[i] / 255 - rs.data[i]); if (d > mx) mx = d; }
console.log("small maxdiff", mx);
const rm = readNpy("./tmp/r2_mask.npy", Float32Array);
let mg = 0;
for (let i = 0; i < a.mask.length; i++) if (a.mask[i] !== rm.data[i]) mg++;
console.log("mask disagree", mg, "of", a.mask.length);
