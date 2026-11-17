// Cache only public model weights. Echo videos are never persisted.
async function loadCachedModel(url, report, expectedBytes) {
  var cache = null, response = null, saved = false;
  var mb = expectedBytes ? Math.round(expectedBytes / 1e6) : null;
  try {
    cache = await caches.open("echo-public-models-v1");
    response = await cache.match(url);
  } catch (_) { /* storage unavailable in private browsing */ }
  if (response) {
    report("Loading saved model from this device…");
    return { bytes: await response.arrayBuffer(), saved: true };
  }
  report("Downloading model" + (mb ? " (" + mb + " MB)" : "") + ". It will be saved on this device…");
  response = await fetch(url);
  if (!response.ok) throw new Error("Model download failed: HTTP " + response.status);
  var bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error("Downloaded model is empty.");
  if (expectedBytes && Math.abs(bytes.byteLength - expectedBytes) > 1024) {
    throw new Error("Model size mismatch: got " + bytes.byteLength + ", expected " + expectedBytes);
  }
  if (cache) {
    try {
      await cache.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
      saved = true;
    } catch (_) { /* inference can proceed without persisting */ }
  }
  return { bytes: bytes, saved: saved };
}

