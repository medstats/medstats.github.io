// Shared UI for both echo tools. The page sets window.ECHO_PAGE to "panecho" or "unity".
var PAGE = window.ECHO_PAGE || "panecho";
var worker = new Worker("../worker.js?v=4");
var vids = [];
var busy = false, modelReady = false, hasVideo = false;
function el(id) { return document.getElementById(id); }
function setStatus(t) { var s = el("status"); if (s) s.textContent = t; }
function updateRun() { var b = el("runBtn"); if (b) b.disabled = !(modelReady && hasVideo) || busy; }
function finish() { busy = false; updateRun(); var bar = el("bar"); if (bar) bar.style.width = "100%"; }

worker.onmessage = function (ev) {
  var m = ev.data;
  if (m.type === "status") { setStatus(m.message); return; }
  if (m.type === "ready") { modelReady = true; setStatus("Model ready. Add a cine and press Run."); updateRun(); return; }
  if (m.type === "progress") {
    var bar = el("bar"); if (bar) bar.style.width = Math.round(100 * m.value) + "%";
    if (m.label) setStatus(m.label);
    return;
  }
  if (m.type === "panecho_result") { renderPanecho(m); finish(); return; }
  if (m.type === "unity_result") { renderUnity(m); finish(); return; }
  if (m.type === "error") { setStatus("Error: " + m.message); finish(); return; }
};
worker.onerror = function (e) { setStatus("Worker error: " + e.message); finish(); };

function waitForData(v) {
  if (v.readyState >= 2) return Promise.resolve();
  return new Promise(function (res) {
    var done = false;
    function fin() { if (done) return; done = true; res(); }
    v.addEventListener("loadeddata", fin, { once: true });
    v.addEventListener("canplay", fin, { once: true });
    v.addEventListener("canplaythrough", fin, { once: true });
    setTimeout(fin, 7000);
  });
}
function seekTo(v, t) {
  return new Promise(function (res) {
    if (Math.abs(v.currentTime - t) < 1e-3) return res();
    var done = false;
    function fin() { if (done) return; done = true; res(); }
    v.addEventListener("seeked", fin, { once: true });
    setTimeout(fin, 1500);
    v.currentTime = t;
  });
}
function grabSquare(v, size) {
  var c = document.createElement("canvas");
  c.width = size; c.height = size;
  var ctx = c.getContext("2d");
  ctx.drawImage(v, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}
function drawPreview(item) {
  var p = el("prev");
  if (!p) return;
  var side = Math.min(520, Math.max(240, p.clientWidth || 420));
  p.width = side; p.height = side;
  var ctx = p.getContext("2d");
  ctx.drawImage(item.el, 0, 0, side, side);
  var ov = el("over");
  if (ov) {
    ov.width = side; ov.height = side;
    ov.getContext("2d").clearRect(0, 0, side, side);
  }
  var d = ctx.getImageData(0, 0, side, side).data;
  var sum = 0;
  for (var i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  if (sum / (side * side * 3) < 1.5) {
    setTimeout(function () { try { ctx.drawImage(item.el, 0, 0, side, side); } catch (_) {} }, 400);
  }
}

function renderFileList() {
  var box = el("fileList");
  if (!box) return;
  if (!vids.length) { box.textContent = ""; return; }
  var lines = vids.map(function (v, i) {
    return (i + 1) + ". " + v.name + " &mdash; " + v.w + "x" + v.h + ", " + v.dur.toFixed(1) + " s";
  });
  var extra = "";
  if (PAGE === "panecho" && vids.length > 1) {
    extra = "<br><span class='muted'>Averaged across all " + vids.length + " cines.</span>";
  }
  if (PAGE === "unity" && vids.length > 1) {
    extra = "<br><span class='muted'>Unity-GLS uses the first cine only; select the apical loop.</span>";
  }
  box.innerHTML = lines.join("<br>") + extra;
}

var fileInput = el("file");
if (fileInput) fileInput.addEventListener("change", async function (e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  if (!files.length) return;
  vids.forEach(function (v) { try { v.el.src = ""; } catch (_) {} });
  vids = [];
  var list = el("fileList"); if (list) list.textContent = "Loading cines…";
  var failed = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.src = URL.createObjectURL(f);
    var ok = await new Promise(function (res) {
      v.addEventListener("loadedmetadata", function () { res(true); }, { once: true });
      v.addEventListener("error", function () { res(false); }, { once: true });
      setTimeout(function () { res(v.videoWidth > 0); }, 8000);
    });
    if (!ok) { failed.push(f.name); continue; }
    vids.push({ name: f.name, el: v, dur: v.duration || 0, w: v.videoWidth, h: v.videoHeight });
  }
  hasVideo = vids.length > 0;
  renderFileList();
  if (vids.length) {
    await waitForData(vids[0].el);
    await seekTo(vids[0].el, Math.min(vids[0].dur / 2, Math.max(0.05, vids[0].dur * 0.4)));
    drawPreview(vids[0]);
  }
  setStatus(failed.length
    ? "Could not decode: " + failed.join(", ") + ". Try MP4 (H.264)."
    : "Loaded " + vids.length + " cine" + (vids.length === 1 ? "" : "s") + ". Press Run.");
  updateRun();
});

var runBtn = el("runBtn");
if (runBtn) runBtn.addEventListener("click", async function () {
  if (!vids.length || busy) return;
  busy = true; updateRun();
  var bar = el("bar"); if (bar) bar.style.width = "0%";
  try {
    if (PAGE === "panecho") await runPanecho(); else await runUnity();
  } catch (err) {
    setStatus("Error: " + (err.message || err));
    busy = false; updateRun();
  }
});

async function runPanecho() {
  var clips = 4, per = 16, step = 1 / 30, all = [];
  for (var vi = 0; vi < vids.length; vi++) {
    var item = vids[vi];
    await waitForData(item.el);
    for (var c = 0; c < clips; c++) {
      setStatus("Cine " + (vi + 1) + " of " + vids.length + ", clip " + (c + 1) + " of " + clips + "…");
      var start = (item.dur * c) / clips;
      var frames = [];
      for (var k = 0; k < per; k++) {
        var t = Math.min(start + k * step, Math.max(0, item.dur - 0.03));
        await seekTo(item.el, t);
        frames.push(grabSquare(item.el, 256));
      }
      all.push(frames);
    }
  }
  setStatus("Running PanEcho on " + all.length + " clips…");
  worker.postMessage({ type: "run_panecho", clips: all, w: 256, h: 256 });
}

async function runUnity() {
  var item = vids[0];
  await waitForData(item.el);
  var offsets = [-9, -3, -1, 0, 1, 3, 9];
  var windows = 8, step = 1 / 30, all = [];
  for (var i = 0; i < windows; i++) {
    setStatus("Context window " + (i + 1) + " of " + windows + "…");
    var tc = (item.dur * i) / windows + item.dur / (windows * 2);
    var frames = [];
    for (var k = 0; k < offsets.length; k++) {
      var t = Math.min(Math.max(tc + offsets[k] * step, 0), Math.max(0, item.dur - 0.03));
      await seekTo(item.el, t);
      frames.push(grabSquare(item.el, 608));
    }
    frames.t = tc;
    all.push(frames);
  }
  setStatus("Running Unity-GLS on " + windows + " windows…");
  worker.postMessage({ type: "run_unity", windows: all, w: 608, h: 608 });
}

function fmt(v) { return (v === null || v === undefined || isNaN(v)) ? "-" : Number(v).toFixed(2); }

function renderPanecho(m) {
  var tb = el("peTable");
  if (!tb) return;
  var body = tb.querySelector("tbody");
  body.innerHTML = "";
  m.rows.forEach(function (r) {
    var tr = document.createElement("tr");
    var measure = document.createElement("td"); measure.textContent = r.name;
    var val = document.createElement("td");
    if (r.type === "multi-class_classification") {
      var best = 0;
      for (var i = 1; i < r.values.length; i++) if (r.values[i] > r.values[best]) best = i;
      val.textContent = (r.classes[best] || ("class " + best)) + " (" + fmt(r.values[best]) + ")";
    } else if (r.type === "binary_classification") {
      val.textContent = fmt(r.values[0]) + "  P(" + r.positive + ")";
    } else {
      val.textContent = fmt(r.values[0]);
    }
    tr.appendChild(measure); tr.appendChild(val); body.appendChild(tr);
  });
  var meta = el("peMeta");
  if (meta) meta.textContent = "Averaged over " + m.clips + " clips from " + vids.length +
    " cine" + (vids.length === 1 ? "" : "s") + ". Model estimates only; units follow the upstream task definitions.";
}

function renderUnity(m) {
  var ov = el("over");
  if (!ov) return;
  var ctx = ov.getContext("2d");
  ctx.clearRect(0, 0, ov.width, ov.height);
  var sc = ov.width / 608;
  var w0 = m.windows[0];
  if (!w0) return;
  ctx.strokeStyle = "#e0218a"; ctx.lineWidth = 2; ctx.beginPath();
  w0.curve.forEach(function (p, i) { var X = p[0] * sc, Y = p[1] * sc; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
  ctx.stroke();
  [[w0.apex, "#22c55e"], [w0.ant, "#1565c0"], [w0.inf, "#f59e0b"]].forEach(function (p) {
    ctx.fillStyle = p[1]; ctx.beginPath();
    ctx.arc(p[0].x * sc, p[0].y * sc, 5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, ov.height - 20, ov.width, 20);
  ctx.fillStyle = "#fff"; ctx.font = "12px system-ui";
  ctx.fillText("pink: endocardial curve   green: apex   blue/amber: MV hinges", 8, ov.height - 6);
  var stats = el("unityStats");
  if (stats) {
    stats.innerHTML = (m.shortening === null)
      ? "<strong>No endocardial curve detected.</strong> Confirm the cine is an apical view."
      : "<strong>Shortening:</strong> " + (m.shortening * 100).toFixed(1) + "%" +
        " &nbsp; <strong>max length:</strong> " + m.maxLen.toFixed(1) + " px" +
        " &nbsp; <strong>min length:</strong> " + m.minLen.toFixed(1) + " px" +
        " &nbsp; <span class='muted'>608-px model grid; no physical calibration</span>";
  }
  var lm = el("lmTable");
  if (lm) {
    var body = lm.querySelector("tbody");
    body.innerHTML = "";
    m.layers.forEach(function (name, i) {
      var tr = document.createElement("tr");
      var c1 = document.createElement("td"); c1.textContent = name;
      var p = i === 1 ? w0.apex : i === 2 ? w0.ant : i === 3 ? w0.inf : null;
      var c2 = document.createElement("td");
      c2.textContent = p ? ("x=" + p.x + ", y=" + p.y + " (" + p.v.toFixed(3) + ")") : (w0.curve.length + " points");
      tr.appendChild(c1); tr.appendChild(c2); body.appendChild(tr);
    });
  }
}

modelReady = false;
setStatus("Loading " + PAGE + " model…");
worker.postMessage({ type: "init", model: PAGE });

