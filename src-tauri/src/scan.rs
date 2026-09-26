//! Import from Scanner: the scanners Windows knows about (Windows.Devices.Scanners,
//! WIA underneath), scanned into a fresh folder under the temp directory. The UI
//! opens the files it gets back, or combines them into one PDF.

use serde::Serialize;

#[derive(Serialize)]
pub struct Scanner {
    pub id: String,
    pub name: String,
    /// Sources the device supports: "flatbed", "feeder".
    pub sources: Vec<String>,
}

#[tauri::command]
pub async fn scanners_list() -> Result<Vec<Scanner>, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(win::list).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[derive(Serialize)]
pub struct ScanResult {
    pub files: Vec<String>,
    /// Resolution the device scanned at (0 when it doesn't say), so pages get their real size.
    pub dpi: f32,
}

/// Scans from `source` ("auto", "flatbed" or "feeder") at about `dpi` and returns the files written.
#[tauri::command]
pub async fn scan(id: String, source: String, dpi: f32) -> Result<ScanResult, String> {
    let dir = std::env::temp_dir().join("Glance Scans").join(format!(
        "{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || win::scan(&id, &source, dpi, &dir)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (id, source, dpi, dir);
        Err("Scanning uses Windows scanner drivers and is only available on Windows.".into())
    }
}

#[cfg(windows)]
mod win {
    use super::{ScanResult, Scanner};
    use std::path::Path;
    use windows::core::HSTRING;
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Devices::Scanners::{ImageScanner, ImageScannerFormat, ImageScannerResolution, ImageScannerScanSource};
    use windows::Storage::StorageFolder;

    fn message(e: windows::core::Error) -> String {
        let m = e.message();
        if m.is_empty() { format!("scanner error {:#x}", e.code().0) } else { m }
    }

    pub fn list() -> Result<Vec<Scanner>, String> {
        let run = || -> windows::core::Result<Vec<Scanner>> {
            let found = DeviceInformation::FindAllAsyncAqsFilter(&ImageScanner::GetDeviceSelector()?)?.join()?;
            let mut out = Vec::new();
            for i in 0..found.Size()? {
                let info = found.GetAt(i)?;
                let id = info.Id()?;
                let mut sources = Vec::new();
                // A device that won't open right now (asleep, busy) is still listed.
                if let Ok(scanner) = ImageScanner::FromIdAsync(&id).and_then(|op| op.join()) {
                    if scanner.IsScanSourceSupported(ImageScannerScanSource::Flatbed).unwrap_or(false) {
                        sources.push("flatbed".into());
                    }
                    if scanner.IsScanSourceSupported(ImageScannerScanSource::Feeder).unwrap_or(false) {
                        sources.push("feeder".into());
                    }
                }
                out.push(Scanner { id: id.to_string(), name: info.Name()?.to_string(), sources });
            }
            Ok(out)
        };
        run().map_err(message)
    }

    /// Asks for JPEG (compact, and embeds in a PDF as is) and the requested resolution
    /// when the source supports them; the driver's defaults stay otherwise.
    macro_rules! configure {
        ($config:expr, $dpi:expr) => {{
            let config = $config;
            if config.IsFormatSupported(ImageScannerFormat::Jpeg).unwrap_or(false) {
                let _ = config.SetFormat(ImageScannerFormat::Jpeg);
            }
            if $dpi > 0.0 {
                let _ = config.SetDesiredResolution(ImageScannerResolution { DpiX: $dpi, DpiY: $dpi });
            }
            config.ActualResolution().map(|r| r.DpiX).unwrap_or(0.0)
        }};
    }

    pub fn scan(id: &str, source: &str, dpi: f32, dir: &Path) -> Result<ScanResult, String> {
        let run = || -> windows::core::Result<ScanResult> {
            let scanner = ImageScanner::FromIdAsync(&HSTRING::from(id))?.join()?;
            let source = match source {
                "flatbed" => ImageScannerScanSource::Flatbed,
                "feeder" => ImageScannerScanSource::Feeder,
                _ => scanner.DefaultScanSource()?,
            };
            let actual = match source {
                ImageScannerScanSource::Flatbed => configure!(scanner.FlatbedConfiguration()?, dpi),
                ImageScannerScanSource::Feeder => configure!(scanner.FeederConfiguration()?, dpi),
                _ => 0.0,
            };
            let folder = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(dir.as_os_str()))?.join()?;
            let result = scanner.ScanFilesToFolderAsync(source, &folder)?.join()?;
            let files = result.ScannedFiles()?;
            let mut out = Vec::new();
            for i in 0..files.Size()? {
                out.push(files.GetAt(i)?.Path()?.to_string());
            }
            Ok(ScanResult { files: out, dpi: actual })
        };
        run().map_err(message)
    }
}
