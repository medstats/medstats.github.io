import { readFileSync } from "node:fs";
import { automorphTensor } from "./preprocess.js";
function readNpy(path) {
  const b = readFileSync(path);
  let o = 0;
  const magic = b.toString("ascii", 0, 6); o = 6;
  const ver = [b[o], b[o + 1]]; o += 2;
  const hl = b.readUInt16LE(o); o += 2;
  const header = b.toString("ascii", o, o + hl); o += hl;
  const shape = header.split("(")[1].split(")")[0].split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
  const n = shape.reduce((x, y) => x * y, 1);
  return { shape, data: new Float32Array(b.buffer, b.byteOffset + o, n) };
}
const W = 3000, H = 3000;
const raw = readFileSync("./tmp/p001.rgb");
const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
const t0 = Date.now();
const { tensor, side } = automorphTensor(rgb, H, W);
console.log("side", side, "ms", Date.now() - t0);
const ref = readNpy("./tmp/am_ref_tensor.npy");
let mx = 0, se = 0;
for (let i = 0; i < tensor.length; i++) { const d = Math.abs(tensor[i] - ref.data[i]); if (d > mx) mx = d; se += d * d; }
console.log("maxdiff", mx, "rmse", Math.sqrt(se / tensor.length));
