import { readFileSync } from "node:fs";
import { bilinearGray } from "./img.js";
function readNpy64(path) {
  const b = readFileSync(path);
  const v = b[6];
  let o;
  if (v === 1) o = 10 + b.readUInt16LE(8);
  else o = 12 + b.readUInt32LE(8);
  const header = b.toString("ascii", v === 1 ? 10 : 12, o);
  const shape = header.split("(")[1].split(")")[0].split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
  const n = shape.reduce((x, y) => x * y, 1);
  return { shape, data: new Float64Array(b.buffer, b.byteOffset + o, n) };
}
const a = readNpy64("./tmp/w_in.npy");
const r = readNpy64("./tmp/w_ref.npy");
const g = new Float32Array(a.data);
const t = bilinearGray(g, 53, 47, 31, 29);
let mx = 0;
for (let i = 0; i < t.length; i++) { const d = Math.abs(t[i] - r.data[i]); if (d > mx) mx = d; }
console.log("warp maxdiff", mx);
