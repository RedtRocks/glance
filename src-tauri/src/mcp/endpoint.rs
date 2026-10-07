//! Where a running Glance listens for AI apps, shared by the app and `glance-mcp`
//! (src-tauri/mcp-bridge includes this file by path; only std and Unix libc are used).
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
/// not the install folder `%LOCALAPPDATA%\Glance`); a private runtime or state
/// directory on Unix. Both the app and bridge honor `GLANCE_MCP_DIR`.
pub fn dir() -> PathBuf {
    if let Some(d) = std::env::var_os("GLANCE_MCP_DIR") {
        return PathBuf::from(d);
    }
    #[cfg(windows)]
    if let Some(d) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(d).join("io.github.redtrocks.glance");
    }
    #[cfg(unix)]
    {
        let absolute_env = |key| std::env::var_os(key).map(PathBuf::from).filter(|p| p.is_absolute());
        if let Some(base) = absolute_env("XDG_RUNTIME_DIR") {
            return base.join("glance");
        }
        let base = absolute_env("XDG_STATE_HOME").unwrap_or_else(|| {
            // Without a home, fail closed rather than publish a token in a shared temp directory.
            absolute_env("HOME").unwrap_or_else(|| PathBuf::from("/")).join(".local/state")
        });
        base.join("glance")
    }
    #[cfg(not(unix))]
    {
        let base = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let user = std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default();
        base.join(format!("glance-{user}"))
    }
}

pub fn file() -> PathBuf {
    dir().join("mcp-endpoint")
}

// Used by glance-mcp, which includes this file.
#[allow(dead_code)]
pub fn read() -> Option<Endpoint> {
    #[cfg(unix)]
    {
        read_in(&dir())
    }
    #[cfg(not(unix))]
    {
        Endpoint::parse(&std::fs::read_to_string(file()).ok()?)
    }
}

/// A private directory prevents other users from swapping the endpoint or stealing its token.
#[cfg(unix)]
pub fn private_dir_ok(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
        return Err(format!("{} is not a private directory owned by the current user", path.display()));
    }
    Ok(())
}

#[cfg(unix)]
fn read_in(dir: &std::path::Path) -> Option<Endpoint> {
    use std::io::Read;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    private_dir_ok(dir).ok()?;
    let path = dir.join("mcp-endpoint");
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() || meta.uid() != unsafe { libc::geteuid() } {
        return None;
    }
    let mut file = std::fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(path).ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file() || meta.uid() != unsafe { libc::geteuid() } {
        return None;
    }
    let mut line = String::new();
    file.read_to_string(&mut line).ok()?;
    Endpoint::parse(&line)
}

// The bridge includes this module but only reads endpoints.
#[cfg(unix)]
#[allow(dead_code)]
pub fn write_in(dir: &std::path::Path, ep: &Endpoint) -> std::io::Result<()> {
    use std::io::Read;
    let mut random = [0u8; 16];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
    write_with_temp(dir, ep, &format!(".mcp-endpoint-{:032x}.tmp", u128::from_ne_bytes(random)))
}

#[cfg(unix)]
fn write_with_temp(dir: &std::path::Path, ep: &Endpoint, name: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    private_dir_ok(dir).map_err(|e| std::io::Error::new(std::io::ErrorKind::PermissionDenied, e))?;
    let tmp = dir.join(name);
    // Never remove a pre-existing file when exclusive creation refuses it.
    let mut file = std::fs::OpenOptions::new()
        .write(true).create_new(true).mode(0o600).custom_flags(libc::O_NOFOLLOW).open(&tmp)?;
    let result = (|| {
        file.write_all(ep.to_line().as_bytes())?;
        drop(file);
        std::fs::rename(&tmp, dir.join("mcp-endpoint"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
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

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;
    use std::os::unix::fs::{symlink, DirBuilderExt, MetadataExt, PermissionsExt};
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let name = format!("glance-endpoint-test-{}-{}-{}", std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed));
            let path = std::env::temp_dir().join(name);
            std::fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn ep() -> Endpoint {
        Endpoint { port: 51234, token: "secret".into(), pid: 42 }
    }

    #[test]
    fn rejects_symlinked_directory() {
        let temp = TempDir::new();
        let link = temp.0.join("link");
        symlink(&temp.0, &link).unwrap();
        assert!(private_dir_ok(&link).is_err());
        assert!(write_in(&link, &ep()).is_err());
        assert_eq!(read_in(&link), None);
        assert!(!temp.0.join("mcp-endpoint").exists());
    }

    #[test]
    fn rejects_public_directory() {
        let temp = TempDir::new();
        std::fs::set_permissions(&temp.0, std::fs::Permissions::from_mode(0o777)).unwrap();
        assert!(private_dir_ok(&temp.0).is_err());
        assert!(write_in(&temp.0, &ep()).is_err());
        std::fs::write(temp.0.join("mcp-endpoint"), ep().to_line()).unwrap();
        assert_eq!(read_in(&temp.0), None);
    }

    #[test]
    fn exclusive_create_preserves_existing_file_and_symlink() {
        let temp = TempDir::new();
        let existing = temp.0.join("existing.tmp");
        std::fs::write(&existing, b"untouched").unwrap();
        assert!(write_with_temp(&temp.0, &ep(), "existing.tmp").is_err());
        assert_eq!(std::fs::read(&existing).unwrap(), b"untouched");
        let link = temp.0.join("link.tmp");
        symlink(&existing, &link).unwrap();
        assert!(write_with_temp(&temp.0, &ep(), "link.tmp").is_err());
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(&existing).unwrap(), b"untouched");
        assert!(!temp.0.join("mcp-endpoint").exists());
    }

    #[test]
    fn round_trips_in_fresh_private_directory() {
        let temp = TempDir::new();
        let dir = temp.0.join("fresh");
        write_in(&dir, &ep()).unwrap();
        assert_eq!(std::fs::metadata(&dir).unwrap().mode() & 0o777, 0o700);
        assert_eq!(std::fs::metadata(dir.join("mcp-endpoint")).unwrap().mode() & 0o777, 0o600);
        assert_eq!(read_in(&dir), Some(ep()));
        let replacement = Endpoint { port: 51235, token: "replacement".into(), pid: 43 };
        write_in(&dir, &replacement).unwrap();
        assert_eq!(read_in(&dir), Some(replacement));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn refuses_symlinked_endpoint() {
        let temp = TempDir::new();
        let target = temp.0.join("target");
        std::fs::write(&target, ep().to_line()).unwrap();
        symlink(&target, temp.0.join("mcp-endpoint")).unwrap();
        assert_eq!(read_in(&temp.0), None);
    }

    #[test]
    fn removes_own_temp_file_after_rename_failure() {
        let temp = TempDir::new();
        std::fs::create_dir(temp.0.join("mcp-endpoint")).unwrap();
        assert!(write_with_temp(&temp.0, &ep(), "new.tmp").is_err());
        assert!(!temp.0.join("new.tmp").exists());
        assert_eq!(read_in(&temp.0), None);
    }
}
