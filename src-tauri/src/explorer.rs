//! Explorer's right-click verbs (Combine into PDF, Remove Location Info).
//!
//! The classic context menu runs the verb's command once per selected file, so a
//! selection of ten files arrives as ten launches: one starts Glance, the rest are
//! forwarded by the single-instance plugin. Launches are gathered here until they stop
//! arriving for a moment, then handed to the UI as one request.

use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// How long to wait after the last launch before treating the selection as complete.
const SETTLE: Duration = Duration::from_millis(600);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Action {
    Combine,
    RemoveLocation,
}

impl Action {
    fn from_flag(arg: &str) -> Option<Self> {
        match arg {
            "--combine-pdf" => Some(Self::Combine),
            "--remove-location" => Some(Self::RemoveLocation),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Request {
    pub action: Action,
    pub files: Vec<String>,
}

/// The verb named on a command line, if any. Other flags are ignored.
pub fn action_from_args<S: AsRef<str>>(args: &[S]) -> Option<Action> {
    args.iter().find_map(|a| Action::from_flag(a.as_ref()))
}

#[derive(Default)]
struct Inner {
    pending: Vec<Request>,
    /// Bumped on every launch; a settle timer only flushes if nothing arrived since it started.
    generation: u64,
    /// Settled requests waiting for the UI to start listening.
    ready: Vec<Request>,
    listening: bool,
}

#[derive(Default)]
pub struct Queue(Mutex<Inner>);

impl Inner {
    fn push(&mut self, action: Action, files: Vec<String>) -> u64 {
        match self.pending.iter_mut().find(|r| r.action == action) {
            Some(r) => {
                for f in files {
                    if !r.files.iter().any(|g| crate::files::same_path(g, &f)) {
                        r.files.push(f);
                    }
                }
            }
            None => self.pending.push(Request { action, files }),
        }
        self.generation += 1;
        self.generation
    }

    /// Moves pending requests out if no launch arrived since `generation`.
    fn settle(&mut self, generation: u64) -> Vec<Request> {
        if generation != self.generation {
            return Vec::new();
        }
        std::mem::take(&mut self.pending).into_iter().filter(|r| !r.files.is_empty()).collect()
    }
}

/// Records one launch's files and schedules the hand-off to the UI.
pub fn enqueue(app: &AppHandle, action: Action, files: Vec<String>) {
    let generation = app.state::<Queue>().0.lock().unwrap().push(action, files);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SETTLE);
        let queue = app.state::<Queue>();
        let mut inner = queue.0.lock().unwrap();
        let settled = inner.settle(generation);
        if settled.is_empty() {
            return;
        }
        if inner.listening {
            drop(inner);
            for r in settled {
                let _ = app.emit_to("main", "shell-request", r);
            }
        } else {
            inner.ready.extend(settled);
        }
    });
}

/// Called by the main window once it listens for "shell-request": returns anything that
/// settled before then, and later requests arrive as events.
#[tauri::command]
pub fn take_shell_requests(window: tauri::WebviewWindow, queue: tauri::State<'_, Queue>) -> Vec<Request> {
    // Document windows opened later run the same UI; only the main window handles verbs.
    if window.label() != "main" {
        return Vec::new();
    }
    let mut inner = queue.0.lock().unwrap();
    inner.listening = true;
    std::mem::take(&mut inner.ready)
}

/// Where Combine into PDF writes: `name` in `dir`, or `name 2`, `name 3`… if taken.
#[tauri::command]
pub fn unique_path(dir: String, name: String) -> String {
    let dir = std::path::Path::new(&dir);
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name.as_str(), ""),
    };
    let mut n = 1;
    loop {
        let candidate = if n == 1 { dir.join(&name) } else { dir.join(format!("{stem} {n}{ext}")) };
        if !candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_verb_flag() {
        assert_eq!(action_from_args(&["--combine-pdf", "a.pdf"]), Some(Action::Combine));
        assert_eq!(action_from_args(&["a.jpg", "--remove-location"]), Some(Action::RemoveLocation));
        assert_eq!(action_from_args(&["a.jpg"]), None);
        assert_eq!(action_from_args::<&str>(&[]), None);
    }

    #[test]
    fn launches_merge_into_one_request_per_action() {
        let mut q = Inner::default();
        q.push(Action::Combine, vec!["C:\\a.pdf".into()]);
        q.push(Action::Combine, vec!["C:\\b.jpg".into()]);
        q.push(Action::Combine, vec!["c:\\A.PDF".into()]);
        let last = q.push(Action::RemoveLocation, vec!["C:\\c.jpg".into()]);
        let settled = q.settle(last);
        assert_eq!(
            settled,
            vec![
                Request { action: Action::Combine, files: vec!["C:\\a.pdf".into(), "C:\\b.jpg".into()] },
                Request { action: Action::RemoveLocation, files: vec!["C:\\c.jpg".into()] },
            ]
        );
        assert!(q.pending.is_empty());
    }

    #[test]
    fn a_later_launch_postpones_the_flush() {
        let mut q = Inner::default();
        let first = q.push(Action::Combine, vec!["a.pdf".into()]);
        let second = q.push(Action::Combine, vec!["b.pdf".into()]);
        assert!(q.settle(first).is_empty());
        assert_eq!(q.settle(second)[0].files.len(), 2);
    }

    #[test]
    fn empty_launches_are_dropped() {
        let mut q = Inner::default();
        let g = q.push(Action::Combine, vec![]);
        assert!(q.settle(g).is_empty());
    }

    #[test]
    fn unique_path_counts_up() {
        let dir = std::env::temp_dir().join(format!("glance-unique-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.to_string_lossy().into_owned();
        let first = unique_path(d.clone(), "Combined.pdf".into());
        assert!(first.ends_with("Combined.pdf"));
        std::fs::write(&first, b"x").unwrap();
        assert!(unique_path(d.clone(), "Combined.pdf".into()).ends_with("Combined 2.pdf"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
