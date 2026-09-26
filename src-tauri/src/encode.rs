//! Native image encoding for Save / Save As / Export of images.

use image::codecs::{bmp::BmpEncoder, jpeg::JpegEncoder, png::PngEncoder, tiff::TiffEncoder, webp::WebPEncoder};
use image::{ExtendedColorType, ImageEncoder, RgbaImage};
use std::io::Cursor;
use tauri::ipc::{InvokeBody, Request};

/// Encodes RGBA pixels into `format`. JPEG has no alpha, so transparent pixels are
/// composited onto white (Preview does the same).
pub fn encode(format: &str, width: u32, height: u32, rgba: &[u8], quality: u8) -> Result<Vec<u8>, String> {
    if rgba.len() != (width as usize) * (height as usize) * 4 {
        return Err("pixel buffer doesn't match size".into());
    }
    let mut out = Cursor::new(Vec::new());
    let e = |e: image::ImageError| e.to_string();
    match format {
        "png" => PngEncoder::new(&mut out).write_image(rgba, width, height, ExtendedColorType::Rgba8).map_err(e)?,
        "jpg" | "jpeg" | "jfif" => {
            let rgb: Vec<u8> = rgba
                .chunks_exact(4)
                .flat_map(|p| {
                    let a = p[3] as u32;
                    [0, 1, 2].map(|i| ((p[i] as u32 * a + 255 * (255 - a)) / 255) as u8)
                })
                .collect();
            JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100))
                .write_image(&rgb, width, height, ExtendedColorType::Rgb8)
                .map_err(e)?
        }
        "webp" => WebPEncoder::new_lossless(&mut out).write_image(rgba, width, height, ExtendedColorType::Rgba8).map_err(e)?,
        "bmp" | "dib" => BmpEncoder::new(&mut out).write_image(rgba, width, height, ExtendedColorType::Rgba8).map_err(e)?,
        "tif" | "tiff" => TiffEncoder::new(&mut out).write_image(rgba, width, height, ExtendedColorType::Rgba8).map_err(e)?,
        "tga" | "qoi" | "ico" => {
            let img = RgbaImage::from_raw(width, height, rgba.to_vec()).ok_or("bad buffer")?;
            let fmt = image::ImageFormat::from_extension(format).ok_or("unsupported format")?;
            img.write_to(&mut out, fmt).map_err(e)?
        }
        other => return Err(format!("Glance can't write .{other} files")),
    }
    Ok(out.into_inner())
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let v = request.headers().get(name).ok_or_else(|| format!("missing header {name}"))?;
    Ok(percent_encoding::percent_decode_str(v.to_str().map_err(|e| e.to_string())?).decode_utf8_lossy().into_owned())
}

/// Encodes and writes atomically (temp file + rename).
#[tauri::command]
pub async fn save_image(request: Request<'_>) -> Result<(), String> {
    let path = std::path::PathBuf::from(header(&request, "x-path")?);
    let format = header(&request, "x-format")?.to_ascii_lowercase();
    let width: u32 = header(&request, "x-width")?.parse().map_err(|_| "bad width")?;
    let height: u32 = header(&request, "x-height")?.parse().map_err(|_| "bad height")?;
    let quality: u8 = header(&request, "x-quality").ok().and_then(|q| q.parse().ok()).unwrap_or(90);
    let rgba = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        _ => return Err("expected binary body".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = encode(&format, width, height, &rgba, quality)?;
        let tmp = path.with_extension(format!("{format}.glance-tmp"));
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            e.to_string()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_format_round_trips_dimensions() {
        let (w, h) = (7, 5);
        let rgba: Vec<u8> = (0..w * h).flat_map(|i| [i as u8 * 3, 100, 200, 255]).collect();
        for fmt in ["png", "jpg", "webp", "bmp", "tiff", "tga", "qoi", "ico"] {
            let bytes = encode(fmt, w, h, &rgba, 90).unwrap_or_else(|e| panic!("{fmt}: {e}"));
            let known = image::ImageFormat::from_extension(fmt).unwrap();
            let img = image::load_from_memory_with_format(&bytes, known).unwrap_or_else(|e| panic!("{fmt}: {e}"));
            assert_eq!((img.width(), img.height()), (w, h), "{fmt}");
        }
    }

    #[test]
    fn jpeg_composites_transparency_on_white() {
        let rgba = [0, 0, 0, 0u8].repeat(16 * 16);
        let img = image::load_from_memory(&encode("jpg", 16, 16, &rgba, 95).unwrap()).unwrap().to_rgb8();
        assert!(img.get_pixel(8, 8).0.iter().all(|&v| v > 245));
    }

    #[test]
    fn png_keeps_alpha_exactly() {
        let rgba = [10, 20, 30, 40u8, 50, 60, 70, 80];
        let back = image::load_from_memory(&encode("png", 2, 1, &rgba, 90).unwrap()).unwrap().to_rgba8();
        assert_eq!(back.as_raw().as_slice(), &rgba);
    }

    #[test]
    fn refuses_formats_it_cannot_write() {
        assert!(encode("heic", 1, 1, &[0; 4], 90).is_err());
        assert!(encode("png", 2, 2, &[0; 4], 90).is_err());
    }
}
