import { grayRGB, normMinMax, floodZeroFrom, morphRect, maskCenter, maskRadius, circleMask, bilinearRGB } from "./img.js";
function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
export function automorphTensor(rgb, h, w) {
  const g = grayRGB(rgb, h, w);
  const tg = normMinMax(g);
  const thr = Math.max(5, mean(tg) / 3 - 5);
  const m0 = new Float32Array(h * w);
  for (let i = 0; i < h * w; i++) m0[i] = tg[i] > thr ? 1 : 0;
  const nm = new Float32Array(h * w);
  for (let i = 0; i < h * w; i++) nm[i] = 1 - m0[i];
  floodZeroFrom(nm, h, w, 0, 0);
  floodZeroFrom(nm, h, w, h - 1, w - 1);
  const m1 = new Float32Array(h * w);
  for (let i = 0; i < h * w; i++) m1[i] = m0[i] + nm[i];
  const er = morphRect(m1, h, w, 20, 0);
  const mask = morphRect(er, h, w, 20, 1);
  const center = maskCenter(mask, h, w);
  const radius = maskRadius(mask, h, w, center);
  const circ = circleMask(h, w, center[0], center[1], radius);
  const sh = Math.max(0, Math.trunc(center[0] - radius));
  const sw = Math.max(0, Math.trunc(center[1] - radius));
  const bh = Math.min(h - sh, 2 * radius), bw = Math.min(w - sw, 2 * radius);
  const maxL = Math.max(bh, bw);
  const top = Math.trunc(maxL / 2 - bh / 2), left = Math.trunc(maxL / 2 - bw / 2);
  const sq = new Uint8Array(maxL * maxL * 3);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const s = ((sh + y) * w + (sw + x)) * 3, d = ((top + y) * maxL + (left + x)) * 3;
    sq[d] = rgb[s]; sq[d + 1] = rgb[s + 1]; sq[d + 2] = rgb[s + 2];
  }
  const small = bilinearRGB(sq, maxL, maxL, 512, 512);
  const t = new Float32Array(3 * 512 * 512);
  for (let c = 0; c < 3; c++) for (let i = 0; i < 512 * 512; i++) t[c * 512 * 512 + i] = small[i * 3 + c] / 255;
  return { tensor: t, side: maxL, center, radius };
}
import { bilinearRGB as _b, areaGray as _a } from "./img.js";
function padSquareRGB(rgb, h, w) {
  if (h === w) return { data: rgb, side: h };
  const s = Math.max(h, w), top = ((s - h) / 2) | 0, left = ((s - w) / 2) | 0;
  const out = new Uint8Array(s * s * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = (y * w + x) * 3, b = ((top + y) * s + (left + x)) * 3;
    out[b] = rgb[a]; out[b + 1] = rgb[a + 1]; out[b + 2] = rgb[a + 2];
  }
  return { data: out, side: s };
}
function normCHW(u8, H, W, mean, std) {
  const t = new Float32Array(3 * H * W);
  for (let c = 0; c < 3; c++) for (let i = 0; i < H * W; i++)
    t[c * H * W + i] = (u8[i * 3 + c] / 255 - mean[c]) / std[c];
  return t;
}
// SegFormer HF processor: square-pad (app-level, documented), bilinear 512,
// rescale 1/255, ImageNet normalize.
export function segformerTensor(rgb, h, w) {
  const { data, side } = padSquareRGB(rgb, h, w);
  const small = _b(data, side, side, 512, 512);
  return normCHW(small, 512, 512, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
}
// APTOS grader eval: BGR auto-crop tol=7, square pad, INTER_AREA 384, norm.
export function drTensor(rgb, h, w) {
  const g = new Float32Array(h * w);
  for (let i = 0, j = 0; i < h * w; i++, j += 3) g[i] = 0.114 * rgb[j] + 0.587 * rgb[j + 1] + 0.299 * rgb[j + 2];
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
  const rowHas = (y) => { for (let x = 0; x < w; x++) if (g[y * w + x] > 7) return true; return false; };
  const colHas = (x) => { for (let y = 0; y < h; y++) if (g[y * w + x] > 7) return true; return false; };
  while (y0 <= y1 && !rowHas(y0)) y0++;
  while (y1 >= y0 && !rowHas(y1)) y1--;
  while (x0 <= x1 && !colHas(x0)) x0++;
  while (x1 >= x0 && !colHas(x1)) x1--;
  if (y1 < y0 || x1 < x0) { y0 = 0; y1 = h - 1; x0 = 0; x1 = w - 1; }
  const ch = y1 - y0 + 1, cw = x1 - x0 + 1;
  const crop = new Uint8Array(ch * cw * 3);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const a = ((y0 + y) * w + (x0 + x)) * 3, b = (y * cw + x) * 3;
    crop[b] = rgb[a]; crop[b + 1] = rgb[a + 1]; crop[b + 2] = rgb[a + 2];
  }
  const { data, side } = padSquareRGB(crop, ch, cw);
  const f = (c) => {
    const chx = new Float32Array(side * side);
    for (let i = 0; i < side * side; i++) chx[i] = data[i * 3 + c];
    return _a(chx, side, side, 384, 384);
  };
  const R = f(0), G = f(1), B = f(2);
  const t = new Float32Array(3 * 384 * 384), M = [0.485, 0.456, 0.406], S = [0.229, 0.224, 0.225], C = [R, G, B];
  for (let c = 0; c < 3; c++) for (let i = 0; i < 384 * 384; i++) t[c * 384 * 384 + i] = (C[c][i] / 255 - M[c]) / S[c];
  return t;
}
export function drGrade(meanScore) {
  const thr = [0.668, 1.1319999999999997, 2.3239999999999994, 3.3];
  let g = 0;
  for (const t of thr) if (meanScore > t) g++;
  return g;
}
import { bicubicGray as _bic, gaussianGray as _gg, bilinearGray as _bl, equalizeAdapthistRGB as _clahe } from "./img.js";
function diskOffsets(r) {
  const o = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if (dx * dx + dy * dy <= r * r) o.push([dy, dx]);
  return o;
}
function erodeMask(m, h, w, offs) {
  const out = new Float32Array(h * w).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let k = 0; k < offs.length; k++) {
      const yy = y + offs[k][0], xx = x + offs[k][1];
      const v = (yy < 0 || yy >= h || xx < 0 || xx >= w) ? 0 : m[yy * w + xx];
      if (v < 0.5) { out[y * w + x] = 0; break; }
    }
  }
  return out;
}
export function r2v2Tensor(rgb, h, w) {
  const NW = 1408;
  const nh = Math.round(h * (NW / w));
  const chOf = function (c) {
    const g = new Float32Array(h * w);
    for (let i = 0; i < h * w; i++) g[i] = rgb[i * 3 + c];
    const sh = (h / nh - 1) / 2, sw = (w / NW - 1) / 2;
    var bl = _gg(g, h, w, sh > 0.01 ? sh : 0.001, sw > 0.01 ? sw : 0.001); return _bl(bl, h, w, nh, NW);
  };
  const Rs = chOf(0), Gs = chOf(1), Bs = chOf(2);
  const f = new Float32Array(nh * NW * 3);
  for (let i = 0; i < nh * NW; i++) { f[i * 3] = Rs[i]; f[i * 3 + 1] = Gs[i]; f[i * 3 + 2] = Bs[i]; }
  const mask = new Float32Array(nh * NW);
  for (let i = 0; i < nh * NW; i++) mask[i] = (f[i * 3] + f[i * 3 + 1] + f[i * 3 + 2] > 2.55) ? 1 : 0;
  const zw = Math.round(NW * 1.15), zh = Math.round(nh * 1.15);
  const zc = function (c) {
    const g = new Float32Array(nh * NW);
    for (let i = 0; i < nh * NW; i++) g[i] = Math.round(f[i * 3 + c]);
    return _bic(g, nh, NW, zh, zw, -0.5);
  };
  const Zr = zc(0), Zg = zc(1), Zb = zc(2);
  const cx0 = Math.floor((zw - NW) / 2), cy0 = Math.floor((zh - nh) / 2);
  const zoom = new Float32Array(nh * NW * 3);
  for (let y = 0; y < nh; y++) for (let x = 0; x < NW; x++) {
    const q = ((cy0 + y) * zw + (cx0 + x)) | 0;
    const d = (y * NW + x) * 3;
    zoom[d] = Zr[q] / 255; zoom[d + 1] = Zg[q] / 255; zoom[d + 2] = Zb[q] / 255;
  }
  return { zoom: zoom, mask: mask, small: f, nh: nh };
}
export function r2v2Finish(zoom, mask, small, nh, NW) {
  const ker = diskOffsets(5);
  const em = erodeMask(mask, nh, NW, ker);
  const n = nh * NW;
  const comp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const on = em[i] >= 1 ? 1 : 0;
    for (let c = 0; c < 3; c++) comp[i * 3 + c] = on ? small[i * 3 + c] / 255 : zoom[i * 3 + c];
  }
  const filt = new Float32Array(n * 3);
  for (let c = 0; c < 3; c++) {
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = comp[i * 3 + c];
    const bl = _gg(g, nh, NW, 10, 10, 1);
    for (let i = 0; i < n; i++) filt[i * 3 + c] = bl[i];
  }
  const sub = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const on = em[i] >= 1 ? 1 : 0;
    for (let c = 0; c < 3; c++) sub[i * 3 + c] = on ? comp[i * 3 + c] - filt[i * 3 + c] : 0;
  }
  let sm = 0;
  for (let i = 0; i < sub.length; i++) sm += sub[i];
  sm /= sub.length;
  let va = 0;
  for (let i = 0; i < sub.length; i++) va += (sub[i] - sm) * (sub[i] - sm);
  const sd = Math.sqrt(va / sub.length);
  let emn = Infinity, emx = -Infinity;
  const sc = new Float32Array(sub.length);
  for (let i = 0; i < sub.length; i++) {
    sc[i] = sd > 0 ? sub[i] / sd : 0;
    if (sc[i] < emn) emn = sc[i];
    if (sc[i] > emx) emx = sc[i];
  }
  const dd = emx - emn;
  const u8 = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const on = em[i] >= 1 ? 1 : 0;
    for (let c = 0; c < 3; c++) {
      const vv = dd <= 0 ? 0 : (sc[i * 3 + c] - emn) / dd;
      const q = Math.trunc(vv * 255);
      u8[i * 3 + c] = on ? Math.max(0, Math.min(255, q)) : 0;
    }
  }
  const pre = _clahe(u8, nh, NW, 0.01);
  const six = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
    six[i * 6 + c] = pre[i * 3 + c];
    six[i * 6 + 3 + c] = small[i * 3 + c] / 255;
  }
  const m = 32;
  const ph = m - (nh % m), pw = m - (NW % m);
  const th = Math.floor(ph / 2), bh = ph - th, lw = Math.floor(pw / 2), rw = pw - lw;
  const H = nh + ph, Wd = NW + pw;
  const t = new Float32Array(6 * H * Wd);
  for (let c = 0; c < 6; c++) for (let y = 0; y < nh; y++) for (let x = 0; x < NW; x++)
    t[c * H * Wd + (y + th) * Wd + (x + lw)] = six[(y * NW + x) * 6 + c];
  return { tensor: t, h: H, w: Wd, pad: [th, bh, lw, rw], inner: [nh, NW] };
}
