// Echo preprocessing helpers. Frames arrive from the page as ImageData buffers.
// PanEcho: OpenCV BGR, 256 resize then 224 centre crop, ImageNet normalisation.
// Unity-GLS: grayscale 608 square, pixel/255 - 0.5, seven context frames as channels.

function rgbToGray(rgba, w, h) {
  var g = new Float32Array(w * h);
  for (var i = 0, j = 0; i < w * h; i++, j += 4) {
    g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  }
  return g;
}

// Bilinear resample of a single channel.
function resizeGray(src, sw, sh, tw, th) {
  var out = new Float32Array(tw * th);
  for (var y = 0; y < th; y++) {
    var sy = (y + 0.5) * sh / th - 0.5;
    if (sy < 0) sy = 0; if (sy > sh - 1) sy = sh - 1;
    var y0 = Math.floor(sy), y1 = Math.min(y0 + 1, sh - 1), fy = sy - y0;
    for (var x = 0; x < tw; x++) {
      var sx = (x + 0.5) * sw / tw - 0.5;
      if (sx < 0) sx = 0; if (sx > sw - 1) sx = sw - 1;
      var x0 = Math.floor(sx), x1 = Math.min(x0 + 1, sw - 1), fx = sx - x0;
      var a = src[y0 * sw + x0], b = src[y0 * sw + x1];
      var c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * tw + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

// PanEcho tensor: one clip of 16 frames, BGR, ImageNet normalisation.
// Frames are 256x256 RGB; centre crop to 224 here.
var PE_MEAN = [0.485, 0.456, 0.406], PE_STD = [0.229, 0.224, 0.225];
function panechoClipTensor(frames, w, h) {
  var n = frames.length, side = 224, off = ((w - side) >> 1);
  var t = new Float32Array(3 * n * side * side);
  for (var f = 0; f < n; f++) {
    var rgba = frames[f];
    for (var y = 0; y < side; y++) {
      for (var x = 0; x < side; x++) {
        var si = ((y + off) * w + (x + off)) * 4;
        // BGR order to match the released OpenCV pipeline
        var b = rgba[si + 2] / 255, g = rgba[si + 1] / 255, r = rgba[si] / 255;
        var px = y * side + x;
        t[0 * n * side * side + f * side * side + px] = (b - PE_MEAN[0]) / PE_STD[0];
        t[1 * n * side * side + f * side * side + px] = (g - PE_MEAN[1]) / PE_STD[1];
        t[2 * n * side * side + f * side * side + px] = (r - PE_MEAN[2]) / PE_STD[2];
      }
    }
  }
  return t;
}

// Unity tensor: seven context frames stacked as channels, grayscale, /255 - 0.5.
function unityStackTensor(frames, w, h) {
  var n = frames.length;
  var t = new Float32Array(n * h * w);
  for (var f = 0; f < n; f++) {
    var g = rgbToGray(frames[f], w, h);
    for (var i = 0; i < w * h; i++) t[f * w * h + i] = g[i] / 255 - 0.5;
  }
  return t;
}

// Heatmap peak and curve extraction for the four Unity layers.
function unityLandmarks(data, layers, H, W) {
  function argmax(ch) {
    var best = -1, bi = 0, base = ch * H * W;
    for (var i = 0; i < H * W; i++) {
      var v = data[base + i];
      if (v > best) { best = v; bi = i; }
    }
    return { x: bi % W, y: Math.floor(bi / W), v: best };
  }
  var apex = argmax(1), ant = argmax(2), inf = argmax(3);
  function ridge(thr) {
    var pts = [];
    for (var y = 0; y < H; y++) {
      var best = -1, bx = -1, base = 0 * H * W;
      for (var x = 0; x < W; x++) {
        var v = data[base + y * W + x];
        if (v > best) { best = v; bx = x; }
      }
      if (bx >= 0 && best > thr) pts.push([bx, y]);
    }
    return pts;
  }
  var curve = ridge(0.15);
  if (curve.length < 40) { var wider = ridge(0.05); if (wider.length > curve.length) curve = wider; }
  var len = 0;
  for (var i = 1; i < curve.length; i++) {
    var dx = curve[i][0] - curve[i - 1][0], dy = curve[i][1] - curve[i - 1][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return { apex: apex, ant: ant, inf: inf, curve: curve, lengthPx: len, layers: layers };
}

