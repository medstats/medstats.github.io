var worker = new Worker("worker.js?v=10");
var eyeImg = null;
function el(id) { return document.getElementById(id); }
function setStatus(t) { el("status").textContent = t; }
worker.onmessage = function (ev) {
  var m = ev.data;
  if (m.type === "loading") { setStatus(m.message); return; }
  if (m.type === "ready") { setStatus("Model ready. " + (m.saved ? "Saved on this device for future visits." : "Device storage unavailable; a future visit may download again.")); el("runBtn").disabled = false; return; }
  if (m.type === "result") { renderTop(m.top, m.ms); return; }
  if (m.type === "error") { setStatus("Error: " + m.message); return; }
};
worker.onerror = function (e) { setStatus("Worker error: " + e.message); };
worker.postMessage({ type: "init" });
el("fileEye").addEventListener("change", function (e) {
  var f = e.target.files[0];
  if (!f) return;
  var url = URL.createObjectURL(f);
  var img = new Image();
  img.onload = function () {
    eyeImg = null;
    var c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    var d = ctx.getImageData(0, 0, c.width, c.height);
    var mean = 0, cnt = 0, step = Math.max(1, Math.floor(d.data.length / 4 / 2000));
    for (var k = 0; k < d.data.length; k += step * 4) { mean += d.data[k] + d.data[k+1] + d.data[k+2]; cnt += 3; }
    mean = Math.round(mean / Math.max(cnt, 1));
    eyeImg = { w: c.width, h: c.height, pixels: d.data.buffer.slice(0) };
    var p = el("prevEye");
    var sc = Math.min(1, 420 / c.width);
    p.width = Math.round(c.width * sc); p.height = Math.round(c.height * sc);
    p.getContext("2d").drawImage(c, 0, 0, p.width, p.height);
    setStatus("Loaded " + c.width + "x" + c.height + ", brightness " + mean + ". Press Run.");
  };
  img.onerror = function () { URL.revokeObjectURL(url); setStatus("Could not decode that file. Use a JPEG or PNG photo."); };
    img.src = url;
});
el("runBtn").addEventListener("click", function () {
  if (!eyeImg) { setStatus("Load an image first."); return; }
  setStatus("Running...");
  var buf = eyeImg.pixels.slice(0);
  worker.postMessage({ type: "run", pixels: buf, w: eyeImg.w, h: eyeImg.h }, [buf]);
});
function renderTop(top, ms) {
  var tb = el("eyeTable").querySelector("tbody");
  tb.innerHTML = "";
  top.forEach(function (r, i) {
    var tr = document.createElement("tr");
    [String(i + 1), r.label, Number(r.score).toFixed(3)].forEach(function (t) {
      var td = document.createElement("td"); td.textContent = t; tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  setStatus("Done in " + (ms / 1000).toFixed(1) + "s. Raw scores, no thresholds applied.");
}
