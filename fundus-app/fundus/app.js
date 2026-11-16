var worker = new Worker("worker.js?v=3");
var eyes = { R: null, L: null };
var results = { R: null, L: null };
var ready = false;
var totalTasks = 0, doneTasks = 0;
function el(id) { return document.getElementById(id); }
function setStatus(t) { el("status").textContent = t; }
worker.onmessage = function (ev) {
  var m = ev.data;
  if (m.type === "ready") { ready = true; setStatus("Models ready."); el("runBtn").disabled = false; return; }
  if (m.type === "progress") { doneTasks++; el("progBar").style.width = Math.round(100 * doneTasks / Math.max(totalTasks, 1)) + "%"; return; }
  if (m.type === "result") { results[m.eye] = m.models; renderEye(m.eye); checkDone(); return; }
  if (m.type === "error") { setStatus("Error: " + m.message); return; }
};
worker.onerror = function (e) { setStatus("Worker error: " + e.message); };
worker.postMessage({ type: "init", base: "models/" });

function loadFile(input, eye) {
  var f = input.files[0];
  if (!f) return;
  var url = URL.createObjectURL(f);
  var img = new Image();
  img.onload = function () {
    var c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    var d = ctx.getImageData(0, 0, c.width, c.height);
    eyes[eye] = { w: c.width, h: c.height, pixels: d.data.buffer.slice(0) };
    drawPreview(eye, img);
  };
  img.onerror = function () { URL.revokeObjectURL(url); setStatus("Could not decode that file. Use a JPEG or PNG photo."); };
    img.src = url;
}
function drawPreview(eye, img) {
  var e = eyes[eye];
  var src = document.createElement("canvas");
  src.width = e.w; src.height = e.h;
  var sctx = src.getContext("2d");
  var id = sctx.createImageData(e.w, e.h);
  id.data.set(new Uint8ClampedArray(e.pixels));
  sctx.putImageData(id, 0, 0);
  var mean = 0; var step = Math.max(1, Math.floor(e.pixels.length / 4000));
  var cnt = 0;
  for (var k = 0; k < e.pixels.length; k += step * 4) { mean += e.pixels[k] + e.pixels[k+1] + e.pixels[k+2]; cnt += 3; }
  mean = Math.round(mean / Math.max(cnt, 1));
  var maxW = 520;
  var sc = Math.min(1, maxW / img.naturalWidth);
  var cw = Math.round(img.naturalWidth * sc), ch = Math.round(img.naturalHeight * sc);
  var pv = el("prev" + eye), ov = el("over" + eye);
  pv.width = cw; pv.height = ch; ov.width = cw; ov.height = ch;
  pv.getContext("2d").drawImage(src, 0, 0, cw, ch);
  el("stat" + eye).textContent = "Loaded " + e.w + "x" + e.h + ", brightness " + mean + ". Choose models and press Run.";
}
function selectedModels() {
  var out = [];
  if (el("m_am").checked) out.push("am");
  if (el("m_seg").checked) out.push("seg");
  if (el("m_dr").checked) out.push("dr");
  return out;
}
el("fileR").addEventListener("change", function (e) { loadFile(e.target, "R"); });
el("fileL").addEventListener("change", function (e) { loadFile(e.target, "L"); });
el("runBtn").addEventListener("click", function () {
  var models = selectedModels();
  if (!models.length) { setStatus("Select at least one model."); return; }
  var has = ["R", "L"].filter(function (e) { return eyes[e] !== null; });
  if (!has.length) { setStatus("Load a right or left eye image first."); return; }
  results = { R: null, L: null };
  totalTasks = has.length * models.length;
  doneTasks = 0;
  el("progBar").style.width = "0%";
  setStatus("Running...");
  el("csvBtn").disabled = true;
  has.forEach(function (e) {
    var buf = eyes[e].pixels.slice(0);
    worker.postMessage({ type: "run", eye: e, pixels: buf, w: eyes[e].w, h: eyes[e].h, models: models }, [buf]);
  });
});

function fmt(x, d) { return (x === null || x === undefined || isNaN(x)) ? "-" : Number(x).toFixed(d === undefined ? 3 : d); }
function renderEye(eye) { drawOverlay(eye); renderTable(); }
function checkDone() {
  var has = ["R", "L"].filter(function (e) { return eyes[e] !== null; });
  var done = has.filter(function (e) { return results[e] !== null; });
  if (done.length === has.length) { setStatus("Done."); el("csvBtn").disabled = false; }
}
function drawOverlay(eye) {
  var o = el("over" + eye);
  var ctx = o.getContext("2d");
  ctx.clearRect(0, 0, o.width, o.height);
  var r = results[eye];
  if (!r) return;
  var defs = [{ k: "am", color: "#22c55e", dash: [] }, { k: "seg", color: "#e0218a", dash: [6, 4] }];
  defs.forEach(function (d) {
    var m = r[d.k];
    if (!m || !m.cdr || !m.cdr.valid) return;
    var H = m.hw[0], W = m.hw[1];
    var sx = o.width / W, sy = o.height / H;
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(d.dash);
    var groups = [[m.discBd, m.cdr.discBox], [m.cupBd, m.cdr.cupBox]];
    groups.forEach(function (pair) {
      var pts = pair[0], box = pair[1];
      ctx.beginPath();
      for (var i = 0; i < pts.length; i++) {
        var X = pts[i][0] * sx, Y = pts[i][1] * sy;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.closePath();
      ctx.stroke();
      var cx = (box[0] + box[2]) / 2 * sx, cy = (box[1] + box[3]) / 2 * sy;
      ctx.beginPath();
      ctx.moveTo(cx, box[1] * sy);
      ctx.lineTo(cx, box[3] * sy);
      ctx.moveTo(box[0] * sx, cy);
      ctx.lineTo(box[2] * sx, cy);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  });
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, o.height - 22, o.width, 22);
  ctx.fillStyle = "#fff";
  ctx.font = "12px system-ui";
  ctx.fillText("solid green = AutoMorph, dashed pink = SegFormer", 8, o.height - 7);
}

function rowCells(tr, vals) {
  vals.forEach(function (t) { var td = document.createElement("td"); td.textContent = t; tr.appendChild(td); });
}
function renderTable() {
  var tb = el("resTable").querySelector("tbody");
  tb.innerHTML = "";
  var any = false;
  ["R", "L"].forEach(function (eye) {
    var r = results[eye];
    if (!r) return;
    any = true;
    var names = { am: "AutoMorph", seg: "SegFormer" };
    ["am", "seg"].forEach(function (k) {
      var m = r[k];
      if (!m) return;
      var c = m.cdr;
      var tr = document.createElement("tr");
      if (c && c.valid) rowCells(tr, [eye, names[k], fmt(c.vcdr), fmt(c.hcdr), c.discW + "x" + c.discH, c.cupW + "x" + c.cupH, "-", (m.ms / 1000).toFixed(1) + "s", ""]);
      else rowCells(tr, [eye, names[k], "-", "-", "-", "-", "-", "-", (c && c.reason) || "failed"]);
      tb.appendChild(tr);
    });
    if (r.dr) {
      var tr = document.createElement("tr");
      rowCells(tr, [eye, "DR 5-fold", "-", "-", "-", "-", "grade " + r.dr.grade + " (mean " + r.dr.mean.toFixed(2) + ")", (r.dr.ms / 1000).toFixed(1) + "s", r.dr.grade >= 2 ? "referable range" : ""]);
      tb.appendChild(tr);
    }
    var vs = [];
    ["am", "seg"].forEach(function (k) { if (r[k] && r[k].cdr && r[k].cdr.valid) vs.push(r[k].cdr.vcdr); });
    if (vs.length === 2) {
      var tr = document.createElement("tr");
      rowCells(tr, [eye, "median consensus", fmt((vs[0] + vs[1]) / 2), "-", "-", "-", "-", "-", "-", "of AutoMorph + SegFormer"]);
      tb.appendChild(tr);
    }
  });
  if (!any) tb.innerHTML = "<tr><td colspan=9>No results yet.</td></tr>";
}
el("csvBtn").addEventListener("click", function () {
  var lines = ["eye,model,vcdr,hcdr,disc_w,disc_h,cup_w,cup_h,dr_grade,dr_mean,note"];
  ["R", "L"].forEach(function (eye) {
    var r = results[eye];
    if (!r) return;
    ["am", "seg"].forEach(function (k) {
      var m = r[k];
      if (!m) return;
      var c = m.cdr;
      if (c && c.valid) lines.push([eye, k, c.vcdr.toFixed(4), c.hcdr.toFixed(4), c.discW, c.discH, c.cupW, c.cupH, "", "", ""].join(","));
      else lines.push([eye, k, "", "", "", "", "", "", "", "", ((c && c.reason) || "failed")].join(","));
    });
    if (r.dr) lines.push([eye, "dr", "", "", "", "", "", r.dr.grade, r.dr.mean.toFixed(4), r.dr.grade >= 2 ? "referable-range" : ""].join(","));
  });
  var blob = new Blob([lines.join("\n")], { type: "text/csv" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fundus_cdr_results.csv";
  a.click();
});
