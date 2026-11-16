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
for (let y = 470; y < 480; y++) {
  let a = [], b2 = [];
  for (let x = 160; x < 170; x++) { a.push(t[y * 512 + x].toFixed(2)); b2.push(r.data[y * 512 + x].toFixed(2)); }
  console.log("y" + y, "js", a.join(" "));
  console.log("y" + y, "rf", b2.join(" "));
}
