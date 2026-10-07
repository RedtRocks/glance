//! Image decoding pipeline (ADR 0010): WIC first on Windows, then pure-Rust decoders.

pub mod archive;
pub mod bmp;
pub mod eps;
pub mod formats;
pub mod psd;
pub mod raw_preview;
#[cfg(windows)]
pub mod wic;
#[cfg(windows)]
pub mod xps;

use image::{DynamicImage, ImageDecoder, RgbaImage};
use std::io::Cursor;
use std::path::Path;

pub struct Decoded {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl Decoded {
    fn from_rgba(img: RgbaImage) -> Self {
        let (width, height) = img.dimensions();
        Decoded { width, height, rgba: img.into_raw() }
    }

    fn fit(self, max: Option<u32>) -> Self {
        match max {
            Some(m) if self.width > m || self.height > m => {
                let img = RgbaImage::from_raw(self.width, self.height, self.rgba).expect("buffer size");
                let (w, h) = fit_dims(self.width, self.height, m);
                Decoded::from_rgba(image::imageops::thumbnail(&img, w, h))
            }
            _ => self,
        }
    }
}

pub fn fit_dims(w: u32, h: u32, max: u32) -> (u32, u32) {
    if w >= h {
        (max, ((h as f64 * max as f64 / w as f64).round() as u32).max(1))
    } else {
        (((w as f64 * max as f64 / h as f64).round() as u32).max(1), max)
    }
}

/// Number of pages/frames the backend exposes for a file (multi-page TIFF, CBZ).
pub fn page_count(path: &Path) -> u32 {
    let ext = formats::extension(path);
    if ext == "cbz" {
        return archive::page_names(path).map(|n| n.len() as u32).unwrap_or(0);
    }
    if ext == "xps" || ext == "oxps" {
        // Rendered by the Windows XPS rasterizer; 0 = can't be shown here.
        #[cfg(windows)]
        return xps::page_count(path).unwrap_or(0);
        #[cfg(not(windows))]
        return 0;
    }
    #[cfg(windows)]
    if let Ok(n) = wic::frame_count(path) {
        return n;
    }
    if ext == "tif" || ext == "tiff" {
        return std::fs::File::open(path)
            .map_err(|e| e.to_string())
            .and_then(|file| tiff_page_count(std::io::BufReader::new(file)))
            .unwrap_or(1);
    }
    1
}

/// Decodes one page of an image file, optionally downscaled so neither side exceeds `max`.
///
/// Decoders parse untrusted files; a bug in any of them must produce an error for that
/// file, never take the whole app down.
pub fn decode(path: &Path, page: u32, max: Option<u32>) -> Result<Decoded, String> {
    std::panic::catch_unwind(|| decode_unguarded(path, page, max))
        .unwrap_or_else(|_| Err("The decoder failed on this file. It may be damaged.".into()))
}

fn decode_unguarded(path: &Path, page: u32, max: Option<u32>) -> Result<Decoded, String> {
    let ext = formats::extension(path);

    if ext == "cbz" {
        let (_, bytes) = archive::read_page(path, page as usize)?;
        return decode_bytes(&bytes, None).map(|d| d.fit(max));
    }

    #[cfg(windows)]
    if ext == "xps" || ext == "oxps" {
        let (width, height, rgba) = xps::render(path, page, max)?;
        return Ok(Decoded { width, height, rgba }.fit(max));
    }

    #[cfg(windows)]
    {
        // WIC can downscale while decoding, which is far cheaper for thumbnails.
        if let Ok(d) = wic::decode(path, page, max) {
            return Ok(d);
        }
    }

    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    if ext == "tif" || ext == "tiff" {
        match decode_tiff(&data, page) {
            Ok(d) => return Ok(d.fit(max)),
            Err(e) if page != 0 => return Err(e),
            // Keep the image crate's first-page support for uncommon TIFF layouts.
            Err(_) => {}
        }
    }
    Ok(decode_data(&ext, &data)?.fit(max))
}

/// Decodes a whole file's bytes with the pure-Rust decoders, picked by extension.
/// Shared with the browser version (web/decoder), which has no WIC.
pub fn decode_data(ext: &str, data: &[u8]) -> Result<Decoded, String> {
    let decoded = match ext {
        "jp2" | "j2k" | "jpf" | "jpx" | "j2c" => decode_jpeg2000(data)?,
        "jxl" => decode_jxl(data)?,
        "psd" | "psb" => psd::decode(data)?,
        "icns" => decode_icns(data)?,
        "eps" | "epsf" | "epsi" => {
            let tiff = eps::embedded_tiff_preview(data).ok_or("This EPS file has no embedded preview")?;
            decode_bytes(tiff, None)?
        }
        _ if formats::RAW_IMAGES.contains(&ext) => {
            let jpeg = raw_preview::largest_embedded_jpeg(data)
                .ok_or("No RAW codec is installed and the file has no embedded preview")?;
            decode_bytes(jpeg, raw_preview::tiff_orientation(data))?
        }
        _ => decode_hinted(data, image::ImageFormat::from_extension(ext), None)?,
    };
    Ok(decoded)
}

fn tiff_page_count(reader: impl std::io::Read + std::io::Seek) -> Result<u32, String> {
    let mut decoder = tiff::decoder::Decoder::new(reader).map_err(|e| e.to_string())?;
    let mut count = 1u32;
    while decoder.more_images() {
        decoder.next_image().map_err(|e| e.to_string())?;
        count = count.checked_add(1).ok_or("Too many TIFF pages")?;
    }
    Ok(count)
}

/// Decodes any page of a multi-page TIFF; the `image` crate only reads the first page.
fn decode_tiff(data: &[u8], page: u32) -> Result<Decoded, String> {
    use tiff::{decoder::DecodingResult, ColorType};

    let mut decoder = tiff::decoder::Decoder::new(Cursor::new(data)).map_err(|e| e.to_string())?;
    for _ in 0..page {
        decoder.next_image().map_err(|e| e.to_string())?;
    }
    let (width, height) = decoder.dimensions().map_err(|e| e.to_string())?;
    let color = decoder.colortype().map_err(|e| e.to_string())?;
    let orientation = decoder.get_tag_u32(tiff::tags::Tag::Orientation).ok()
        .and_then(|v| u8::try_from(v).ok())
        .and_then(image::metadata::Orientation::from_exif);
    macro_rules! pixels {
        ($variant:ident, $data:expr) => {
            DynamicImage::$variant(image::ImageBuffer::from_raw(width, height, $data)
                .ok_or("Invalid TIFF pixel buffer")?)
        };
    }
    let mut img = match (color, decoder.read_image().map_err(|e| e.to_string())?) {
        // Bilevel (fax) pages: MSB-first bits, rows padded to whole bytes; WhiteIsZero is
        // already inverted by the tiff crate, so 1 = white.
        (ColorType::Gray(1), DecodingResult::U8(v)) => {
            let stride = (width as usize).div_ceil(8);
            let mut luma = Vec::with_capacity(width as usize * height as usize);
            for row in v.chunks_exact(stride).take(height as usize) {
                luma.extend((0..width as usize).map(|x| if row[x / 8] & (0x80 >> (x % 8)) != 0 { 255 } else { 0 }));
            }
            pixels!(ImageLuma8, luma)
        }
        (ColorType::Gray(8), DecodingResult::U8(v)) => pixels!(ImageLuma8, v),
        (ColorType::Gray(16), DecodingResult::U16(v)) => pixels!(ImageLuma16, v),
        (ColorType::GrayA(8), DecodingResult::U8(v)) => pixels!(ImageLumaA8, v),
        (ColorType::GrayA(16), DecodingResult::U16(v)) => pixels!(ImageLumaA16, v),
        (ColorType::RGB(8), DecodingResult::U8(v)) => pixels!(ImageRgb8, v),
        (ColorType::RGB(16), DecodingResult::U16(v)) => pixels!(ImageRgb16, v),
        (ColorType::RGBA(8), DecodingResult::U8(v)) => pixels!(ImageRgba8, v),
        (ColorType::RGBA(16), DecodingResult::U16(v)) => pixels!(ImageRgba16, v),
        (ColorType::CMYK(8), DecodingResult::U8(mut v)) => {
            for p in v.chunks_exact_mut(4) {
                let k = 255 - p[3] as u16;
                for c in &mut p[..3] {
                    *c = ((255 - *c as u16) * k / 255) as u8;
                }
                p[3] = 255;
            }
            pixels!(ImageRgba8, v)
        }
        _ => return Err("Unsupported TIFF color layout".into()),
    };
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(Decoded::from_rgba(img.into_rgba8()))
}

/// Generic path through the `image` crate, honoring EXIF orientation.
pub fn decode_bytes(data: &[u8], orientation_override: Option<u8>) -> Result<Decoded, String> {
    decode_hinted(data, None, orientation_override)
}

/// Like [`decode_bytes`], falling back to `hint` for formats without magic bytes (TGA).
fn decode_hinted(
    data: &[u8],
    hint: Option<image::ImageFormat>,
    orientation_override: Option<u8>,
) -> Result<Decoded, String> {
    let mut reader = image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    if reader.format().is_none() {
        if let Some(fmt) = hint {
            reader.set_format(fmt);
        }
    }
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    if let Some(o) = orientation_override.and_then(|v| image::metadata::Orientation::from_exif(v)) {
        img.apply_orientation(o);
    } else if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(Decoded::from_rgba(to_display_rgba(img)))
}

/// Converts any color type to 8-bit sRGB RGBA; HDR content is tone-mapped.
fn to_display_rgba(img: DynamicImage) -> RgbaImage {
    match img {
        DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_) => tone_map(img.into_rgba32f()),
        other => other.into_rgba8(),
    }
}

/// Reinhard tone mapping + sRGB transfer for linear HDR data (EXR, Radiance HDR).
fn tone_map(img: image::Rgba32FImage) -> RgbaImage {
    let (w, h) = img.dimensions();
    let mut out = RgbaImage::new(w, h);
    for (src, dst) in img.pixels().zip(out.pixels_mut()) {
        let c = |v: f32| -> u8 {
            let v = v.max(0.0);
            let mapped = v / (1.0 + v);
            let srgb = if mapped <= 0.003_130_8 { mapped * 12.92 } else { 1.055 * mapped.powf(1.0 / 2.4) - 0.055 };
            (srgb * 255.0 + 0.5).clamp(0.0, 255.0) as u8
        };
        dst.0 = [c(src[0]), c(src[1]), c(src[2]), (src[3].clamp(0.0, 1.0) * 255.0 + 0.5) as u8];
    }
    out
}

fn decode_jpeg2000(data: &[u8]) -> Result<Decoded, String> {
    let img = hayro_jpeg2000::Image::new(data, &hayro_jpeg2000::DecodeSettings::default())
        .map_err(|e| format!("{e:?}"))?;
    let dynamic = DynamicImage::from_decoder(img).map_err(|e| e.to_string())?;
    Ok(Decoded::from_rgba(dynamic.into_rgba8()))
}

fn decode_jxl(data: &[u8]) -> Result<Decoded, String> {
    let dec = jxl_oxide::integration::JxlDecoder::new(Cursor::new(data)).map_err(|e| e.to_string())?;
    let img = DynamicImage::from_decoder(dec).map_err(|e| e.to_string())?;
    Ok(Decoded::from_rgba(to_display_rgba(img)))
}


fn decode_icns(data: &[u8]) -> Result<Decoded, String> {
    let family = icns::IconFamily::read(Cursor::new(data)).map_err(|e| e.to_string())?;
    let best = family
        .available_icons()
        .into_iter()
        .max_by_key(|t| t.pixel_width())
        .ok_or("empty icon file")?;
    let icon = family.get_icon_with_type(best).map_err(|e| e.to_string())?;
    let rgba = icon.convert_to(icns::PixelFormat::RGBA);
    Ok(Decoded { width: rgba.width(), height: rgba.height(), rgba: rgba.data().to_vec() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_temp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("glance-decode-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    fn encode(img: &DynamicImage, fmt: image::ImageFormat) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, fmt).unwrap();
        out.into_inner()
    }

    #[test]
    fn decodes_tga_and_downscales() {
        let img = DynamicImage::ImageRgba8(RgbaImage::from_pixel(400, 200, image::Rgba([1, 2, 3, 255])));
        let p = write_temp("t.tga", &encode(&img, image::ImageFormat::Tga));
        let d = decode(&p, 0, Some(100)).unwrap();
        assert_eq!((d.width, d.height), (100, 50));
        assert_eq!(&d.rgba[0..4], &[1, 2, 3, 255]);
    }

    #[test]
    fn decodes_each_tiff_page() {
        use tiff::encoder::{colortype, TiffEncoder};

        let mut bytes = Cursor::new(Vec::new());
        {
            let mut encoder = TiffEncoder::new(&mut bytes).unwrap();
            encoder.write_image::<colortype::RGB8>(1, 1, &[255, 0, 0]).unwrap();
            encoder.write_image::<colortype::RGBA8>(2, 1, &[1, 2, 3, 255, 4, 5, 6, 255]).unwrap();
        }
        let bytes = bytes.into_inner();
        let p = write_temp("multipage.tiff", &bytes);
        assert_eq!(tiff_page_count(Cursor::new(&bytes)).unwrap(), 2);
        assert_eq!(page_count(&p), 2);
        let d = decode_tiff(&bytes, 1).unwrap();
        assert_eq!((d.width, d.height), (2, 1));
        assert_eq!(&d.rgba[..4], &[1, 2, 3, 255]);
        let d = decode(&p, 1, None).unwrap();
        assert_eq!((d.width, d.height), (2, 1));
        assert_eq!(&d.rgba[..4], &[1, 2, 3, 255]);
        let d = decode(&p, 1, Some(1)).unwrap();
        assert_eq!((d.width, d.height), (1, 1));
        assert!(decode_tiff(&bytes, 2).is_err());
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn decodes_bilevel_tiff_page() {
        // Hand-built 10x2 1-bit TIFF; the tiff encoder can't write bilevel images.
        let mut t = b"II*\0".to_vec();
        t.extend(12u32.to_le_bytes());
        t.extend([0x80, 0x40, 0, 0]); // row 0: pixels 0 and 9 white; row 1 black
        let tags: [(u16, u16, u32); 8] =
            [(256, 3, 10), (257, 3, 2), (258, 3, 1), (259, 3, 1), (262, 3, 1), (273, 4, 8), (278, 3, 2), (279, 4, 4)];
        t.extend((tags.len() as u16).to_le_bytes());
        for (tag, kind, value) in tags {
            t.extend(tag.to_le_bytes());
            t.extend(kind.to_le_bytes());
            t.extend(1u32.to_le_bytes());
            t.extend(value.to_le_bytes());
        }
        t.extend(0u32.to_le_bytes());
        let d = decode_tiff(&t, 0).unwrap();
        assert_eq!((d.width, d.height), (10, 2));
        let px = |x: usize, y: usize| d.rgba[(y * 10 + x) * 4];
        assert_eq!((px(0, 0), px(1, 0), px(9, 0), px(0, 1)), (255, 0, 255, 0));
    }

    #[test]
    fn tone_maps_hdr_into_displayable_range() {
        let mut hdr = image::Rgba32FImage::new(2, 1);
        hdr.put_pixel(0, 0, image::Rgba([0.0, 0.0, 0.0, 1.0]));
        hdr.put_pixel(1, 0, image::Rgba([1000.0, 1.0, 0.18, 1.0]));
        let out = tone_map(hdr);
        assert_eq!(out.get_pixel(0, 0).0, [0, 0, 0, 255]);
        let p = out.get_pixel(1, 0).0;
        assert!(p[0] > 250 && p[1] > 150 && p[1] < 200 && p[2] > 90 && p[2] < 130, "{p:?}");
    }

    #[test]
    fn raw_without_codec_falls_back_to_embedded_preview() {
        let preview = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(120, 80, image::Rgb([9, 9, 9])));
        let mut file = b"FUJIFILMCCD-RAW 0201".to_vec();
        file.extend(encode(&preview, image::ImageFormat::Jpeg));
        let p = write_temp("x.raf", &file);
        #[cfg(not(windows))]
        {
            let d = decode(&p, 0, None).unwrap();
            assert_eq!((d.width, d.height), (120, 80));
        }
        let _ = p;
    }

    #[test]
    fn fit_dims_keeps_aspect() {
        assert_eq!(fit_dims(4000, 3000, 256), (256, 192));
        assert_eq!(fit_dims(1000, 4000, 200), (50, 200));
    }
}
