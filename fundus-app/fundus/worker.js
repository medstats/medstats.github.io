// Classic worker: image in, measurements out. Loaded with the UMD ORT build.
importScripts("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js");
importScripts("worker-lib.js");
ort.env.wasm.numThreads = (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated) ? 4 : 1;
ort.env.wasm.simd = true;
var sessions = {};
var MODEL_DEFS = {
  am: { file: "automorph_ensemble.onnx", input: "image", output: "probs" },
  seg: { file: "segformer_int8.onnx", input: "pixel_values", output: "logits" },
  dr: { files: ["fold1.onnx", "fold2.onnx", "fold3.onnx", "fold4.onnx", "fold5.onnx"], input: "image", output: "score" }
};
var THR = [0.668, 1.132, 2.324, 3.3];
function gradeOf(mean) {
  var g = 0;
  for (var i = 0; i < THR.length; i++) if (mean >= THR[i]) g = i + 1;
  return g;
}
function argmaxCHW(logits, C, H, W) {
  var m = new Uint8Array(H * W);
  for (var i = 0; i < H * W; i++) {
    var best = 0, bv = logits[i];
    for (var c = 1; c < C; c++) { var v = logits[c * H * W + i]; if (v > bv) { bv = v; best = c; } }
    m[i] = best;
  }
  return m;
}
self.onmessage = function (ev) {
  var msg = ev.data;
  if (msg.type === "init") {
    var jobs = [];
    Object.keys(MODEL_DEFS).forEach(function (k) {
      var d = MODEL_DEFS[k];
      var files = d.files || [d.file];
      files.forEach(function (f, idx) {
        var key = d.files ? k + idx : k;
        jobs.push(ort.InferenceSession.create(msg.base + f, { executionProviders: ["wasm"] }).then(function (s) { sessions[key] = s; }));
      });
    });
    Promise.all(jobs).then(function () { self.postMessage({ type: "ready" }); }).catch(function (e) { self.postMessage({ type: "error", message: String(e && e.message || e) }); });
    return;
  }
  if (msg.type === "run") {
    try {
      var px = new Uint8Array(msg.pixels);
      var rgb = new Uint8Array(msg.w * msg.h * 3);
      for (var i = 0, j = 0; i < msg.w * msg.h; i++, j += 4) { rgb[i * 3] = px[j]; rgb[i * 3 + 1] = px[j + 1]; rgb[i * 3 + 2] = px[j + 2]; }
      var out = { type: "result", eye: msg.eye, models: {} };
      if (msg.models.indexOf("am") >= 0) {
        var t0 = Date.now();
        var t = automorphTensor(rgb, msg.h, msg.w);
        var inp = new ort.Tensor("float32", t.tensor, [1, 3, 512, 512]);
        var r = sessions.am.run({ image: inp });
        out.models.am = finishSeg(r.probs.data, 3, 512, 512);
        out.models.am.ms = Date.now() - t0;
        self.postMessage({ type: "progress", eye: msg.eye, model: "am" });
      }
      if (msg.models.indexOf("seg") >= 0) {
        var t1 = Date.now();
        var s = segformerTensor(rgb, msg.h, msg.w);
        var inp2 = new ort.Tensor("float32", s, [1, 3, 512, 512]);
        var r2 = sessions.seg.run({ pixel_values: inp2 });
        out.models.seg = finishSeg(r2.logits.data, 3, 128, 128);
        out.models.seg.ms = Date.now() - t1;
        self.postMessage({ type: "progress", eye: msg.eye, model: "seg" });
      }
      if (msg.models.indexOf("dr") >= 0) {
        var t2 = Date.now();
        var dt = drTensor(rgb, msg.h, msg.w);
        var scores = [];
        for (var f = 0; f < 5; f++) {
          var inp3 = new ort.Tensor("float32", dt, [1, 3, 384, 384]);
          var r3 = sessions["dr" + f].run({ image: inp3 });
          scores.push(r3.score.data[0]);
        }
        var mean = (scores[0] + scores[1] + scores[2] + scores[3] + scores[4]) / 5;
        out.models.dr = { scores: scores, mean: mean, grade: gradeOf(mean) };
        out.models.dr.ms = Date.now() - t2;
        self.postMessage({ type: "progress", eye: msg.eye, model: "dr" });
      }
      self.postMessage(out);
    } catch (e) { self.postMessage({ type: "error", eye: msg.eye, message: String(e && e.message || e) }); }
  }
};
function finishSeg(logits, C, H, W) {
  var m = argmaxCHW(logits, C, H, W);
  var cdr = cdrFromMask(m, H, W);
  var bd = boundaryPts(m, H, W, 1, 1200);
  var bc = boundaryPts(m, H, W, 2, 1200);
  return { cdr: cdr, discBd: bd, cupBd: bc, hw: [H, W], mask: m };
}
