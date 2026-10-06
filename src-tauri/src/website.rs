//! The Ask AI sidebar's other view: the AI company's own website (chatgpt.com, claude.ai, …)
//! shown inside Glance, where the user signs in once with their own account, free or paid.
//!
//! Each site is a child webview of the main window, placed over the sidebar's content area.
//! It shares Glance's WebView2 profile, so sign-ins are remembered. Only the addresses of
//! Glance's built-in companies can be opened; sites get no access to Glance's commands
//! (capabilities cover Glance's own pages, not remote ones).

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

const PREFIX: &str = "site-";

fn sites(app: &AppHandle) -> Vec<Webview> {
    app.webviews().into_iter().filter(|(label, _)| label.starts_with(PREFIX)).map(|(_, w)| w).collect()
}

/// Shows `id`'s website at the given place (CSS pixels in the main window), hiding the others.
#[tauri::command]
pub async fn website_show(app: AppHandle, id: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let url = crate::agents::builtins()
        .into_iter()
        .find(|a| a.id == id)
        .and_then(|a| a.website)
        .ok_or_else(|| format!("{id} has no website"))?;
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
    let parsed = url.parse().map_err(|e: url::ParseError| e.to_string())?;
    let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        // Sign-in pages hop between domains; only web addresses are allowed.
        .on_navigation(|u| matches!(u.scheme(), "https" | "about"));
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

/// Reloads the shown site (after the user signs in elsewhere, or a page gets stuck).
#[tauri::command]
pub fn website_reload(app: AppHandle, id: String) -> Result<(), String> {
    let w = app.get_webview(&format!("{PREFIX}{id}")).ok_or("not open")?;
    w.reload().map_err(|e| e.to_string())
}
