import { readFileSync } from "node:fs";
function loadF32(path) {
  const b = readFileSync(path);
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}
function loadU8(path) {
  const b = readFileSync(path);
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}
const inp = loadF32("./tmp/zoom_in.raw");
const ref = loadU8("./tmp/zoom_ref_dump.raw");
function cubicKeys(t) {
  const a = -0.5;
  t = Math.abs(t);
  if (t < 1) return ((a + 2) * t - (a + 3)) * t * t + 1;
  if (t < 2) return (((t - 5) * t + 8) * t - 4) * a;
  return 0;
}
const g = new Float32Array(90 * 80);
for (let i = 0; i < 90 * 80; i++) g[i] = inp[i * 3];
const H = 103, W = 92, h = 90, w = 80;
const sy = h / H, sx = w / W;
const mid = new Float32Array(H * w);
for (let y = 0; y < H; y++) {
  const iy = (y + 0.5) * sy - 0.5;
  const y0 = Math.floor(iy), fy = iy - y0;
  const wy = [cubicKeys(1 + fy), cubicKeys(fy), cubicKeys(1 - fy), cubicKeys(2 - fy)];
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = 0; j < 4; j++) s += g[Math.max(0, Math.min(h - 1, y0 - 1 + j)) * w + x] * wy[j];
    mid[y * w + x] = Math.max(0, Math.min(255, Math.round(s)));
  }
}
const out = new Float32Array(H * W);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ix = (x + 0.5) * sx - 0.5;
  const x0 = Math.floor(ix), fx = ix - x0;
  const wx = [cubicKeys(1 + fx), cubicKeys(fx), cubicKeys(1 - fx), cubicKeys(2 - fx)];
  let s = 0;
  for (let i = 0; i < 4; i++) s += mid[y * w + Math.max(0, Math.min(w - 1, x0 - 1 + i))] * wx[i];
  out[y * W + x] = Math.max(0, Math.min(255, Math.round(s)));
}
let mx = 0;
for (let i = 0; i < H * W; i++) { const d = Math.abs(out[i] - ref[i * 3]); if (d > mx) mx = d; }
console.log("twopass-round maxdiff", mx.toFixed(2));
