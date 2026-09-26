# Bundled models

## u2netp.onnx

- **Model:** U²-Net-p (the 4.7 MB "portable" variant of U²-Net), salient object detection, used for Remove Background and Copy Subject (ADR 0002).
- **Source:** https://github.com/xuebinqin/U-2-Net (Apache-2.0), ONNX export as published by the rembg project: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
- **SHA-256:** `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`
- **Input:** 1×3×320×320 float32, RGB normalized with ImageNet mean/std. **Output:** 1×1×320×320 saliency in 0..1.

Embedded into the binary with `include_bytes!` (see `src/subject.rs`).
