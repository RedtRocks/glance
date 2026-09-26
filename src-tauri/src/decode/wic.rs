//! Windows Imaging Component: the system-wide codec engine (ADR 0010).
//!
//! Whatever codecs the user has installed (Raw Image Extension, HEIF, AVIF, WebP,
//! JPEG XR, DDS, …) become available to Glance through this module.

use super::{fit_dims, Decoded};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{GENERIC_READ, RPC_E_CHANGED_MODE};
use windows::Win32::Graphics::Imaging::*;
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::VT_UI2;

fn ensure_com() {
    // Protocol requests run on worker threads; initialize COM once per thread.
    thread_local!(static INIT: () = unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            eprintln!("CoInitializeEx failed: {hr:?}");
        }
    });
    INIT.with(|_| {});
}

fn factory() -> windows::core::Result<IWICImagingFactory> {
    ensure_com();
    unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER) }
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

fn open(f: &IWICImagingFactory, path: &Path) -> windows::core::Result<IWICBitmapDecoder> {
    let p = wide(path);
    unsafe { f.CreateDecoderFromFilename(PCWSTR(p.as_ptr()), None, GENERIC_READ, WICDecodeMetadataCacheOnDemand) }
}

pub fn frame_count(path: &Path) -> Result<u32, String> {
    let f = factory().map_err(|e| e.to_string())?;
    let dec = open(&f, path).map_err(|e| e.to_string())?;
    unsafe { dec.GetFrameCount() }.map_err(|e| e.to_string())
}

/// EXIF orientation (1..=8) via the format-independent System.Photo.Orientation policy.
fn orientation(frame: &IWICBitmapFrameDecode) -> u16 {
    unsafe {
        let Ok(reader) = frame.GetMetadataQueryReader() else { return 1 };
        let mut pv = PROPVARIANT::default();
        let mut value = 1;
        if reader.GetMetadataByName(w!("System.Photo.Orientation"), &mut pv).is_ok() {
            let inner = &pv.Anonymous.Anonymous;
            if inner.vt == VT_UI2 {
                value = inner.Anonymous.uiVal;
            }
        }
        let _ = PropVariantClear(&mut pv);
        value
    }
}

fn transform_for(orientation: u16) -> WICBitmapTransformOptions {
    match orientation {
        2 => WICBitmapTransformFlipHorizontal,
        3 => WICBitmapTransformRotate180,
        4 => WICBitmapTransformFlipVertical,
        5 => WICBitmapTransformOptions(WICBitmapTransformRotate90.0 | WICBitmapTransformFlipHorizontal.0),
        6 => WICBitmapTransformRotate90,
        7 => WICBitmapTransformOptions(WICBitmapTransformRotate270.0 | WICBitmapTransformFlipHorizontal.0),
        8 => WICBitmapTransformRotate270,
        _ => WICBitmapTransformRotate0,
    }
}

pub fn decode(path: &Path, page: u32, max: Option<u32>) -> Result<Decoded, String> {
    decode_inner(path, page, max).map_err(|e| e.to_string())
}

fn decode_inner(path: &Path, page: u32, max: Option<u32>) -> windows::core::Result<Decoded> {
    let f = factory()?;
    let dec = open(&f, path)?;
    let frame = unsafe { dec.GetFrame(page)? };
    let (mut w, mut h) = (0u32, 0u32);
    unsafe { frame.GetSize(&mut w, &mut h)? };

    let mut source: IWICBitmapSource = frame.clone().into();

    // Scale first (cheapest on the native resolution), then orient.
    if let Some(m) = max {
        if w > m || h > m {
            let (sw, sh) = fit_dims(w, h, m);
            let scaler = unsafe { f.CreateBitmapScaler()? };
            unsafe { scaler.Initialize(&source, sw, sh, WICBitmapInterpolationModeFant)? };
            source = scaler.into();
            (w, h) = (sw, sh);
        }
    }

    let o = orientation(&frame);
    if o != 1 {
        let rot = unsafe { f.CreateBitmapFlipRotator()? };
        unsafe { rot.Initialize(&source, transform_for(o))? };
        source = rot.into();
        if (5..=8).contains(&o) {
            std::mem::swap(&mut w, &mut h);
        }
    }

    let conv = unsafe { f.CreateFormatConverter()? };
    unsafe {
        conv.Initialize(
            &source,
            &GUID_WICPixelFormat32bppRGBA,
            WICBitmapDitherTypeNone,
            None,
            0.0,
            WICBitmapPaletteTypeCustom,
        )?
    };
    let stride = w * 4;
    let mut rgba = vec![0u8; (stride * h) as usize];
    unsafe { conv.CopyPixels(std::ptr::null(), stride, &mut rgba)? };
    Ok(Decoded { width: w, height: h, rgba })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("glance-wic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_fn(w, h, |x, y| image::Rgba([x as u8, y as u8, 7, 200]));
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn decodes_png_through_windows_imaging_component() {
        let p = temp("wic.png", &png(40, 20));
        assert_eq!(frame_count(&p).unwrap(), 1);
        let d = decode(&p, 0, None).unwrap();
        assert_eq!((d.width, d.height), (40, 20));
        // Pixel (3, 5): R = x, G = y, straight (non-premultiplied) alpha.
        let i = (5 * 40 + 3) * 4;
        assert_eq!(&d.rgba[i..i + 4], &[3, 5, 7, 200]);
    }

    #[test]
    fn scales_while_decoding() {
        let p = temp("wic-big.png", &png(400, 100));
        let d = decode(&p, 0, Some(100)).unwrap();
        assert_eq!((d.width, d.height), (100, 25));
    }

    #[test]
    fn unknown_data_is_an_error_not_a_crash() {
        let p = temp("junk.bin", b"definitely not an image");
        assert!(decode(&p, 0, None).is_err());
    }
}
