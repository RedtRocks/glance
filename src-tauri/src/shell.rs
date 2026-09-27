//! Windows shell integration invoked from the UI: Open With another app, and setting
//! an image as the desktop wallpaper or lock screen.

use crate::commands::{header, raw_body};
use tauri::ipc::Request;
use tauri::Manager;

/// Shows the Windows "Open with" picker for a file Glance can't fully edit
/// (a layered PSD, an Illustrator file, …). Choosing an app opens the file once;
/// file associations are left untouched.
#[tauri::command]
pub async fn open_with(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        tauri::async_runtime::spawn_blocking(move || win::open_with(hwnd, &path)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, path);
        Err("Open With is only available on Windows.".into())
    }
}

/// Sets the image in the request body as the wallpaper (`x-target: desktop`) or the
/// lock screen (`x-target: lock`). The file is kept in Glance's data folder, since
/// Windows reads it from there.
#[tauri::command]
pub async fn set_wallpaper(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String> {
    let target = header(&request, "x-target")?;
    let ext = header(&request, "x-ext")?.to_ascii_lowercase();
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "bmp") {
        return Err(format!("unsupported wallpaper format {ext}"));
    }
    let kind = match target.as_str() {
        "desktop" => "desktop",
        "lock" => "lock",
        _ => return Err(format!("unknown target {target}")),
    };
    let bytes = raw_body(&request)?;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("Wallpaper");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // A fresh name each time: Windows caches by path and may not notice a rewritten file.
    for old in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if old.file_name().to_string_lossy().starts_with(kind) {
            let _ = std::fs::remove_file(old.path());
        }
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("{kind}-{stamp}.{ext}"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let path = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || if kind == "desktop" { win::set_desktop(&path) } else { win::set_lock_screen(&path) })
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Setting the wallpaper is only available on Windows.".into())
    }
}

#[cfg(windows)]
mod share {
    use std::sync::Mutex;
    use windows::core::{AgileReference, Interface, HSTRING};
    use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::{IStorageItem, StorageFile};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::IDataTransferManagerInterop;

    /// The handler registered for the last share, removed before the next one.
    static LAST: Mutex<Option<(isize, i64)>> = Mutex::new(None);

    /// Opens the Windows share sheet for files. Must run on the window's UI thread.
    pub fn share(hwnd: isize, paths: &[String], title: &str) -> windows::core::Result<()> {
        // Agile references: the handler may run on another thread.
        let items: Vec<AgileReference<IStorageItem>> = paths
            .iter()
            .map(|p| AgileReference::new(&StorageFile::GetFileFromPathAsync(&HSTRING::from(p.as_str()))?.join()?.cast::<IStorageItem>()?))
            .collect::<windows::core::Result<_>>()?;
        let interop = windows::core::factory::<DataTransferManager, IDataTransferManagerInterop>()?;
        let window = HWND(hwnd as _);
        let manager: DataTransferManager = unsafe { interop.GetForWindow(window)? };
        if let Some((h, token)) = LAST.lock().unwrap().take() {
            if h == hwnd {
                let _ = manager.RemoveDataRequested(token);
            }
        }
        let title = HSTRING::from(title);
        let token = manager.DataRequested(&TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                let data = args.Request()?.Data()?;
                data.Properties()?.SetTitle(&title)?;
                let resolved: Vec<Option<IStorageItem>> = items.iter().map(|r| r.resolve().ok()).collect();
                let list: windows_collections::IIterable<IStorageItem> = resolved.into();
                data.SetStorageItemsReadOnly(&list)?;
            }
            Ok(())
        }))?;
        *LAST.lock().unwrap() = Some((hwnd, token));
        unsafe { interop.ShowShareUIForWindow(window) }
    }
}

/// Opens the Windows share sheet (mail, Nearby Share, apps) for these files.
#[tauri::command]
pub async fn share_files(app: tauri::AppHandle, window: tauri::WebviewWindow, paths: Vec<String>, title: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (tx, rx) = std::sync::mpsc::channel();
        // The share UI belongs to the window's thread.
        app.run_on_main_thread(move || {
            let _ = tx.send(share::share(hwnd, &paths, &title).map_err(|e| e.message()));
        })
        .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, window, paths, title);
        Err("Sharing uses the Windows share sheet and is only available on Windows.".into())
    }
}

#[cfg(windows)]
mod win {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Storage::StorageFile;
    use windows::System::UserProfile::LockScreen;
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{SHOpenWithDialog, OAIF_EXEC, OAIF_HIDE_REGISTRATION, OPENASINFO};
    use windows::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn open_with(hwnd: isize, path: &str) -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let file = wide(path);
            let info = OPENASINFO { pcszFile: PCWSTR(file.as_ptr()), pcszClass: PCWSTR::null(), oaifInFlags: OAIF_EXEC | OAIF_HIDE_REGISTRATION };
            match SHOpenWithDialog(Some(HWND(hwnd as _)), &info) {
                Ok(()) => Ok(()),
                Err(e) if e.code() == ERROR_CANCELLED.to_hresult() => Ok(()),
                Err(e) => Err(e.message()),
            }
        }
    }

    pub fn set_desktop(path: &str) -> Result<(), String> {
        let file = wide(path);
        unsafe {
            SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, Some(file.as_ptr() as _), SPIF_UPDATEINIFILE | SPIF_SENDCHANGE)
                .map_err(|e| e.message())
        }
    }

    pub fn set_lock_screen(path: &str) -> Result<(), String> {
        let run = || -> windows::core::Result<()> {
            let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path))?.join()?;
            LockScreen::SetImageFileAsync(&file)?.join()
        };
        run().map_err(|e| format!("Windows didn’t accept the lock screen image ({}). Your organization may manage the lock screen.", e.message()))
    }
}

/// Whether Windows opens PDFs and common images (JPEG, PNG) with Glance.
#[derive(serde::Serialize)]
pub struct DefaultAppStatus {
    pdf: bool,
    images: bool,
}

#[tauri::command]
pub async fn default_app_status() -> DefaultAppStatus {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| DefaultAppStatus {
            pdf: default_app::opens_with_glance(".pdf"),
            images: default_app::opens_with_glance(".jpg") && default_app::opens_with_glance(".png"),
        })
        .await
        .unwrap_or(DefaultAppStatus { pdf: false, images: false })
    }
    #[cfg(not(windows))]
    {
        DefaultAppStatus { pdf: false, images: false }
    }
}

/// Opens Glance's page in Settings → Apps → Default apps. Windows doesn't let apps
/// change defaults themselves; on Windows 11 that page has one "Set default" button.
#[tauri::command]
pub async fn open_default_apps_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(default_app::open_settings).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("Default apps are only available on Windows.".into())
    }
}

#[cfg(windows)]
mod default_app {
    use windows::core::{w, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
    use windows::Win32::Storage::Packaging::Appx::GetCurrentApplicationUserModelId;
    use windows::Win32::UI::Shell::{AssocQueryStringW, ShellExecuteW, ASSOCF_NONE, ASSOCSTR_EXECUTABLE};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    /// Name of Glance's value under HKCU\Software\RegisteredApplications
    /// (src-tauri/windows/default-apps.nsh).
    const REGISTERED_APP: &str = "Glance";

    /// Whether double-clicking a file with this extension starts glance.exe.
    pub fn opens_with_glance(ext: &str) -> bool {
        let ext = HSTRING::from(ext);
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = unsafe { AssocQueryStringW(ASSOCF_NONE, ASSOCSTR_EXECUTABLE, &ext, w!("open"), Some(PWSTR(buf.as_mut_ptr())), &mut len) };
        if ok.is_err() {
            return false;
        }
        let exe = String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())]);
        let ours = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
        let theirs = std::path::Path::new(&exe).file_name().map(|n| n.to_string_lossy().into_owned());
        matches!((ours, theirs), (Some(a), Some(b)) if a.eq_ignore_ascii_case(&b))
    }

    /// The Store build's app user model id, or None for the installer build.
    fn package_app_id() -> Option<String> {
        let mut len = 0u32;
        if unsafe { GetCurrentApplicationUserModelId(&mut len, None) } != ERROR_INSUFFICIENT_BUFFER {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        unsafe { GetCurrentApplicationUserModelId(&mut len, Some(PWSTR(buf.as_mut_ptr()))) }.ok().ok()?;
        Some(String::from_utf16_lossy(&buf[..len.saturating_sub(1) as usize]))
    }

    pub fn open_settings() -> Result<(), String> {
        // Windows 11 opens the app's own page from these; Windows 10 shows Default apps.
        let url = match package_app_id() {
            Some(aumid) => format!("ms-settings:defaultapps?registeredAUMID={aumid}"),
            None => format!("ms-settings:defaultapps?registeredAppUser={REGISTERED_APP}"),
        };
        let result = unsafe { ShellExecuteW(None, w!("open"), &HSTRING::from(url), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        // ShellExecute returns a value above 32 on success.
        if result.0 as isize > 32 {
            Ok(())
        } else {
            Err("Windows Settings didn’t open.".into())
        }
    }
}
