import { readFileSync } from "node:fs";
function keys(t) {
  t = Math.abs(t);
  if (t < 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
  if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
  return 0;
}
function pilResize(g, h, w, H, W, support) {
  function pass1(src, ih, iw, oh, ow, axis) {
    const scale = (axis === 0 ? ih : iw) / (axis === 0 ? oh : ow);
    const fs = Math.max(1, scale);
    const sup = support * fs;
    const inv = 1 / fs;
    const dst = new Float64Array(oh * ow);
    const n = axis === 0 ? oh : ow;
    const N = axis === 0 ? ih : iw;
    for (let o = 0; o < n; o++) {
      const center = (o + 0.5) * scale;
      let xmin = Math.trunc(center - sup + 0.5);
      if (xmin < 0) xmin = 0;
      let xmax = Math.trunc(center + sup + 0.5);
      if (xmax > N) xmax = N;
      const cnt = xmax - xmin;
      const ks = [];
      let sum = 0;
      for (let x = 0; x < cnt; x++) { const v = keys((x + xmin - center + 0.5) * inv); ks.push(v); sum += v; }
      if (sum !== 0) for (let x = 0; x < cnt; x++) ks[x] /= sum;
      for (let i = 0; i < (axis === 0 ? ow : oh); i++) {
        let s = 0;
        for (let x = 0; x < cnt; x++) {
          const v = axis === 0 ? src[(xmin + x) * iw + i] : src[i * iw + (xmin + x)];
          s += v * ks[x];
        }
        if (axis === 0) dst[o * ow + i] = s; else dst[i * ow + o] = s;
      }
    }
    return dst;
  }
  const ih = h, iw = w;
  const needH = H !== ih, needW = W !== iw;
  let cur = Float64Array.from(g), cw = iw, ch = ih;
  const horizFirst = !((ih - H > 0) && (ih - H) > (iw - W) * 2);
  if ((needW && horizFirst) || needH) { /* vert precompute inline in pass */ }
  if (horizFirst) {
    if (needW) { cur = pass1(cur, ch, cw, ch, W, 1); cw = W; }
    if (needH) { cur = pass1(cur, ch, cw, H, W, 0); ch = H; }
  } else {
    if (needH) { cur = pass1(cur, ch, cw, H, cw, 0); ch = H; }
    if (needW) { cur = pass1(cur, ch, cw, ch, W, 1); cw = W; }
  }
  const out = new Float32Array(H * W);
  for (let i = 0; i < H * W; i++) out[i] = cur[i] < 0 ? 0 : (cur[i] > 255 ? 255 : cur[i]);
  return out;
}
function loadF32(path) {
  const b = readFileSync(path);
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}
function loadU8(path) {
  const b = readFileSync(path);
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}
const inp = loadF32("./tmp/zoom_in.raw");
const ref = loadU8("./tmp/zoom_ref_dump.raw");
const g = new Float64Array(90 * 80);
for (let i = 0; i < 90 * 80; i++) g[i] = inp[i * 3];
const o = pilResize(g, 90, 80, 103, 92, 2);
let mx = 0;
for (let i = 0; i < 103 * 92; i++) { const d = Math.abs(o[i] - ref[i * 3]); if (d > mx) mx = d; }
console.log("pil-exact maxdiff", mx.toFixed(3));
