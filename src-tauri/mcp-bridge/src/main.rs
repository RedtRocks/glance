//! glance-mcp: lets AI apps (Claude Code, Claude Desktop, Codex, Cursor, …) use Glance.
//!
//! AI apps start MCP servers as a command and talk JSON-RPC over its stdin and stdout.
//! glance-mcp answers the handshake and the tool list itself (from src/core/mcp/tools.json),
//! so an AI app starting up doesn't start Glance. The first tool call connects to the
//! Glance app, starting it without a window if it isn't running, and from then on calls are
//! relayed unchanged to Glance, which implements the tools (src/state/mcp.ts). If Glance
//! goes away (the user quit it), the next call starts or finds it again, so the AI app
//! never has to be told to open Glance. Glance.exe itself can't be the command: it is a
//! GUI program, a second launch hands over to the running one, and its window must survive
//! the AI app.

#[path = "../../src/mcp/endpoint.rs"]
#[allow(dead_code)] // The app side uses the rest.
mod endpoint;

use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Cold start of Glance (WebView2 included) on a slow machine.
const START_TIMEOUT: Duration = Duration::from_secs(60);

/// Must match PROTOCOL_VERSIONS in src/core/mcp/protocol.ts (tests/mcp.test.ts checks).
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS_JSON: &str = include_str!("../../../src/core/mcp/tools.json");
const TAURI_CONF: &str = include_str!("../../tauri.conf.json");

fn main() {
    if let Some(arg) = std::env::args().nth(1) {
        match arg.as_str() {
            "--version" | "-V" => return println!("glance-mcp {}", app_version()),
            "--help" | "-h" => {
                return println!(
                    "glance-mcp: lets AI apps use Glance (MCP over stdio).\n\nAdd it to your AI app as a stdio MCP server with this command:\n  {}\n\nGlance starts in the background when a tool needs it.",
                    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_else(|_| "glance-mcp".into())
                )
            }
            _ => {}
        }
    }
    let mut bridge = Bridge::new(io::stdout(), connect);
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if !line.trim().is_empty() {
            bridge.handle(&line);
        }
    }
    bridge.close();
}

/// Glance's version, which glance-mcp ships with.
fn app_version() -> String {
    serde_json::from_str::<Value>(TAURI_CONF)
        .ok()
        .and_then(|c| c.get("version")?.as_str().map(str::to_string))
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").into())
}

/// The live connection to Glance.
struct Link {
    stream: TcpStream,
    /// Cleared by the reader thread when Glance closes the connection.
    open: Arc<Mutex<bool>>,
}

/// Speaks MCP to the AI app (`out`), answering what it can itself and relaying the rest to
/// Glance over a connection made on first need and remade after Glance goes away.
struct Bridge<W: Write + Send + 'static> {
    out: Arc<Mutex<W>>,
    connect: Box<dyn FnMut() -> Result<TcpStream, String>>,
    link: Option<Link>,
    /// Ids (as JSON) of relayed requests Glance hasn't answered yet.
    pending: Arc<Mutex<HashSet<String>>>,
    catalog: Value,
}

impl<W: Write + Send + 'static> Bridge<W> {
    fn new(out: W, connect: impl FnMut() -> Result<TcpStream, String> + 'static) -> Self {
        Self {
            out: Arc::new(Mutex::new(out)),
            connect: Box::new(connect),
            link: None,
            pending: Arc::default(),
            catalog: serde_json::from_str(TOOLS_JSON).expect("tools.json is valid JSON"),
        }
    }

    fn handle(&mut self, line: &str) {
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return send(&self.out, &error(Value::Null, -32700, "Parse error")),
        };
        let method = msg.get("method").and_then(Value::as_str);
        let id = msg.get("id").cloned();
        if let (Some(method), Some(id)) = (method, &id) {
            if let Some(result) = self.answer(method, msg.get("params")) {
                return send(&self.out, &json!({ "jsonrpc": "2.0", "id": id, "result": result }));
            }
        }
        // Notifications (initialized, cancelled, …) only matter to a Glance already serving us.
        if method.is_some() && id.is_none() && !self.connected() {
            return;
        }
        self.relay(line, id);
    }

    /// What glance-mcp answers without Glance.
    fn answer(&self, method: &str, params: Option<&Value>) -> Option<Value> {
        Some(match method {
            "initialize" => {
                let asked = params.and_then(|p| p.get("protocolVersion")).and_then(Value::as_str).unwrap_or("");
                let version = PROTOCOL_VERSIONS.iter().find(|v| **v == asked).unwrap_or(&PROTOCOL_VERSIONS[0]);
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "glance", "title": "Glance", "version": app_version() },
                    "instructions": self.catalog["instructions"],
                })
            }
            "ping" => json!({}),
            "tools/list" => json!({ "tools": self.catalog["tools"] }),
            "resources/list" => json!({ "resources": [] }),
            "resources/templates/list" => json!({ "resourceTemplates": [] }),
            "prompts/list" => json!({ "prompts": [] }),
            _ => return None,
        })
    }

    fn connected(&self) -> bool {
        self.link.as_ref().is_some_and(|l| *l.open.lock().unwrap())
    }

    /// Sends a message to Glance, connecting (and starting Glance) first if needed. A
    /// request that can't be delivered is answered with an error.
    fn relay(&mut self, line: &str, id: Option<Value>) {
        let key = id.as_ref().map(Value::to_string);
        if let Some(k) = &key {
            self.pending.lock().unwrap().insert(k.clone());
        }
        // A connection Glance closed a moment ago can still accept a write; then try once more.
        for _ in 0..2 {
            if !self.connected() {
                if let Err(e) = self.open() {
                    return self.give_up(key.as_deref(), id.as_ref(), &format!("Couldn't reach Glance: {e}"));
                }
            }
            let link = self.link.as_mut().unwrap();
            if link.stream.write_all(format!("{line}\n").as_bytes()).is_ok() {
                return;
            }
            *link.open.lock().unwrap() = false;
        }
        self.give_up(key.as_deref(), id.as_ref(), "Couldn't reach Glance");
    }

    fn give_up(&self, key: Option<&str>, id: Option<&Value>, message: &str) {
        if let (Some(k), Some(id)) = (key, id) {
            if self.pending.lock().unwrap().remove(k) {
                send(&self.out, &error(id.clone(), -32603, message));
            }
        }
    }

    fn open(&mut self) -> Result<(), String> {
        if let Some(old) = self.link.take() {
            let _ = old.stream.shutdown(std::net::Shutdown::Both);
        }
        let stream = (self.connect)()?;
        let reader = stream.try_clone().map_err(|e| e.to_string())?;
        let open = Arc::new(Mutex::new(true));
        let (out, pending, still_open) = (self.out.clone(), self.pending.clone(), open.clone());
        // Glance → AI app, until Glance closes the connection.
        std::thread::spawn(move || {
            for line in BufReader::new(reader).lines() {
                let Ok(line) = line else { break };
                if let Some(id) = serde_json::from_str::<Value>(&line).ok().and_then(|m| m.get("id").cloned()) {
                    pending.lock().unwrap().remove(&id.to_string());
                }
                let mut out = out.lock().unwrap();
                let _ = writeln!(out, "{line}").and_then(|_| out.flush());
            }
            *still_open.lock().unwrap() = false;
            // Requests Glance took with it (the user quit it mid-call) get an answer.
            for key in std::mem::take(&mut *pending.lock().unwrap()) {
                if let Ok(id) = serde_json::from_str::<Value>(&key) {
                    send(&out, &error(id, -32603, "Glance closed before finishing. Try again; it will start again."));
                }
            }
        });
        self.link = Some(Link { stream, open });
        Ok(())
    }

    fn close(&mut self) {
        if let Some(link) = self.link.take() {
            let _ = link.stream.shutdown(std::net::Shutdown::Both);
        }
    }
}

fn error(id: Value, code: i32, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn send<W: Write>(out: &Mutex<W>, msg: &Value) {
    let mut out = out.lock().unwrap();
    let _ = writeln!(out, "{msg}").and_then(|_| out.flush());
}

/// Connects to the running Glance, starting it first if needed.
fn connect() -> Result<TcpStream, String> {
    let deadline = Instant::now() + START_TIMEOUT;
    let mut launched = false;
    let mut last_error = String::from("Glance didn't start");
    loop {
        if let Some(ep) = endpoint::read() {
            match handshake(&ep) {
                Ok(s) => return Ok(s),
                Err(e) => last_error = e,
            }
        }
        if !launched {
            launch()?;
            launched = true;
        }
        if Instant::now() > deadline {
            return Err(format!("couldn't reach Glance: {last_error}"));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn handshake(ep: &endpoint::Endpoint) -> Result<TcpStream, String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, ep.port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).map_err(|e| e.to_string())?;
    s.set_nodelay(true).ok();
    s.set_read_timeout(Some(Duration::from_secs(5))).ok();
    s.write_all(format!("{} {}\n", endpoint::HELLO, ep.token).as_bytes()).map_err(|e| e.to_string())?;
    let mut line = String::new();
    // One byte at a time, so nothing after the greeting is consumed by a buffer.
    let mut byte = [0u8; 1];
    while !line.ends_with('\n') {
        match io::Read::read(&mut s, &mut byte) {
            Ok(1) => line.push(byte[0] as char),
            Ok(_) => return Err("Glance closed the connection".into()),
            Err(e) => return Err(e.to_string()),
        }
        if line.len() > 64 {
            return Err("unexpected greeting".into());
        }
    }
    if line.trim() != endpoint::WELCOME {
        return Err("Glance refused the connection".into());
    }
    s.set_read_timeout(None).ok();
    Ok(s)
}

/// The Glance app next to this program (or GLANCE_APP), started hidden with `--mcp`.
fn launch() -> Result<(), String> {
    let app = app_path()?;
    let mut cmd = Command::new(&app);
    cmd.arg("--mcp").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(dir) = app.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        // Outlive the AI app's process tree when it allows that; the user may open the
        // window later and keep working.
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
        keep_std_handles_to_ourselves();
        if cmd.spawn().is_ok() {
            return Ok(());
        }
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("couldn't start {}: {e}", app.display()))
}

/// Windows hands every inheritable handle to a child, whatever its stdio says, and the
/// pipes the AI app gave us are inheritable. Glance would then hold the AI app's pipes
/// open after we exit, and an AI app waiting for our output to end would wait forever.
#[cfg(windows)]
fn keep_std_handles_to_ourselves() {
    const STD_HANDLES: [u32; 3] = [-10i32 as u32, -11i32 as u32, -12i32 as u32];
    const HANDLE_FLAG_INHERIT: u32 = 1;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(which: u32) -> isize;
        fn SetHandleInformation(handle: isize, mask: u32, flags: u32) -> i32;
    }
    for which in STD_HANDLES {
        // SAFETY: plain Win32 calls on this process's own standard handles.
        unsafe {
            let h = GetStdHandle(which);
            if h != 0 && h != -1 {
                SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0);
            }
        }
    }
}

fn app_path() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("GLANCE_APP") {
        return Ok(PathBuf::from(p));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = std::fs::canonicalize(&exe).unwrap_or(exe);
    let dir = exe.parent().ok_or("no folder for glance-mcp")?;
    let name = if cfg!(windows) { "glance.exe" } else { "glance" };
    let app = dir.join(name);
    if app.is_file() {
        Ok(app)
    } else {
        Err(format!("Glance isn't installed next to glance-mcp ({} not found)", app.display()))
    }
}

/// Reads one line (used by tests).
#[allow(dead_code)]
fn read_line(s: &TcpStream) -> io::Result<String> {
    let mut line = String::new();
    BufReader::new(s).read_line(&mut line)?;
    Ok(line)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// A fake Glance: checks the token, then echoes one line back.
    fn fake_app(token: &'static str) -> u16 {
        let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let hello = read_line(&s).unwrap();
            if hello.trim() == format!("{} {token}", endpoint::HELLO) {
                s.write_all(b"OK\n").unwrap();
                let msg = read_line(&s).unwrap();
                s.write_all(msg.as_bytes()).unwrap();
            }
        });
        port
    }

    #[test]
    fn handshakes_and_relays() {
        let port = fake_app("secret");
        let ep = endpoint::Endpoint { port, token: "secret".into(), pid: 1 };
        let mut s = handshake(&ep).unwrap();
        s.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n").unwrap();
        assert_eq!(read_line(&s).unwrap(), "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n");
    }

    /// What the bridge wrote to the AI app, shared with the test.
    #[derive(Clone, Default)]
    struct Out(Arc<Mutex<Vec<u8>>>);
    impl Write for Out {
        fn write(&mut self, b: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().write(b)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    impl Out {
        /// Waits for the n-th line the bridge wrote.
        fn line(&self, n: usize) -> Value {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let text = String::from_utf8(self.0.lock().unwrap().clone()).unwrap();
                if let Some(l) = text.lines().nth(n) {
                    return serde_json::from_str(l).unwrap();
                }
                assert!(Instant::now() < deadline, "no line {n} in {text:?}");
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }

    /// A Glance that answers each request with `{"ok": <method>}`, then, after
    /// `answers` requests, closes the connection. Counts connections.
    fn glance(answers: usize) -> (impl FnMut() -> Result<TcpStream, String>, Arc<Mutex<usize>>) {
        let connections = Arc::new(Mutex::new(0));
        let count = connections.clone();
        let connect = move || {
            let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = l.local_addr().unwrap().port();
            std::thread::spawn(move || {
                let (s, _) = l.accept().unwrap();
                let mut w = s.try_clone().unwrap();
                for line in BufReader::new(s).lines().take(answers) {
                    let m: Value = serde_json::from_str(&line.unwrap()).unwrap();
                    writeln!(w, "{}", json!({ "jsonrpc": "2.0", "id": m["id"], "result": { "ok": m["method"] } })).unwrap();
                }
            });
            *count.lock().unwrap() += 1;
            TcpStream::connect((Ipv4Addr::LOCALHOST, port)).map_err(|e| e.to_string())
        };
        (connect, connections)
    }

    #[test]
    fn answers_the_handshake_without_starting_glance() {
        let out = Out::default();
        let mut b = Bridge::new(out.clone(), || -> Result<TcpStream, String> { panic!("started Glance") });
        b.handle(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#);
        b.handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        b.handle(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        let init = out.line(0);
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(init["result"]["serverInfo"]["name"], "glance");
        assert!(init["result"]["instructions"].as_str().unwrap().contains("Glance"));
        let tools = out.line(1)["result"]["tools"].as_array().unwrap().len();
        assert!(tools >= 13);
    }

    #[test]
    fn starts_glance_on_the_first_call_and_again_after_it_quits() {
        let out = Out::default();
        let (connect, connections) = glance(1);
        let mut b = Bridge::new(out.clone(), connect);
        b.handle(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"glance_info"}}"#);
        assert_eq!(out.line(0)["result"]["ok"], "tools/call");
        // That Glance closes after one answer, as if the user quit it.
        let deadline = Instant::now() + Duration::from_secs(5);
        while b.connected() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        b.handle(r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"glance_info"}}"#);
        assert_eq!(out.line(1)["id"], 2);
        assert_eq!(out.line(1)["result"]["ok"], "tools/call");
        assert_eq!(*connections.lock().unwrap(), 2);
    }

    #[test]
    fn a_call_glance_never_answers_gets_an_error() {
        let out = Out::default();
        let (connect, _) = glance(0);
        let mut b = Bridge::new(out.clone(), connect);
        b.handle(r#"{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"glance_info"}}"#);
        let reply = out.line(0);
        assert_eq!(reply["id"], "a");
        assert!(reply["error"]["message"].as_str().unwrap().contains("Glance"));
    }

    #[test]
    fn says_when_glance_cant_start() {
        let out = Out::default();
        let mut b = Bridge::new(out.clone(), || Err("not installed".to_string()));
        b.handle(r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"glance_info"}}"#);
        assert_eq!(out.line(0)["error"]["message"], "Couldn't reach Glance: not installed");
    }

    #[test]
    fn protocol_versions_match_the_app() {
        let ts = include_str!("../../../src/core/mcp/protocol.ts");
        let list = PROTOCOL_VERSIONS.iter().map(|v| format!("'{v}'")).collect::<Vec<_>>().join(", ");
        assert!(ts.contains(&format!("PROTOCOL_VERSIONS = [{list}]")), "update PROTOCOL_VERSIONS in both places");
    }

    #[test]
    fn wrong_token_is_refused() {
        let port = fake_app("secret");
        let ep = endpoint::Endpoint { port, token: "guess".into(), pid: 1 };
        assert!(handshake(&ep).is_err());
    }
}
