//! AI apps (MCP clients) talking to Glance, through `glance-mcp` (src-tauri/mcp-bridge).
//!
//! Glance listens on a loopback port (see endpoint.rs) and relays each connection's
//! JSON-RPC lines to the main window, where the MCP server and its tools live
//! (src/state/mcp.ts). Answers come back through `mcp_send`.
//!
//! Started by `glance-mcp` with `--mcp`, Glance keeps its window hidden and quits when
//! the last AI app disconnects, unless the user (or a tool) showed the window meanwhile.

pub mod apps;
pub mod endpoint;

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Launched by `glance-mcp` to serve an AI app, not by the user.
pub fn launched_for_ai<S: AsRef<str>>(args: &[S]) -> bool {
    args.iter().any(|a| a.as_ref() == "--mcp")
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Event {
    Message { conn: u64, message: String },
    Closed { conn: u64 },
}

#[derive(Default)]
pub struct Hub {
    conns: Mutex<HashMap<u64, TcpStream>>,
    /// Events that arrived before the main window started listening.
    pending: Mutex<Vec<Event>>,
    listening: AtomicBool,
    next: AtomicU64,
    hidden_launch: AtomicBool,
}

fn deliver(app: &AppHandle, event: Event) {
    let hub = app.state::<Hub>();
    if hub.listening.load(Ordering::SeqCst) {
        let _ = app.emit_to("main", "mcp", event);
    } else {
        hub.pending.lock().unwrap().push(event);
    }
}

fn new_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut seed = Vec::new();
    for _ in 0..4 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        seed.extend_from_slice(&h.finish().to_le_bytes());
    }
    seed.extend_from_slice(&std::process::id().to_le_bytes());
    blake3::hash(&seed).to_hex()[..40].to_string()
}

fn write_endpoint(ep: &endpoint::Endpoint) -> std::io::Result<()> {
    std::fs::create_dir_all(endpoint::dir())?;
    let path = endpoint::file();
    let tmp = path.with_extension("tmp");
    {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
        opts.open(&tmp)?.write_all(ep.to_line().as_bytes())?;
    }
    std::fs::rename(&tmp, &path)
}

/// Starts listening for `glance-mcp`. Called once, from setup.
pub fn start(app: &AppHandle, hidden_launch: bool) {
    app.state::<Hub>().hidden_launch.store(hidden_launch, Ordering::SeqCst);
    let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, 0)) {
        Ok(l) => l,
        Err(e) => return eprintln!("[mcp] can't listen: {e}"),
    };
    let port = match listener.local_addr() {
        Ok(a) => a.port(),
        Err(e) => return eprintln!("[mcp] can't listen: {e}"),
    };
    let token = new_token();
    if let Err(e) = write_endpoint(&endpoint::Endpoint { port, token: token.clone(), pid: std::process::id() }) {
        return eprintln!("[mcp] can't write {}: {e}", endpoint::file().display());
    }
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let token = token.clone();
            std::thread::spawn(move || serve(app, stream, &token));
        }
    });
}

fn serve(app: AppHandle, stream: TcpStream, token: &str) {
    let Ok(writer) = stream.try_clone() else { return };
    let mut reader = BufReader::new(stream);
    let mut hello = String::new();
    // Anything other than glance-mcp (a browser, a port scanner) is dropped right away.
    let _ = reader.get_ref().set_read_timeout(Some(Duration::from_secs(5)));
    if reader.read_line(&mut hello).is_err() {
        return;
    }
    let ok = hello
        .trim_end()
        .strip_prefix(endpoint::HELLO)
        .and_then(|rest| rest.strip_prefix(' '))
        .is_some_and(|t| endpoint::same_token(t, token));
    if !ok {
        return;
    }
    let _ = reader.get_ref().set_read_timeout(None);
    let mut w = &writer;
    if w.write_all(format!("{}\n", endpoint::WELCOME).as_bytes()).is_err() {
        return;
    }
    let _ = writer.set_nodelay(true);
    let hub = app.state::<Hub>();
    let conn = hub.next.fetch_add(1, Ordering::SeqCst) + 1;
    hub.conns.lock().unwrap().insert(conn, writer);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let message = line.trim();
                if !message.is_empty() {
                    deliver(&app, Event::Message { conn, message: message.to_string() });
                }
            }
        }
    }
    let left = {
        let mut conns = hub.conns.lock().unwrap();
        conns.remove(&conn);
        conns.len()
    };
    deliver(&app, Event::Closed { conn });
    if left == 0 && hub.hidden_launch.load(Ordering::SeqCst) {
        // Give a restarting AI app a moment to reconnect before quitting.
        std::thread::sleep(Duration::from_secs(3));
        let idle = hub.conns.lock().unwrap().is_empty();
        let hidden = app.get_webview_window("main").map(|w| !w.is_visible().unwrap_or(true)).unwrap_or(true);
        if idle && hidden && app.webview_windows().len() <= 1 {
            app.exit(0);
        }
    }
}

/// The main window starts handling AI requests: returns those that arrived before,
/// later ones come as "mcp" events.
#[tauri::command]
pub fn mcp_take(window: tauri::WebviewWindow, hub: tauri::State<'_, Hub>) -> Vec<Event> {
    if window.label() != "main" {
        return Vec::new();
    }
    let mut pending = hub.pending.lock().unwrap();
    hub.listening.store(true, Ordering::SeqCst);
    std::mem::take(&mut *pending)
}

/// Sends one JSON-RPC message to an AI app.
#[tauri::command]
pub fn mcp_send(conn: u64, message: String, hub: tauri::State<'_, Hub>) -> Result<(), String> {
    let conns = hub.conns.lock().unwrap();
    let Some(stream) = conns.get(&conn) else { return Err("the AI app disconnected".into()) };
    let mut w = stream;
    // JSON never needs a raw newline; one would split the message in two.
    let line = format!("{}\n", message.replace(['\r', '\n'], " "));
    w.write_all(line.as_bytes()).map_err(|e| e.to_string())
}

/// Whether this launch came from an AI app (the window stays hidden until needed).
#[tauri::command]
pub fn mcp_launched_hidden(hub: tauri::State<'_, Hub>) -> bool {
    hub.hidden_launch.load(Ordering::SeqCst)
}

/// A tool asked to show Glance: from now on it stays open like a normal launch.
#[tauri::command]
pub fn mcp_show(app: AppHandle) {
    app.state::<Hub>().hidden_launch.store(false, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spots_the_ai_launch_flag() {
        assert!(launched_for_ai(&["--mcp"]));
        assert!(!launched_for_ai(&["C:\\a.pdf", "--combine-pdf"]));
    }

    #[test]
    fn tokens_are_unique() {
        let (a, b) = (new_token(), new_token());
        assert_eq!(a.len(), 40);
        assert_ne!(a, b);
    }

    #[test]
    fn events_serialize_for_the_ui() {
        let m = serde_json::to_string(&Event::Message { conn: 3, message: "{}".into() }).unwrap();
        assert_eq!(m, r#"{"type":"message","conn":3,"message":"{}"}"#);
        let c = serde_json::to_string(&Event::Closed { conn: 3 }).unwrap();
        assert_eq!(c, r#"{"type":"closed","conn":3}"#);
    }
}
