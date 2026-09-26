# Bundle U²-Net-p and run it in Rust with tract

Remove Background and Copy Subject need an ML model. The maintainer chose to bundle it so it works offline from first launch, rather than downloading it on demand. We ship `u2netp.onnx` (~4.7 MB, Apache-2.0) and run it with `tract-onnx`: pure Rust, no ONNX Runtime DLLs, no WASM runtime. The Rust binary grows, but inference is native-speed and stays off the UI thread.
