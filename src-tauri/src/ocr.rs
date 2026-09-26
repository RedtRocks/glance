//! Text recognition with the OCR engine built into Windows (Windows.Media.Ocr),
//! in the languages the user has installed. No model is shipped with Glance.

use crate::commands::{header, raw_body};
use serde::Serialize;
use tauri::ipc::Request;

#[derive(Serialize)]
pub struct Word {
    pub text: String,
    /// Pixel box in the submitted image.
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Serialize)]
pub struct Line {
    pub text: String,
    pub words: Vec<Word>,
}

#[derive(Serialize)]
pub struct OcrPage {
    pub lines: Vec<Line>,
    pub language: String,
}

/// Recognizes text in BGRA pixels (`x-width` × `x-height`, straight alpha).
#[tauri::command]
pub async fn ocr_image(request: Request<'_>) -> Result<OcrPage, String> {
    let width: u32 = header(&request, "x-width")?.parse().map_err(|_| "bad width")?;
    let height: u32 = header(&request, "x-height")?.parse().map_err(|_| "bad height")?;
    let bgra = raw_body(&request)?;
    if bgra.len() != (width as usize) * (height as usize) * 4 {
        return Err("pixel buffer doesn't match the size".into());
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || win::recognize(&bgra, width, height)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = bgra;
        Err("Text recognition uses the Windows OCR engine and is only available on Windows.".into())
    }
}

/// Largest side the engine accepts; the UI scales pages to fit.
#[tauri::command]
pub fn ocr_max_dimension() -> u32 {
    #[cfg(windows)]
    {
        windows::Media::Ocr::OcrEngine::MaxImageDimension().unwrap_or(2600)
    }
    #[cfg(not(windows))]
    {
        0
    }
}

#[cfg(windows)]
mod win {
    use super::{Line, OcrPage, Word};
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Security::Cryptography::CryptographicBuffer;

    pub fn recognize(bgra: &[u8], width: u32, height: u32) -> Result<OcrPage, String> {
        let run = || -> windows::core::Result<OcrPage> {
            let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
            let buffer = CryptographicBuffer::CreateFromByteArray(bgra)?;
            let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, width as i32, height as i32)?;
            let result = engine.RecognizeAsync(&bitmap)?.join()?;
            let mut lines = Vec::new();
            let all = result.Lines()?;
            for i in 0..all.Size()? {
                let line = all.GetAt(i)?;
                let words = line.Words()?;
                let mut out = Vec::new();
                for k in 0..words.Size()? {
                    let w = words.GetAt(k)?;
                    let r = w.BoundingRect()?;
                    out.push(Word { text: w.Text()?.to_string(), x: r.X, y: r.Y, w: r.Width, h: r.Height });
                }
                lines.push(Line { text: line.Text()?.to_string(), words: out });
            }
            let language = engine.RecognizerLanguage()?.DisplayName()?.to_string();
            Ok(OcrPage { lines, language })
        };
        run().map_err(|e| {
            if e.code().is_ok() {
                "No OCR language is installed. Add one in Settings → Time & language → Language & region.".to_string()
            } else {
                e.message()
            }
        })
    }
}
