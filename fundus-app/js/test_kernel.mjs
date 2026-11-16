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
function kernelKeys(t, a) {
  t = Math.abs(t);
  if (t < 1) return ((a + 2) * t - (a + 3)) * t * t + 1;
  if (t < 2) return (((t - 5) * t + 8) * t - 4) * a;
  return 0;
}
function kernelMN(t, B, C) {
  t = Math.abs(t);
  if (t < 1) return ((12 - 9 * B - 6 * C) * t * t * t + (-18 + 12 * B + 6 * C) * t * t + (6 - 2 * B)) / 6;
  if (t < 2) return ((-B - 6 * C) * t * t * t + (6 * B + 30 * C) * t * t + (-12 * B - 48 * C) * t + (8 * B + 24 * C)) / 6;
  return 0;
}
function resizeWith(g, h, w, H, W, kf) {
  const out = new Float32Array(H * W);
  const sy = h / H, sx = w / W;
  for (let y = 0; y < H; y++) {
    const iy = (y + 0.5) * sy - 0.5;
    const y0 = Math.floor(iy), fy = iy - y0;
    for (let x = 0; x < W; x++) {
      const ix = (x + 0.5) * sx - 0.5;
      const x0 = Math.floor(ix), fx = ix - x0;
      let s = 0;
      for (let j = -1; j <= 2; j++) {
        const yy = Math.max(0, Math.min(h - 1, y0 + j));
        const wy = kf(Math.abs(j - fy));
        for (let i = -1; i <= 2; i++) {
          const xx = Math.max(0, Math.min(w - 1, x0 + i));
          s += g[yy * w + xx] * kf(Math.abs(i - fx)) * wy;
        }
      }
      out[y * W + x] = s < 0 ? 0 : (s > 255 ? 255 : s);
    }
  }
  return out;
}
const g = new Float32Array(90 * 80);
for (let i = 0; i < 90 * 80; i++) g[i] = inp[i * 3];
const cands = { keysNeg05: (t) => kernelKeys(t, -0.5) };
for (const [B, C] of [[1/3, 1/3], [0, 0.5], [0, 0.75], [0, 1], [0.5, 0], [1, 0]]) cands["mn" + B + "_" + C] = (t) => kernelMN(t, B, C);
for (const [n, kf] of Object.entries(cands)) {
  const o = resizeWith(g, 90, 80, 103, 92, kf);
  let mx = 0;
  for (let i = 0; i < 103 * 92; i++) { const d = Math.abs(o[i] - ref[i * 3]); if (d > mx) mx = d; }
  console.log(n, mx.toFixed(2));
}
