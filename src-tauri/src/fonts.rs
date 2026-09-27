//! Installed system fonts for text boxes.
//!
//! The UI shows each family by name (WebView2 renders them directly); when a PDF is
//! saved, the regular face's file is embedded (subset) so the text looks the same in
//! every viewer. Faces inside collections (.ttc) are cut out into standalone fonts,
//! since PDF embedding needs a single sfnt.
//!
//! Files are memory-mapped while scanning: Windows ships hundreds of megabytes of fonts
//! (CJK collections alone are tens of MB each), and only a few small tables per face are
//! needed to name it, so reading them whole made the font list take seconds to appear.

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::ipc::Response;

#[derive(Clone, Serialize)]
pub struct FontFamily {
    pub family: String,
    #[serde(skip)]
    path: PathBuf,
    #[serde(skip)]
    index: u32,
}

fn font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        let win = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        dirs.push(win.join("Fonts"));
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join(r"Microsoft\Windows\Fonts"));
        }
    } else {
        dirs.push("/usr/share/fonts".into());
        dirs.push("/usr/local/share/fonts".into());
        dirs.push("/Library/Fonts".into());
        dirs.push("/System/Library/Fonts".into());
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(&home).join(".local/share/fonts"));
            dirs.push(PathBuf::from(&home).join(".fonts"));
        }
    }
    dirs
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth < 4 {
                walk(&p, depth + 1, out);
            }
        } else if matches!(p.extension().and_then(|x| x.to_str()).map(|x| x.to_ascii_lowercase()).as_deref(), Some("ttf" | "otf" | "ttc")) {
            out.push(p);
        }
    }
}

fn family_name(face: &ttf_parser::Face) -> Option<String> {
    let names = face.names();
    // Typographic family (16) groups weights under one name; fall back to the legacy family (1).
    for id in [ttf_parser::name_id::TYPOGRAPHIC_FAMILY, ttf_parser::name_id::FAMILY] {
        let found = names.into_iter().filter(|n| n.name_id == id).find_map(|n| if n.is_unicode() { n.to_string() } else { None });
        if let Some(s) = found.filter(|s| !s.trim().is_empty()) {
            return Some(s);
        }
    }
    None
}

/// Lower is a better "regular" face.
fn regular_score(face: &ttf_parser::Face) -> u32 {
    let w = face.weight().to_number() as i32;
    (w - 400).unsigned_abs() + if face.is_italic() || face.is_oblique() { 1000 } else { 0 }
}

fn map(path: &Path) -> Option<memmap2::Mmap> {
    let file = std::fs::File::open(path).ok()?;
    // SAFETY: font files aren't rewritten while installed; the map only lives for this scan.
    unsafe { memmap2::Mmap::map(&file) }.ok()
}

fn scan() -> Vec<FontFamily> {
    let mut files = Vec::new();
    for d in font_dirs() {
        walk(&d, 0, &mut files);
    }
    let mut best: BTreeMap<String, (u32, FontFamily)> = BTreeMap::new();
    for path in files {
        let Some(data) = map(&path) else { continue };
        let data = &data[..];
        let count = ttf_parser::fonts_in_collection(data).unwrap_or(1);
        for index in 0..count {
            let Ok(face) = ttf_parser::Face::parse(data, index) else { continue };
            let Some(family) = family_name(&face) else { continue };
            // Symbol-only and hidden (dot-prefixed) fonts aren't useful for typing text.
            if family.starts_with('.') || face.glyph_index('a').is_none() {
                continue;
            }
            let score = regular_score(&face);
            let key = family.to_lowercase();
            if best.get(&key).is_none_or(|(s, _)| score < *s) {
                best.insert(key, (score, FontFamily { family, path: path.clone(), index }));
            }
        }
    }
    best.into_values().map(|(_, f)| f).collect()
}

fn families() -> &'static [FontFamily] {
    static CACHE: OnceLock<Vec<FontFamily>> = OnceLock::new();
    CACHE.get_or_init(scan)
}

/// Copies one face of a collection into a standalone sfnt file.
fn extract_face(data: &[u8], index: u32) -> Option<Vec<u8>> {
    let u32at = |o: usize| data.get(o..o + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]));
    let u16at = |o: usize| data.get(o..o + 2).map(|b| u16::from_be_bytes([b[0], b[1]]));
    if data.get(0..4)? != b"ttcf" {
        return Some(data.to_vec());
    }
    let offset = u32at(12 + 4 * index as usize)? as usize;
    let num = u16at(offset + 4)? as usize;
    let header = 12 + 16 * num;
    let mut out = Vec::with_capacity(header);
    out.extend_from_slice(data.get(offset..offset + header)?);
    let mut body: Vec<u8> = Vec::new();
    for t in 0..num {
        let rec = offset + 12 + 16 * t;
        let src = u32at(rec + 8)? as usize;
        let len = u32at(rec + 12)? as usize;
        let at = header + body.len();
        out[12 + 16 * t + 8..12 + 16 * t + 12].copy_from_slice(&(at as u32).to_be_bytes());
        body.extend_from_slice(data.get(src..src + len)?);
        while body.len() % 4 != 0 {
            body.push(0);
        }
    }
    out.extend_from_slice(&body);
    Some(out)
}

#[tauri::command]
pub async fn fonts_list() -> Result<Vec<FontFamily>, String> {
    tauri::async_runtime::spawn_blocking(|| families().to_vec()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn font_bytes(family: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let f = families().iter().find(|f| f.family.eq_ignore_ascii_case(&family)).ok_or_else(|| format!("Font {family} is not installed"))?;
        let data = std::fs::read(&f.path).map_err(|e| e.to_string())?;
        extract_face(&data, f.index).map(Response::new).ok_or_else(|| "Unreadable font collection".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_every_face_of_a_collection_as_a_parseable_font() {
        let Some(ttc) = families().iter().find(|f| f.path.extension().is_some_and(|e| e.eq_ignore_ascii_case("ttc"))) else {
            eprintln!("no font collection installed; skipping");
            return;
        };
        let data = std::fs::read(&ttc.path).unwrap();
        let face = extract_face(&data, ttc.index).unwrap();
        let parsed = ttf_parser::Face::parse(&face, 0).unwrap();
        assert_eq!(family_name(&parsed).as_deref(), Some(ttc.family.as_str()));
    }

    #[cfg(windows)]
    #[test]
    fn lists_the_standard_windows_fonts() {
        let all = families();
        for want in ["Arial", "Times New Roman", "Segoe UI"] {
            assert!(all.iter().any(|f| f.family == want), "{want} missing from {} families", all.len());
        }
    }

    #[test]
    fn lists_installed_families_once_each() {
        let all = families();
        let mut names: Vec<_> = all.iter().map(|f| f.family.to_lowercase()).collect();
        names.dedup();
        assert_eq!(names.len(), all.len());
    }
}
