//! Subject detection for Remove Background / Copy Subject (ADR 0002).
//!
//! U²-Net-p runs natively with tract. The UI sends a 320×320 RGB thumbnail and gets a
//! 320×320 mask back; upscaling the mask and applying it to the full-resolution image
//! happens in the UI, so only ~400 KB crosses the IPC boundary.

use std::sync::OnceLock;
use tauri::ipc::{InvokeBody, Request, Response};
use tract_onnx::prelude::*;

pub const SIZE: usize = 320;
const MODEL: &[u8] = include_bytes!("../models/u2netp.onnx");
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

type Plan = std::sync::Arc<TypedRunnableModel>;

fn model() -> Result<&'static Plan, String> {
    static PLAN: OnceLock<Result<Plan, String>> = OnceLock::new();
    PLAN.get_or_init(|| {
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
        tract_linalg::multithread::set_default_executor(tract_linalg::multithread::Executor::multithread(threads));
        tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(MODEL))
            .and_then(|m| m.with_input_fact(0, f32::fact([1, 3, SIZE, SIZE]).into()))
            .and_then(|m| m.into_optimized())
            .and_then(|m| m.into_runnable())
            .map_err(|e| format!("model failed to load: {e}"))
    })
    .as_ref()
    .map_err(|e| e.clone())
}

/// `rgb` is SIZE×SIZE×3 bytes; returns SIZE×SIZE mask bytes (255 = subject).
pub fn mask(rgb: &[u8]) -> Result<Vec<u8>, String> {
    if rgb.len() != SIZE * SIZE * 3 {
        return Err(format!("expected {} bytes of RGB", SIZE * SIZE * 3));
    }
    let input: Tensor = tract_ndarray::Array4::from_shape_fn((1, 3, SIZE, SIZE), |(_, c, y, x)| {
        let v = rgb[(y * SIZE + x) * 3 + c] as f32 / 255.0;
        (v - MEAN[c]) / STD[c]
    })
    .into();
    let out = model()?.run(tvec!(input.into())).map_err(|e| e.to_string())?;
    let pred = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for &v in pred.iter() {
        lo = lo.min(v);
        hi = hi.max(v);
    }
    let range = (hi - lo).max(1e-6);
    Ok(pred.iter().map(|&v| (((v - lo) / range) * 255.0).round().clamp(0.0, 255.0) as u8).collect())
}

/// Loads the model in the background at startup so the first click feels instant.
pub fn warm_up() {
    std::thread::spawn(|| {
        let _ = model();
    });
}

#[tauri::command]
pub async fn subject_mask(request: Request<'_>) -> Result<Response, String> {
    let rgb = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        _ => return Err("expected binary body".into()),
    };
    let m = tauri::async_runtime::spawn_blocking(move || mask(&rgb)).await.map_err(|e| e.to_string())??;
    Ok(Response::new(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_bright_disk_on_a_dark_background() {
        let mut rgb = vec![0u8; SIZE * SIZE * 3];
        for y in 0..SIZE {
            for x in 0..SIZE {
                let d = ((x as f32 - 160.0).powi(2) + (y as f32 - 160.0).powi(2)).sqrt();
                let v = if d < 90.0 { 230 } else { 25 };
                rgb[(y * SIZE + x) * 3..][..3].copy_from_slice(&[v, v / 2, 40]);
            }
        }
        let m = mask(&rgb).unwrap();
        assert!(m[160 * SIZE + 160] > 200, "center should be subject");
        assert!(m[5 * SIZE + 5] < 30, "corner should be background");
    }

    #[test]
    fn rejects_wrong_input_size() {
        assert!(mask(&[0; 10]).is_err());
    }
}
