// Shared exact-port image ops. Pixel convention: gray masks are Float32Array
// row-major HxW with values 0/1 unless noted; RGB is Uint8Array HxWx3.
// All ports verified against the Python references (see tools/verify_*).
function grayRGB(rgb, h, w) {
  const g = new Float32Array(h * w);
  for (let i = 0, j = 0; i < h * w; i++, j += 3)
    g[i] = 0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2];
  return g;
}
function minMax(a) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  return [mn, mx];
}
function normMinMax(g) {
  const [mn, mx] = minMax(g);
  const out = new Float32Array(g.length);
  const d = mx - mn;
  if (d <= 0) return out;
  for (let i = 0; i < g.length; i++) out[i] = (g[i] - mn) / d * 255;
  return out;
}
// Flood-fill zeros from all borders; returns mask OR filled-background.
// Matches cv2 floodFill corners + mask addition in get_mask_BZ.
function fillHoles(mask, h, w) {
  const seen = new Uint8Array(h * w);
  const stack = [];
  const push = (y, x) => { const i = y * w + x; if (!seen[i] && mask[i] <= 0) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(0, x); push(h - 1, x); }
  for (let y = 0; y < h; y++) { push(y, 0); push(y, w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const y = (i / w) | 0, x = i % w;
    if (y > 0) push(y - 1, x);
    if (y + 1 < h) push(y + 1, x);
    if (x > 0) push(y, x - 1);
    if (x + 1 < w) push(y, x + 1);
  }
  const out = new Float32Array(h * w);
  for (let i = 0; i < h * w; i++) out[i] = (mask[i] > 0 || seen[i]) ? 1 : 0;
  return out;
}
// Integral image of a 0/1 mask for O(1) rectangular morphology.
function integral(m, h, w) {
  const s = new Float64Array((h + 1) * (w + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += m[y * w + x];
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
    }
  }
  return s;
}
function rectSum(s, w, y0, x0, y1, x1) {
  return s[y1 * (w + 1) + x1] - s[y0 * (w + 1) + x1] - s[y1 * (w + 1) + x0] + s[y0 * (w + 1) + x0];
}
// Erode (all ones) or dilate (any one) with a kxk rectangular kernel,
// border handling matches cv2 default (constant 0 beyond border for erode
// semantics via clamped windows; validated numerically).
function morphRect(mask, h, w, k, op) {
  const s = integral(mask, h, w);
  const out = new Float32Array(h * w);
  const r = (k / 2) | 0;
  const area = k * k;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const n = rectSum(s, w, y0, x0, y1, x1);
      const full = (y1 - y0) * (x1 - x0);
      out[y * w + x] = op === 0 ? (n === full && full === area ? 1 : (full < area ? 0 : (n === full ? 1 : 0))) : (n > 0 ? 1 : 0);
    }
  }
  return out;
}
// Center from row/column sums above 95% of max, matching _get_center_by_edge.
function maskCenter(mask, h, w) {
  const rs = new Float64Array(h), cs = new Float64Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = mask[y * w + x]; rs[y] += v; cs[x] += v; }
  let rmax = 0, cmax = 0;
  for (let y = 0; y < h; y++) if (rs[y] > rmax) rmax = rs[y];
  for (let x = 0; x < w; x++) if (cs[x] > cmax) cmax = cs[x];
  let cy = 0, ncy = 0, cx = 0, ncx = 0;
  for (let y = 0; y < h; y++) if (rs[y] > rmax * 0.95) { cy += y; ncy++; }
  for (let x = 0; x < w; x++) if (cs[x] > cmax * 0.95) { cx += x; ncx++; }
  return [cy / Math.max(ncy, 1), cx / Math.max(ncx, 1)];
}
// Ellipse kernel offsets for the morphological gradient.
function ellipseOffsets(k) {
  const r = (k / 2) | 0, offs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if ((dx * dx + dy * dy) <= r * r + 1e-9) offs.push([dy, dx]);
  }
  return offs;
}
// Radius from gradient-pixel distances, matching _get_radius_by_mask_center.
// Restricted to the mask bounding box expanded by k for speed.
function maskRadius(mask, h, w, center) {
  const k = Math.max(((w / 400) | 0) * 2 + 1, 3);
  const offs = ellipseOffsets(k);
  const r = (k / 2) | 0;
  let y0 = h, y1 = -1, x0 = w, x1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (mask[y * w + x] > 0) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  y0 = Math.max(0, y0 - r - 1); y1 = Math.min(h - 1, y1 + r + 1);
  x0 = Math.max(0, x0 - r - 1); x1 = Math.min(w - 1, x1 + r + 1);
  const dist = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let mn = 1, mx = 0;
      for (let o = 0; o < offs.length; o++) {
        const yy = y + offs[o][0], xx = x + offs[o][1];
        const v = (yy < 0 || yy >= h || xx < 0 || xx >= w) ? 0 : mask[yy * w + xx];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mx - mn > 0) dist.push(Math.sqrt((y - center[0]) * (y - center[0]) + (x - center[1]) * (x - center[1])));
    }
  }
  const bins = new Map();
  for (const d of dist) { const b = Math.ceil(d); bins.set(b, (bins.get(b) || 0) + 1); }
  let mx = 0;
  for (const c of bins.values()) if (c > mx) mx = c;
  let radius = 0;
  for (const [b, c] of bins) if (c > mx * 0.995 && b > radius) radius = b;
  return radius;
}
function circleMask(h, w, cy, cx, radius) {
  const out = new Float32Array(h * w);
  const r2 = radius * radius;
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(h - 1, Math.ceil(cy + radius));
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(w - 1, Math.ceil(cx + radius));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    if ((y - cy) * (y - cy) + (x - cx) * (x - cx) <= r2) out[y * w + x] = 1;
  return out;
}
// PIL-BILINEAR mapping: in = (out + 0.5) * scale - 0.5, edge clamped.
function bilinearGray(g, h, w, H, W) {
  const out = new Float32Array(H * W);
  const sy = h / H, sx = w / W;
  for (let y = 0; y < H; y++) {
    let iy = (y + 0.5) * sy - 0.5;
    let y0 = Math.floor(iy);
    const fy = iy - y0;
    y0 = Math.max(0, Math.min(h - 1, y0));
    const y1 = Math.min(h - 1, y0 + 1);
    for (let x = 0; x < W; x++) {
      let ix = (x + 0.5) * sx - 0.5;
      let x0 = Math.floor(ix);
      const fx = ix - x0;
      x0 = Math.max(0, Math.min(w - 1, x0));
      const x1 = Math.min(w - 1, x0 + 1);
      const a = g[y0 * w + x0], b = g[y0 * w + x1], c = g[y1 * w + x0], d = g[y1 * w + x1];
      out[y * W + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}
function bilinearRGB(rgb, h, w, H, W) {
  const ch = [new Float32Array(h * w), new Float32Array(h * w), new Float32Array(h * w)];
  for (let i = 0, j = 0; i < h * w; i++, j += 3) { ch[0][i] = rgb[j]; ch[1][i] = rgb[j + 1]; ch[2][i] = rgb[j + 2]; }
  const r = bilinearGray(ch[0], h, w, H, W), g = bilinearGray(ch[1], h, w, H, W), b = bilinearGray(ch[2], h, w, H, W);
  const out = new Uint8Array(H * W * 3);
  for (let i = 0, j = 0; i < H * W; i++, j += 3) {
    out[j] = Math.max(0, Math.min(255, Math.round(r[i])));
    out[j + 1] = Math.max(0, Math.min(255, Math.round(g[i])));
    out[j + 2] = Math.max(0, Math.min(255, Math.round(b[i])));
  }
  return out;
}
// Exact box-average downscale (cv2 INTER_AREA for shrink factors).
// Falls back to bilinear when upscaling.
function areaGray(g, h, w, H, W) {
  if (H >= h && W >= w) return bilinearGray(g, h, w, H, W);
  const out = new Float32Array(H * W);
  const sy = h / H, sx = w / W;
  for (let y = 0; y < H; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy;
    const ya = Math.floor(y0), yb = Math.min(h - 1, Math.ceil(y1) - 1);
    for (let x = 0; x < W; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx;
      const xa = Math.floor(x0), xb = Math.min(w - 1, Math.ceil(x1) - 1);
      let s = 0, a = 0;
      for (let yy = ya; yy <= yb; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = xa; xx <= xb; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          s += g[yy * w + xx] * wx * wy; a += wx * wy;
        }
      }
      out[y * W + x] = s / a;
    }
  }
  return out;
}
function cubicKeys(t, a) {
  t = Math.abs(t);
  if (t < 1) return ((a + 2) * t - (a + 3)) * t * t + 1;
  if (t < 2) return (((t - 5) * t + 8) * t - 4) * a;
  return 0;
}
// PIL bicubic (a = -0.5), same center mapping as bilinear.
function bicubicGray(g, h, w, H, W, a) {
  a = a === undefined ? -0.5 : a;
  const out = new Float32Array(H * W);
  const sy = h / H, sx = w / W;
  for (let y = 0; y < H; y++) {
    const iy = (y + 0.5) * sy - 0.5;
    const y0 = Math.floor(iy), fy = iy - y0;
    const wy = [cubicKeys(fy + 1, a), cubicKeys(fy, a), cubicKeys(1 - fy, a), cubicKeys(2 - fy, a)];
    for (let x = 0; x < W; x++) {
      const ix = (x + 0.5) * sx - 0.5;
      const x0 = Math.floor(ix), fx = ix - x0;
      const wx = [cubicKeys(fx + 1, a), cubicKeys(fx, a), cubicKeys(1 - fx, a), cubicKeys(2 - fx, a)];
      let s = 0;
      for (let j = 0; j < 4; j++) {
        const yy = Math.max(0, Math.min(h - 1, y0 - 1 + j));
        for (let i = 0; i < 4; i++) {
          const xx = Math.max(0, Math.min(w - 1, x0 - 1 + i));
          s += g[yy * w + xx] * wx[i] * wy[j];
        }
      }
      out[y * W + x] = s < 0 ? 0 : (s > 255 ? 255 : s);
    }
  }
  return out;
}
// Exact port of the two floodFill calls in get_mask_BZ: fill the corner-
// connected component (of whatever value lives at the corner) with 0.
function floodZeroFrom(nm, h, w, sy, sx) {
  const seed = nm[sy * w + sx];
  const seen = new Uint8Array(h * w);
  const stack = [sy * w + sx];
  seen[sy * w + sx] = 1;
  while (stack.length) {
    const i = stack.pop();
    nm[i] = 0;
    const y = (i / w) | 0, x = i % w;
    const tryPush = (yy, xx) => {
      const j = yy * w + xx;
      if (!seen[j] && nm[j] === seed) { seen[j] = 1; stack.push(j); }
    };
    if (y > 0) tryPush(y - 1, x);
    if (y + 1 < h) tryPush(y + 1, x);
    if (x > 0) tryPush(y, x - 1);
    if (x + 1 < w) tryPush(y, x + 1);
  }
  return nm;
}
// Separable Gaussian, scipy ndimage mode=reflect (edge NOT duplicated):
// out-of-range index i maps: -1->1, -2->2, n->n-2, n+1->n-3, etc.
function reflectIdx(i, n) {
  if (n <= 1) return 0;
  const m = 2 * (n - 1);
  i = ((i % m) + m) % m;
  if (i >= n) i = m - i;
  return i;
}
function gaussKernel(sigma) {
  const r = Math.max(1, Math.trunc(4 * sigma + 0.5));
  const k = new Float64Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / sigma) * (i / sigma)); k[i + r] = v; s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { k, r };
}
function dupIdx(i, n) {
  if (n <= 1) return 0;
  while (i < 0 || i >= n) { if (i < 0) i = -i - 1; else i = 2 * n - i - 1; }
  return i;
}
function gaussianGray(g, h, w, sy, sx, edge) {
  var idx = edge === 1 ? dupIdx : reflectIdx;
  const kx = gaussKernel(sx), ky = gaussKernel(sy);
  const tmp = new Float64Array(h * w), out = new Float32Array(h * w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -kx.r; i <= kx.r; i++) s += g[y * w + idx(x + i, w)] * kx.k[i + kx.r];
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = -ky.r; j <= ky.r; j++) s += tmp[idx(y + j, h) * w + x] * ky.k[j + ky.r];
    out[y * w + x] = s;
  }
  return out;
}
// Bankers rounding (numpy round half-to-even).
function bankers(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return (f % 2 === 0) ? f : f + 1;
}
// Linear min-max map to [0,1] (interp1d equivalent for to_0_1).
function to01(g) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < g.length; i++) { const v = g[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const out = new Float32Array(g.length), d = mx - mn;
  if (d <= 0) return out;
  for (let i = 0; i < g.length; i++) out[i] = (g[i] - mn) / d;
  return out;
}
function rgb2hsvPixel(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}
function hsv2rgbPixel(h, s, v) {
  if (s === 0) return [v, v, v];
  h = (h % 1) * 6;
  const i = Math.floor(h), f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  if (i === 0) return [v, t, p];
  if (i === 1) return [q, v, p];
  if (i === 2) return [p, v, t];
  if (i === 3) return [p, q, v];
  if (i === 4) return [t, p, v];
  return [v, p, q];
}
const NR = 16384, NBINS = 256, BINSZ = 65;
function clipHistogram(hist, clim) {
  let nExcess = 0;
  for (let i = 0; i < 256; i++) if (hist[i] > clim) { nExcess += hist[i] - clim; hist[i] = clim; }
  const binIncr = Math.floor(nExcess / 256);
  const upper = clim - binIncr;
  for (let i = 0; i < 256; i++) if (hist[i] < upper) { hist[i] += binIncr; nExcess -= binIncr; }
  for (let i = 0; i < 256; i++) {
    if (hist[i] >= upper && hist[i] < clim) { nExcess += hist[i] - clim; hist[i] = clim; }
  }
  while (nExcess > 0) {
    const prev = nExcess;
    for (let index = 0; index < 256; index++) {
      let under = 0;
      for (let i = 0; i < 256; i++) if (hist[i] < clim) under++;
      const step = Math.max(1, Math.floor(under / nExcess));
      for (let i = index; i < 256; i += step) {
        if (hist[i] < clim) { hist[i] += 1; nExcess -= 1; }
      }
      if (nExcess <= 0) break;
    }
    if (prev === nExcess) break;
  }
  return hist;
}
function mapHistogram(hist, nPixels) {
  const out = new Float64Array(256);
  let c = 0;
  for (let i = 0; i < 256; i++) {
    c += hist[i];
    let v = c * 16383 / nPixels;
    out[i] = v > 16383 ? 16383 : v;
  }
  return out;
}
function padReflect2(g, h, w, pt, pl, pb, pr) {
  const H = h + pt + pb, W = w + pl + pr;
  const out = new Float64Array(H * W);
  for (let y = 0; y < H; y++) {
    const yy = reflectIdx(y - pt, h);
    const row = yy * w;
    for (let x = 0; x < W; x++) out[y * W + x] = g[row + reflectIdx(x - pl, w)];
  }
  return { data: out, h: H, w: W };
}
function claheCore(v, h, w, kh, kw, clipLimit) {
  const pt = Math.floor(kh / 2), pl = Math.floor(kw / 2);
  const pb = ((kh - h % kh) % kh) + Math.ceil(kh / 2);
  const pr = ((kw - w % kw) % kw) + Math.ceil(kw / 2);
  const P = padReflect2(v, h, w, pt, pl, pb, pr);
  const H = P.h, W = P.w, G = P.data;
  const lut = new Uint16Array(NR);
  for (let i = 0; i < NR; i++) lut[i] = Math.floor(i / BINSZ);
  const binned = new Uint16Array(H * W);
  for (let i = 0; i < H * W; i++) binned[i] = lut[G[i]];
  const nry = Math.floor(H / kh) - 1, nrx = Math.floor(W / kw) - 1;
  const kElem = kh * kw;
  const clim = Math.max(1, Math.floor(Math.min(clipLimit, 1) * kElem));
  const maps = [];
  for (let by = 0; by < nry; by++) for (let bx = 0; bx < nrx; bx++) {
    const hist = new Float64Array(256);
    const oy = by * kh + (kh >> 1), ox = bx * kw + (kw >> 1);
    for (let y = 0; y < kh; y++) for (let x = 0; x < kw; x++)
      hist[binned[(oy + y) * W + (ox + x)]]++;
    clipHistogram(hist, clim);
    maps.push(mapHistogram(hist, kElem));
  }
  const ny = Math.floor(H / kh), nx = Math.floor(W / kw);
  const gp = [];
  for (let by = -1; by <= nry; by++) for (let bx = -1; bx <= nrx; bx++) {
    const cy = Math.max(0, Math.min(nry - 1, by)), cx = Math.max(0, Math.min(nrx - 1, bx));
    gp.push(maps[cy * nrx + cx]);
  }
  const W2 = nx + 1;
  const res = new Float64Array(H * W);
  const cyy = new Float64Array(kh * kw), cxx = new Float64Array(kh * kw);
  for (let j = 0; j < kh; j++) for (let i = 0; i < kw; i++) { cyy[j * kw + i] = j / kh; cxx[j * kw + i] = i / kw; }
  for (let py = 0; py < ny; py++) for (let px = 0; px < nx; px++) {
    const m00 = gp[py * W2 + px], m01 = gp[py * W2 + px + 1];
    const m10 = gp[(py + 1) * W2 + px], m11 = gp[(py + 1) * W2 + px + 1];
    for (let j = 0; j < kh; j++) for (let i = 0; i < kw; i++) {
      const k = j * kw + i, wy = cyy[k], wx = cxx[k];
      const pv = binned[(py * kh + j) * W + (px * kw + i)];
      res[(py * kh + j) * W + (px * kw + i)] =
        m00[pv] * (1 - wy) * (1 - wx) + m01[pv] * (1 - wy) * wx +
        m10[pv] * wy * (1 - wx) + m11[pv] * wy * wx;
    }
  }
  const out = new Float64Array(h * w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = res[(y + pt) * W + (x + pl)];
  return out;
}
function equalizeAdapthistRGB(img, h, w, clipLimit) {
  if (clipLimit === undefined) clipLimit = 0.01;
  const H = new Float64Array(h * w), S = new Float64Array(h * w), V = new Float64Array(h * w);
  for (let i = 0, j = 0; i < h * w; i++, j += 3) {
    const t = rgb2hsvPixel(img[j] / 255, img[j + 1] / 255, img[j + 2] / 255);
    H[i] = t[0]; S[i] = t[1]; V[i] = t[2];
  }
  let vmn = Infinity, vmx = -Infinity;
  for (let i = 0; i < h * w; i++) { if (V[i] < vmn) vmn = V[i]; if (V[i] > vmx) vmx = V[i]; }
  const lv = new Float64Array(h * w);
  const dv = vmx - vmn;
  for (let i = 0; i < h * w; i++) lv[i] = dv <= 0 ? 0 : bankers((V[i] - vmn) * 16383 / dv);
  const kh = Math.max((h / 8) | 0, 1), kw = Math.max((w / 8) | 0, 1);
  const eq = claheCore(lv, h, w, kh, kw, clipLimit);
  let emn = Infinity, emx = -Infinity;
  for (let i = 0; i < h * w; i++) { if (eq[i] < emn) emn = eq[i]; if (eq[i] > emx) emx = eq[i]; }
  const out = new Float64Array(h * w * 3);
  const de = emx - emn;
  for (let i = 0; i < h * w; i++) {
    const vv = de <= 0 ? 0.5 : (eq[i] - emn) / de;
    const t = hsv2rgbPixel(H[i], S[i], vv);
    out[i * 3] = t[0]; out[i * 3 + 1] = t[1]; out[i * 3 + 2] = t[2];
  }
  return out;
}
function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
function automorphTensor(rgb, h, w) {
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
function segformerTensor(rgb, h, w) {
  const { data, side } = padSquareRGB(rgb, h, w);
  const small = _b(data, side, side, 512, 512);
  return normCHW(small, 512, 512, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
}
// APTOS grader eval: BGR auto-crop tol=7, square pad, INTER_AREA 384, norm.
function drTensor(rgb, h, w) {
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
function drGrade(meanScore) {
  const thr = [0.668, 1.1319999999999997, 2.3239999999999994, 3.3];
  let g = 0;
  for (const t of thr) if (meanScore > t) g++;
  return g;
}
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
function r2v2Tensor(rgb, h, w) {
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
function r2v2Finish(zoom, mask, small, nh, NW) {
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
// Mask analysis shared by worker and tests. Label convention: 0 bg, 1 disc, 2 cup.
function extents(mask, H, W, cls) {
  let x0 = W, x1 = -1, y0 = H, y1 = -1, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x] === cls) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (n === 0) return null;
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, x0, x1, y0, y1, n };
}
function cdrFromMask(mask, H, W) {
  const d = extents(mask, H, W, 1), c = extents(mask, H, W, 2);
  const disc = d !== null || c !== null;
  if (!disc) return { valid: false, reason: "empty_disc" };
  const dw = d ? d.w : 0, dh = d ? d.h : 0;
  let cw = 0, chh = 0;
  if (c) { cw = c.w; chh = c.h; }
  else if (d) { cw = d.w; chh = d.h; }
  if (!d || dw <= 0 || dh <= 0) return { valid: false, reason: "empty_disc" };
  if (!c) return { valid: false, reason: "empty_cup" };
  return {
    valid: true,
    vcdr: chh / dh, hcdr: cw / dw,
    discW: dw, discH: dh, cupW: cw, cupH: chh,
    discBox: [d.x0, d.y0, d.x1, d.y1], cupBox: [c.x0, c.y0, c.x1, c.y1]
  };
}
// Boundary pixels for overlay (4-neighbourhood edge), downsampled to at most maxPts.
function boundaryPts(mask, H, W, cls, maxPts) {
  const pts = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x] !== cls) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
        mask[y * W + x - 1] !== cls || mask[y * W + x + 1] !== cls ||
        mask[(y - 1) * W + x] !== cls || mask[(y + 1) * W + x] !== cls) pts.push([x, y]);
  }
  if (pts.length <= maxPts) return pts;
  const step = pts.length / maxPts, out = [];
  for (let i = 0; i < maxPts; i++) out.push(pts[Math.floor(i * step)]);
  return out;
}
function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
