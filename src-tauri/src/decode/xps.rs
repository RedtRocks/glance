//! XPS and OpenXPS pages, rendered by Windows' own XPS rasterizer
//! (XPS Object Model + IXpsRasterizationFactory), like the XPS Viewer.

use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Graphics::Imaging::{GUID_WICPixelFormat32bppRGBA, IWICImagingFactory, CLSID_WICImagingFactory, WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom};
use windows::Win32::Graphics::Printing::{IXpsRasterizationFactory, CLSID_XPSRASTERIZER_FACTORY, XPSRAS_RENDERING_MODE_ANTIALIASED};
use windows::Win32::Storage::Xps::{IXpsOMObjectFactory, IXpsOMPage, XpsOMObjectFactory};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

/// Default rendering resolution when no size limit is given.
const DPI: f32 = 150.0;

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect()
}

/// Every page of every document in the package, in reading order.
fn pages(path: &Path) -> windows::core::Result<Vec<IXpsOMPage>> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let factory: IXpsOMObjectFactory = CoCreateInstance(&XpsOMObjectFactory, None, CLSCTX_INPROC_SERVER)?;
        let file = wide(path);
        let package = factory.CreatePackageFromFile(PCWSTR(file.as_ptr()), false)?;
        let docs = package.GetDocumentSequence()?.GetDocuments()?;
        let mut out = Vec::new();
        for d in 0..docs.GetCount()? {
            let refs = docs.GetAt(d)?.GetPageReferences()?;
            for p in 0..refs.GetCount()? {
                out.push(refs.GetAt(p)?.GetPage()?);
            }
        }
        Ok(out)
    }
}

pub fn page_count(path: &Path) -> Result<u32, String> {
    pages(path).map(|p| p.len() as u32).map_err(|e| e.message())
}

/// Renders one page to straight-alpha RGBA on white, at 150 dpi or fitted to `max`.
pub fn render(path: &Path, page: u32, max: Option<u32>) -> Result<(u32, u32, Vec<u8>), String> {
    let run = || -> windows::core::Result<(u32, u32, Vec<u8>)> {
        let all = pages(path)?;
        let page = all.get(page as usize).ok_or_else(|| windows::core::Error::from_hresult(windows::Win32::Foundation::E_INVALIDARG))?;
        unsafe {
            // Page size in XPS units (1/96 inch).
            let size = page.GetPageDimensions()?;
            let mut dpi = DPI;
            if let Some(m) = max {
                let longest = size.width.max(size.height) / 96.0;
                dpi = (m as f32 / longest).min(DPI * 2.0);
            }
            let w = ((size.width / 96.0) * dpi).round().max(1.0) as i32;
            let h = ((size.height / 96.0) * dpi).round().max(1.0) as i32;
            let rf: IXpsRasterizationFactory = CoCreateInstance(&CLSID_XPSRASTERIZER_FACTORY, None, CLSCTX_INPROC_SERVER)?;
            let rasterizer = rf.CreateRasterizer(page, dpi, XPSRAS_RENDERING_MODE_ANTIALIASED, XPSRAS_RENDERING_MODE_ANTIALIASED)?;
            let bitmap = rasterizer.RasterizeRect(0, 0, w, h, None)?;
            let wic: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
            let conv = wic.CreateFormatConverter()?;
            conv.Initialize(&bitmap, &GUID_WICPixelFormat32bppRGBA, WICBitmapDitherTypeNone, None, 0.0, WICBitmapPaletteTypeCustom)?;
            let stride = w as u32 * 4;
            let mut rgba = vec![0u8; (stride * h as u32) as usize];
            conv.CopyPixels(std::ptr::null(), stride, &mut rgba)?;
            // Pages are paper: composite the transparent background onto white.
            for px in rgba.chunks_exact_mut(4) {
                let a = px[3] as u32;
                for c in &mut px[..3] {
                    *c = ((*c as u32 * a + 255 * (255 - a)) / 255) as u8;
                }
                px[3] = 255;
            }
            Ok((w as u32, h as u32, rgba))
        }
    };
    run().map_err(|e| e.message())
}
