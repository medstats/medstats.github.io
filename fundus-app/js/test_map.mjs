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
function rz(g, h, w, H, W, mapFn) {
  const out = new Float32Array(H * W);
  const sy = h / H, sx = w / W;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = mapFn(x, y, sx, sy);
    const y0 = Math.floor(c.iy), fy = c.iy - y0, x0 = Math.floor(c.ix), fx = c.ix - x0;
    let s = 0;
    for (let j = -1; j <= 2; j++) {
      const wy = cubicKeys(Math.abs(j - fy));
      const yy = Math.max(0, Math.min(h - 1, y0 + j));
      for (let i = -1; i <= 2; i++) {
        const xx = Math.max(0, Math.min(w - 1, x0 + i));
        s += g[yy * w + xx] * cubicKeys(Math.abs(i - fx)) * wy;
      }
    }
    out[y * W + x] = s < 0 ? 0 : (s > 255 ? 255 : s);
  }
  return out;
}
const g = new Float32Array(90 * 80);
for (let i = 0; i < 90 * 80; i++) g[i] = inp[i * 3];
const maps = {
  center: (x, y, sx, sy) => ({ ix: (x + 0.5) * sx - 0.5, iy: (y + 0.5) * sy - 0.5 }),
  corner: (x, y, sx, sy) => ({ ix: x * sx + (sx - 1) / 2, iy: y * sy + (sy - 1) / 2 }),
  half: (x, y, sx, sy) => ({ ix: (x + 0.5) * sx - 0.5 * sx, iy: (y + 0.5) * sy - 0.5 * sy })
};
for (const [n, m] of Object.entries(maps)) {
  const o = rz(g, 90, 80, 103, 92, m);
  let mx = 0;
  for (let i = 0; i < 103 * 92; i++) { const d = Math.abs(o[i] - ref[i * 3]); if (d > mx) mx = d; }
  console.log(n, mx.toFixed(2));
}
