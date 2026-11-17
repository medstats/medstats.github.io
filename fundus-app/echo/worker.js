importScripts("../vendor/ort.min.js");
importScripts("model-cache.js");
importScripts("preprocess.js");
importScripts("tasks.js");
ort.env.wasm.numThreads = (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated) ? 4 : 1;
ort.env.wasm.wasmPaths = new URL("../vendor/", self.location.href).href;

var PINS = "07d2bb26f9e813d9203debb508390fb65a494a63";
var URLS = {
  panecho: "https://huggingface.co/AnupamK/panecho-onnx/resolve/" + PINS + "/panecho.onnx",
  unity: "https://huggingface.co/AnupamK/panecho-onnx/resolve/" + PINS + "/unity_gls.onnx"
};
var SIZES = { panecho: 168457629, unity: 268182424 };
var UNITY_LAYERS = ["curve-lv-endo", "lv-apex-endo", "mv-ant-wall-hinge", "mv-inf-wall-hinge"];
var loaded = null, session = null, sessionBytes = 0;

function report(t) { self.postMessage({ type: "status", message: t }); }

async function ensure(model) {
  if (session && loaded === model) return session;
  if (session) { try { await session.release(); } catch (e) {} session = null; loaded = null; }
  var got = await loadCachedModel(URLS[model], report, SIZES[model]);
  report("Preparing model for inference…");
  session = await ort.InferenceSession.create(got.bytes, { executionProviders: ["wasm"] });
  loaded = model; sessionBytes = got.bytes.byteLength;
  self.postMessage({ type: "ready", model: model, saved: got.saved });
  return session;
}

self.onmessage = async function (ev) {
  var m = ev.data;
  try {
    if (m.type === "init") { await ensure(m.model); return; }
    if (m.type === "run_panecho") { await runPanecho(m); return; }
    if (m.type === "run_unity") { await runUnity(m); return; }
  } catch (e) {
    self.postMessage({ type: "error", message: String(e && e.message || e) + (e && e.stack ? " | " + e.stack : "") });
  }
};

async function runPanecho(m) {
  var s = await ensure("panecho");
  var total = ECHO_TASKS.reduce(function (a, t) { return a + t.size; }, 0);
  var acc = new Float32Array(total);
  var clips = m.clips, done = 0;
  for (var c = 0; c < clips.length; c++) {
    var frames = clips[c];
    if (!frames.length) continue;
    var t = panechoClipTensor(frames, m.w, m.h);
    var out = await s.run({ frames: new ort.Tensor("float32", t, [1, 3, frames.length, 224, 224]) });
    var v = out.preds.data;
    for (var i = 0; i < total; i++) acc[i] += v[i];
    done++;
    self.postMessage({ type: "progress", value: done / clips.length, label: "clip " + done + " of " + clips.length });
  }
  if (!done) throw new Error("No clips produced");
  for (var j = 0; j < total; j++) acc[j] /= done;
  var rows = [], off = 0;
  ECHO_TASKS.forEach(function (task) {
    var size = task.size, vals = [];
    for (var k = 0; k < size; k++) vals.push(acc[off + k]);
    off += size;
    rows.push({ name: task.name, type: task.type, classes: task.classes, positive: task.positive, values: vals });
  });
  self.postMessage({ type: "panecho_result", rows: rows, clips: done });
}

async function runUnity(m) {
  var s = await ensure("unity");
  var results = [], wins = m.windows;
  for (var i = 0; i < wins.length; i++) {
    var frames = wins[i];
    if (frames.length !== 7) throw new Error("Unity needs seven context frames, got " + frames.length);
    var t = unityStackTensor(frames, m.w, m.h);
    var out = await s.run({ frames: new ort.Tensor("float32", t, [1, 7, m.h, m.w]) });
    var lm = unityLandmarks(out.heatmaps.data, UNITY_LAYERS, m.h, m.w);
    lm.t = wins[i].t;
    results.push(lm);
    self.postMessage({ type: "progress", value: (i + 1) / wins.length, label: "window " + (i + 1) + " of " + wins.length });
  }
  var lens = results.map(function (r) { return r.lengthPx; }).filter(function (v) { return v > 0; });
  var max = lens.length ? Math.max.apply(null, lens) : null;
  var min = lens.length ? Math.min.apply(null, lens) : null;
  var short = (max && max > 0) ? (max - min) / max : null;
  self.postMessage({
    type: "unity_result", windows: results, layers: UNITY_LAYERS,
    maxLen: max, minLen: min, shortening: short
  });
}

