importScripts("../vendor/ort.min.js");
importScripts("worker-lib.js?v=5");
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL("../vendor/", self.location.href).href;
var sessions = {};
var MODEL_DEFS = { am: { file: "automorph_ensemble.onnx", input: "image", output: "probs" }, seg: { file: "segformer_int8.onnx", input: "pixel_values", output: "logits" }, dr: { files: ["fold1.onnx", "fold2.onnx", "fold3.onnx", "fold4.onnx", "fold5.onnx"], input: "image", output: "score" } };
var THR = [0.668, 1.132, 2.324, 3.3];
function gradeOf(mean) { var g = 0; for (var i = 0; i < THR.length; i++) if (mean >= THR[i]) g = i + 1; return g; }
function argmaxCHW(logits, C, H, W) {
  var m = new Uint8Array(H * W);
  for (var i = 0; i < H * W; i++) { var best = 0, bv = logits[i]; for (var c = 1; c < C; c++) { var v = logits[c * H * W + i]; if (v > bv) { bv = v; best = c; } } m[i] = best; }
  return m;
}
function finishSeg(logits, C, H, W) {
  var m = argmaxCHW(logits, C, H, W);
  var cdr = cdrFromMask(m, H, W);
  return { cdr: cdr, discBd: boundaryPts(m, H, W, 1, 1200), cupBd: boundaryPts(m, H, W, 2, 1200), hw: [H, W], mask: m };
}
self.onmessage = function (ev) {
  var msg = ev.data;
  if (msg.type === "init") { initModels(msg.base); return; }
  if (msg.type === "run") { runModels(msg); return; }
};
function initModels(base) {
  var jobs = [];
  Object.keys(MODEL_DEFS).forEach(function (k) {
    var d = MODEL_DEFS[k];
    var files = d.files || [d.file];
    files.forEach(function (f, idx) {
      var key = d.files ? k + idx : k;
      jobs.push(ort.InferenceSession.create(base + f, { executionProviders: ["wasm"] }).then(function (s) { sessions[key] = s; }));
    });
  });
  Promise.all(jobs).then(function () { self.postMessage({ type: "ready" }); }).catch(function (e) { self.postMessage({ type: "error", message: String(e && e.message || e) }); });
}
async function runModels(msg) {
  try {
    var px = new Uint8Array(msg.pixels);
    if (!(msg.w > 0 && msg.h > 0)) throw new Error("empty image");
    var rgb = new Uint8Array(msg.w * msg.h * 3);
    for (var i = 0, j = 0; i < msg.w * msg.h; i++, j += 4) { rgb[i * 3] = px[j]; rgb[i * 3 + 1] = px[j + 1]; rgb[i * 3 + 2] = px[j + 2]; }
    var out = { type: "result", eye: msg.eye, models: {} };
    if (msg.models.indexOf("am") >= 0) {
      var t0 = Date.now();
      var t = automorphTensor(rgb, msg.h, msg.w);
      var r = await sessions.am.run({ image: new ort.Tensor("float32", t.tensor, [1, 3, 512, 512]) });
      out.models.am = finishSeg(r.probs.data, 3, 512, 512);
      out.models.am.ms = Date.now() - t0;
      self.postMessage({ type: "progress", eye: msg.eye, model: "am" });
    }
    if (msg.models.indexOf("seg") >= 0) {
      var t1 = Date.now();
      var s = segformerTensor(rgb, msg.h, msg.w);
      var r2 = await sessions.seg.run({ pixel_values: new ort.Tensor("float32", s, [1, 3, 512, 512]) });
      out.models.seg = finishSeg(r2.logits.data, 3, 128, 128);
      out.models.seg.ms = Date.now() - t1;
      self.postMessage({ type: "progress", eye: msg.eye, model: "seg" });
    }
    if (msg.models.indexOf("dr") >= 0) {
      var t2 = Date.now();
      var dt = drTensor(rgb, msg.h, msg.w);
      var scores = [];
      for (var f = 0; f < 5; f++) {
        var r3 = await sessions["dr" + f].run({ image: new ort.Tensor("float32", dt, [1, 3, 384, 384]) });
        scores.push(r3.score.data[0]);
      }
      var mean = (scores[0] + scores[1] + scores[2] + scores[3] + scores[4]) / 5;
      out.models.dr = { scores: scores, mean: mean, grade: gradeOf(mean), ms: Date.now() - t2 };
      self.postMessage({ type: "progress", eye: msg.eye, model: "dr" });
    }
    self.postMessage(out, [out.models.am ? out.models.am.mask.buffer : new ArrayBuffer(0)]);
  } catch (e) { self.postMessage({ type: "error", eye: msg.eye, message: String(e && e.message || e) + " | " + String(e && e.stack || "") }); }
}
