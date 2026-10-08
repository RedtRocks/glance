//! Settings → AI apps: adds Glance to the MCP settings of AI apps installed for this user.
//!
//! Each app keeps its MCP servers in a config file; Connect adds a "glance" entry that
//! runs glance-mcp.exe, Disconnect removes it. Everything else in the file is kept as
//! is (key order included), a file that doesn't parse is never touched, and the first
//! change to a file keeps a copy of the original next to it (`*.glance-backup`).

use serde::Serialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// The entry's name in every app's config.
pub const SERVER_NAME: &str = "glance";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Format {
    /// `{ "<key>": { "glance": { "command": … } } }`; `typed` adds `"type": "stdio"`.
    Json { key: &'static str, typed: bool },
    /// Codex: `[mcp_servers.glance]` in config.toml.
    CodexToml,
}

#[derive(Clone, Debug)]
struct Target {
    file: PathBuf,
    /// The app counts as installed when this folder exists.
    detect: PathBuf,
    format: Format,
}

struct App {
    id: &'static str,
    name: &'static str,
    targets: Vec<Target>,
}

/// Base folders, passed in so tests can use a scratch home.
#[derive(Clone, Debug)]
pub struct Dirs {
    pub home: PathBuf,
    pub appdata: PathBuf,
    pub local_appdata: PathBuf,
}

impl Dirs {
    pub fn current() -> Option<Self> {
        let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
        let home = var("USERPROFILE").or_else(|| var("HOME"))?;
        Some(Self {
            appdata: var("APPDATA").unwrap_or_else(|| home.join(".config")),
            local_appdata: var("LOCALAPPDATA").unwrap_or_else(|| home.join(".local/share")),
            home,
        })
    }
}

const MCP_SERVERS: Format = Format::Json { key: "mcpServers", typed: false };

fn json_target(file: PathBuf, detect: PathBuf, format: Format) -> Target {
    Target { file, detect, format }
}

fn apps(d: &Dirs) -> Vec<App> {
    let home = &d.home;
    // Claude Desktop from the Microsoft Store (or winget) keeps its settings in the
    // package's virtualized AppData, and ignores the documented %APPDATA% file.
    let mut claude_desktop: Vec<Target> = std::fs::read_dir(d.local_appdata.join("Packages"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("Claude_"))
        .map(|e| {
            let dir = e.path().join("LocalCache").join("Roaming").join("Claude");
            json_target(dir.join("claude_desktop_config.json"), e.path(), MCP_SERVERS)
        })
        .collect();
    claude_desktop.push(json_target(d.appdata.join("Claude").join("claude_desktop_config.json"), d.appdata.join("Claude"), MCP_SERVERS));
    vec![
        App {
            id: "claude-code",
            name: "Claude Code",
            targets: vec![json_target(home.join(".claude.json"), home.join(".claude"), Format::Json { key: "mcpServers", typed: true })],
        },
        App { id: "claude-desktop", name: "Claude Desktop", targets: claude_desktop },
        App {
            id: "codex",
            name: "Codex",
            targets: vec![json_target(home.join(".codex").join("config.toml"), home.join(".codex"), Format::CodexToml)],
        },
        App {
            id: "antigravity",
            name: "Antigravity",
            targets: vec![
                // Antigravity 2 shares one config between the IDE, agy and the SDK.
                json_target(home.join(".gemini").join("config").join("mcp_config.json"), home.join(".gemini").join("config"), MCP_SERVERS),
                json_target(home.join(".gemini").join("antigravity").join("mcp_config.json"), home.join(".gemini").join("antigravity"), MCP_SERVERS),
            ],
        },
        App {
            id: "gemini-cli",
            name: "Gemini CLI",
            targets: vec![json_target(home.join(".gemini").join("settings.json"), home.join(".gemini").join("settings.json"), MCP_SERVERS)],
        },
        App {
            id: "muse-code",
            name: "Muse Code",
            targets: vec![json_target(home.join(".config").join("muse").join("settings.json"), home.join(".config").join("muse"), MCP_SERVERS)],
        },
        App {
            id: "cursor",
            name: "Cursor",
            targets: vec![json_target(home.join(".cursor").join("mcp.json"), home.join(".cursor"), MCP_SERVERS)],
        },
        App {
            id: "vscode",
            name: "VS Code (Copilot)",
            targets: vec![json_target(
                d.appdata.join("Code").join("User").join("mcp.json"),
                d.appdata.join("Code").join("User"),
                Format::Json { key: "servers", typed: true },
            )],
        },
        App {
            id: "windsurf",
            name: "Windsurf",
            targets: vec![json_target(home.join(".codeium").join("windsurf").join("mcp_config.json"), home.join(".codeium").join("windsurf"), MCP_SERVERS)],
        },
        App {
            id: "lm-studio",
            name: "LM Studio",
            targets: vec![json_target(home.join(".lmstudio").join("mcp.json"), home.join(".lmstudio"), MCP_SERVERS)],
        },
    ]
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub installed: bool,
    pub connected: bool,
    /// The config file(s) Connect writes.
    pub files: Vec<String>,
}

fn installed(app: &App) -> Vec<&Target> {
    app.targets.iter().filter(|t| t.detect.exists()).collect()
}

/// Muse Code still reads its old `mcp_servers` key, and drops every server when a file
/// has both; keep using whichever the file already has.
fn json_key<'a>(root: &Map<String, Value>, key: &'a str) -> &'a str {
    if key == "mcpServers" && !root.contains_key("mcpServers") && root.contains_key("mcp_servers") {
        "mcp_servers"
    } else {
        key
    }
}

fn read_json(file: &Path) -> Result<Map<String, Value>, String> {
    match std::fs::read_to_string(file) {
        Ok(s) if s.trim().is_empty() => Ok(Map::new()),
        Ok(s) => match serde_json::from_str::<Value>(&s) {
            Ok(Value::Object(m)) => Ok(m),
            _ => Err(format!("{} isn't plain JSON (comments?), so Glance left it alone. Add Glance there by hand.", file.display())),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(format!("{}: {e}", file.display())),
    }
}

fn has_entry(t: &Target) -> bool {
    match t.format {
        Format::Json { key, .. } => read_json(&t.file)
            .ok()
            .is_some_and(|root| root.get(json_key(&root, key)).and_then(|s| s.get(SERVER_NAME)).is_some()),
        Format::CodexToml => std::fs::read_to_string(&t.file).is_ok_and(|s| toml_block(&s).is_some()),
    }
}

pub fn status(d: &Dirs) -> Vec<AppStatus> {
    apps(d)
        .iter()
        .map(|app| {
            let found = installed(app);
            AppStatus {
                id: app.id,
                name: app.name,
                installed: !found.is_empty(),
                connected: found.iter().any(|t| has_entry(t)),
                files: found.iter().map(|t| t.file.to_string_lossy().into_owned()).collect(),
            }
        })
        .collect()
}

fn backup(file: &Path) {
    let copy = PathBuf::from(format!("{}.glance-backup", file.display()));
    if file.exists() && !copy.exists() {
        let _ = std::fs::copy(file, copy);
    }
}

fn write(file: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    backup(file);
    crate::commands::write_atomic(file, text.as_bytes())
}

/// Two-space JSON with a final newline, like the apps write themselves.
fn to_text(root: Map<String, Value>) -> String {
    serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default() + "\n"
}

/// Byte range of `[mcp_servers.glance]` and its sub-tables, up to the next other table.
fn toml_block(s: &str) -> Option<(usize, usize)> {
    let header = format!("[mcp_servers.{SERVER_NAME}");
    let mut start = None;
    let mut pos = 0;
    for line in s.split_inclusive('\n') {
        let t = line.trim();
        let ours = t.starts_with(&header) && matches!(t[header.len()..].chars().next(), Some(']') | Some('.'));
        match start {
            None if ours => start = Some(pos),
            Some(st) if t.starts_with('[') && !ours => return Some((st, pos)),
            _ => {}
        }
        pos += line.len();
    }
    start.map(|st| (st, s.len()))
}

fn toml_string(s: &str) -> String {
    let mut out = String::from('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c if c.is_control() => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn connect_target(t: &Target, b: &Bridge) -> Result<(), String> {
    match t.format {
        Format::Json { key, typed } => {
            let mut root = read_json(&t.file)?;
            let key = json_key(&root, key).to_string();
            let mut entry = Map::new();
            if typed {
                entry.insert("type".into(), json!("stdio"));
            }
            entry.insert("command".into(), json!(b.command));
            entry.insert("args".into(), json!(b.args));
            let servers = root.entry(key).or_insert_with(|| Value::Object(Map::new()));
            let Value::Object(servers) = servers else {
                return Err(format!("{}: unexpected MCP settings, left alone", t.file.display()));
            };
            servers.insert(SERVER_NAME.into(), Value::Object(entry));
            write(&t.file, &to_text(root))
        }
        Format::CodexToml => {
            let old = std::fs::read_to_string(&t.file).unwrap_or_default();
            let args = b.args.iter().map(|a| toml_string(a)).collect::<Vec<_>>().join(", ");
            let block = format!("[mcp_servers.{SERVER_NAME}]\ncommand = {}\nargs = [{args}]\n", toml_string(&b.command));
            let new = match toml_block(&old) {
                Some((a, b)) => format!("{}{block}{}{}", &old[..a], if b < old.len() { "\n" } else { "" }, &old[b..]),
                None if old.is_empty() => block,
                None => format!("{}{}\n{block}", old, if old.ends_with('\n') { "" } else { "\n" }),
            };
            write(&t.file, &new)
        }
    }
}

fn disconnect_target(t: &Target) -> Result<(), String> {
    if !has_entry(t) {
        return Ok(());
    }
    match t.format {
        Format::Json { key, .. } => {
            let mut root = read_json(&t.file)?;
            let key = json_key(&root, key).to_string();
            if let Some(Value::Object(servers)) = root.get_mut(&key) {
                servers.remove(SERVER_NAME);
            }
            write(&t.file, &to_text(root))
        }
        Format::CodexToml => {
            let old = std::fs::read_to_string(&t.file).map_err(|e| e.to_string())?;
            let Some((a, b)) = toml_block(&old) else { return Ok(()) };
            let mut new = format!("{}{}", &old[..a], &old[b..]);
            while new.ends_with("\n\n") {
                new.pop();
            }
            write(&t.file, &new)
        }
    }
}

pub fn connect(d: &Dirs, id: &str, b: &Bridge) -> Result<(), String> {
    let all = apps(d);
    let app = all.iter().find(|a| a.id == id).ok_or("unknown app")?;
    let found = installed(app);
    if found.is_empty() {
        return Err(format!("{} isn't installed for this user", app.name));
    }
    for t in found {
        connect_target(t, b)?;
    }
    Ok(())
}

pub fn disconnect(d: &Dirs, id: &str) -> Result<(), String> {
    let all = apps(d);
    let app = all.iter().find(|a| a.id == id).ok_or("unknown app")?;
    for t in installed(app) {
        disconnect_target(t)?;
    }
    Ok(())
}

/// What AI apps run to reach Glance.
pub struct Bridge {
    pub command: String,
    pub args: Vec<String>,
}

/// The command AI apps run: glance-mcp next to Glance, or, for the Store build (whose
/// folder is versioned and changes with every update), its app execution alias.
pub fn bridge_command(store_package: bool, d: Option<&Dirs>) -> Result<Bridge, String> {
    // A Flatpak's files aren't on the host's paths: AI apps start glance-mcp through flatpak run.
    if let Some(id) = crate::flatpak_id() {
        return Ok(Bridge { command: "flatpak".into(), args: vec!["run".into(), "--command=glance-mcp".into(), id] });
    }
    let name = if cfg!(windows) { "glance-mcp.exe" } else { "glance-mcp" };
    if store_package {
        if let Some(d) = d {
            return Ok(Bridge { command: d.local_appdata.join("Microsoft").join("WindowsApps").join(name).to_string_lossy().into_owned(), args: vec![] });
        }
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("no app folder")?;
    let bridge = dir.join(name);
    if bridge.is_file() {
        Ok(Bridge { command: bridge.to_string_lossy().into_owned(), args: vec![] })
    } else {
        Err(format!("{} is missing; reinstall Glance", bridge.display()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    apps: Vec<AppStatus>,
    /// Empty when glance-mcp is missing (development builds).
    command: String,
    args: Vec<String>,
    problem: Option<String>,
}

fn bridge(d: Option<&Dirs>) -> Result<Bridge, String> {
    bridge_command(crate::store_package_now(), d)
}

#[tauri::command]
pub fn ai_apps() -> Overview {
    let d = Dirs::current();
    let (command, args, problem) = match bridge(d.as_ref()) {
        Ok(b) => (b.command, b.args, None),
        Err(e) => (String::new(), Vec::new(), Some(e)),
    };
    Overview { apps: d.as_ref().map(status).unwrap_or_default(), command, args, problem }
}

#[tauri::command]
pub fn ai_app_connect(id: String) -> Result<(), String> {
    let d = Dirs::current().ok_or("no home folder")?;
    connect(&d, &id, &bridge(Some(&d))?)
}

#[tauri::command]
pub fn ai_app_disconnect(id: String) -> Result<(), String> {
    disconnect(&Dirs::current().ok_or("no home folder")?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(c: &str) -> Bridge { Bridge { command: c.into(), args: vec![] } }

    fn scratch(name: &str) -> Dirs {
        let root = std::env::temp_dir().join(format!("glance-aiapps-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let d = Dirs { home: root.join("home"), appdata: root.join("roaming"), local_appdata: root.join("local") };
        std::fs::create_dir_all(&d.home).unwrap();
        d
    }

    fn by_id<'a>(s: &'a [AppStatus], id: &str) -> &'a AppStatus {
        s.iter().find(|a| a.id == id).unwrap()
    }

    #[test]
    fn only_installed_apps_can_connect() {
        let d = scratch("installed");
        assert!(!by_id(&status(&d), "cursor").installed);
        assert!(connect(&d, "cursor", &plain("C:\\g\\glance-mcp.exe")).is_err());
        std::fs::create_dir_all(d.home.join(".cursor")).unwrap();
        assert!(by_id(&status(&d), "cursor").installed);
        connect(&d, "cursor", &plain("C:\\g\\glance-mcp.exe")).unwrap();
        let text = std::fs::read_to_string(d.home.join(".cursor/mcp.json")).unwrap();
        assert_eq!(text, "{\n  \"mcpServers\": {\n    \"glance\": {\n      \"command\": \"C:\\\\g\\\\glance-mcp.exe\",\n      \"args\": []\n    }\n  }\n}\n");
        assert!(by_id(&status(&d), "cursor").connected);
    }

    #[test]
    fn keeps_everything_else_in_claude_json() {
        let d = scratch("claude");
        std::fs::create_dir_all(d.home.join(".claude")).unwrap();
        let original = "{\"zeta\":1,\"numStartups\":5,\"mcpServers\":{\"other\":{\"command\":\"x\"}},\"alpha\":[1,2]}";
        std::fs::write(d.home.join(".claude.json"), original).unwrap();
        connect(&d, "claude-code", &plain("/opt/glance-mcp")).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.home.join(".claude.json")).unwrap()).unwrap();
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["zeta", "numStartups", "mcpServers", "alpha"]);
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        assert_eq!(v["mcpServers"]["glance"], json!({ "type": "stdio", "command": "/opt/glance-mcp", "args": [] }));
        assert_eq!(std::fs::read_to_string(d.home.join(".claude.json.glance-backup")).unwrap(), original);

        disconnect(&d, "claude-code").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.home.join(".claude.json")).unwrap()).unwrap();
        assert!(v["mcpServers"].get("glance").is_none());
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        assert!(!by_id(&status(&d), "claude-code").connected);
    }

    #[test]
    fn leaves_files_it_cant_parse_alone() {
        let d = scratch("jsonc");
        std::fs::create_dir_all(d.appdata.join("Code/User")).unwrap();
        let jsonc = "{\n  // my servers\n  \"servers\": {}\n}\n";
        std::fs::write(d.appdata.join("Code/User/mcp.json"), jsonc).unwrap();
        assert!(connect(&d, "vscode", &plain("glance-mcp")).is_err());
        assert_eq!(std::fs::read_to_string(d.appdata.join("Code/User/mcp.json")).unwrap(), jsonc);
    }

    #[test]
    fn vscode_uses_servers_with_a_type() {
        let d = scratch("vscode");
        std::fs::create_dir_all(d.appdata.join("Code/User")).unwrap();
        connect(&d, "vscode", &plain("glance-mcp")).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.appdata.join("Code/User/mcp.json")).unwrap()).unwrap();
        assert_eq!(v["servers"]["glance"]["type"], "stdio");
    }

    #[test]
    fn muse_keeps_its_legacy_key() {
        let d = scratch("muse");
        std::fs::create_dir_all(d.home.join(".config/muse")).unwrap();
        std::fs::write(d.home.join(".config/muse/settings.json"), "{\"mcp_servers\":{}}").unwrap();
        connect(&d, "muse-code", &plain("glance-mcp")).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.home.join(".config/muse/settings.json")).unwrap()).unwrap();
        assert!(v.get("mcpServers").is_none());
        assert_eq!(v["mcp_servers"]["glance"]["command"], "glance-mcp");
    }

    #[test]
    fn claude_desktop_from_the_store_uses_the_package_folder() {
        let d = scratch("desktop");
        let pkg = d.local_appdata.join("Packages/Claude_pzs8sxrjxfjjc");
        std::fs::create_dir_all(&pkg).unwrap();
        let s = status(&d);
        assert!(by_id(&s, "claude-desktop").installed);
        connect(&d, "claude-desktop", &plain("glance-mcp")).unwrap();
        assert!(pkg.join("LocalCache/Roaming/Claude/claude_desktop_config.json").is_file());
        assert!(!d.appdata.join("Claude/claude_desktop_config.json").exists());
    }

    #[test]
    fn codex_toml_block_is_added_replaced_and_removed() {
        let d = scratch("codex");
        std::fs::create_dir_all(d.home.join(".codex")).unwrap();
        let file = d.home.join(".codex/config.toml");
        let original = "model = \"gpt-5\"\n\n[mcp_servers.other]\ncommand = \"x\"\n";
        std::fs::write(&file, original).unwrap();
        connect(&d, "codex", &plain("C:\\Program Files\\Glance\\glance-mcp.exe")).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        assert_eq!(
            text,
            "model = \"gpt-5\"\n\n[mcp_servers.other]\ncommand = \"x\"\n\n[mcp_servers.glance]\ncommand = \"C:\\\\Program Files\\\\Glance\\\\glance-mcp.exe\"\nargs = []\n"
        );
        // Reconnecting replaces the block (and its sub-tables) instead of adding another.
        std::fs::write(&file, format!("{text}\n[mcp_servers.glance.env]\nA = \"1\"\n\n[profile]\nx = 1\n")).unwrap();
        connect(&d, "codex", &plain("glance-mcp")).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        assert_eq!(text.matches("[mcp_servers.glance").count(), 1);
        assert!(text.contains("command = \"glance-mcp\"") && text.contains("[profile]\nx = 1"));
        assert!(by_id(&status(&d), "codex").connected);
        disconnect(&d, "codex").unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(!text.contains("glance"));
        assert!(text.starts_with(original.trim_end()) && text.contains("[profile]"));
    }

    #[test]
    fn args_are_written_for_json_and_toml() {
        let d = scratch("args");
        std::fs::create_dir_all(d.home.join(".cursor")).unwrap();
        std::fs::create_dir_all(d.home.join(".codex")).unwrap();
        let b = Bridge { command: "flatpak".into(), args: vec!["run".into(), "--command=glance-mcp".into(), "io.github.redtrocks.glance".into()] };
        connect(&d, "cursor", &b).unwrap();
        connect(&d, "codex", &b).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.home.join(".cursor/mcp.json")).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["glance"]["args"], json!(["run", "--command=glance-mcp", "io.github.redtrocks.glance"]));
        let text = std::fs::read_to_string(d.home.join(".codex/config.toml")).unwrap();
        assert!(text.contains("args = [\"run\", \"--command=glance-mcp\", \"io.github.redtrocks.glance\"]"));
    }

    #[test]
    fn toml_strings_are_escaped() {
        assert_eq!(toml_string(r#"C:\a "b""#), r#""C:\\a \"b\"""#);
    }
}
