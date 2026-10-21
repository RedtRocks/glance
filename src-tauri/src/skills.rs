//! Skills (ADR 0019): the person's own skills in Glance's app data, and installing Glance's
//! skills where other agents look for them (Settings → AI apps).
//!
//! A skill is a folder with a SKILL.md and, optionally, more text files (examples). Glance
//! only reads them as text; the app parses and uses them (src/state/skills.ts).

use crate::mcp::apps::Dirs;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Larger files aren't skills; they would only fill the agent's context.
const MAX_FILE: u64 = 256 * 1024;
const MAX_FILES: usize = 24;
/// Glance's block in AGENTS.md sits between these lines.
const BEGIN: &str = "<!-- glance:begin (written by Glance, Settings > AI apps) -->";
const END: &str = "<!-- glance:end -->";
/// Skills Glance installs are named glance-<name>, so it never touches anyone else's.
const PREFIX: &str = "glance-";

#[derive(Serialize, Debug, PartialEq)]
pub struct UserSkill {
    folder: String,
    text: String,
    files: BTreeMap<String, String>,
}

#[derive(Deserialize, Debug)]
pub struct SkillToInstall {
    name: String,
    text: String,
    #[serde(default)]
    files: BTreeMap<String, String>,
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("skills");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn read_small(p: &Path) -> Option<String> {
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE {
        return None;
    }
    std::fs::read_to_string(p).ok()
}

/// Text files under `dir` other than SKILL.md, by path with forward slashes, two levels deep.
fn extra_files(dir: &Path, base: &Path, depth: usize, out: &mut BTreeMap<String, String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        if out.len() >= MAX_FILES {
            return;
        }
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if p.is_dir() {
            if depth < 2 {
                extra_files(&p, base, depth + 1, out);
            }
        } else if dir != base || name != "SKILL.md" {
            let lower = name.to_ascii_lowercase();
            if [".md", ".txt", ".json", ".csv"].iter().any(|x| lower.ends_with(x)) {
                if let (Some(text), Ok(rel)) = (read_small(&p), p.strip_prefix(base)) {
                    out.insert(rel.to_string_lossy().replace('\\', "/"), text);
                }
            }
        }
    }
}

/// Every folder in `root` with a SKILL.md, sorted by name.
pub fn read_user_skills(root: &Path) -> Vec<UserSkill> {
    let Ok(entries) = std::fs::read_dir(root) else { return vec![] };
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    dirs.into_iter()
        .filter_map(|d| {
            let text = read_small(&d.join("SKILL.md"))?;
            let mut files = BTreeMap::new();
            extra_files(&d, &d, 0, &mut files);
            Some(UserSkill { folder: d.file_name()?.to_string_lossy().to_string(), text, files })
        })
        .collect()
}

fn valid_name(name: &str) -> bool {
    name.starts_with(PREFIX) && name.len() <= 64 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_rel(rel: &str) -> bool {
    !rel.is_empty() && !rel.starts_with('/') && !rel.contains('\\') && !rel.contains(':') && rel.split('/').all(|p| !p.is_empty() && p != "." && p != "..")
}

fn claude_skills(d: &Dirs) -> PathBuf {
    d.home.join(".claude").join("skills")
}

fn agents_md(d: &Dirs) -> PathBuf {
    d.home.join(".codex").join("AGENTS.md")
}

/// `text` with Glance's block replaced by `note`, or removed when `note` is None.
fn with_block(text: &str, note: Option<&str>) -> String {
    let block = note.map(|n| format!("{BEGIN}\n{}\n{END}\n", n.trim_end()));
    let (before, after) = match (text.find(BEGIN), text.find(END)) {
        (Some(b), Some(e)) if e > b => (&text[..b], text[e + END.len()..].trim_start_matches(['\r', '\n'])),
        _ => (text, ""),
    };
    let mut out = before.trim_end().to_string();
    if let Some(block) = block {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&block);
    } else if !out.is_empty() {
        out.push('\n');
    }
    if !after.is_empty() {
        if !out.is_empty() && !out.ends_with("\n\n") {
            out.push('\n');
        }
        out.push_str(after);
    }
    out
}

fn write(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    crate::commands::write_atomic(path, text.as_bytes())
}

/// Glance's skill folders in Claude Code's skills folder.
fn installed_folders(d: &Dirs) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(claude_skills(d)) else { return vec![] };
    entries.flatten().map(|e| e.path()).filter(|p| p.is_dir() && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(PREFIX))).collect()
}

pub fn install(d: &Dirs, skills: &[SkillToInstall], note: &str) -> Result<Vec<String>, String> {
    if let Some(bad) = skills.iter().find(|s| !valid_name(&s.name)) {
        return Err(format!("not a Glance skill name: {}", bad.name));
    }
    // Skills turned off since the last install go away.
    for old in installed_folders(d) {
        if !skills.iter().any(|s| old.file_name().is_some_and(|n| n.to_string_lossy() == s.name)) {
            std::fs::remove_dir_all(&old).map_err(|e| e.to_string())?;
        }
    }
    let mut written = vec![];
    for s in skills {
        let dir = claude_skills(d).join(&s.name);
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("SKILL.md");
        write(&file, &s.text)?;
        written.push(file.display().to_string());
        for (rel, text) in &s.files {
            if !valid_rel(rel) {
                return Err(format!("not a file in the skill: {rel}"));
            }
            let file = dir.join(rel);
            write(&file, text)?;
            written.push(file.display().to_string());
        }
    }
    let md = agents_md(d);
    let old = std::fs::read_to_string(&md).unwrap_or_default();
    write(&md, &with_block(&old, Some(note)))?;
    written.push(md.display().to_string());
    Ok(written)
}

pub fn uninstall(d: &Dirs) -> Result<(), String> {
    for old in installed_folders(d) {
        std::fs::remove_dir_all(&old).map_err(|e| e.to_string())?;
    }
    let md = agents_md(d);
    if let Ok(old) = std::fs::read_to_string(&md) {
        if old.contains(BEGIN) {
            write(&md, &with_block(&old, None))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn skills_user_list(app: AppHandle) -> Result<Vec<UserSkill>, String> {
    Ok(read_user_skills(&folder(&app)?))
}

#[tauri::command]
pub fn skills_folder(app: AppHandle) -> Result<String, String> {
    Ok(folder(&app)?.display().to_string())
}

#[tauri::command]
pub fn skills_install(skills: Vec<SkillToInstall>, note: String) -> Result<Vec<String>, String> {
    install(&Dirs::current().ok_or("no home folder")?, &skills, &note)
}

#[tauri::command]
pub fn skills_uninstall() -> Result<(), String> {
    uninstall(&Dirs::current().ok_or("no home folder")?)
}

#[tauri::command]
pub fn skills_installed() -> bool {
    Dirs::current().is_some_and(|d| !installed_folders(&d).is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> Dirs {
        let root = std::env::temp_dir().join(format!("glance-skills-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let d = Dirs { home: root.join("home"), appdata: root.join("roaming"), local_appdata: root.join("local") };
        std::fs::create_dir_all(&d.home).unwrap();
        d
    }

    fn skill(name: &str) -> SkillToInstall {
        SkillToInstall { name: name.into(), text: format!("---\nname: {name}\n---\nhi"), files: BTreeMap::from([("examples/a.md".into(), "eg".into())]) }
    }

    #[test]
    fn reads_skill_folders_and_their_examples() {
        let d = scratch("read");
        let root = d.home.join("skills");
        std::fs::create_dir_all(root.join("resume/examples")).unwrap();
        std::fs::write(root.join("resume/SKILL.md"), "---\nname: resume\n---").unwrap();
        std::fs::write(root.join("resume/examples/one.md"), "eg").unwrap();
        std::fs::write(root.join("resume/picture.png"), [0u8; 4]).unwrap();
        std::fs::create_dir_all(root.join("empty")).unwrap();
        let list = read_user_skills(&root);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].folder, "resume");
        assert_eq!(list[0].files.keys().collect::<Vec<_>>(), vec!["examples/one.md"]);
    }

    #[test]
    fn installs_replaces_and_removes_only_glances_own() {
        let d = scratch("install");
        std::fs::create_dir_all(claude_skills(&d).join("mine")).unwrap();
        std::fs::create_dir_all(d.home.join(".codex")).unwrap();
        std::fs::write(agents_md(&d), "# My rules\n\nBe nice.\n").unwrap();
        install(&d, &[skill("glance-slide-design"), skill("glance-editing")], "## Glance\nUse it.").unwrap();
        assert!(claude_skills(&d).join("glance-editing/examples/a.md").exists());
        let md = std::fs::read_to_string(agents_md(&d)).unwrap();
        assert!(md.starts_with("# My rules\n\nBe nice.\n\n<!-- glance:begin"));
        assert!(md.contains("Use it."));
        // Again with one skill off: its folder goes, the note is replaced, not repeated.
        install(&d, &[skill("glance-slide-design")], "## Glance\nUse it now.").unwrap();
        assert!(!claude_skills(&d).join("glance-editing").exists());
        let md = std::fs::read_to_string(agents_md(&d)).unwrap();
        assert_eq!(md.matches("glance:begin").count(), 1);
        assert!(md.contains("Use it now.") && !md.contains("Use it.\n"));
        uninstall(&d).unwrap();
        assert!(claude_skills(&d).join("mine").exists());
        assert!(installed_folders(&d).is_empty());
        assert_eq!(std::fs::read_to_string(agents_md(&d)).unwrap(), "# My rules\n\nBe nice.\n");
    }

    #[test]
    fn refuses_names_and_paths_outside_its_own() {
        let d = scratch("refuse");
        assert!(install(&d, &[skill("slide-design")], "x").is_err());
        let mut s = skill("glance-x");
        s.files = BTreeMap::from([("../../evil.md".into(), "x".into())]);
        assert!(install(&d, &[s], "x").is_err());
    }

    #[test]
    fn block_keeps_text_after_it() {
        let text = format!("A\n\n{BEGIN}\nold\n{END}\n\nB\n");
        assert_eq!(with_block(&text, Some("new")), format!("A\n\n{BEGIN}\nnew\n{END}\n\nB\n"));
        assert_eq!(with_block(&text, None), "A\n\nB\n");
        assert_eq!(with_block("", Some("n")), format!("{BEGIN}\nn\n{END}\n"));
    }
}
