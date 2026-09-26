//! Native image encoding for Save / Save As / Export of images.

use image::codecs::{bmp::BmpEncoder, jpeg::JpegEncoder, png::PngEncoder, tiff::TiffEncoder, webp::WebPEncoder};
use image::{ExtendedColorType, ImageEncoder, RgbaImage};
use crate::color::{convert, Profile};
use std::io::Cursor;
use tauri::ipc::{InvokeBody, Request};

/// Encodes RGBA pixels into `format`. JPEG has no alpha, so transparent pixels are
/// composited onto white (Preview does the same).
pub fn encode(format: &str, width: u32, height: u32, rgba: &[u8], quality: u8) -> Result<Vec<u8>, String> {
    encode_with_profile(format, width, height, rgba, quality, None)
}

/// Like [`encode`], converting from sRGB into `profile` and embedding its ICC
/// profile (PNG, JPEG, TIFF, WebP). Gray profiles write grayscale images.
pub fn encode_with_profile(format: &str, width: u32, height: u32, rgba: &[u8], quality: u8, profile: Option<Profile>) -> Result<Vec<u8>, String> {
    if rgba.len() != (width as usize) * (height as usize) * 4 {
        return Err("pixel buffer doesn't match size".into());
    }
    let mut out = Cursor::new(Vec::new());
    let e = |e: image::ImageError| e.to_string();
    if let Some(p) = profile {
        let mut px = rgba.to_vec();
        convert(&mut px, p);
        let icc = crate::color::icc(p);
        let gray = p == Profile::Gray;
        let opaque = px.chunks_exact(4).all(|q| q[3] == 255);
        // Composite on white where the format has no alpha (JPEG) or the image is opaque anyway.
        let flat = |channels: usize| -> Vec<u8> {
            px.chunks_exact(4)
                .flat_map(|q| {
                    let a = q[3] as u32;
                    (0..channels).map(move |i| ((q[i] as u32 * a + 255 * (255 - a)) / 255) as u8)
                })
                .collect()
        };
        let (buf, color): (Vec<u8>, ExtendedColorType) = match (gray, opaque || matches!(format, "jpg" | "jpeg" | "jfif")) {
            (true, true) => (flat(1), ExtendedColorType::L8),
            (true, false) => (px.chunks_exact(4).flat_map(|q| [q[0], q[3]]).collect(), ExtendedColorType::La8),
            (false, true) => (flat(3), ExtendedColorType::Rgb8),
            (false, false) => (px.clone(), ExtendedColorType::Rgba8),
        };
        match format {
            "png" => {
                let mut enc = PngEncoder::new(&mut out);
                enc.set_icc_profile(icc).map_err(|e| e.to_string())?;
                enc.write_image(&buf, width, height, color).map_err(e)?
            }
            "jpg" | "jpeg" | "jfif" => {
                let mut enc = JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100));
                enc.set_icc_profile(icc).map_err(|e| e.to_string())?;
                enc.write_image(&buf, width, height, color).map_err(e)?
            }
            "tif" | "tiff" => {
                let mut enc = TiffEncoder::new(&mut out);
                enc.set_icc_profile(icc).map_err(|e| e.to_string())?;
                enc.write_image(&buf, width, height, color).map_err(e)?
            }
            other => return Err(format!("Color profiles can be embedded in PNG, JPEG and TIFF, not .{other}")),
        }
        return Ok(out.into_inner());
    }
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
    let profile = header(&request, "x-profile").ok().and_then(|p| Profile::parse(&p));
    let rgba = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        _ => return Err("expected binary body".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = encode_with_profile(&format, width, height, &rgba, quality, profile)?;
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

    #[test]
    fn embeds_the_chosen_color_profile() {
        use image::ImageDecoder;
        let rgba: Vec<u8> = (0..16).flat_map(|i| [i as u8 * 10, 50, 200, 255]).collect();
        for (fmt, p, name) in [("png", Profile::DisplayP3, "Display P3"), ("jpg", Profile::AdobeRgb, "Adobe RGB (1998) compatible"), ("png", Profile::Gray, "Gray Gamma 2.2")] {
            let bytes = encode_with_profile(fmt, 4, 4, &rgba, 90, Some(p)).unwrap();
            let icc = match fmt {
                "png" => image::codecs::png::PngDecoder::new(Cursor::new(&bytes)).unwrap().icc_profile().unwrap(),
                _ => image::codecs::jpeg::JpegDecoder::new(Cursor::new(&bytes)).unwrap().icc_profile().unwrap(),
            }
            .expect("profile embedded");
            assert_eq!(crate::color::profile_name(&icc).as_deref(), Some(name));
        }
    }
}
