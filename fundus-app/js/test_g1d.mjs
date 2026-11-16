import { readFileSync } from "node:fs";
import { gaussianGray } from "./img.js";
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
const a = readNpy64("./tmp/g1d_in.npy");
const g = new Float32Array(a.data);
const t = gaussianGray(g, 1, 15, 0.001, 0.5653);
console.log(Array.from(t).map(v => v.toFixed(6)).join(" "));
