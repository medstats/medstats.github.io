import { readFileSync } from "node:fs";
import { segformerTensor } from "./preprocess.js";
function readNpy(path) {
  const b = readFileSync(path);
  const hl = b.readUInt16LE(8);
  const o = 10 + hl;
  const header = b.toString("ascii", 10, o);
  const shape = header.split("(")[1].split(")")[0].split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
  const n = shape.reduce((x, y) => x * y, 1);
  return { shape, data: new Float32Array(b.buffer, b.byteOffset + o, n) };
}
const raw = readFileSync("./tmp/p001.rgb");
const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
const t = segformerTensor(rgb, 3000, 3000);
const r = readNpy("./tmp/seg_ref.npy");
let nbig = 0, mx = 0, mi = 0;
for (let i = 0; i < t.length; i++) { const d = Math.abs(t[i] - r.data[i]); if (d > mx) { mx = d; mi = i; } if (d > 0.05) nbig++; }
const c = (mi / (512 * 512)) | 0, y = ((mi - c * 512 * 512) / 512) | 0, x = mi % 512;
console.log("big", nbig, "max", mx, "at ch", c, "y", y, "x", x, "js", t[mi], "ref", r.data[mi]);
