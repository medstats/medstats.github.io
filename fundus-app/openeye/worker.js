importScripts("../vendor/ort.min.js");
importScripts("worker-lib.js");
ort.env.wasm.numThreads = (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated) ? 4 : 1;
ort.env.wasm.wasmPaths = new URL("../vendor/", self.location.href).href;
var sess = null, labels = [];
var URL_MODEL = "https://huggingface.co/AnupamK/fundus-cdr-onnx/resolve/09a2af2fad20285735f106f3b51c4727030c9725/openeye_vision.onnx";
var MEAN = [0.31561512, 0.20948674, 0.16498742], STD = [0.13639495, 0.08581575, 0.08441529];
self.onmessage = function (ev) {
  var msg = ev.data;
  if (msg.type === "init") {
    fetch("labels.json").then(function (r) { return r.json(); }).then(function (j) {
      labels = Object.keys(j);
      return ort.InferenceSession.create(URL_MODEL, { executionProviders: ["wasm"] });
    }).then(function (s) { sess = s; self.postMessage({ type: "ready" }); })
    .catch(function (e) { self.postMessage({ type: "error", message: String(e && e.message || e) }); });
    return;
  }
  if (msg.type === "run") { runEye(msg); return; }
};
async function runEye(msg) {
    try {
      var t0 = Date.now();
      var t = eyeTensor(new Uint8Array(msg.pixels), msg.w, msg.h);
      var inp = new ort.Tensor("float32", t, [1, 3, 224, 224]);
      var r = await sess.run({ image: inp });
      var out = Array.prototype.slice.call(r.logits.data);
      var idx = out.map(function (v, i) { return i; });
      idx.sort(function (a, b) { return out[b] - out[a]; });
      var top = idx.slice(0, 10).map(function (i) { return { label: labels[i] || ("class " + i), score: out[i] }; });
      self.postMessage({ type: "result", top: top, ms: Date.now() - t0 });
    } catch (e) { self.postMessage({ type: "error", message: String(e && e.message || e) }); }
}
function eyeTensor(rgb, h, w) {
  var chs = [];
  for (var c = 0; c < 3; c++) {
    var g = new Float32Array(h * w);
    for (var i = 0; i < h * w; i++) g[i] = rgb[i * 3 + c];
    chs.push(bicubicGray(g, h, w, 256, 256, -0.5));
  }
  var t = new Float32Array(3 * 224 * 224);
  for (var c2 = 0; c2 < 3; c2++) for (var y = 0; y < 224; y++) for (var x = 0; x < 224; x++)
    t[c2 * 224 * 224 + y * 224 + x] = (chs[c2][(y + 16) * 256 + (x + 16)] / 255 - MEAN[c2]) / STD[c2];
  return t;
}
