import { readFileSync, writeFileSync } from "node:fs";
import { r2v2Tensor, r2v2Finish } from "./preprocess.js";
const raw = readFileSync("./tmp/p001.rgb");
const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
const a = r2v2Tensor(rgb, 3000, 3000);
const r = r2v2Finish(a.zoom, a.mask, a.small, a.nh, 1408);
writeFileSync("./tmp/js_r2.raw", Buffer.from(r.tensor.buffer));
console.log("dumped", r.tensor.length);
