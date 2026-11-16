import { readFileSync } from "node:fs";
import { equalizeAdapthistRGB } from "./img.js";
function readNpy64(path) {
  const b = readFileSync(path);
  const v = b[6];
  let o, n;
  if (v === 1) { const hl = b.readUInt16LE(8); o = 10 + hl; }
  else { const hl = b.readUInt32LE(8); o = 12 + hl; }
  const header = b.toString("ascii", v === 1 ? 10 : 12, o);
  const shape = header.split("(")[1].split(")")[0].split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
  n = shape.reduce((x, y) => x * y, 1);
  return { shape, data: new Float64Array(b.buffer, b.byteOffset + o, n) };
}
const raw = readFileSync("./tmp/c320.rgb");
const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
const t0 = Date.now();
const t = equalizeAdapthistRGB(rgb, 320, 320, 0.01);
console.log("ms", Date.now() - t0);
const r = readNpy64("./tmp/clahe_ref.npy");
let mx = 0;
for (let i = 0; i < t.length; i++) { const d = Math.abs(t[i] - r.data[i]); if (d > mx) mx = d; }
console.log("maxdiff", mx);
