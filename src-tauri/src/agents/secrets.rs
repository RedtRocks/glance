//! API keys for the Ask AI sidebar, kept in Windows Credential Manager (never in Glance's own
//! files, and never sent back to the webview).

const PREFIX: &str = "Glance/AI/";

#[cfg(windows)]
mod imp {
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Security::Credentials::*;

    pub fn save(target: &str, secret: &str) -> Result<(), String> {
        let name = HSTRING::from(target);
        let user = HSTRING::from("Glance");
        let mut blob = secret.as_bytes().to_vec();
        let cred = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(name.as_ptr() as *mut u16),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(user.as_ptr() as *mut u16),
            ..Default::default()
        };
        unsafe { CredWriteW(&cred, 0) }.map_err(|e| e.to_string())
    }

    pub fn load(target: &str) -> Option<String> {
        let mut p: *mut CREDENTIALW = std::ptr::null_mut();
        unsafe {
            CredReadW(&HSTRING::from(target), CRED_TYPE_GENERIC, None, &mut p).ok()?;
            let c = &*p;
            let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec();
            CredFree(p as *const _);
            String::from_utf8(bytes).ok()
        }
    }

    pub fn delete(target: &str) {
        let _ = unsafe { CredDeleteW(&HSTRING::from(target), CRED_TYPE_GENERIC, None) };
    }
}

/// Elsewhere (development and tests) keys live in memory only.
#[cfg(not(windows))]
mod imp {
    use std::collections::HashMap;
    use std::sync::Mutex;

    static KEYS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

    pub fn save(target: &str, secret: &str) -> Result<(), String> {
        KEYS.lock().unwrap().get_or_insert_with(HashMap::new).insert(target.into(), secret.into());
        Ok(())
    }

    pub fn load(target: &str) -> Option<String> {
        KEYS.lock().unwrap().as_ref()?.get(target).cloned()
    }

    pub fn delete(target: &str) {
        if let Some(m) = KEYS.lock().unwrap().as_mut() {
            m.remove(target);
        }
    }
}

pub fn save(agent: &str, secret: &str) -> Result<(), String> {
    imp::save(&format!("{PREFIX}{agent}"), secret)
}

pub fn load(agent: &str) -> Option<String> {
    imp::load(&format!("{PREFIX}{agent}"))
}

pub fn delete(agent: &str) {
    imp::delete(&format!("{PREFIX}{agent}"))
}
