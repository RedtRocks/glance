//! Version history (ADR 0005): every save keeps a version of the file, stored as
//! content-defined chunks (FastCDC) addressed by BLAKE3 hash, so versions share
//! all unchanged data. Old versions are thinned like macOS (all from the last day,
//! then one per day for a month, then one per week), and the oldest go first when
//! the store grows past its size limit.
//!
//! Layout under the app's local data folder:
//!   History/chunks/ab/abcdef…      chunk data
//!   History/files/<hash of path>.json  the file's versions (newest last)

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MIN_CHUNK: u32 = 16 * 1024;
const AVG_CHUNK: u32 = 64 * 1024;
const MAX_CHUNK: u32 = 256 * 1024;
const DAY: u64 = 24 * 60 * 60 * 1000;
/// Total store size before the oldest versions are deleted.
const DEFAULT_LIMIT: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Version {
    pub id: String,
    /// Milliseconds since the Unix epoch.
    pub time: u64,
    pub size: u64,
    pub label: String,
    pub hash: String,
    pub chunks: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct Manifest {
    path: String,
    versions: Vec<Version>,
}

/// What the UI lists (without the chunk list).
#[derive(Serialize, Debug)]
pub struct VersionInfo {
    pub id: String,
    pub time: u64,
    pub size: u64,
    pub label: String,
}

pub struct Store {
    root: PathBuf,
    limit: u64,
}

/// One writer at a time: saves, thinning and GC touch shared chunks.
static LOCK: Mutex<()> = Mutex::new(());

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Paths are compared case-insensitively with normalized separators (Windows).
fn key(path: &str) -> String {
    let norm = path.replace('/', "\\").to_lowercase();
    blake3::hash(norm.as_bytes()).to_hex()[..32].to_string()
}

impl Store {
    pub fn new(root: PathBuf) -> Store {
        Store { root, limit: DEFAULT_LIMIT }
    }

    #[cfg(test)]
    fn with_limit(root: PathBuf, limit: u64) -> Store {
        Store { root, limit }
    }

    fn manifest_path(&self, path: &str) -> PathBuf {
        self.root.join("files").join(format!("{}.json", key(path)))
    }

    fn chunk_path(&self, hash: &str) -> PathBuf {
        self.root.join("chunks").join(&hash[..2]).join(hash)
    }

    fn load(&self, path: &str) -> Manifest {
        std::fs::read(self.manifest_path(path))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Manifest { path: path.to_string(), versions: Vec::new() })
    }

    fn store(&self, m: &Manifest) -> Result<(), String> {
        let p = self.manifest_path(&m.path);
        if m.versions.is_empty() {
            let _ = std::fs::remove_file(&p);
            return Ok(());
        }
        std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
        let tmp = p.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
    }

    fn all_manifests(&self) -> Vec<Manifest> {
        let Ok(dir) = std::fs::read_dir(self.root.join("files")) else { return Vec::new() };
        dir.flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok())
            .collect()
    }

    /// Records a version of `path` with these bytes. Identical to the newest version → no-op.
    pub fn record(&self, path: &str, bytes: &[u8], label: &str) -> Result<Option<VersionInfo>, String> {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let hash = blake3::hash(bytes).to_hex().to_string();
        let mut m = self.load(path);
        if m.versions.last().is_some_and(|v| v.hash == hash) {
            return Ok(None);
        }
        let mut chunks = Vec::new();
        for c in fastcdc::v2020::FastCDC::new(bytes, MIN_CHUNK, AVG_CHUNK, MAX_CHUNK) {
            let data = &bytes[c.offset..c.offset + c.length];
            let h = blake3::hash(data).to_hex().to_string();
            let p = self.chunk_path(&h);
            if !p.exists() {
                std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
                let tmp = p.with_extension("tmp");
                std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
                std::fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
            }
            chunks.push(h);
        }
        let time = now().max(m.versions.last().map(|v| v.time + 1).unwrap_or(0));
        let v = Version { id: format!("{time:x}"), time, size: bytes.len() as u64, label: label.to_string(), hash, chunks };
        let info = VersionInfo { id: v.id.clone(), time, size: v.size, label: v.label.clone() };
        m.versions.push(v);
        thin(&mut m.versions, time);
        self.store(&m)?;
        self.enforce_limit()?;
        Ok(Some(info))
    }

    pub fn list(&self, path: &str) -> Vec<VersionInfo> {
        self.load(path)
            .versions
            .iter()
            .rev()
            .map(|v| VersionInfo { id: v.id.clone(), time: v.time, size: v.size, label: v.label.clone() })
            .collect()
    }

    pub fn read(&self, path: &str, id: &str) -> Result<Vec<u8>, String> {
        let m = self.load(path);
        let v = m.versions.iter().find(|v| v.id == id).ok_or("That version no longer exists.")?;
        let mut out = Vec::with_capacity(v.size as usize);
        for h in &v.chunks {
            out.extend(std::fs::read(self.chunk_path(h)).map_err(|_| "A part of this version is missing from the history store.")?);
        }
        if blake3::hash(&out).to_hex().as_str() != v.hash {
            return Err("This version is damaged.".into());
        }
        Ok(out)
    }

    /// Deletes the given versions (all when `ids` is None), then unreferenced chunks.
    pub fn delete(&self, path: &str, ids: Option<&[String]>) -> Result<usize, String> {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let mut m = self.load(path);
        let before = m.versions.len();
        match ids {
            Some(ids) => m.versions.retain(|v| !ids.contains(&v.id)),
            None => m.versions.clear(),
        }
        self.store(&m)?;
        self.collect_garbage()?;
        Ok(before - m.versions.len())
    }

    /// Keeps a file's history attached when it is renamed or moved (Save As).
    pub fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let mut m = self.load(from);
        if m.versions.is_empty() {
            return Ok(());
        }
        let _ = std::fs::remove_file(self.manifest_path(from));
        let mut target = self.load(to);
        target.versions.append(&mut m.versions);
        target.versions.sort_by_key(|v| v.time);
        self.store(&target)
    }

    fn collect_garbage(&self) -> Result<(), String> {
        let live: HashSet<String> = self.all_manifests().into_iter().flat_map(|m| m.versions.into_iter().flat_map(|v| v.chunks)).collect();
        let Ok(dirs) = std::fs::read_dir(self.root.join("chunks")) else { return Ok(()) };
        for d in dirs.flatten() {
            let Ok(files) = std::fs::read_dir(d.path()) else { continue };
            for f in files.flatten() {
                if !live.contains(&*f.file_name().to_string_lossy()) {
                    let _ = std::fs::remove_file(f.path());
                }
            }
        }
        Ok(())
    }

    fn total_size(&self) -> u64 {
        let Ok(dirs) = std::fs::read_dir(self.root.join("chunks")) else { return 0 };
        dirs.flatten()
            .filter_map(|d| std::fs::read_dir(d.path()).ok())
            .flat_map(|files| files.flatten().filter_map(|f| f.metadata().ok()).map(|m| m.len()))
            .sum()
    }

    /// Over the limit: delete the oldest versions across all files (never a file's
    /// newest), until the store fits.
    fn enforce_limit(&self) -> Result<(), String> {
        let mut total = self.total_size();
        if total <= self.limit {
            return Ok(());
        }
        let mut manifests = self.all_manifests();
        let mut candidates: Vec<(u64, usize, String)> = manifests
            .iter()
            .enumerate()
            .flat_map(|(i, m)| m.versions.iter().rev().skip(1).map(move |v| (v.time, i, v.id.clone())))
            .collect();
        candidates.sort();
        for (_, i, id) in candidates {
            if total <= self.limit {
                break;
            }
            manifests[i].versions.retain(|v| v.id != id);
            self.store(&manifests[i])?;
            self.collect_garbage()?;
            total = self.total_size();
        }
        Ok(())
    }
}

/// macOS-style thinning: everything from the last day, the newest version of each
/// day for 30 days, then the newest of each week. The newest version always stays.
pub fn thin(versions: &mut Vec<Version>, now: u64) {
    let mut seen = HashSet::new();
    let newest = versions.last().map(|v| v.id.clone());
    let mut keep: Vec<bool> = vec![false; versions.len()];
    for (i, v) in versions.iter().enumerate().rev() {
        let age = now.saturating_sub(v.time);
        let bucket = if age < DAY {
            None
        } else if age < 30 * DAY {
            Some(("day", v.time / DAY))
        } else {
            Some(("week", v.time / (7 * DAY)))
        };
        keep[i] = match bucket {
            None => true,
            Some(b) => seen.insert(b),
        } || Some(&v.id) == newest.as_ref();
    }
    let mut i = 0;
    versions.retain(|_| {
        i += 1;
        keep[i - 1]
    });
}

fn store(app: &tauri::AppHandle) -> Result<Store, String> {
    use tauri::Manager;
    Ok(Store::new(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("History")))
}

#[tauri::command]
pub async fn history_record(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<VersionInfo>, String> {
    let path = crate::commands::header(&request, "x-path")?;
    let label = crate::commands::header(&request, "x-label").unwrap_or_default();
    let bytes = crate::commands::raw_body(&request)?;
    let s = store(&app)?;
    tauri::async_runtime::spawn_blocking(move || s.record(&path, &bytes, &label)).await.map_err(|e| e.to_string())?
}

/// Records the file as it is on disk now (before Glance first overwrites it).
#[tauri::command]
pub async fn history_record_file(app: tauri::AppHandle, path: String, label: String) -> Result<Option<VersionInfo>, String> {
    let s = store(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        s.record(&path, &bytes, &label)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn history_list(app: tauri::AppHandle, path: String) -> Result<Vec<VersionInfo>, String> {
    let s = store(&app)?;
    tauri::async_runtime::spawn_blocking(move || Ok(s.list(&path))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn history_read(app: tauri::AppHandle, path: String, id: String) -> Result<tauri::ipc::Response, String> {
    let s = store(&app)?;
    tauri::async_runtime::spawn_blocking(move || s.read(&path, &id).map(tauri::ipc::Response::new)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn history_delete(app: tauri::AppHandle, path: String, ids: Option<Vec<String>>) -> Result<usize, String> {
    let s = store(&app)?;
    tauri::async_runtime::spawn_blocking(move || s.delete(&path, ids.as_deref())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn history_rename(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    let s = store(&app)?;
    tauri::async_runtime::spawn_blocking(move || s.rename(&from, &to)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(limit: u64) -> (Store, PathBuf) {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("glance-history-{}-{}-{n}", std::process::id(), now()));
        (Store::with_limit(dir.clone(), limit), dir)
    }

    fn pseudo_random(n: usize, seed: u64) -> Vec<u8> {
        let mut x = seed;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                x as u8
            })
            .collect()
    }

    fn chunk_bytes(dir: &Path) -> u64 {
        std::fs::read_dir(dir.join("chunks"))
            .unwrap()
            .flatten()
            .flat_map(|d| std::fs::read_dir(d.path()).unwrap().flatten())
            .map(|f| f.metadata().unwrap().len())
            .sum()
    }

    #[test]
    fn versions_round_trip_and_share_unchanged_chunks() {
        let (s, dir) = temp_store(u64::MAX);
        let v1 = pseudo_random(2_000_000, 7);
        let mut v2 = v1.clone();
        v2[1_000_000..1_000_100].copy_from_slice(&[0xAB; 100]); // a small edit in the middle
        let a = s.record("C:\\Docs\\Report.pdf", &v1, "Opened").unwrap().unwrap();
        let b = s.record("c:/docs/report.pdf", &v2, "Saved").unwrap().unwrap(); // same file, other spelling
        assert!(s.record("C:\\Docs\\Report.pdf", &v2, "Saved").unwrap().is_none(), "identical save is a no-op");
        assert_eq!(s.read("C:\\Docs\\Report.pdf", &a.id).unwrap(), v1);
        assert_eq!(s.read("C:\\Docs\\Report.pdf", &b.id).unwrap(), v2);
        assert_eq!(s.list("C:\\Docs\\Report.pdf").iter().map(|v| v.label.as_str()).collect::<Vec<_>>(), ["Saved", "Opened"]);
        // Dedup: the second version adds only the chunk(s) around the edit.
        let stored = chunk_bytes(&dir);
        assert!(stored < 2_000_000 + 600_000, "stored {stored} bytes for two 2 MB versions");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn deleting_versions_removes_their_unique_data() {
        let (s, dir) = temp_store(u64::MAX);
        s.record("a.pdf", &pseudo_random(300_000, 1), "one").unwrap();
        let keep = s.record("a.pdf", &pseudo_random(300_000, 2), "two").unwrap().unwrap();
        let before = chunk_bytes(&dir);
        let old: Vec<String> = s.list("a.pdf").into_iter().filter(|v| v.id != keep.id).map(|v| v.id).collect();
        assert_eq!(s.delete("a.pdf", Some(&old)).unwrap(), 1);
        assert!(chunk_bytes(&dir) < before);
        assert!(s.read("a.pdf", &keep.id).is_ok());
        s.delete("a.pdf", None).unwrap();
        assert_eq!(chunk_bytes(&dir), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn oldest_versions_go_first_when_over_the_limit() {
        let (s, dir) = temp_store(700_000);
        for seed in 1..=4 {
            s.record("b.png", &pseudo_random(300_000, seed), "save").unwrap();
        }
        let left = s.list("b.png");
        assert!(left.len() < 4 && !left.is_empty());
        assert!(chunk_bytes(&dir) <= 700_000);
        assert_eq!(s.read("b.png", &left[0].id).unwrap(), pseudo_random(300_000, 4), "newest survives");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn thinning_keeps_recent_all_then_daily_then_weekly() {
        let now = 1_000 * DAY;
        let mk = |t: u64| Version { id: format!("{t}"), time: t, size: 0, label: String::new(), hash: String::new(), chunks: vec![] };
        let mut vs: Vec<Version> = vec![
            mk(now - 200 * DAY), mk(now - 199 * DAY), // same week, >30 days: one kept
            mk(now - 10 * DAY - 3000), mk(now - 10 * DAY - 2000), // same day: one kept
            mk(now - 5000), mk(now - 4000), mk(now - 1000), // last day: all kept
        ];
        vs.sort_by_key(|v| v.time);
        thin(&mut vs, now);
        assert_eq!(vs.len(), 1 + 1 + 3);
        assert_eq!(vs.last().unwrap().time, now - 1000);
    }

    #[test]
    fn renaming_moves_the_history() {
        let (s, dir) = temp_store(u64::MAX);
        let v = s.record("old.pdf", b"hello", "x").unwrap().unwrap();
        s.rename("old.pdf", "new.pdf").unwrap();
        assert!(s.list("old.pdf").is_empty());
        assert_eq!(s.read("new.pdf", &v.id).unwrap(), b"hello");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
