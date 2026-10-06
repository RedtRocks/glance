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

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};
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
    let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(url))
        .user_agent(&edge_user_agent())
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
        });
    window.add_child(builder, position, size).map_err(|e| e.to_string())?;
    Ok(())
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
    fn user_agent_reads_as_edge() {
        let ua = edge_user_agent();
        assert!(ua.contains(" Edg/") && ua.contains(" Chrome/"));
        assert!(!ua.contains("WebView"));
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
