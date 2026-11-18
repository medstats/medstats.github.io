FastUGI-Net B7 + XXS — offline research app

Serve this directory over localhost or HTTPS; do not open index.html directly.
For example, from this folder:
  python -m http.server 8765 --bind 127.0.0.1
Then open http://127.0.0.1:8765/ in Chrome.

Wait for "Ready for offline use". The model and runtime are cached locally.
The app can then reopen at the same address without a network connection.
Clearing browser site data removes the offline copy.

Select JPEG/PNG images, optionally enter a study ID, analyze, and export CSV.
Images are processed locally in memory. No patient data are uploaded.

FP32 B7+XXS model with original 9 anatomy / 10 disease labels.
Research use: scores are not calibrated diagnostic probabilities.
No clinical external validation has been performed for this app.

Source model: https://github.com/allebasycin/FastUGI-Net
Runtime: ONNX Runtime Web 1.20.1; license in vendor/ONNXRUNTIME-LICENSE.
