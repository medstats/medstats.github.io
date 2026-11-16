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
const a = new Float32Array(81);
a[4 * 9 + 4] = 1;
const t = gaussianGray(a, 9, 9, 0.5653, 0.5653);
const r = readNpy64("./tmp/g_imp.npy");
for (let y = 3; y < 6; y++) {
  let s1 = [], s2 = [];
  for (let x = 3; x < 6; x++) { s1.push(t[y * 9 + x].toFixed(4)); s2.push(r.data[y * 9 + x].toFixed(4)); }
  console.log("js", s1.join(" "), "| py", s2.join(" "));
}
