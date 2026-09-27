//! Explorer thumbnail handler for PDFs: the first page, rendered by Windows.Data.Pdf.
//!
//! Windows has no PDF thumbnailer of its own; apps like Acrobat register one under
//! their ProgID, so with Glance as the default app PDFs showed Glance's icon. The
//! installer registers this DLL (src-tauri/windows/hooks.nsh) as CLSID
//! {4d578e19-3f31-49d8-8d05-8efaa193a022} for Glance's PDF ProgIDs, and for .pdf when
//! no other thumbnailer is registered. Explorer loads it in an isolated host process
//! and hands it the file as a stream (IInitializeWithStream).
#![cfg(windows)]

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

pub const CLSID_PDF_THUMBNAIL: GUID = GUID::from_u128(0x4d578e19_3f31_49d8_8d05_8efaa193a022);

/// Larger files aren't read, so a huge PDF can't stall Explorer.
const MAX_BYTES: u64 = 512 * 1024 * 1024;

#[implement(IThumbnailProvider, IInitializeWithStream)]
struct PdfThumbnail {
    stream: RefCell<Option<IStream>>,
}

impl IInitializeWithStream_Impl for PdfThumbnail_Impl {
    fn Initialize(&self, stream: Ref<IStream>, _mode: u32) -> Result<()> {
        *self.stream.borrow_mut() = Some(stream.ok()?.clone());
        Ok(())
    }
}

impl IThumbnailProvider_Impl for PdfThumbnail_Impl {
    fn GetThumbnail(&self, cx: u32, bitmap: *mut HBITMAP, alpha: *mut WTS_ALPHATYPE) -> Result<()> {
        if bitmap.is_null() || alpha.is_null() {
            return Err(E_POINTER.into());
        }
        let stream = self.stream.borrow().clone().ok_or(windows::core::Error::from(E_UNEXPECTED))?;
        let bytes = read_all(&stream)?;
        let (width, height, pixels) = render_first_page(bytes, cx)?;
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
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<windows::core::IUnknown>, iid: *const GUID, object: *mut *mut c_void) -> Result<()> {
        if object.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *object = std::ptr::null_mut() };
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let thumbnail: IThumbnailProvider = PdfThumbnail { stream: RefCell::new(None) }.into();
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
    if unsafe { *clsid } != CLSID_PDF_THUMBNAIL {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IClassFactory = Factory.into();
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

    /// Run after installing Glance (CI does): asks the shell itself for a thumbnail-only
    /// image of a PDF, which only works when a thumbnail handler is registered for it.
    #[test]
    #[ignore]
    fn installed_handler_gives_explorer_a_thumbnail() {
        use windows::core::HSTRING;
        use windows::Win32::Foundation::SIZE;
        use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_THUMBNAILONLY};
        let path = std::fs::canonicalize(concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/signatures/signed.pdf")).unwrap();
        let path = path.to_string_lossy().trim_start_matches(r"\\?\").to_string();
        unsafe {
            windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_APARTMENTTHREADED).ok().unwrap();
            let item: IShellItemImageFactory = SHCreateItemFromParsingName(&HSTRING::from(path), None).unwrap();
            let bitmap = item.GetImage(SIZE { cx: 256, cy: 256 }, SIIGBF_THUMBNAILONLY).unwrap();
            assert!(!bitmap.is_invalid());
        }
    }

    #[test]
    fn rejects_non_pdf() {
        assert!(render_first_page(b"not a pdf".to_vec(), 256).is_err());
    }
}
