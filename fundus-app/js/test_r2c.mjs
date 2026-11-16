import { readFileSync } from "node:fs";
import { r2v2Tensor } from "./preprocess.js";
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
console.log("mine[0..5]", Array.from(a.small.slice(0, 6)).map(v => v.toFixed(1)).join(" "));
console.log("ref [0..5]", Array.from(rs.data.slice(0, 6)).map(v => v.toFixed(3)).join(" "));
const W = 1408;
let mx = 0, mi = 0;
for (let i = 0; i < 1408 * 1408 * 3; i += 3) {
  const d = Math.abs(a.small[i] / 255 - rs.data[i]);
  if (d > mx) { mx = d; mi = i / 3; }
}
const my = (mi / W) | 0, mx2 = mi % W;
console.log("worst at y", my, "x", mx2, "mine", (a.small[mi * 3] / 255).toFixed(3), "ref", rs.data[mi * 3].toFixed(3));
