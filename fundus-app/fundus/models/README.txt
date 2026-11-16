Open weights bundled with the fundus browser demo (small enough for GitHub Pages).
Source of truth for hashes: project Drive onnx/ folder and parity reports.

automorph_ensemble.onnx (2.5 MB, FP32)
  All 8 AutoMorph WNet seeds averaged into one graph. Input image (1,3,512,512).
  Frozen EyeQ preprocessing, 512 bilinear, /255. No normalization.
segformer_int8.onnx (49 MB, INT8)
  pamixsun segformer_for_optic_disc_cup_segmentation at pinned revision.
  Input pixel_values (1,3,512,512). Square-pad non-square photos first.
  Preprocessing: bilinear 512, /255, ImageNet normalize.
  INT8 verified: 99.99 percent mask agreement vs FP32 on 4 photos.
fold1.onnx .. fold5.onnx (16 MB each, FP32)
  senanurcetin aptos-retinopathy-grader 5-fold DR ensemble. Input image (1,3,384,384).
  Preprocessing: auto-crop tol 7, square pad, INTER_AREA 384, ImageNet normalize.
  Grade = digitize of 5-fold mean with thresholds from export.json.
  INT8 builds of these folds are INVALID (exploding activations) and are not shipped.
export.json
  Publisher thresholds, preprocessing record and parity statement for the DR grader.

The OpenEye app loads openeye_vision.onnx (371 MB) from Hugging Face at the pinned commit recorded in openeye/worker.js. Nothing else is fetched remotely.
r2v2 excluded from the app. segformer FP32, r2v2_bv, openeye_vision stay on HF.
