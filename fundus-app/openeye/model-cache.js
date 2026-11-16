// Cache only public model weights; uploaded photographs are never persisted.
async function loadCachedModel(url, report) {
  var cache = null, response = null, saved = false;
  try {
    cache = await caches.open('fundus-public-models-v1');
    response = await cache.match(url);
  } catch (_) { /* Storage may be unavailable in private browsing. */ }
  if (response) {
    report('Loading saved model from this device…');
    return { bytes: await response.arrayBuffer(), saved: true };
  }
  report('Downloading model (371 MB). It will be saved on this device…');
  response = await fetch(url);
  if (!response.ok) throw new Error('Model download failed: HTTP ' + response.status);
  var bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error('Downloaded model is empty.');
  if (cache) {
    try {
      await cache.put(url, new Response(bytes, {headers: {'Content-Type': 'application/octet-stream'}}));
      saved = true;
    } catch (_) { /* Inference can proceed if the device has insufficient storage. */ }
  }
  return { bytes: bytes, saved: saved };
}
