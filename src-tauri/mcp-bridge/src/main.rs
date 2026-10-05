//! glance-mcp: lets AI apps (Claude Code, Claude Desktop, Codex, Cursor, …) use Glance.
//!
//! AI apps start MCP servers as a command and talk JSON-RPC over its stdin and stdout.
//! This relays those messages, unchanged, to the Glance app, which implements the tools
//! (src/state/mcp.ts). If Glance isn't running, it is started without a window and
//! quits again when the AI app disconnects. Glance.exe itself can't be the command: it
//! is a GUI program, a second launch hands over to the running one, and its window
//! must survive the AI app.
//!
//! Std only, so it stays small and starts instantly.

#[path = "../../src/mcp/endpoint.rs"]
mod endpoint;

use std::io::{self, BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Cold start of Glance (WebView2 included) on a slow machine.
const START_TIMEOUT: Duration = Duration::from_secs(60);

fn main() {
    if let Some(arg) = std::env::args().nth(1) {
        match arg.as_str() {
            "--version" | "-V" => return println!("glance-mcp {}", env!("CARGO_PKG_VERSION")),
            "--help" | "-h" => {
                return println!(
                    "glance-mcp: lets AI apps use Glance (MCP over stdio).\n\nAdd it to your AI app as a stdio MCP server with this command:\n  {}\n\nGlance starts in the background when needed.",
                    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_else(|_| "glance-mcp".into())
                )
            }
            _ => {}
        }
    }
    let stream = match connect() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("glance-mcp: {e}");
            std::process::exit(1);
        }
    };
    let mut from_app = match stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("glance-mcp: {e}");
            std::process::exit(1);
        }
    };
    // Glance → AI app. Glance closing the connection ends the session.
    std::thread::spawn(move || {
        let stdout = io::stdout();
        let _ = io::copy(&mut from_app, &mut stdout.lock());
        std::process::exit(0);
    });
    // AI app → Glance, until the AI app closes our stdin.
    let mut to_app = stream;
    let _ = io::copy(&mut io::stdin().lock(), &mut to_app);
    let _ = to_app.shutdown(std::net::Shutdown::Both);
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
        if cmd.spawn().is_ok() {
            return Ok(());
        }
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("couldn't start {}: {e}", app.display()))
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

    #[test]
    fn wrong_token_is_refused() {
        let port = fake_app("secret");
        let ep = endpoint::Endpoint { port, token: "guess".into(), pid: 1 };
        assert!(handshake(&ep).is_err());
    }
}
