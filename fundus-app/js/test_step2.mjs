import { readFileSync } from "node:fs";
import { bilinearGray } from "./img.js";
const N = 586, M = 100;
const a = new Float32Array(N * N);
for (let y = 0; y < N; y++) for (let x = N >> 1; x < N; x++) a[y * N + x] = 255;
const o = bilinearGray(a, N, N, M, M);
const b = readFileSync("./tmp/step586_ref.npy");
const hl = b.readUInt16LE(8);
const ref = new Uint8Array(b.buffer, b.byteOffset + 10 + hl, M * M);
let mx = 0;
for (let i = 0; i < M * M; i++) { const d = Math.abs(o[i] - ref[i]); if (d > mx) mx = d; }
console.log("maxdiff", mx);
let r1 = [], r2 = [];
for (let x = 45; x < 55; x++) { r1.push(Math.round(o[50 * M + x])); r2.push(ref[50 * M + x]); }
console.log("mine", r1.join(" "));
console.log("ref ", r2.join(" "));
