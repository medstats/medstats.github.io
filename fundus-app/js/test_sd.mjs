import { readFileSync } from "node:fs";
import { segformerTensor, drTensor } from "./preprocess.js";
function readNpy(path) {
  const b = readFileSync(path);
  const hl = b.readUInt16LE(6 + 2);
  const o = 6 + 2 + 2 + hl;
  const header = b.toString("ascii", 6 + 2 + 2, o);
  const shape = header.split("(")[1].split(")")[0].split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
  const n = shape.reduce((x, y) => x * y, 1);
  return { shape, data: new Float32Array(b.buffer, b.byteOffset + o, n) };
}
const raw = readFileSync("./tmp/p001.rgb");
const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
for (const [name, fn, ref] of [["seg", () => segformerTensor(rgb, 3000, 3000), "./tmp/seg_ref.npy"], ["dr", () => drTensor(rgb, 3000, 3000), "./tmp/dr_ref.npy"]]) {
  const t0 = Date.now();
  const t = fn();
  const r = readNpy(ref);
  let mx = 0;
  for (let i = 0; i < t.length; i++) { const d = Math.abs(t[i] - r.data[i]); if (d > mx) mx = d; }
  console.log(name, "maxdiff", mx, "ms", Date.now() - t0);
}
