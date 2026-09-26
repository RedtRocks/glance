mod color;
mod commands;
mod decode;
mod encode;
mod files;
mod fonts;
mod history;
mod metadata;
mod ocr;
mod protocol;
mod shell;
mod signatures;
mod subject;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

/// Whether the Windows 11 Mica backdrop could be applied (false on Windows 10 and elsewhere).
static MICA: AtomicBool = AtomicBool::new(false);

/// "mica" when the translucent backdrop is active, otherwise "solid"; the UI paints its own
/// opaque background in the latter case.
#[tauri::command]
fn window_material() -> &'static str {
    if MICA.load(Ordering::Relaxed) { "mica" } else { "solid" }
}

fn apply_backdrop(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        if window_vibrancy::apply_mica(window, None).is_ok() {
            MICA.store(true, Ordering::Relaxed);
            return;
        }
    }
    // No backdrop available: make the window opaque so the desktop never shows through.
    let _ = window.set_background_color(Some(tauri::window::Color(32, 32, 32, 255)));
}

pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch forwards its files here and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let files = commands::files_from_args(argv.into_iter().skip(1).map(|a| {
                let p = std::path::Path::new(&a);
                if p.is_relative() { std::path::Path::new(&cwd).join(p).to_string_lossy().into_owned() } else { a }
            }));
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            if !files.is_empty() {
                // Only the main window opens them (every window listens for the event).
                let _ = app.emit_to("main", "open-files", files);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .register_asynchronous_uri_scheme_protocol("glance", |_ctx, request, responder| {
            tauri::async_runtime::spawn_blocking(move || responder.respond(protocol::handle(request)));
        })
        .manage(files::OpenFiles::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                files::release_window(window.app_handle(), window.label());
            }
        })
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                apply_backdrop(&win);
            }
            subject::warm_up();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_material,
            commands::probe,
            commands::write_file,
            commands::write_temp,
            commands::ghostscript_available,
            commands::convert_postscript,
            commands::initial_files,
            commands::log_frontend,
            signatures::signatures_list,
            signatures::signature_save,
            signatures::signature_delete,
            subject::subject_mask,
            encode::save_image,
            fonts::fonts_list,
            fonts::font_bytes,
            shell::open_with,
            metadata::image_metadata,
            metadata::remove_location,
            ocr::ocr_image,
            ocr::ocr_max_dimension,
            files::claim_file,
            files::release_file,
            files::focus_file,
            files::file_stamp,
            history::history_record,
            history::history_record_file,
            history::history_list,
            history::history_read,
            history::history_delete,
            history::history_rename,
            shell::set_wallpaper,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glance");
}
