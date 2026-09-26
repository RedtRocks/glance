# Bundle U²-Net-p and run it in Rust with tract

Remove Background and Copy Subject need an ML model. The maintainer chose to bundle it so it works offline from first launch, rather than downloading it on demand. We ship `u2netp.onnx` (~4.7 MB, Apache-2.0) and run it with `tract-onnx`: pure Rust, no ONNX Runtime DLLs, no WASM runtime. The Rust binary grows, but inference is native-speed and stays off the UI thread.

## Consequences
- The model is embedded in the binary (`include_bytes!`); installers are ~6 MB.
- tract's multithreaded matrix multiply is enabled: one inference took 1.9 s single-threaded and 1.1 s multithreaded on a 4-core CI-class VM. The model loads in the background at startup, so the first click doesn't pay the ~0.3 s load.
- Only a 320×320 thumbnail goes to the model; the mask is upscaled and applied to the full-resolution image in the UI.
