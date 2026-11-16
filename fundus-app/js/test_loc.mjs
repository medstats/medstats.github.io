import { readFileSync } from "node:fs";
import { automorphTensor } from "./preprocess.js";
function readNpy(path) {
  const b = readFileSync(path);
  const hl = b.readUInt16LE(8);
  const header = b.toString("ascii", 10, 10 + hl);
  const shape = header.split("(")[1].split(")")[0].split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
  const n = shape.reduce((x, y) => x * y, 1);
  return { shape, data: new Float32Array(b.buffer, b.byteOffset + 10 + hl, n) };
}
const raw = readFileSync("./tmp/p001.rgb");
const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
const { tensor } = automorphTensor(rgb, 3000, 3000);
const ref = readNpy("./tmp/am_ref_tensor.npy");
let nbig = 0;
const ys = {};
for (let c = 0; c < 3; c++) for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
  const i = c * 512 * 512 + y * 512 + x;
  if (Math.abs(tensor[i] - ref.data[i]) > 0.02) { nbig++; const k = (y / 64 | 0) + "x" + (x / 64 | 0); ys[k] = (ys[k] || 0) + 1; }
}
console.log("big", nbig, "of", tensor.length);
console.log(JSON.stringify(ys));
