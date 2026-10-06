mod agents;
mod certsig;
mod color;
mod commands;
mod decode;
mod encode;
mod explorer;
mod files;
mod fonts;
mod history;
mod mcp;
mod metadata;
mod ocr;
mod speech;
mod scan;
mod protocol;
mod shell;
mod signatures;
mod subject;
mod website;

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

/// Whether Glance runs from its MSIX package (the Microsoft Store build). The Store keeps
/// that build up to date, so the UI skips its own GitHub update checks.
#[tauri::command]
fn store_package() -> bool {
    store_package_now()
}

pub(crate) fn store_package_now() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
        use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
        // With an empty buffer this reports the size needed when packaged, and
        // APPMODEL_ERROR_NO_PACKAGE otherwise.
        let mut len = 0u32;
        unsafe { GetCurrentPackageFullName(&mut len, None) == ERROR_INSUFFICIENT_BUFFER }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn apply_backdrop(window: &tauri::Window) {
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
            // glance-mcp starting Glance while it already runs: nothing to show or open.
            if mcp::launched_for_ai(&argv) {
                return;
            }
            let action = explorer::action_from_args(&argv);
            let files = commands::files_from_args(argv.into_iter().skip(1).map(|a| {
                let p = std::path::Path::new(&a);
                if p.is_relative() { std::path::Path::new(&cwd).join(p).to_string_lossy().into_owned() } else { a }
            }));
            if let Some(win) = app.get_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            if let Some(action) = action {
                explorer::enqueue(app, action, files);
            } else if !files.is_empty() {
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
        .manage(explorer::Queue::default())
        .manage(mcp::Hub::default())
        .manage(agents::Agents::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                files::release_window(window.app_handle(), window.label());
                if window.label() == "main" {
                    agents::stop_all(window.app_handle());
                }
            }
        })
        .setup(|app| {
            if let Some(win) = app.get_window("main") {
                apply_backdrop(&win);
            }
            let args: Vec<String> = std::env::args().skip(1).collect();
            mcp::start(app.handle(), mcp::launched_for_ai(&args));
            if let Some(action) = explorer::action_from_args(&args) {
                explorer::enqueue(app.handle(), action, commands::files_from_args(args.into_iter()));
            }
            subject::warm_up();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_material,
            store_package,
            commands::probe,
            commands::write_file,
            commands::write_temp,
            commands::ghostscript_available,
            commands::convert_postscript,
            commands::initial_files,
            explorer::take_shell_requests,
            explorer::unique_path,
            commands::log_frontend,
            signatures::signatures_list,
            signatures::signature_save,
            signatures::signature_delete,
            certsig::verify_pdf_signature,
            certsig::show_certificate,
            certsig::pick_signing_certificate,
            certsig::sign_with_certificate,
            subject::subject_mask,
            encode::save_image,
            fonts::fonts_list,
            fonts::font_bytes,
            shell::open_with,
            shell::default_app_status,
            shell::open_default_apps_settings,
            metadata::image_metadata,
            metadata::remove_location,
            ocr::ocr_image,
            speech::speech_start,
            speech::speech_stop,
            speech::voice_typing,
            ocr::ocr_max_dimension,
            scan::scanners_list,
            scan::scan,
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
            shell::share_files,
            mcp::mcp_take,
            mcp::mcp_send,
            mcp::mcp_launched_hidden,
            mcp::mcp_show,
            mcp::apps::ai_apps,
            mcp::apps::ai_app_connect,
            mcp::apps::ai_app_disconnect,
            agents::agents_list,
            agents::agent_add,
            agents::agent_remove,
            agents::agent_add_key,
            website::website_show,
            website::website_hide,
            website::website_reload,
            website::website_close_all,
            website::website_back,
            website::website_home,
            agents::agent_start,
            agents::agent_send,
            agents::agent_stop,
            agents::agent_login,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glance");
}
