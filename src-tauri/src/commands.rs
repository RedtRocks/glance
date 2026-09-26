use crate::decode::{self, formats::Kind};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    path: String,
    name: String,
    size: u64,
    kind: Kind,
    /// WebView2 can decode this image itself (served raw, never re-encoded).
    browser_native: bool,
    /// Pages known to the backend (multi-page TIFF, CBZ). PDFs are counted by PDF.js.
    pages: u32,
}

#[tauri::command]
pub async fn probe(path: String) -> Result<Probe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
        let mut head = [0u8; 16];
        let n = std::fs::File::open(p)
            .and_then(|mut f| std::io::Read::read(&mut f, &mut head))
            .unwrap_or(0);
        let kind = decode::formats::classify(p, &head[..n]);
        let pages = match kind {
            Kind::Image | Kind::Archive | Kind::Xps => decode::page_count(p),
            _ => 1,
        };
        Ok(Probe {
            name: p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            size: meta.len(),
            kind,
            browser_native: decode::formats::is_browser_native(p),
            pages,
            path,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("expected a binary body".into()),
    }
}

pub(crate) fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let v = request.headers().get(name).ok_or_else(|| format!("missing header {name}"))?;
    let s = v.to_str().map_err(|e| e.to_string())?;
    Ok(percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned())
}

/// Writes bytes atomically: temp file in the same directory, then rename over the target.
#[tauri::command]
pub fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = PathBuf::from(header(&request, "x-path")?);
    write_atomic(&path, &raw_body(&request)?)
}

pub(crate) fn write_atomic(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!(
        "{}.glance-tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Writes a scratch file (drag-out payloads, drag icons) and returns its path.
#[tauri::command]
pub fn write_temp(request: Request<'_>) -> Result<String, String> {
    let name = header(&request, "x-name")?;
    let safe: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let dir = std::env::temp_dir().join("Glance").join(format!(
        "{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe);
    std::fs::write(&path, raw_body(&request)?).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn ghostscript_available() -> bool {
    decode::eps::find_ghostscript().is_some()
}

/// Converts PostScript/EPS to a temporary PDF. Errors with "ghostscript-missing" when
/// Ghostscript is not installed, so the UI can offer the embedded preview or install.
#[tauri::command]
pub async fn convert_postscript(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let gs = decode::eps::find_ghostscript().ok_or("ghostscript-missing")?;
        let input = Path::new(&path);
        let stem = input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "document".into());
        let dir = std::env::temp_dir().join("Glance").join("ps");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let out = dir.join(format!("{stem}-{}.pdf", std::process::id()));
        decode::eps::to_pdf(&gs, input, &out)?;
        Ok(out.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Files passed on the command line (Open with, Send to, drop onto the .exe).
#[tauri::command]
pub fn initial_files() -> Vec<String> {
    files_from_args(std::env::args().skip(1))
}

pub fn files_from_args(args: impl Iterator<Item = String>) -> Vec<String> {
    args.filter(|a| !a.starts_with('-'))
        .filter(|a| Path::new(a).is_file())
        .map(|a| std::fs::canonicalize(&a).map(|p| strip_verbatim(&p)).unwrap_or(a))
        .collect()
}

/// `canonicalize` on Windows yields `\\?\C:\…`; the UI and dialogs want `C:\…`.
fn strip_verbatim(p: &Path) -> String {
    let s = p.to_string_lossy();
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or_else(|| s.into_owned())
}

/// Frontend errors end up on stderr, which makes bug reports from `glance.exe > log.txt` useful.
#[tauri::command]
pub fn log_frontend(level: String, message: String) {
    eprintln!("[webview {level}] {message}");
}
