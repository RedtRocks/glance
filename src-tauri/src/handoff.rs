//! Handing off: when Glance can't make something itself, the AI company's own agent (the one
//! the Ask AI sidebar runs) makes it into a folder Glance picks here, under Glance's app data.
//! Glance then opens what it wrote. These commands only reach inside that folder.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("hand-off"))
}

/// `path`, if it is inside `root` (after resolving `..` and links).
fn inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let p = path.canonicalize().map_err(|e| e.to_string())?;
    if p.starts_with(&root) {
        Ok(p)
    } else {
        Err("not a hand-off file".into())
    }
}

/// A plain folder name: no separators, no `..`.
fn plain(name: &str) -> bool {
    !name.is_empty() && name.len() <= 80 && name != "." && name != ".." && !name.contains(['/', '\\', ':']) && !name.starts_with('.')
}

/// Makes a new, empty folder for one hand-off and returns its path.
#[tauri::command]
pub fn hand_off_folder(app: AppHandle, name: String) -> Result<String, String> {
    if !plain(&name) {
        return Err("bad folder name".into());
    }
    let dir = root(&app)?.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Found {
    path: String,
    name: String,
    size: u64,
    /// Milliseconds since 1970.
    modified: f64,
}

fn walk(dir: &Path, depth: u8, out: &mut Vec<Found>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let Ok(meta) = e.metadata() else { continue };
        let path = e.path();
        if meta.is_dir() {
            if depth > 0 {
                walk(&path, depth - 1, out);
            }
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);
        out.push(Found { name: e.file_name().to_string_lossy().into_owned(), path: path.to_string_lossy().into_owned(), size: meta.len(), modified });
    }
}

fn list(dir: &Path) -> Vec<Found> {
    let mut out = Vec::new();
    walk(dir, 2, &mut out);
    out
}

/// The files in a hand-off folder (and two levels below); the UI picks the result.
#[tauri::command]
pub fn hand_off_files(app: AppHandle, dir: String) -> Result<Vec<Found>, String> {
    let dir = inside(&root(&app)?, Path::new(&dir))?;
    Ok(list(&dir))
}

/// `name` in `dir`, numbered like browsers do when one is there already.
fn unique(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|c| !c.exists()).unwrap()
}

fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    // Another drive: copy, then remove.
    std::fs::copy(from, to).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(from);
    Ok(())
}

/// Keep: moves a handed-off file into `dir` (the source file's folder) or Downloads, with
/// `name`, and returns where it went.
#[tauri::command]
pub fn hand_off_keep(app: AppHandle, path: String, dir: Option<String>, name: String) -> Result<String, String> {
    let from = inside(&root(&app)?, Path::new(&path))?;
    let to_dir = match dir.filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => app.path().download_dir().map_err(|e| e.to_string())?,
    };
    let name = Path::new(&name).file_name().ok_or("bad name")?.to_string_lossy().into_owned();
    let to = unique(&to_dir, &name);
    move_file(&from, &to)?;
    Ok(to.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_stay_inside() {
        assert!(plain("2026-10-02 03.04.05 abc"));
        for bad in ["", ".", "..", "../x", "a/b", "a\\b", "C:", ".hidden"] {
            assert!(!plain(bad), "{bad}");
        }
    }

    #[test]
    fn paths_outside_the_root_are_refused() {
        let base = std::env::temp_dir().join(format!("glance-handoff-{}", std::process::id()));
        let root = base.join("hand-off");
        std::fs::create_dir_all(root.join("job")).unwrap();
        std::fs::write(base.join("secret.txt"), "x").unwrap();
        std::fs::write(root.join("job").join("deck.pptx"), "x").unwrap();
        assert!(inside(&root, &root.join("job").join("deck.pptx")).is_ok());
        assert!(inside(&root, &root.join("job").join("..").join("..").join("secret.txt")).is_err());
        let found = list(&root.join("job"));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "deck.pptx");
        let kept = unique(&root.join("job"), "deck.pptx");
        assert!(kept.ends_with("deck (1).pptx"));
        let _ = std::fs::remove_dir_all(&base);
    }
}
