//! Where a running Glance listens for AI apps, shared by the app and `glance-mcp`
//! (src-tauri/mcp-bridge includes this file by path, so it must stay std-only).
//!
//! Glance listens on a random loopback port and writes the port and a secret token to
//! a file only the current user can read. `glance-mcp` reads the file, connects, and
//! sends the token as its first line; Glance answers `OK` and from then on both sides
//! exchange MCP's newline-delimited JSON-RPC messages.

use std::path::PathBuf;

/// First line the client sends: this, a space, then the token.
pub const HELLO: &str = "GLANCE-MCP";
/// Glance's answer to a correct token.
pub const WELCOME: &str = "OK";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
    pub pid: u32,
}

impl Endpoint {
    pub fn to_line(&self) -> String {
        format!("{} {} {}\n", self.port, self.token, self.pid)
    }

    pub fn parse(s: &str) -> Option<Self> {
        let mut parts = s.split_whitespace();
        let port = parts.next()?.parse().ok()?;
        let token = parts.next()?.to_string();
        let pid = parts.next()?.parse().ok()?;
        (!token.is_empty()).then_some(Self { port, token, pid })
    }
}

/// Glance's local data folder on Windows (`%LOCALAPPDATA%\io.github.redtrocks.glance`,
/// not the install folder `%LOCALAPPDATA%\Glance`); the runtime or temp directory
/// elsewhere (development builds only).
pub fn dir() -> PathBuf {
    if let Some(d) = std::env::var_os("GLANCE_MCP_DIR") {
        return PathBuf::from(d);
    }
    #[cfg(windows)]
    if let Some(d) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(d).join("io.github.redtrocks.glance");
    }
    let base = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let user = std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default();
    base.join(format!("glance-{user}"))
}

pub fn file() -> PathBuf {
    dir().join("mcp-endpoint")
}

// Used by glance-mcp, which includes this file.
#[allow(dead_code)]
pub fn read() -> Option<Endpoint> {
    Endpoint::parse(&std::fs::read_to_string(file()).ok()?)
}

/// Compares in constant time, so the token can't be guessed byte by byte.
pub fn same_token(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let e = Endpoint { port: 51234, token: "abc123".into(), pid: 42 };
        assert_eq!(Endpoint::parse(&e.to_line()), Some(e));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(Endpoint::parse(""), None);
        assert_eq!(Endpoint::parse("port token pid"), None);
        assert_eq!(Endpoint::parse("80"), None);
    }

    #[test]
    fn compares_tokens() {
        assert!(same_token("abc", "abc"));
        assert!(!same_token("abc", "abd"));
        assert!(!same_token("abc", "abcd"));
    }
}
