//! Which Glance window has which file open, so the same file is never edited in two
//! windows at once, and file stamps to notice changes made by other apps.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Normalized path → label of the window that has it open.
#[derive(Default)]
pub struct OpenFiles(Mutex<HashMap<String, String>>);

fn norm(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

/// Whether two paths name the same file, compared the way Windows does.
pub fn same_path(a: &str, b: &str) -> bool {
    norm(a) == norm(b)
}

/// Claims `path` for this window. Returns the label of another window that already
/// has it open (the caller should hand over to that window), or None when claimed.
#[tauri::command]
pub fn claim_file(app: tauri::AppHandle, window: tauri::Window, state: tauri::State<'_, OpenFiles>, path: String) -> Option<String> {
    let mut map = state.0.lock().unwrap();
    let key = norm(&path);
    if let Some(owner) = map.get(&key) {
        if owner != window.label() && app.get_window(owner).is_some() {
            return Some(owner.clone());
        }
    }
    map.insert(key, window.label().to_string());
    None
}

#[tauri::command]
pub fn release_file(window: tauri::Window, state: tauri::State<'_, OpenFiles>, path: String) {
    let mut map = state.0.lock().unwrap();
    let key = norm(&path);
    if map.get(&key).is_some_and(|o| o == window.label()) {
        map.remove(&key);
    }
}

/// Drops every claim of a window that closed.
pub fn release_window(app: &tauri::AppHandle, label: &str) {
    if let Some(state) = app.try_state::<OpenFiles>() {
        state.0.lock().unwrap().retain(|_, owner| owner != label);
    }
}

/// Brings the owning window forward and asks it to show the file's tab.
#[tauri::command]
pub fn focus_file(app: tauri::AppHandle, label: String, path: String) -> Result<(), String> {
    let win = app.get_window(&label).ok_or("That window has closed.")?;
    let _ = win.unminimize();
    let _ = win.set_focus();
    win.emit_to(&label, "activate-file", path).map_err(|e| e.to_string())
}

#[derive(Serialize, PartialEq, Debug)]
pub struct Stamp {
    pub modified: u64,
    pub size: u64,
}

/// Last-modified time (ms) and size, to notice edits made outside this window.
#[tauri::command]
pub fn file_stamp(path: String) -> Result<Stamp, String> {
    let m = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    Ok(Stamp { modified, size: m.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_change_when_the_file_changes() {
        let p = std::env::temp_dir().join(format!("glance-stamp-{}.txt", std::process::id()));
        std::fs::write(&p, b"one").unwrap();
        let a = file_stamp(p.to_string_lossy().into()).unwrap();
        std::fs::write(&p, b"three").unwrap();
        let b = file_stamp(p.to_string_lossy().into()).unwrap();
        assert_ne!(a, b);
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn paths_compare_like_windows() {
        assert_eq!(norm("C:/Docs/Report.PDF"), norm("c:\\docs\\report.pdf"));
    }
}
