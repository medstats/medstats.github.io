import { readFileSync, writeFileSync } from "node:fs";
import { automorphTensor, segformerTensor } from "./preprocess.js";
const raw = readFileSync("./tmp/p001.rgb");
const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
const am = automorphTensor(rgb, 3000, 3000);
writeFileSync("./tmp/js_am.raw", Buffer.from(am.tensor.buffer));
const sg = segformerTensor(rgb, 3000, 3000);
writeFileSync("./tmp/js_sg.raw", Buffer.from(sg.buffer));
console.log("dumped");
