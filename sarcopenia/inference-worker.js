/* global importScripts, ort */
importScripts('ort/ort.wasm.min.js');

ort.env.wasm.wasmPaths = new URL('ort/', self.location.href).href;
ort.env.wasm.numThreads = 1;

let activeModelId = null;
let activeSession = null;

function computeGaussian(patchH, patchW, sigmaScale = 1 / 8) {
  const g = new Float32Array(patchH * patchW);
  const cy = Math.floor(patchH / 2);
  const cx = Math.floor(patchW / 2);
  const sy = patchH * sigmaScale;
  const sx = patchW * sigmaScale;
  const inv2sy2 = 1 / (2 * sy * sy);
  const inv2sx2 = 1 / (2 * sx * sx);
  let maxV = 0;
  for (let y = 0; y < patchH; y++) {
    const dy = y - cy;
    const ey = dy * dy * inv2sy2;
    for (let x = 0; x < patchW; x++) {
      const dx = x - cx;
      const v = Math.exp(-(ey + dx * dx * inv2sx2));
      g[y * patchW + x] = v;
      if (v > maxV) maxV = v;
    }
  }
  const minPos = 1e-6;
  for (let i = 0; i < g.length; i++) {
    const n = g[i] / (maxV || 1);
    g[i] = n < minPos ? minPos : n;
  }
  return g;
}

function computeSteps(imgSize, patchSize, stepSize = 0.5) {
  if (imgSize <= patchSize) return [0];
  const targetStep = patchSize * stepSize;
  const nSteps = Math.ceil((imgSize - patchSize) / targetStep) + 1;
  const maxStart = imgSize - patchSize;
  const actualStep = nSteps > 1 ? maxStart / (nSteps - 1) : 0;
  const steps = [];
  for (let i = 0; i < nSteps; i++) {
    steps.push(Math.round(i * actualStep));
  }
  return steps;
}

function flipTile(tile, h, w, flipY, flipX) {
  const out = new Float32Array(h * w);
  for (let y = 0; y < h; y++) {
    const sy = flipY ? h - 1 - y : y;
    const dstRow = y * w;
    const srcRow = sy * w;
    for (let x = 0; x < w; x++) {
      const sx = flipX ? w - 1 - x : x;
      out[dstRow + x] = tile[srcRow + sx];
    }
  }
  return out;
}

function accumulateMirroredLogits(dst, src, numClasses, h, w, flipY, flipX, scale) {
  const hw = h * w;
  for (let c = 0; c < numClasses; c++) {
    const cOff = c * hw;
    for (let y = 0; y < h; y++) {
      const sy = flipY ? h - 1 - y : y;
      const dstRow = cOff + y * w;
      const srcRow = cOff + sy * w;
      for (let x = 0; x < w; x++) {
        const sx = flipX ? w - 1 - x : x;
        dst[dstRow + x] += src[srcRow + sx] * scale;
      }
    }
  }
}

async function fetchCachedPart(url, partIdx, totalParts, modelId) {
  let cache = null;
  try {
    cache = await caches.open('l3-public-models-v1');
    const cached = await cache.match(url);
    if (cached) {
      self.postMessage({
        type: 'status',
        message: `Loading saved ${modelId} model (${partIdx + 1}/${totalParts}) from device…`,
      });
      return new Uint8Array(await cached.arrayBuffer());
    }
  } catch (_) {}

  self.postMessage({
    type: 'status',
    message: `Downloading ${modelId} model (${partIdx + 1}/${totalParts})… It will be cached on this device.`,
  });
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Model download failed: HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  if (!buf.byteLength) throw new Error('Downloaded model file is empty.');
  if (cache) {
    try {
      await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch (_) {}
  }
  return new Uint8Array(buf);
}

async function ensureModel(modelId, partUrls) {
  if (activeModelId === modelId && activeSession) {
    return activeSession;
  }
  if (activeSession) {
    try {
      await activeSession.release();
    } catch (_) {}
    activeSession = null;
    activeModelId = null;
  }

  const buffers = [];
  let totalBytes = 0;
  for (let i = 0; i < partUrls.length; i++) {
    const chunk = await fetchCachedPart(partUrls[i], i, partUrls.length, modelId);
    buffers.push(chunk);
    totalBytes += chunk.byteLength;
  }

  let merged;
  if (buffers.length === 1) {
    merged = buffers[0];
  } else {
    merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const b of buffers) {
      merged.set(b, offset);
      offset += b.byteLength;
    }
  }

  self.postMessage({ type: 'status', message: `Initializing ${modelId} segmentation model…` });
  activeSession = await ort.InferenceSession.create(merged, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  activeModelId = modelId;
  return activeSession;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'preload') {
      await ensureModel(data.modelId, data.partUrls);
      self.postMessage({ type: 'ready', modelId: data.modelId });
      return;
    }

    if (data.type !== 'infer') return;

    const { modelId, partUrls, image, height, width, patchH, patchW, numClasses, useMirroring } = data;
    const session = await ensureModel(modelId, partUrls);

    const t0 = performance.now();
    const src = new Float32Array(image);

    const padH = Math.max(0, patchH - height);
    const padW = Math.max(0, patchW - width);
    const padTop = Math.floor(padH / 2);
    const padLeft = Math.floor(padW / 2);
    const pH = height + padH;
    const pW = width + padW;

    const padded = new Float32Array(pH * pW);
    for (let y = 0; y < height; y++) {
      const sOff = y * width;
      const dOff = (y + padTop) * pW + padLeft;
      padded.set(src.subarray(sOff, sOff + width), dOff);
    }

    const stepsY = computeSteps(pH, patchH, 0.5);
    const stepsX = computeSteps(pW, patchW, 0.5);
    const gauss = computeGaussian(patchH, patchW, 1 / 8);

    const acc = new Float32Array(numClasses * pH * pW);
    const wSum = new Float32Array(pH * pW);
    const tileBuf = new Float32Array(patchH * patchW);
    const totalTiles = stepsY.length * stepsX.length;
    let doneTiles = 0;

    const mirrorConfigs = useMirroring
      ? [[false, false], [true, false], [false, true], [true, true]]
      : [[false, false]];
    const mirrorWeight = 1 / mirrorConfigs.length;

    for (const sy of stepsY) {
      for (const sx of stepsX) {
        self.postMessage({
          type: 'progress',
          modelId,
          done: doneTiles,
          total: totalTiles,
        });

        for (let y = 0; y < patchH; y++) {
          const off = (sy + y) * pW + sx;
          tileBuf.set(padded.subarray(off, off + patchW), y * patchW);
        }

        const tileLogits = new Float32Array(numClasses * patchH * patchW);
        for (const [fy, fx] of mirrorConfigs) {
          const inpArr = (!fy && !fx) ? tileBuf : flipTile(tileBuf, patchH, patchW, fy, fx);
          const tensor = new ort.Tensor('float32', inpArr, [1, 1, patchH, patchW]);
          const outputs = await session.run({ input: tensor });
          const outTensor = outputs.logits || Object.values(outputs)[0];
          accumulateMirroredLogits(tileLogits, outTensor.data, numClasses, patchH, patchW, fy, fx, mirrorWeight);
          Object.values(outputs).forEach((t) => t.dispose());
        }

        const patchHW = patchH * patchW;
        const pHW = pH * pW;
        for (let y = 0; y < patchH; y++) {
          const pRow = (sy + y) * pW + sx;
          const tRow = y * patchW;
          for (let x = 0; x < patchW; x++) {
            const gVal = gauss[tRow + x];
            wSum[pRow + x] += gVal;
            for (let c = 0; c < numClasses; c++) {
              acc[c * pHW + pRow + x] += tileLogits[c * patchHW + tRow + x] * gVal;
            }
          }
        }
        doneTiles++;
      }
    }

    const outHW = height * width;
    const pHW = pH * pW;
    const unpadded = new Float32Array(numClasses * outHW);
    for (let y = 0; y < height; y++) {
      const py = y + padTop;
      const srcRow = py * pW + padLeft;
      const dstRow = y * width;
      for (let x = 0; x < width; x++) {
        const w = wSum[srcRow + x] || 1e-8;
        for (let c = 0; c < numClasses; c++) {
          unpadded[c * outHW + dstRow + x] = acc[c * pHW + srcRow + x] / w;
        }
      }
    }

    const ms = performance.now() - t0;
    self.postMessage(
      {
        type: 'result',
        modelId,
        logits: unpadded.buffer,
        height,
        width,
        numClasses,
        milliseconds: ms,
      },
      [unpadded.buffer]
    );
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};
