import { readFileSync } from "node:fs";
import { r2v2Tensor, r2v2Finish } from "./preprocess.js";
function readNpy(path) {
  const b = readFileSync(path);
  const v = b[6];
  let o;
  if (v === 1) o = 10 + b.readUInt16LE(8);
  else o = 12 + b.readUInt32LE(8);
  const header = b.toString("ascii", v === 1 ? 10 : 12, o);
  const shape = header.split("(")[1].split(")")[0].split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
  const n = shape.reduce((x, y) => x * y, 1);
  return { shape, data: new Float32Array(b.buffer, b.byteOffset + o, n) };
}
const raw = readFileSync("./tmp/p001.rgb");
const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
const t0 = Date.now();
const a = r2v2Tensor(rgb, 3000, 3000);
const r = r2v2Finish(a.zoom, a.mask, a.small, a.nh, 1408);
console.log("ms", Date.now() - t0, "shape 6x" + r.h + "x" + r.w);
const ref = readNpy("./tmp/r2_ref.npy");
console.log("ref shape", ref.shape.join("x"));
let mx = 0;
for (let i = 0; i < r.tensor.length; i++) { const d = Math.abs(r.tensor[i] - ref.data[i]); if (d > mx) mx = d; }
console.log("maxdiff", mx);
