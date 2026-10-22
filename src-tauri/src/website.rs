//! The Ask AI sidebar's other view: the AI company's own website (chatgpt.com, claude.ai, …)
//! shown inside Glance, where the user signs in once with their own account, free or paid.
//!
//! Each site is a child webview of the main window, placed over the sidebar's content area.
//! It shares Glance's WebView2 profile, so sign-ins are remembered. Only the addresses of
//! Glance's built-in companies can be opened; sites get no access to Glance's commands
//! (capabilities cover Glance's own pages, not remote ones).
//!
//! The main window holds more than one webview while a site is open, so Glance's own
//! commands take `tauri::Window`, never `WebviewWindow` (which then fails to resolve).
//!
//! Files the user downloads from a site are saved in Downloads, as in a browser, and Glance
//! is told (`website-download`) so it can open them in a tab. Glance never scripts the sites.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

const PREFIX: &str = "site-";

fn sites(app: &AppHandle) -> Vec<Webview> {
    app.webviews().into_iter().filter(|(label, _)| label.starts_with(PREFIX)).map(|(_, w)| w).collect()
}

fn home(id: &str) -> Result<url::Url, String> {
    let url = crate::agents::builtins()
        .into_iter()
        .find(|a| a.id == id)
        .and_then(|a| a.website)
        .ok_or_else(|| format!("{id} has no website"))?;
    url.parse().map_err(|e: url::ParseError| e.to_string())
}

fn site(app: &AppHandle, id: &str) -> Result<Webview, String> {
    app.get_webview(&format!("{PREFIX}{id}")).ok_or_else(|| "not open".into())
}

/// The user agent of Microsoft Edge on the same engine. WebView2's own adds client hints
/// naming "WebView2", and Google refuses to sign in inside apps that send them; a custom
/// user agent turns those hints off.
#[cfg(windows)]
fn edge_user_agent() -> String {
    let version = tauri::webview_version().unwrap_or_else(|_| "141.0.0.0".into());
    let major = version.split('.').next().unwrap_or("141");
    format!("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36 Edg/{version}")
}

/// Shows `id`'s website at the given place (CSS pixels in the main window), hiding the others.
#[tauri::command]
pub async fn website_show(app: AppHandle, id: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let url = home(&id)?;
    let label = format!("{PREFIX}{id}");
    for w in sites(&app) {
        if w.label() != label {
            let _ = w.hide();
        }
    }
    let position = LogicalPosition::new(x, y);
    let size = LogicalSize::new(width.max(1.0), height.max(1.0));
    if let Some(w) = app.get_webview(&label) {
        w.set_position(position).map_err(|e| e.to_string())?;
        w.set_size(size).map_err(|e| e.to_string())?;
        w.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let window = app.get_window("main").ok_or("no main window")?;
    let opener = app.clone();
    let downloads = app.clone();
    let site_id = id.clone();
    let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(url))
        // Sign-in pages hop between domains; only web addresses are allowed.
        .on_navigation(|u| matches!(u.scheme(), "https" | "about"))
        // "Sign in with Google/Apple/Microsoft" opens a sized popup that reports back to the
        // site, so those open as a small window. Plain links that open a new tab go to the
        // user's browser instead of replacing the site.
        .on_new_window(move |u, features| {
            if u.scheme() != "https" {
                return tauri::webview::NewWindowResponse::Deny;
            }
            if features.size().is_some() {
                return tauri::webview::NewWindowResponse::Allow;
            }
            let _ = opener.opener().open_url(u.as_str(), None::<&str>);
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(move |_, event| {
            match event {
                DownloadEvent::Requested { destination, .. } => {
                    if let Ok(dir) = downloads.path().download_dir() {
                        *destination = into_downloads(&dir, destination);
                    }
                }
                DownloadEvent::Finished { url, path, success } => {
                    let _ = downloads.emit("website-download", Download { site: site_id.clone(), url: url.to_string(), path: path.map(|p| p.to_string_lossy().into_owned()), ok: success });
                }
                _ => {}
            }
            true
        });
    #[cfg(windows)]
    let builder = builder.user_agent(&edge_user_agent());
    window.add_child(builder, position, size).map_err(|e| e.to_string())?;
    Ok(())
}

/// A finished download from a company website, for Glance's page.
#[derive(Serialize, Clone)]
struct Download {
    site: String,
    url: String,
    /// Where it was saved; missing on macOS.
    path: Option<String>,
    ok: bool,
}

/// Where a site's download goes: Downloads, with the name the site suggested, numbered when
/// that name is taken (WebView2 and WebKitGTK suggest a path; only its name is used).
fn into_downloads(dir: &Path, suggested: &Path) -> PathBuf {
    let name = suggested.file_name().map(|n| n.to_string_lossy().into_owned()).filter(|n| !n.is_empty()).unwrap_or_else(|| "download".into());
    let first = dir.join(&name);
    if suggested == first || !first.exists() {
        return first;
    }
    let p = Path::new(&name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|c| !c.exists()).unwrap()
}

/// Opens an address on the shown company's own site, such as its new-chat page with a
/// prompt filled in (`claude.ai/new?q=…`). Other sites are refused.
#[tauri::command]
pub fn website_go(app: AppHandle, id: String, url: String) -> Result<(), String> {
    let target: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
    if !same_site(&home(&id)?, &target) {
        return Err("not this company's site".into());
    }
    site(&app, &id)?.navigate(target).map_err(|e| e.to_string())
}

fn same_site(home: &url::Url, target: &url::Url) -> bool {
    target.scheme() == "https" && target.host_str().is_some() && target.host_str() == home.host_str()
}

/// Hides every company website (the sidebar closed or went back to Glance's chat).
#[tauri::command]
pub fn website_hide(app: AppHandle) {
    for w in sites(&app) {
        let _ = w.hide();
    }
}

/// Closes every company website. Glance's page calls this when it loads, so a site left
/// over from before a reload never sits over the window with nothing to close it.
#[tauri::command]
pub fn website_close_all(app: AppHandle) {
    for w in sites(&app) {
        let _ = w.close();
    }
}

/// Reloads the shown site (after the user signs in elsewhere, or a page gets stuck).
#[tauri::command]
pub fn website_reload(app: AppHandle, id: String) -> Result<(), String> {
    site(&app, &id)?.reload().map_err(|e| e.to_string())
}

/// Goes back a page, for when a sign-in leads somewhere with no way back.
#[tauri::command]
pub fn website_back(app: AppHandle, id: String) -> Result<(), String> {
    site(&app, &id)?.eval("history.back()").map_err(|e| e.to_string())
}

/// Returns to the company's start page.
#[tauri::command]
pub fn website_home(app: AppHandle, id: String) -> Result<(), String> {
    let url = home(&id)?;
    site(&app, &id)?.navigate(url).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn user_agent_reads_as_edge() {
        let ua = edge_user_agent();
        assert!(ua.contains(" Edg/") && ua.contains(" Chrome/"));
        assert!(!ua.contains("WebView"));
    }

    #[test]
    fn prompts_only_go_to_the_company_site() {
        let home: url::Url = "https://claude.ai/".parse().unwrap();
        assert!(same_site(&home, &"https://claude.ai/new?q=hi".parse().unwrap()));
        assert!(!same_site(&home, &"https://evil.example/?q=hi".parse().unwrap()));
        assert!(!same_site(&home, &"http://claude.ai/new".parse().unwrap()));
    }

    #[test]
    fn downloads_are_numbered_not_overwritten() {
        let dir = std::env::temp_dir().join(format!("glance-dl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(into_downloads(&dir, Path::new("/elsewhere/deck.pptx")), dir.join("deck.pptx"));
        std::fs::write(dir.join("deck.pptx"), "x").unwrap();
        assert_eq!(into_downloads(&dir, Path::new("/elsewhere/deck.pptx")), dir.join("deck (1).pptx"));
        // Already numbered by the web view: keep it.
        assert_eq!(into_downloads(&dir, &dir.join("deck (1).pptx")), dir.join("deck (1).pptx"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_site_is_https() {
        for a in crate::agents::builtins() {
            if let Some(site) = a.website {
                assert!(site.starts_with("https://"), "{site}");
                assert!(home(&a.id).is_ok());
            }
        }
    }
}
