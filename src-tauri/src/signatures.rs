//! Saved signatures, encrypted at rest with Windows DPAPI.
//!
//! A saved signature can stamp a legally meaningful mark, so it must not be usable by
//! other accounts or by someone who copies the file: CryptProtectData ties the
//! ciphertext to the current Windows user. (Other platforms are for development only
//! and store the data unencrypted.)

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    pub id: String,
    pub name: String,
    pub created: u64,
    /// PNG with transparent background, base64-encoded.
    pub png: String,
}

const ENTROPY: &[u8] = b"Glance signature v1";

#[cfg(windows)]
mod dpapi {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
    }

    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
        v
    }

    pub fn protect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(data);
        let ent = blob(entropy);
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptProtectData(&input, windows::core::w!("Glance signature"), Some(&ent), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
                .map_err(|e| e.to_string())?;
            Ok(take(out))
        }
    }

    pub fn unprotect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(data);
        let ent = blob(entropy);
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(&input, None, Some(&ent), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
                .map_err(|e| e.to_string())?;
            Ok(take(out))
        }
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn protect(data: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
    pub fn unprotect(data: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("signatures");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn write(dir: &Path, sig: &Signature) -> Result<(), String> {
    let json = serde_json::to_vec(sig).map_err(|e| e.to_string())?;
    let sealed = dpapi::protect(&json, ENTROPY)?;
    std::fs::write(dir.join(format!("{}.sig", sig.id)), sealed).map_err(|e| e.to_string())
}

pub fn read_all(dir: &Path) -> Vec<Signature> {
    let mut out: Vec<Signature> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "sig"))
        .filter_map(|e| std::fs::read(e.path()).ok())
        .filter_map(|b| dpapi::unprotect(&b, ENTROPY).ok())
        .filter_map(|j| serde_json::from_slice(&j).ok())
        .collect();
    out.sort_by_key(|s| s.created);
    out
}

#[tauri::command]
pub fn signatures_list(app: AppHandle) -> Result<Vec<Signature>, String> {
    Ok(read_all(&dir(&app)?))
}

#[tauri::command]
pub fn signature_save(app: AppHandle, name: String, png: String) -> Result<Signature, String> {
    // Validate that it really is a PNG before storing it.
    let bytes = base64::engine::general_purpose::STANDARD.decode(&png).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || bytes.len() > 8 * 1024 * 1024 {
        return Err("invalid signature image".into());
    }
    let created = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let sig = Signature { id: format!("sig-{created:x}"), name: name.chars().take(80).collect(), created, png };
    write(&dir(&app)?, &sig)?;
    Ok(sig)
}

#[tauri::command]
pub fn signature_delete(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid id".into());
    }
    let p = dir(&app)?.join(format!("{id}.sig"));
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_is_not_plaintext_on_windows() {
        let d = std::env::temp_dir().join(format!("glance-sig-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let sig = Signature { id: "sig-1".into(), name: "Jane".into(), created: 1, png: "iVBORw0KGgo=".into() };
        write(&d, &sig).unwrap();
        let raw = std::fs::read(d.join("sig-1.sig")).unwrap();
        #[cfg(windows)]
        assert!(!String::from_utf8_lossy(&raw).contains("Jane"), "signature must be encrypted at rest");
        let _ = raw;
        let back = read_all(&d);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].name, "Jane");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn rejects_path_traversal_ids() {
        assert!(!valid_id("../x"));
        assert!(!valid_id(""));
        assert!(valid_id("sig-18c0ffee"));
    }
}
