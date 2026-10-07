//! The COM side: an `IExplorerCommand` per verb and the DLL exports the surrogate host calls.

use crate::{launches, Verb};
use std::ffi::c_void;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use windows::core::{implement, Interface, Ref, Result, GUID, HRESULT, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_NOTIMPL, E_POINTER, HMODULE, MAX_PATH, S_FALSE};
use windows::Win32::System::Com::{CoTaskMemFree, IBindCtx, IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
};
use windows::Win32::UI::Shell::{
    IEnumExplorerCommand, IExplorerCommand, IExplorerCommand_Impl, IShellItemArray, SHStrDupW, ECF_DEFAULT, ECS_ENABLED, ECS_HIDDEN,
    SIGDN_FILESYSPATH,
};

/// The app, packaged next to this DLL (packaging/msix/pack.ps1).
const APP_EXE: &str = "Glance.exe";

/// This DLL's folder: the package's install folder.
fn module_dir() -> Option<PathBuf> {
    let mut module = HMODULE::default();
    let flags = GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT;
    unsafe { GetModuleHandleExW(flags, PCWSTR(module_dir as *const () as *const u16), &mut module).ok()? };
    let mut buf = vec![0u16; MAX_PATH as usize];
    loop {
        let n = unsafe { GetModuleFileNameW(Some(module), &mut buf) } as usize;
        if n == 0 {
            return None;
        }
        if n < buf.len() {
            return PathBuf::from(String::from_utf16_lossy(&buf[..n])).parent().map(PathBuf::from);
        }
        buf.resize(buf.len() * 2, 0);
    }
}

fn co_string(s: &str) -> Result<PWSTR> {
    unsafe { SHStrDupW(&windows::core::HSTRING::from(s)) }
}

/// File system paths of the selected items; items that aren't files (a search result
/// group, a library) are left out.
fn paths(items: &IShellItemArray) -> Result<Vec<String>> {
    let count = unsafe { items.GetCount()? };
    let mut out = Vec::with_capacity(count as usize);
    for i in 0..count {
        let item = unsafe { items.GetItemAt(i)? };
        if let Ok(name) = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) } {
            out.push(unsafe { name.to_string() }.unwrap_or_default());
            unsafe { CoTaskMemFree(Some(name.0 as *const c_void)) };
        }
    }
    Ok(out)
}

#[implement(IExplorerCommand)]
struct Command {
    verb: Verb,
}

impl IExplorerCommand_Impl for Command_Impl {
    fn GetTitle(&self, _items: Ref<IShellItemArray>) -> Result<PWSTR> {
        co_string(self.verb.title())
    }

    fn GetIcon(&self, _items: Ref<IShellItemArray>) -> Result<PWSTR> {
        let exe = module_dir().ok_or(windows::core::Error::from(E_FAIL))?.join(APP_EXE);
        co_string(&format!("{},0", exe.display()))
    }

    fn GetToolTip(&self, _items: Ref<IShellItemArray>) -> Result<PWSTR> {
        Err(E_NOTIMPL.into())
    }

    fn GetCanonicalName(&self) -> Result<GUID> {
        Ok(GUID::from_u128(self.verb.clsid()))
    }

    fn GetState(&self, items: Ref<IShellItemArray>, _ok_to_be_slow: windows::core::BOOL) -> Result<u32> {
        let applies = match items.as_ref() {
            Some(items) => self.verb.applies_to(&paths(items)?),
            None => false,
        };
        Ok(if applies { ECS_ENABLED.0 as u32 } else { ECS_HIDDEN.0 as u32 })
    }

    fn Invoke(&self, items: Ref<IShellItemArray>, _bind: Ref<IBindCtx>) -> Result<()> {
        let paths = paths(items.ok()?)?;
        let exe = module_dir().ok_or(windows::core::Error::from(E_FAIL))?.join(APP_EXE);
        for args in launches(self.verb, &paths) {
            // DETACHED_PROCESS: Glance outlives the surrogate host and needs no console.
            std::process::Command::new(&exe)
                .args(args)
                .creation_flags(0x0000_0008)
                .spawn()
                .map_err(|_| windows::core::Error::from(E_FAIL))?;
        }
        Ok(())
    }

    fn GetFlags(&self) -> Result<u32> {
        Ok(ECF_DEFAULT.0 as u32)
    }

    fn EnumSubCommands(&self) -> Result<IEnumExplorerCommand> {
        Err(E_NOTIMPL.into())
    }
}

#[implement(IClassFactory)]
struct Factory {
    verb: Verb,
}

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<windows::core::IUnknown>, iid: *const GUID, object: *mut *mut c_void) -> Result<()> {
        if object.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *object = std::ptr::null_mut() };
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let command: IExplorerCommand = Command { verb: self.verb }.into();
        unsafe { command.query(iid, object).ok() }
    }

    fn LockServer(&self, _lock: windows::core::BOOL) -> Result<()> {
        Ok(())
    }
}

#[no_mangle]
extern "system" fn DllGetClassObject(clsid: *const GUID, iid: *const GUID, object: *mut *mut c_void) -> HRESULT {
    if clsid.is_null() || iid.is_null() || object.is_null() {
        return E_POINTER;
    }
    unsafe { *object = std::ptr::null_mut() };
    let Some(verb) = Verb::from_clsid(unsafe { &*clsid }.to_u128()) else {
        return CLASS_E_CLASSNOTAVAILABLE;
    };
    let factory: IClassFactory = Factory { verb }.into();
    unsafe { factory.query(iid, object) }
}

/// The surrogate host exits on its own; keeping the DLL loaded until then is simpler than
/// counting objects.
#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{SHCreateItemFromParsingName, SHCreateShellItemArrayFromShellItem, IShellItem};

    fn selection(path: &str) -> IShellItemArray {
        let item: IShellItem = unsafe { SHCreateItemFromParsingName(&HSTRING::from(path), None) }.unwrap();
        unsafe { SHCreateShellItemArrayFromShellItem(&item) }.unwrap()
    }

    /// Run with the package installed (CI packs and installs a test-signed one): creates each
    /// command the way Explorer does, from the package's COM registration in its surrogate
    /// host, and invokes Combine into PDF, which starts the packaged Glance.exe.
    #[test]
    #[ignore]
    fn installed_package_serves_the_commands() {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap() };
        let dir = std::env::temp_dir().join("glance-context-menu-check");
        std::fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("photo.jpg");
        let scan = dir.join("scan.pdf");
        std::fs::write(&photo, b"").unwrap();
        std::fs::write(&scan, b"").unwrap();
        for verb in crate::VERBS {
            let command: IExplorerCommand = unsafe { CoCreateInstance(&GUID::from_u128(verb.clsid()), None, CLSCTX_LOCAL_SERVER) }
                .unwrap_or_else(|e| panic!("{verb:?} isn't registered by the package: {e}"));
            let title = unsafe { command.GetTitle(None) }.unwrap();
            assert_eq!(unsafe { title.to_string() }.unwrap(), verb.title());
            let icon = unsafe { command.GetIcon(None) }.unwrap();
            let icon = unsafe { icon.to_string() }.unwrap();
            assert!(icon.contains("WindowsApps") && icon.ends_with(r"\Glance.exe,0"), "icon {icon}");
            let state = unsafe { command.GetState(&selection(&photo.to_string_lossy()), false) }.unwrap();
            assert_eq!(state, ECS_ENABLED.0 as u32, "{verb:?} on a photo");
        }
        let remove: IExplorerCommand =
            unsafe { CoCreateInstance(&GUID::from_u128(Verb::RemoveLocation.clsid()), None, CLSCTX_LOCAL_SERVER) }.unwrap();
        let state = unsafe { remove.GetState(&selection(&scan.to_string_lossy()), false) }.unwrap();
        assert_eq!(state, ECS_HIDDEN.0 as u32, "Remove Location Info on a PDF");
        let combine: IExplorerCommand = unsafe { CoCreateInstance(&GUID::from_u128(Verb::Combine.clsid()), None, CLSCTX_LOCAL_SERVER) }.unwrap();
        unsafe { combine.Invoke(&selection(&scan.to_string_lossy()), None) }.unwrap();
    }
}
