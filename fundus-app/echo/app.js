var worker = new Worker("worker.js?v=1");
var vid = null, dur = 0, fps = 30, currentModel = "panecho", busy = false;
var modelReady = false, hasVideo = false;
var outW = 0, outH = 0;
function el(id) { return document.getElementById(id); }
function setStatus(t) { el("status").textContent = t; }

worker.onmessage = function (ev) {
  var m = ev.data;
  if (m.type === "status") { setStatus(m.message); return; }
  if (m.type === "ready") { modelReady = true; setStatus("Model ready (" + m.model + "). Choose a cine and press Run."); updateRun(); return; }
  if (m.type === "progress") { el("bar").style.width = Math.round(100 * m.value) + "%"; if (m.label) setStatus(m.label); return; }
  if (m.type === "panecho_result") { renderPanecho(m); finish(); return; }
  if (m.type === "unity_result") { renderUnity(m); finish(); return; }
  if (m.type === "error") { setStatus("Error: " + m.message); finish(); return; }
};
worker.onerror = function (e) { setStatus("Worker error: " + e.message); finish(); };

function updateRun() { el("runBtn").disabled = !(modelReady && hasVideo) || busy; }
function finish() { busy = false; updateRun(); el("bar").style.width = "100%"; }

function pickModel(model) {
  currentModel = model;
  el("panechoPanel").style.display = "none";
  el("unityPanel").style.display = "none";
  modelReady = false; updateRun();
  setStatus("Loading " + model + " model…");
  worker.postMessage({ type: "init", model: model });
  return false;
}
el("mPanecho").addEventListener("change", function () { if (this.checked) pickModel("panecho"); });
el("mUnity").addEventListener("change", function () { if (this.checked) pickModel("unity"); });


function drawPreview() {
  var p = el("prev");
  var side = Math.min(520, Math.max(240, p.clientWidth || 420));
  p.width = side; p.height = side;
  p.getContext("2d").drawImage(vid, 0, 0, side, side);
  var ov = el("over");
  ov.width = side; ov.height = side;
  var d = p.getContext("2d").getImageData(0, 0, side, side).data;
  var s = 0;
  for (var i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2];
  var mean = Math.round(s / (side * side * 3));
  if (mean < 1) setStatus("Preview is blank; the browser may not have decoded a frame yet. Press Run anyway or reload the cine.");
}

function seekTo(t) {
  return new Promise(function (res) {
    if (Math.abs(vid.currentTime - t) < 1e-3) return res();
    var done = false;
    function fin() { if (done) return; done = true; res(); }
    vid.addEventListener("seeked", fin, { once: true });
    setTimeout(fin, 1200);
    vid.currentTime = t;
  });
}
function grabSquare(size) {
  var c = document.createElement("canvas");
  c.width = size; c.height = size;
  var ctx = c.getContext("2d");
  ctx.drawImage(vid, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

el("file").addEventListener("change", function (e) {
  var f = e.target.files[0];
  if (!f) return;
  if (vid) { vid.remove(); vid = null; }
  vid = document.createElement("video");
  vid.muted = true; vid.playsInline = true; vid.preload = "auto";
  vid.src = URL.createObjectURL(f);
  vid.addEventListener("loadedmetadata", function () {
    dur = vid.duration || 0;
    outW = vid.videoWidth; outH = vid.videoHeight;
    el("fileInfo").textContent = f.name + " — " + outW + "x" + outH + ", " + dur.toFixed(1) + " s";
    hasVideo = true;
    setStatus("Cine loaded. Press Run.");
    updateRun();
    // Metadata exists before any frame is decoded; seek once so the preview is real pixels.
    vid.addEventListener("seeked", drawPreview, { once: true });
    vid.currentTime = Math.min(0.05, Math.max(0, dur / 2));
  }, { once: true });
  vid.addEventListener("error", function () { setStatus("Could not decode that video. Try MP4 (H.264)."); });
});

el("runBtn").addEventListener("click", async function () {
  if (!vid || busy) return;
  busy = true; updateRun(); el("bar").style.width = "0%";
  try {
    if (currentModel === "panecho") await runPanecho();
    else await runUnity();
  } catch (err) {
    setStatus("Error: " + (err.message || err));
    busy = false; updateRun();
  }
});

async function runPanecho() {
  setStatus("Extracting frames…");
  var clips = 4, per = 16, step = 1 / fps;
  var all = [];
  for (var c = 0; c < clips; c++) {
    var start = (dur * c) / clips;
    var frames = [];
    for (var k = 0; k < per; k++) {
      var t = Math.min(start + k * step, Math.max(0, dur - 0.03));
      await seekTo(t);
      frames.push(grabSquare(256));
    }
    all.push(frames);
  }
  setStatus("Running PanEcho…");
  el("panechoPanel").style.display = "block";
  el("unityPanel").style.display = "none";
  worker.postMessage({ type: "run_panecho", clips: all, w: 256, h: 256 });
}

async function runUnity() {
  setStatus("Extracting context frames…");
  var offsets = [-9, -3, -1, 0, 1, 3, 9];
  var windows = 8, step = 1 / fps, all = [];
  for (var i = 0; i < windows; i++) {
    var tc = (dur * i) / windows + dur / (windows * 2);
    var frames = [];
    for (var k = 0; k < offsets.length; k++) {
      var t = Math.min(Math.max(tc + offsets[k] * step, 0), Math.max(0, dur - 0.03));
      await seekTo(t);
      frames.push(grabSquare(608));
    }
    frames.t = tc;
    all.push(frames);
  }
  setStatus("Running Unity-GLS…");
  el("panechoPanel").style.display = "none";
  el("unityPanel").style.display = "block";
  worker.postMessage({ type: "run_unity", windows: all, w: 608, h: 608 });
}

function fmt(v) { return (v === null || v === undefined || isNaN(v)) ? "-" : Number(v).toFixed(2); }
function renderPanecho(m) {
  var tb = el("peTable").querySelector("tbody");
  tb.innerHTML = "";
  m.rows.forEach(function (r) {
    var tr = document.createElement("tr");
    var cell = document.createElement("td");
    var measure = document.createElement("td");
    measure.textContent = r.name;
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
    tr.appendChild(measure); tr.appendChild(val);
    tb.appendChild(tr);
  });
  el("peMeta").textContent = "Averaged over " + m.clips + " clips. Values are model estimates from 16-frame clips; units follow the upstream task definitions.";
}

function renderUnity(m) {
  var ov = el("over");
  var ctx = ov.getContext("2d");
  ctx.clearRect(0, 0, ov.width, ov.height);
  var sc = ov.width / 608;
  var w0 = m.windows[0];
  if (!w0) return;
  ctx.strokeStyle = "#e0218a"; ctx.lineWidth = 2; ctx.beginPath();
  w0.curve.forEach(function (p, i) { var X = p[0] * sc, Y = p[1] * sc; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
  ctx.stroke();
  var pts = [[w0.apex, "#22c55e", "apex"], [w0.ant, "#1565c0", "ant hinge"], [w0.inf, "#f59e0b", "inf hinge"]];
  pts.forEach(function (p) {
    ctx.fillStyle = p[1]; ctx.beginPath();
    ctx.arc(p[0].x * sc, p[0].y * sc, 5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, ov.height - 20, ov.width, 20);
  ctx.fillStyle = "#fff"; ctx.font = "12px system-ui";
  ctx.fillText("pink: endocardial curve   green: apex   blue/amber: MV hinges", 8, ov.height - 6);
  var noCurve = (m.shortening === null);
  el("unityStats").innerHTML = noCurve
    ? "<strong>No endocardial curve detected.</strong> Check the preview: a blank or non-apical frame yields no ridge. <span class='muted'>Curve threshold is relative to heatmap peak.</span>"
    : "<strong>Shortening:</strong> " + (m.shortening * 100).toFixed(1) + "%" +
      " &nbsp; <strong>max length:</strong> " + m.maxLen.toFixed(1) + " px" +
      " &nbsp; <strong>min length:</strong> " + m.minLen.toFixed(1) + " px" +
      " &nbsp; <span class='muted'>relative to the 608-px model grid; no physical calibration</span>";
  var tb = el("lmTable").querySelector("tbody");
  tb.innerHTML = "";
  m.layers.forEach(function (name, i) {
    var tr = document.createElement("tr");
    var c1 = document.createElement("td"); c1.textContent = name;
    var p = i === 1 ? w0.apex : i === 2 ? w0.ant : i === 3 ? w0.inf : null;
    var c2 = document.createElement("td"); c2.textContent = p ? ("x=" + p.x + ", y=" + p.y + " (" + p.v.toFixed(3) + ")") : (w0.curve.length + " points");
    tr.appendChild(c1); tr.appendChild(c2); tb.appendChild(tr);
  });
}

// PanEcho is the default selection, so start loading it immediately.
pickModel("panecho");
