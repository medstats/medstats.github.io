// Mask analysis shared by worker and tests. Label convention: 0 bg, 1 disc, 2 cup.
export function extents(mask, H, W, cls) {
  let x0 = W, x1 = -1, y0 = H, y1 = -1, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x] === cls) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (n === 0) return null;
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, x0, x1, y0, y1, n };
}
export function cdrFromMask(mask, H, W) {
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
export function boundaryPts(mask, H, W, cls, maxPts) {
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
export function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
