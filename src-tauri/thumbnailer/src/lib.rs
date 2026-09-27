//! Explorer thumbnail handler for the formats Windows can't preview itself: PDFs (first
//! page, rendered by Windows.Data.Pdf) and the images, camera RAW, XPS, EPS and comics
//! Glance opens, decoded by the app's own pipeline (src-tauri/src/decode).
//!
//! Each extension gets its own CLSID, {4d578e19-3f31-49d8-8d05-XXXXXXXXXXXX} with the
//! extension's ASCII in the last six bytes, because Explorer hands the handler only a
//! stream, not the file name. The installer (src-tauri/windows/default-apps.nsh) registers
//! one for each extension that has no thumbnailer of its own. Explorer loads the DLL in an
//! isolated host process (IInitializeWithStream).
#![cfg(windows)]

#[allow(dead_code)]
#[path = "../../src/decode/mod.rs"]
mod decode;

use std::cell::RefCell;
use std::ffi::c_void;
use windows::core::{implement, Interface, Ref, Result, GUID, HRESULT};
use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
use windows::Foundation::Size;
use windows::Storage::Streams::{IRandomAccessStream, InMemoryRandomAccessStream};
use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_POINTER, E_UNEXPECTED, S_FALSE};
use windows::Win32::Graphics::Gdi::{CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA, IWICImagingFactory, WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom,
    WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IClassFactory, IClassFactory_Impl, IStream, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    STREAM_SEEK_SET,
};
use windows::Win32::System::WinRT::{CreateRandomAccessStreamOverStream, CreateStreamOverRandomAccessStream, BSOS_DEFAULT};
use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl};
use windows::Win32::UI::Shell::{IThumbnailProvider, IThumbnailProvider_Impl, SHCreateMemStream, WTSAT_ARGB, WTS_ALPHATYPE};

/// Shared first ten bytes of every handler's CLSID.
const CLSID_BASE: u128 = 0x4d578e19_3f31_49d8_8d05_000000000000;

/// The CLSID Glance registers as the thumbnailer for `ext` (lower case, at most 6 ASCII bytes).
pub fn clsid_for(ext: &str) -> GUID {
    let mut tail = 0u128;
    for b in ext.bytes().take(6) {
        tail = tail << 8 | b as u128;
    }
    tail <<= 8 * (6 - ext.len().min(6)) as u128;
    GUID::from_u128(CLSID_BASE | tail)
}

/// The extension a CLSID from [`clsid_for`] stands for.
pub fn ext_for(clsid: &GUID) -> Option<String> {
    let v = clsid.to_u128();
    if v & !0xffff_ffff_ffff != CLSID_BASE {
        return None;
    }
    let ext: String = (0..6).map(|i| (v >> (40 - 8 * i)) as u8).take_while(|&b| b != 0).map(char::from).collect();
    (!ext.is_empty() && ext.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())).then_some(ext)
}

/// Larger files aren't read, so a huge file can't stall Explorer.
const MAX_BYTES: u64 = 512 * 1024 * 1024;

#[implement(IThumbnailProvider, IInitializeWithStream)]
struct Thumbnail {
    ext: String,
    stream: RefCell<Option<IStream>>,
}

impl IInitializeWithStream_Impl for Thumbnail_Impl {
    fn Initialize(&self, stream: Ref<IStream>, _mode: u32) -> Result<()> {
        *self.stream.borrow_mut() = Some(stream.ok()?.clone());
        Ok(())
    }
}

impl IThumbnailProvider_Impl for Thumbnail_Impl {
    fn GetThumbnail(&self, cx: u32, bitmap: *mut HBITMAP, alpha: *mut WTS_ALPHATYPE) -> Result<()> {
        if bitmap.is_null() || alpha.is_null() {
            return Err(E_POINTER.into());
        }
        let stream = self.stream.borrow().clone().ok_or(windows::core::Error::from(E_UNEXPECTED))?;
        let bytes = read_all(&stream)?;
        let (width, height, pixels) = thumbnail(&self.ext, bytes, cx)?;
        let hbitmap = to_hbitmap(width, height, &pixels)?;
        unsafe {
            *bitmap = hbitmap;
            *alpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

fn read_all(stream: &IStream) -> Result<Vec<u8>> {
    unsafe { stream.Seek(0, STREAM_SEEK_SET, None)? };
    let mut out = Vec::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let mut read = 0u32;
        let hr = unsafe { stream.Read(buf.as_mut_ptr() as *mut c_void, buf.len() as u32, Some(&mut read)) };
        if hr.is_err() {
            return Err(hr.into());
        }
        if read == 0 {
            break;
        }
        out.extend_from_slice(&buf[..read as usize]);
        if out.len() as u64 > MAX_BYTES {
            return Err(E_FAIL.into());
        }
    }
    Ok(out)
}

/// A thumbnail of the file (its contents, with extension `ext`) whose longer side is at
/// most `size` pixels, as premultiplied BGRA rows, top to bottom.
pub fn thumbnail(ext: &str, data: Vec<u8>, size: u32) -> Result<(u32, u32, Vec<u8>)> {
    match ext {
        "pdf" | "ai" => render_first_page(data, size),
        _ => decode_with_glance(ext, data, size.clamp(16, 2560)),
    }
}

/// Glance's decoders work on paths (WIC reads the file, XPS and CBZ open it as a package),
/// so the stream is written to a temporary file with the right extension.
fn decode_with_glance(ext: &str, data: Vec<u8>, size: u32) -> Result<(u32, u32, Vec<u8>)> {
    static COUNT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("glance-thumbnail-{}-{n}.{ext}", std::process::id()));
    std::fs::write(&path, data).map_err(|_| windows::core::Error::from(E_FAIL))?;
    let path2 = path.clone();
    // Own MTA thread, like the PDF path: WIC and the XPS rasterizer initialize COM there.
    let result = std::thread::spawn(move || decode::decode(&path2, 0, Some(size))).join();
    let _ = std::fs::remove_file(&path);
    let decoded = result.map_err(|_| windows::core::Error::from(E_FAIL))?.map_err(|_| windows::core::Error::from(E_FAIL))?;
    let mut pixels = decoded.rgba;
    for p in pixels.chunks_exact_mut(4) {
        let a = p[3] as u32;
        let (r, g, b) = (p[0] as u32, p[1] as u32, p[2] as u32);
        p[0] = ((b * a + 127) / 255) as u8;
        p[1] = ((g * a + 127) / 255) as u8;
        p[2] = ((r * a + 127) / 255) as u8;
    }
    Ok((decoded.width, decoded.height, pixels))
}

/// Renders page 1 of the PDF so its longer side is `size` pixels. Returns premultiplied
/// BGRA rows, top to bottom. Runs on its own MTA thread: WinRT's async calls must not
/// block the host's STA thread.
pub fn render_first_page(pdf: Vec<u8>, size: u32) -> Result<(u32, u32, Vec<u8>)> {
    std::thread::spawn(move || {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
        let result = render_on_this_thread(&pdf, size.clamp(16, 2560));
        unsafe { CoUninitialize() };
        result
    })
    .join()
    .map_err(|_| windows::core::Error::from(E_FAIL))?
}

fn render_on_this_thread(pdf: &[u8], size: u32) -> Result<(u32, u32, Vec<u8>)> {
    let input = unsafe { SHCreateMemStream(Some(pdf)) }.ok_or(windows::core::Error::from(E_FAIL))?;
    let input: IRandomAccessStream = unsafe { CreateRandomAccessStreamOverStream(&input, BSOS_DEFAULT)? };
    let doc = PdfDocument::LoadFromStreamAsync(&input)?.join()?;
    let page = doc.GetPage(0)?;
    let Size { Width: w, Height: h } = page.Size()?;
    let scale = size as f32 / w.max(h).max(1.0);
    let options = PdfPageRenderOptions::new()?;
    options.SetDestinationWidth(((w * scale).round() as u32).max(1))?;
    options.SetDestinationHeight(((h * scale).round() as u32).max(1))?;
    let png = InMemoryRandomAccessStream::new()?;
    page.RenderWithOptionsToStreamAsync(&png, &options)?.join()?;
    png.Seek(0)?;

    let png: IStream = unsafe { CreateStreamOverRandomAccessStream(&png)? };
    let wic: IWICImagingFactory = unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)? };
    unsafe {
        let decoder = wic.CreateDecoderFromStream(&png, std::ptr::null(), WICDecodeMetadataCacheOnDemand)?;
        let frame = decoder.GetFrame(0)?;
        let converter = wic.CreateFormatConverter()?;
        converter.Initialize(&frame, &GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, None, 0.0, WICBitmapPaletteTypeCustom)?;
        let (mut width, mut height) = (0u32, 0u32);
        converter.GetSize(&mut width, &mut height)?;
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        converter.CopyPixels(std::ptr::null(), width * 4, &mut pixels)?;
        Ok((width, height, pixels))
    }
}

fn to_hbitmap(width: u32, height: u32, pixels: &[u8]) -> Result<HBITMAP> {
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32), // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = std::ptr::null_mut();
    let bitmap = unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)? };
    if bits.is_null() {
        return Err(E_FAIL.into());
    }
    unsafe { std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len()) };
    Ok(bitmap)
}

#[implement(IClassFactory)]
struct Factory {
    ext: String,
}

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<windows::core::IUnknown>, iid: *const GUID, object: *mut *mut c_void) -> Result<()> {
        if object.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *object = std::ptr::null_mut() };
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let thumbnail: IThumbnailProvider = Thumbnail { ext: self.ext.clone(), stream: RefCell::new(None) }.into();
        unsafe { thumbnail.query(iid, object).ok() }
    }

    fn LockServer(&self, _lock: windows::core::BOOL) -> Result<()> {
        Ok(())
    }
}

#[no_mangle]
extern "system" fn DllGetClassObject(clsid: *const GUID, iid: *const GUID, object: *mut *mut c_void) -> HRESULT {
    if clsid.is_null() || iid.is_null() || object.is_null() {
        return E_POINTER;
    }
    unsafe { *object = std::ptr::null_mut() };
    let Some(ext) = ext_for(unsafe { &*clsid }) else {
        return CLASS_E_CLASSNOTAVAILABLE;
    };
    let factory: IClassFactory = Factory { ext }.into();
    unsafe { factory.query(iid, object) }
}

/// Explorer's thumbnail host exits on its own; keeping the DLL loaded until then is simpler
/// than counting objects.
#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_the_first_page() {
        let pdf = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/signatures/signed.pdf")).unwrap();
        let (w, h, pixels) = render_first_page(pdf, 256).unwrap();
        assert_eq!(w.max(h), 256);
        assert_eq!(pixels.len(), (w * h * 4) as usize);
        // A page with content: not every pixel is the same.
        assert!(pixels.chunks(4).any(|p| p != &pixels[..4]));
    }

    /// Run after installing Glance (CI does): asks the shell itself for thumbnail-only
    /// images of a PDF and a TGA, which only works when a thumbnail handler is registered for it.
    #[test]
    #[ignore]
    fn installed_handler_gives_explorer_a_thumbnail() {
        use windows::core::HSTRING;
        use windows::Win32::Foundation::SIZE;
        use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_THUMBNAILONLY};
        let pdf = std::fs::canonicalize(concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/signatures/signed.pdf")).unwrap();
        // A TGA, which Windows has no decoder for, goes through Glance's decoders.
        let tga = std::env::temp_dir().join("glance-thumbnail-check.tga");
        image::RgbaImage::from_pixel(40, 30, image::Rgba([200, 30, 30, 255])).save(&tga).unwrap();
        unsafe { windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_APARTMENTTHREADED).ok().unwrap() };
        for path in [pdf, tga] {
            let path = path.to_string_lossy().trim_start_matches(r"\\?\").to_string();
            let item: IShellItemImageFactory = unsafe { SHCreateItemFromParsingName(&HSTRING::from(&path), None) }.unwrap();
            let bitmap = unsafe { item.GetImage(SIZE { cx: 256, cy: 256 }, SIIGBF_THUMBNAILONLY) };
            assert!(bitmap.is_ok_and(|b| !b.is_invalid()), "no thumbnail for {path}");
        }
    }

    #[test]
    fn clsids_round_trip() {
        assert_eq!(clsid_for("pdf").to_u128(), 0x4d578e19_3f31_49d8_8d05_706466000000);
        for ext in ["pdf", "ai", "cr2", "3fr", "jfif", "cbz", "oxps"] {
            assert_eq!(ext_for(&clsid_for(ext)).as_deref(), Some(ext));
        }
        assert_eq!(ext_for(&GUID::from_u128(0x12345678_3f31_49d8_8d05_706466000000)), None);
    }

    #[test]
    fn decodes_images_through_glance() {
        // A 2x1 TGA (no magic bytes, so the extension matters): one red pixel, one half-transparent white one.
        let img = image::RgbaImage::from_raw(2, 1, vec![255, 0, 0, 255, 255, 255, 255, 128]).unwrap();
        let mut tga = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut tga), image::ImageFormat::Tga).unwrap();
        let (w, h, px) = thumbnail("tga", tga, 64).unwrap();
        assert_eq!((w, h), (2, 1));
        // Premultiplied BGRA.
        assert_eq!(&px[..4], &[0, 0, 255, 255]);
        assert_eq!(&px[4..], &[128, 128, 128, 128]);
    }

    #[test]
    fn rejects_non_pdf() {
        assert!(render_first_page(b"not a pdf".to_vec(), 256).is_err());
    }
}
