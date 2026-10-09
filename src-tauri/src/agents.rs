//! Runs the AI companies' own agents (Claude, ChatGPT, Gemini, …) for the Ask AI sidebar.
//!
//! Each agent is a program that speaks the Agent Client Protocol (newline-delimited JSON-RPC)
//! on stdin/stdout and signs in with the user's own account. The webview drives the protocol
//! (src/state/ai); this side only starts, feeds and stops the programs. The webview names an
//! agent by id and never passes a command line, so it can't run arbitrary programs: built-in
//! agents are fixed here and the user confirms a custom agent's command in a native dialog
//! before it is saved.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

mod secrets;

/// One way to start an agent: a program and its arguments.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Launch {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    /// Tried in order; the first whose program is installed is used.
    pub launch: Vec<Launch>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// The company's own chat website, offered as the sidebar's other view.
    #[serde(default)]
    pub website: Option<String>,
    /// Where to get the program when none of `launch` is installed.
    #[serde(default)]
    pub install: Option<String>,
    #[serde(default)]
    pub custom: bool,
    /// Set for agents that use an API key instead of signing in; the key itself is in
    /// Windows Credential Manager.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<ApiKey>,
}

/// Which kind of API the key is for, and where it is.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiKey {
    /// "anthropic" (Anthropic-compatible: Anthropic, Z.ai, Kimi, DeepSeek…) or "openai"
    /// (OpenAI-compatible: OpenAI, OpenRouter, Mistral, local servers…).
    pub kind: String,
    /// Empty for the company's own default address.
    #[serde(default)]
    pub base_url: String,
}

/// The settings that make Claude's or Codex's agent use `api` with `secret`.
pub fn key_env(api: &ApiKey, secret: &str) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    let url = api.base_url.trim();
    if api.kind == "anthropic" {
        if !url.is_empty() {
            env.insert("ANTHROPIC_BASE_URL".into(), url.into());
        }
        env.insert("ANTHROPIC_AUTH_TOKEN".into(), secret.into());
        env.insert("ANTHROPIC_API_KEY".into(), secret.into());
    } else {
        env.insert("CODEX_API_KEY".into(), secret.into());
        env.insert("DEFAULT_AUTH_REQUEST".into(), r#"{"methodId":"api-key"}"#.into());
        // Hides the ChatGPT sign-in: this agent is the key's.
        env.insert("NO_BROWSER".into(), "1".into());
        if !url.is_empty() {
            let config = serde_json::json!({
                "model_provider": "glance",
                "model_providers": { "glance": { "name": "Custom", "base_url": url, "env_key": "CODEX_API_KEY" } }
            });
            env.insert("CODEX_CONFIG".into(), config.to_string());
            env.insert("MODEL_PROVIDER".into(), "glance".into());
        }
    }
    env
}

fn launch(program: &str, args: &[&str]) -> Launch {
    Launch { program: program.into(), args: args.iter().map(|a| a.to_string()).collect() }
}

fn npx(package: &str, args: &[&str]) -> Launch {
    let mut all = vec!["-y", package];
    all.extend_from_slice(args);
    launch("npx", &all)
}

const NODE: &str = "https://nodejs.org/en/download";
const UV: &str = "https://docs.astral.sh/uv/getting-started/installation/";

fn builtin(id: &str, name: &str, launch: Vec<Launch>, website: &str, install: &str) -> Agent {
    Agent {
        id: id.into(),
        name: name.into(),
        launch,
        env: BTreeMap::new(),
        website: Some(website.into()),
        install: Some(install.into()),
        custom: false,
        api: None,
    }
}

/// The companies Glance knows out of the box. Ids are stable: chats are saved under them.
pub fn builtins() -> Vec<Agent> {
    vec![
        builtin("claude", "Claude", vec![launch("claude-agent-acp", &[]), npx("@agentclientprotocol/claude-agent-acp", &[])], "https://claude.ai", NODE),
        builtin("chatgpt", "ChatGPT", vec![launch("codex-acp", &[]), npx("@agentclientprotocol/codex-acp", &[])], "https://chatgpt.com", NODE),
        // Runs Google's Antigravity agent, which Glance downloads (see `antigravity`); Gemini CLI
        // is the fallback, and only signs in with a Google Cloud account or a paid API key.
        builtin("gemini", "Gemini", vec![launch("gemini", &["--acp"]), npx("@google/gemini-cli", &["--acp"])], "https://gemini.google.com", antigravity::DOCS),
        builtin("copilot", "GitHub Copilot", vec![launch("copilot", &["--acp"]), npx("@github/copilot", &["--acp"])], "https://github.com/copilot", NODE),
        builtin("qwen", "Qwen", vec![launch("qwen", &["--acp"]), npx("@qwen-code/qwen-code", &["--acp"])], "https://chat.qwen.ai", NODE),
        builtin("kimi", "Kimi", vec![launch("kimi", &["acp"]), launch("uvx", &["--from", "kimi-cli", "kimi", "acp"])], "https://www.kimi.com", UV),
        builtin("mistral", "Mistral", vec![launch("vibe-acp", &[]), launch("uvx", &["--from", "mistral-vibe", "vibe-acp"])], "https://chat.mistral.ai", UV),
        // OpenCode signs in to many more companies (Z.ai, DeepSeek, xAI, …) and has free models.
        builtin("opencode", "OpenCode", vec![launch("opencode", &["acp"]), npx("opencode-ai", &["acp"])], "https://opencode.ai", NODE),
    ]
}

// ---------------------------------------------------------------------------
// Custom agents, saved in the app's config folder.

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("agents.json"))
}

fn load_custom(path: &Path) -> Vec<Agent> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<Agent>>(&b).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|a| Agent { custom: true, ..a })
        .collect()
}

fn save_custom(path: &Path, agents: &[Agent]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(agents).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn all_agents(app: &AppHandle) -> Vec<Agent> {
    let mut list = builtins();
    if let Ok(p) = store_path(app) {
        list.extend(load_custom(&p));
    }
    list
}

fn find(app: &AppHandle, id: &str) -> Result<Agent, String> {
    all_agents(app).into_iter().find(|a| a.id == id).ok_or_else(|| format!("unknown agent {id}"))
}

/// Splits a command line the way a user types it: spaces separate words, double quotes group.
pub fn split_command(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut any = false;
    for ch in line.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any {
                    words.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            c => {
                cur.push(c);
                any = true;
            }
        }
    }
    if any {
        words.push(cur);
    }
    words
}

fn slug(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let s = s.trim_matches('-').to_string();
    format!("custom-{}", if s.is_empty() { "agent" } else { &s })
}

// ---------------------------------------------------------------------------
// Finding programs

fn resolve(l: &Launch) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    if crate::flatpak_id().is_some() {
        return host::which(&l.program);
    }
    which::which(&l.program).ok()
}

/// The launch to use, with its program's full path; `None` when nothing is installed.
fn pick(agent: &Agent) -> Option<(PathBuf, Launch)> {
    agent.launch.iter().find_map(|l| resolve(l).map(|p| (p, l.clone())))
}

#[cfg(target_os = "linux")]
mod host {
    //! In Flatpak, agents are the user's own programs outside the sandbox. They start
    //! through `flatpak-spawn --host` (finish-arg --talk-name=org.freedesktop.Flatpak) in a
    //! login shell, so they get the PATH the user's terminal has.
    // ponytail: `sh -l` reads ~/.profile only; a PATH set only in ~/.bashrc isn't seen.
    // Users then add the agent as a custom agent with its full path.
    // ponytail: stop() can only signal flatpak-spawn, which passes SIGTERM on and, when it dies,
    // has the host agent sent SIGINT (--watch-bus); an agent ignoring both outlives Glance.
    use std::collections::BTreeMap;
    use std::io::{Seek, Write};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const RUN: [&str; 3] = ["sh", "-lc", r#"exec "$0" "$@""#];

    pub fn which(program: &str) -> Option<PathBuf> {
        let out = Command::new("flatpak-spawn").args(["--host", "sh", "-lc", r#"command -v "$0""#, program]).output().ok()?;
        let found = String::from_utf8(out.stdout).ok()?;
        let found = found.trim();
        (out.status.success() && found.starts_with('/')).then(|| PathBuf::from(found))
    }

    /// The agent's environment (API keys) goes through a file descriptor (--env-fd), never
    /// through a command line other users can read. A memfd, not a pipe: flatpak-spawn reads it
    /// only once started, and a pipe would block this write past 64 KiB.
    pub fn command(program: &Path, args: &[String], env: &BTreeMap<String, String>, cwd: &Path) -> std::io::Result<(Command, OwnedFd)> {
        let raw = unsafe { libc::memfd_create(c"glance-agent-env".as_ptr(), libc::MFD_CLOEXEC) };
        if raw < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let mut file = unsafe { std::fs::File::from_raw_fd(raw) };
        for (k, v) in env {
            file.write_all(format!("{k}={v}\0").as_bytes())?;
        }
        file.rewind()?;
        let read = OwnedFd::from(file);
        let fd = read.as_raw_fd();
        let mut cmd = Command::new("flatpak-spawn");
        cmd.args(["--host", "--watch-bus", "--env-fd=3"]).arg(format!("--directory={}", cwd.display())).args(RUN).arg(program).args(args);
        unsafe {
            cmd.pre_exec(move || {
                // dup2 onto the same fd keeps FD_CLOEXEC, so clear the flag instead.
                let r = if fd == 3 { libc::fcntl(3, libc::F_SETFD, 0) } else { libc::dup2(fd, 3) };
                if r < 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
            });
        }
        Ok((cmd, read))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    #[serde(flatten)]
    agent: Agent,
    /// Whether one of its programs is installed (for npx: Node.js).
    ready: bool,
    /// The command Glance runs, shown to the user.
    command: String,
}

fn shown(l: &Launch) -> String {
    std::iter::once(l.program.as_str())
        .chain(l.args.iter().map(String::as_str))
        .map(|w| if w.contains(' ') { format!("\"{w}\"") } else { w.to_string() })
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub fn agents_list(app: AppHandle) -> Vec<AgentInfo> {
    all_agents(&app)
        .into_iter()
        .map(|agent| {
            if agent.id == antigravity::AGENT && antigravity::available() {
                let command = antigravity::installed(&app).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| antigravity::ARCHIVE_NAME.into());
                return AgentInfo { ready: true, command, agent };
            }
            let picked = pick(&agent);
            let command = picked.as_ref().map(|(_, l)| l).or(agent.launch.last()).map(shown).unwrap_or_default();
            AgentInfo { ready: picked.is_some(), command, agent }
        })
        .collect()
}

/// Adds an agent the user typed in, after they confirm its exact command in a native dialog
/// (the webview can't skip it). `title` and `question` are the dialog's translated text.
#[tauri::command]
pub async fn agent_add(app: AppHandle, name: String, command: String, title: String, question: String, confirm: String, cancel: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let name = name.trim().to_string();
    let words = split_command(&command);
    let Some((program, args)) = words.split_first() else { return Err("type the command that starts the agent".into()) };
    if name.is_empty() {
        return Err("give the agent a name".into());
    }
    let launch = Launch { program: program.clone(), args: args.to_vec() };
    let body = format!("{question}\n\n{name}\n{}", shown(&launch));
    let dialog = app.dialog().message(body).title(title).kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::OkCancelCustom(confirm, cancel));
    let ok = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show()).await.map_err(|e| e.to_string())?;
    if !ok {
        return Ok(None);
    }
    let path = store_path(&app)?;
    let mut custom = load_custom(&path);
    let id = unique_id(&app, &name);
    custom.push(Agent { id: id.clone(), name, launch: vec![launch], env: BTreeMap::new(), website: None, install: None, custom: true, api: None });
    save_custom(&path, &custom)?;
    Ok(Some(id))
}

fn unique_id(app: &AppHandle, name: &str) -> String {
    let taken: Vec<String> = all_agents(app).into_iter().map(|a| a.id).collect();
    let base = slug(name);
    let mut id = base.clone();
    let mut n = 2;
    while taken.contains(&id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

/// Adds an AI that uses an API key: Claude's agent for Anthropic-compatible APIs, Codex's for
/// OpenAI-compatible ones, pointed at `base_url`. Runs no command the user typed, so it needs
/// no confirmation. The key goes to Windows Credential Manager.
#[tauri::command]
pub fn agent_add_key(app: AppHandle, name: String, kind: String, base_url: String, key: String) -> Result<String, String> {
    let name = name.trim().to_string();
    let key = key.trim().to_string();
    if name.is_empty() {
        return Err("give it a name".into());
    }
    if key.is_empty() {
        return Err("paste the API key".into());
    }
    let base_url = base_url.trim().to_string();
    if !base_url.is_empty() && !(base_url.starts_with("https://") || base_url.starts_with("http://localhost") || base_url.starts_with("http://127.0.0.1")) {
        return Err("the address must start with https:// (or http://localhost for a server on this PC)".into());
    }
    let template = match kind.as_str() {
        "anthropic" => "claude",
        "openai" => "chatgpt",
        _ => return Err(format!("unknown API kind {kind}")),
    };
    let base = builtins().into_iter().find(|a| a.id == template).ok_or("missing built-in agent")?;
    let path = store_path(&app)?;
    let mut custom = load_custom(&path);
    let id = unique_id(&app, &name);
    secrets::save(&id, &key)?;
    custom.push(Agent { id: id.clone(), name, launch: base.launch, env: BTreeMap::new(), website: None, install: base.install, custom: true, api: Some(ApiKey { kind, base_url }) });
    save_custom(&path, &custom)?;
    Ok(id)
}

#[tauri::command]
pub fn agent_remove(app: AppHandle, id: String) -> Result<(), String> {
    secrets::delete(&id);
    let path = store_path(&app)?;
    let custom: Vec<Agent> = load_custom(&path).into_iter().filter(|a| a.id != id).collect();
    save_custom(&path, &custom)
}

// ---------------------------------------------------------------------------
// Running agents

struct Run {
    child: Child,
    stdin: ChildStdin,
    #[cfg(windows)]
    job: job::Job,
}

#[derive(Default)]
pub struct Agents {
    runs: Mutex<HashMap<u32, Run>>,
    next: AtomicU32,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Event {
    /// One line of protocol output.
    Out { run: u32, line: String },
    /// Diagnostics on stderr, kept for "Show details".
    Log { run: u32, line: String },
    Exit { run: u32, code: Option<i32> },
}

/// Where agents run and keep their scratch files.
fn work_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("ai");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn command(program: &Path, args: &[String], agent: &Agent, cwd: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args).envs(&agent.env).current_dir(cwd);
    cmd
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    run: u32,
    /// The working folder to give the agent's sessions when no document folder applies.
    cwd: String,
}

/// The program and arguments that start `agent`, downloading Antigravity the first time.
async fn program_for(app: &AppHandle, agent: &Agent) -> Result<(PathBuf, Launch), String> {
    if agent.id == antigravity::AGENT && antigravity::available() {
        let a = app.clone();
        let fetched = tauri::async_runtime::spawn_blocking(move || antigravity::ensure(&a)).await.map_err(|e| e.to_string())?;
        match fetched {
            Ok(l) => return Ok((PathBuf::from(&l.program), l)),
            // Offline or blocked: fall back to Gemini CLI if it's installed.
            Err(e) => return pick(agent).ok_or_else(|| format!("couldn’t download Google Antigravity: {e}")),
        }
    }
    pick(agent).ok_or_else(|| format!("not-installed:{}", agent.install.clone().unwrap_or_default()))
}

#[tauri::command]
pub async fn agent_start(app: AppHandle, state: State<'_, Agents>, id: String) -> Result<Started, String> {
    let agent = find(&app, &id)?;
    let (program, l) = program_for(&app, &agent).await?;
    let cwd = work_dir(&app)?;
    let mut agent = agent;
    if let Some(api) = &agent.api {
        let secret = secrets::load(&agent.id).ok_or_else(|| format!("the API key for {} is missing; remove it and add it again", agent.name))?;
        agent.env.extend(key_env(api, &secret));
    }
    #[cfg(target_os = "linux")]
    let (mut cmd, _env_pipe) = if crate::flatpak_id().is_some() {
        let (c, fd) = host::command(&program, &l.args, &agent.env, &cwd).map_err(|e| format!("couldn’t start {}: {e}", agent.name))?;
        (c, Some(fd))
    } else {
        (command(&program, &l.args, &agent, &cwd), None)
    };
    #[cfg(not(target_os = "linux"))]
    let mut cmd = command(&program, &l.args, &agent, &cwd);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // npx launches children; one group lets stop() terminate the whole agent.
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("couldn’t start {}: {e}", agent.name))?;
    #[cfg(windows)]
    let job = job::Job::new_for(&child)?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let run = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    pump(app.clone(), stdout, run, false);
    pump(app.clone(), stderr, run, true);
    state.runs.lock().unwrap().insert(
        run,
        Run {
            child,
            stdin,
            #[cfg(windows)]
            job,
        },
    );
    Ok(Started { run, cwd: cwd.to_string_lossy().into_owned() })
}

fn pump(app: AppHandle, out: impl Read + Send + 'static, run: u32, log: bool) {
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            let event = if log { Event::Log { run, line } } else { Event::Out { run, line } };
            let _ = app.emit_to("main", "agent", event);
        }
        if log {
            return;
        }
        // Output closed: the program has ended (or is about to).
        let state = app.state::<Agents>();
        let code = state.runs.lock().unwrap().remove(&run).and_then(|mut r| r.child.wait().ok()).and_then(|s| s.code());
        let _ = app.emit_to("main", "agent", Event::Exit { run, code });
    });
}

#[tauri::command]
pub fn agent_send(state: State<'_, Agents>, run: u32, data: String) -> Result<(), String> {
    let mut runs = state.runs.lock().unwrap();
    let r = runs.get_mut(&run).ok_or("the agent has stopped")?;
    r.stdin.write_all(data.as_bytes()).and_then(|_| r.stdin.flush()).map_err(|e| e.to_string())
}

fn stop(mut r: Run) {
    #[cfg(windows)]
    r.job.terminate();
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(r.child.id() as libc::pid_t), libc::SIGTERM);
    }
    let _ = r.child.kill();
    let _ = r.child.wait();
}

#[tauri::command]
pub fn agent_stop(state: State<'_, Agents>, run: u32) {
    let r = state.runs.lock().unwrap().remove(&run);
    if let Some(r) = r {
        std::thread::spawn(move || stop(r));
    }
}

/// Stops every agent; called when Glance closes.
pub fn stop_all(app: &AppHandle) {
    let runs: Vec<Run> = app.state::<Agents>().runs.lock().unwrap().drain().map(|(_, r)| r).collect();
    runs.into_iter().for_each(stop);
}

/// Signs in the way the agent asked: runs its command with `args` in a console window the
/// user types into. Glance waits for the window to close.
#[tauri::command]
pub async fn agent_login(app: AppHandle, id: String, args: Vec<String>, env: BTreeMap<String, String>) -> Result<(), String> {
    let mut agent = find(&app, &id)?;
    let (program, l) = program_for(&app, &agent).await?;
    agent.env.extend(env);
    let cwd = work_dir(&app)?;
    let mut all = l.args.clone();
    all.extend(args);
    let mut cmd = command(&program, &all, &agent, &cwd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    #[cfg(not(windows))]
    {
        let _ = &mut cmd;
        return Err("signing in from Glance works on Windows".into());
    }
    #[allow(unreachable_code)]
    tauri::async_runtime::spawn_blocking(move || cmd.status().map(|_| ()).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

mod antigravity {
    //! Google's Antigravity agent. Google stopped Gemini CLI's personal Google sign-in in June
    //! 2026; Antigravity's Agent Client Protocol server replaces it. Google ships it as a zip
    //! per platform rather than an npm package (the ACP registry's "antigravity-acp" entry),
    //! so Glance downloads it once into its local app data, as Zed does.
    use super::Launch;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use tauri::{AppHandle, Manager};

    pub const AGENT: &str = "gemini";
    pub const DOCS: &str = "https://antigravity.google/docs/ide/extensions";
    const VERSION: &str = "1.3.0";
    const BASE: &str = "https://dl.google.com/agy-extensions/releases";

    #[cfg(windows)]
    pub const ARCHIVE_NAME: &str = "agy_acp_server.exe";
    #[cfg(not(windows))]
    pub const ARCHIVE_NAME: &str = "agy_acp_server.par";

    /// The archive for this PC, and the arguments the server takes here.
    fn archive() -> Option<(String, &'static [&'static str])> {
        let (dir, platform, args): (&str, &str, &'static [&'static str]) = match (std::env::consts::OS, std::env::consts::ARCH) {
            ("windows", "x86_64") => ("windows", "windows-x86_64", &[]),
            ("windows", "aarch64") => ("windows", "windows-arm64", &[]),
            ("macos", "x86_64") => ("macos", "darwin-x86_64", &[]),
            ("macos", "aarch64") => ("macos", "darwin-arm64", &[]),
            ("linux", "x86_64") => ("linux", "linux-x86_64", &["--uid="]),
            ("linux", "aarch64") => ("linux", "linux-arm64", &["--uid="]),
            _ => return None,
        };
        Some((format!("{BASE}/{dir}/agy-acp-server-{VERSION}-{platform}.zip"), args))
    }

    pub fn available() -> bool {
        archive().is_some()
    }

    fn dir(app: &AppHandle) -> Option<PathBuf> {
        Some(app.path().app_local_data_dir().ok()?.join("agents").join(format!("antigravity-{VERSION}")))
    }

    pub fn installed(app: &AppHandle) -> Option<PathBuf> {
        dir(app).map(|d| d.join(ARCHIVE_NAME)).filter(|p| p.is_file())
    }

    /// The server's launch, downloading it first if it isn't here yet.
    pub fn ensure(app: &AppHandle) -> Result<Launch, String> {
        let (url, args) = archive().ok_or("Google Antigravity isn’t available for this PC")?;
        let program = match installed(app) {
            Some(p) => p,
            None => fetch(&url, &dir(app).ok_or("no app data folder")?)?,
        };
        Ok(Launch { program: program.to_string_lossy().into_owned(), args: args.iter().map(|a| a.to_string()).collect() })
    }

    fn fetch(url: &str, dest: &Path) -> Result<PathBuf, String> {
        let parent = dest.parent().ok_or("bad folder")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let zip_path = parent.join(format!("antigravity-{VERSION}.zip"));
        let tmp = parent.join(format!("antigravity-{VERSION}.partial"));
        let _ = std::fs::remove_dir_all(&tmp);
        download(url, &zip_path)?;
        let unpacked = (|| -> Result<(), String> {
            let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            zip.extract(&tmp).map_err(|e| e.to_string())
        })();
        let _ = std::fs::remove_file(&zip_path);
        unpacked?;
        // Some archives wrap everything in one folder.
        let root = if tmp.join(ARCHIVE_NAME).is_file() {
            tmp.clone()
        } else {
            std::fs::read_dir(&tmp)
                .map_err(|e| e.to_string())?
                .flatten()
                .map(|e| e.path())
                .find(|p| p.join(ARCHIVE_NAME).is_file())
                .ok_or_else(|| format!("{ARCHIVE_NAME} isn’t in the download"))?
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(root.join(ARCHIVE_NAME), std::fs::Permissions::from_mode(0o755));
        }
        let _ = std::fs::remove_dir_all(dest);
        std::fs::rename(&root, dest).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(dest.join(ARCHIVE_NAME))
    }

    /// Downloads with the curl that ships with Windows 10 and later (and every Mac and Linux).
    fn download(url: &str, to: &Path) -> Result<(), String> {
        #[cfg(windows)]
        let curl = std::env::var_os("SystemRoot").map(|r| PathBuf::from(r).join("System32").join("curl.exe")).filter(|p| p.is_file()).unwrap_or_else(|| "curl.exe".into());
        #[cfg(not(windows))]
        let curl = PathBuf::from("curl");
        let mut cmd = Command::new(curl);
        cmd.args(["-fsSL", "--retry", "2", "-o"]).arg(to).arg(url);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let out = cmd.output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            let _ = std::fs::remove_file(to);
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }
}

#[cfg(windows)]
mod job {
    //! A job object per agent: stopping it ends npx and every process it started, and Windows
    //! ends them all if Glance itself goes away.
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::*;

    pub struct Job(HANDLE);
    // A job handle can be used from any thread.
    unsafe impl Send for Job {}

    impl Job {
        pub fn new_for(child: &std::process::Child) -> Result<Job, String> {
            use std::os::windows::io::AsRawHandle;
            unsafe {
                let h = CreateJobObjectW(None, None).map_err(|e| e.to_string())?;
                let job = Job(h);
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of_val(&info) as u32).map_err(|e| e.to_string())?;
                AssignProcessToJobObject(h, HANDLE(child.as_raw_handle())).map_err(|e| e.to_string())?;
                Ok(job)
            }
        }

        pub fn terminate(&self) {
            unsafe {
                let _ = TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_commands_like_a_shell() {
        assert_eq!(split_command(r#"npx -y my-agent --acp"#), ["npx", "-y", "my-agent", "--acp"]);
        assert_eq!(split_command(r#""C:\Program Files\Agent\agent.exe"  acp ""#), [r"C:\Program Files\Agent\agent.exe", "acp", ""]);
        assert!(split_command("   ").is_empty());
    }

    #[test]
    fn builtin_ids_are_unique_and_stable() {
        let ids: Vec<String> = builtins().into_iter().map(|a| a.id).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len());
        for id in ["claude", "chatgpt", "gemini"] {
            assert!(ids.contains(&id.to_string()));
        }
    }

    #[test]
    fn custom_agents_round_trip() {
        let dir = std::env::temp_dir().join(format!("glance-agents-{}", std::process::id()));
        let path = dir.join("agents.json");
        let a = Agent { id: slug("My Agent!"), name: "My Agent!".into(), launch: vec![launch("my-agent", &["acp"])], env: BTreeMap::new(), website: None, install: None, custom: false, api: None };
        save_custom(&path, &[a]).unwrap();
        let back = load_custom(&path);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].id, "custom-my-agent");
        assert!(back[0].custom);
        assert_eq!(back[0].launch[0], launch("my-agent", &["acp"]));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn api_keys_become_agent_settings() {
        let z = key_env(&ApiKey { kind: "anthropic".into(), base_url: "https://api.z.ai/api/anthropic".into() }, "k1");
        assert_eq!(z["ANTHROPIC_BASE_URL"], "https://api.z.ai/api/anthropic");
        assert_eq!(z["ANTHROPIC_AUTH_TOKEN"], "k1");
        let openai = key_env(&ApiKey { kind: "openai".into(), base_url: String::new() }, "k2");
        assert_eq!(openai["CODEX_API_KEY"], "k2");
        assert!(!openai.contains_key("CODEX_CONFIG"));
        let router = key_env(&ApiKey { kind: "openai".into(), base_url: "https://openrouter.ai/api/v1".into() }, "k3");
        let config: serde_json::Value = serde_json::from_str(&router["CODEX_CONFIG"]).unwrap();
        assert_eq!(config["model_providers"]["glance"]["base_url"], "https://openrouter.ai/api/v1");
        assert_eq!(router["MODEL_PROVIDER"], "glance");
    }

    #[test]
    fn keys_are_stored_apart_from_the_agent_list() {
        let saved = secrets::save("custom-test-key", "secret");
        #[cfg(target_os = "linux")]
        if saved.is_err() {
            return; // CI may have no login keyring.
        }
        saved.unwrap();
        assert_eq!(secrets::load("custom-test-key").as_deref(), Some("secret"));
        secrets::delete("custom-test-key");
        assert_eq!(secrets::load("custom-test-key"), None);
        let a = Agent { id: "x".into(), name: "X".into(), launch: vec![], env: BTreeMap::new(), website: None, install: None, custom: true, api: Some(ApiKey { kind: "openai".into(), base_url: String::new() }) };
        assert!(!serde_json::to_string(&a).unwrap().contains("secret"));
    }

    #[test]
    fn missing_programs_are_reported() {
        let a = Agent { id: "x".into(), name: "X".into(), launch: vec![launch("glance-no-such-program-xyz", &[])], env: BTreeMap::new(), website: None, install: None, custom: true, api: None };
        assert!(pick(&a).is_none());
    }
}
