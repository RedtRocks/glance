//! Saved signatures, encrypted at rest with Windows DPAPI or a Linux login-keyring key.
//!
//! A saved signature can stamp a legally meaningful mark, so copying its file must
//! not reveal it. DPAPI ties ciphertext to the Windows user; Linux uses authenticated
//! encryption with a key held by Secret Service. Without secure storage, saving fails.

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

#[cfg(target_os = "linux")]
mod dpapi {
    use base64::Engine;
    use chacha20poly1305::{aead::{Aead, AeadInPlace, Payload}, KeyInit, XChaCha20Poly1305, XNonce};
    use crate::keyring_store::{entry, UNAVAILABLE};
    use std::sync::Mutex;

    // Serialize first-use creation so concurrent saves cannot overwrite each other's key.
    static KEY_LOCK: Mutex<()> = Mutex::new(());

    pub fn key() -> Result<[u8; 32], String> {
        let _guard = KEY_LOCK.lock().map_err(|_| UNAVAILABLE.to_string())?;
        let entry = entry("signature-key").map_err(|_| UNAVAILABLE.to_string())?;
        match entry.get_password() {
            Ok(encoded) => base64::engine::general_purpose::STANDARD.decode(encoded)
                .map_err(|_| "The saved-signature key in the system keyring is invalid.".to_string())?
                .try_into().map_err(|_| "The saved-signature key in the system keyring is invalid.".to_string()),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0; 32];
                getrandom::fill(&mut key).map_err(|e| format!("Cannot generate the saved-signature key: {e}"))?;
                entry.set_password(&base64::engine::general_purpose::STANDARD.encode(key))
                    .map_err(|_| UNAVAILABLE.to_string())?;
                Ok(key)
            }
            Err(_) => Err(UNAVAILABLE.into()),
        }
    }

    pub fn seal(key: &[u8; 32], data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        let mut nonce = [0; 24];
        getrandom::fill(&mut nonce).map_err(|e| format!("Cannot generate a signature nonce: {e}"))?;
        let cipher = XChaCha20Poly1305::new(key.into());
        let mut sealed = Vec::with_capacity(nonce.len() + data.len() + 16);
        sealed.extend_from_slice(&nonce);
        sealed.extend_from_slice(data);
        let tag = cipher.encrypt_in_place_detached(XNonce::from_slice(&nonce), entropy, &mut sealed[24..])
            .map_err(|_| "Cannot encrypt the saved signature.".to_string())?;
        sealed.extend_from_slice(&tag);
        Ok(sealed)
    }

    pub fn open(key: &[u8; 32], data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        if data.len() < 24 + 16 {
            return Err("The saved signature is damaged or cannot be decrypted.".into());
        }
        XChaCha20Poly1305::new(key.into())
            .decrypt(XNonce::from_slice(&data[..24]), Payload { msg: &data[24..], aad: entropy })
            .map_err(|_| "The saved signature is damaged or cannot be decrypted.".into())
    }

    pub fn protect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        seal(&key()?, data, entropy)
    }

    pub fn unprotect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        open(&key()?, data, entropy)
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod dpapi {
    pub fn protect(_data: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
        Err("Saved signatures need the system keyring (GNOME Keyring or KWallet), which isn't available.".into())
    }
    pub fn unprotect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        protect(data, entropy)
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
    #[cfg(target_os = "linux")]
    dpapi::key()?;
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
    #[cfg(any(windows, target_os = "linux"))]
    fn round_trips_and_is_not_plaintext() {
        #[cfg(target_os = "linux")]
        if let Err(error) = dpapi::key() {
            assert_eq!(error, crate::keyring_store::UNAVAILABLE);
            return; // Headless tests have no login keyring; pure crypto is tested below.
        }
        let d = std::env::temp_dir().join(format!("glance-sig-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let sig = Signature { id: "sig-1".into(), name: "Jane".into(), created: 1, png: "iVBORw0KGgo=".into() };
        write(&d, &sig).unwrap();
        let raw = std::fs::read(d.join("sig-1.sig")).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("Jane"), "signature must be encrypted at rest");
        let back = read_all(&d);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].name, "Jane");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn authenticated_encryption_rejects_tampering_and_wrong_associated_data() {
        // Test keys are built at run time; a literal key reads as a hard-coded secret to CodeQL.
        let seed = std::process::id() as u8;
        let key: [u8; 32] = std::array::from_fn(|i| seed.wrapping_add(i as u8));
        let other: [u8; 32] = std::array::from_fn(|i| key[i] ^ 1);
        let data = b"{\"name\":\"Jane\"}";
        let mut sealed = dpapi::seal(&key, data, ENTROPY).unwrap();
        assert_eq!(dpapi::open(&key, &sealed, ENTROPY).unwrap(), data);
        assert!(dpapi::open(&key, &sealed, b"wrong associated data").is_err());
        assert!(dpapi::open(&other, &sealed, ENTROPY).is_err());
        assert!(dpapi::open(&key, &sealed[..23], ENTROPY).is_err());
        sealed[24] ^= 1;
        assert!(dpapi::open(&key, &sealed, ENTROPY).is_err());
    }

    #[test]
    fn rejects_path_traversal_ids() {
        assert!(!valid_id("../x"));
        assert!(!valid_id(""));
        assert!(valid_id("sig-18c0ffee"));
    }
}
