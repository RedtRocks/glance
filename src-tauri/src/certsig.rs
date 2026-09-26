//! Checking certificate-based (digital) signatures in PDFs with the Windows CryptoAPI.
//!
//! The UI finds each signature in the PDF and sends its CMS/PKCS#7 blob with the bytes it
//! covers. Windows checks that the signature matches those bytes, reads the signer and any
//! trusted timestamp, and builds the signer's certificate chain against the Windows
//! certificate store, the same trust Windows applies to signed programs and email.
//! (Not to be confused with `signatures.rs`, the user's saved handwritten signatures.)

use crate::commands::{header, raw_body};
use serde::Serialize;
use tauri::ipc::Request;

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SignatureCheck {
    /// "intact": the signed bytes are unchanged. "modified": they changed after signing.
    /// "invalid": the signature itself is damaged or can't be read.
    pub integrity: &'static str,
    /// "trusted", "untrusted" (chain doesn't reach a root Windows trusts), "revoked",
    /// "expired" (the certificate wasn't valid when signed), or "unknown" (not checked).
    pub trust: &'static str,
    /// Plain-language reason when integrity or trust isn't good.
    pub detail: String,
    pub signer: String,
    pub email: String,
    pub issuer: String,
    /// Time claimed by the signer's computer (signed attribute), ms since 1970.
    pub signing_time: Option<i64>,
    /// Time vouched for by a timestamp authority, ms since 1970.
    pub timestamp: Option<i64>,
    pub timestamp_authority: String,
    /// Whether revocation (CRL/OCSP) could be checked.
    pub revocation_checked: bool,
    /// Signer certificate, DER, base64.
    pub certificate: String,
}

/// How the PDF's /SubFilter packages the signature.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// adbe.pkcs7.detached, ETSI.CAdES.detached: CMS over the signed bytes.
    Detached,
    /// adbe.pkcs7.sha1: CMS whose content is the SHA-1 of the signed bytes (the UI sends that digest).
    EmbeddedDigest,
    /// ETSI.RFC3161: a document timestamp token over the signed bytes.
    Timestamp,
}

impl Kind {
    fn parse(s: &str) -> Result<Kind, String> {
        match s {
            "detached" => Ok(Kind::Detached),
            "sha1" => Ok(Kind::EmbeddedDigest),
            "timestamp" => Ok(Kind::Timestamp),
            _ => Err(format!("unknown signature kind {s}")),
        }
    }
}

/// Body layout: CMS length (u32 little-endian), the CMS blob, then the signed data.
pub fn split_body(body: &[u8]) -> Result<(&[u8], &[u8]), String> {
    let len = body.get(..4).ok_or("signature request too short")?;
    let len = u32::from_le_bytes(len.try_into().unwrap()) as usize;
    let rest = &body[4..];
    if len == 0 || len > rest.len() {
        return Err("bad signature length".into());
    }
    Ok(rest.split_at(len))
}

/// Checks one signature. Headers: `x-kind`, optional `x-claimed-time` (the PDF's /M, ms since 1970).
#[tauri::command]
pub async fn verify_pdf_signature(request: Request<'_>) -> Result<SignatureCheck, String> {
    let kind = Kind::parse(&header(&request, "x-kind")?)?;
    let claimed: Option<i64> = header(&request, "x-claimed-time").ok().and_then(|s| s.parse().ok());
    let body = raw_body(&request)?;
    split_body(&body)?;
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let (cms, data) = split_body(&body)?;
            win::verify(kind, cms, data, claimed)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (kind, claimed);
        Err("Checking signatures uses the Windows certificate store and is only available on Windows.".into())
    }
}

/// Opens the standard Windows certificate dialog for a DER certificate (base64).
#[tauri::command]
pub async fn show_certificate(app: tauri::AppHandle, window: tauri::WebviewWindow, der: String) -> Result<(), String> {
    use base64::Engine;
    let der = base64::engine::general_purpose::STANDARD.decode(der).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (tx, rx) = std::sync::mpsc::channel();
        // A modal dialog owned by the window belongs on the window's thread.
        app.run_on_main_thread(move || {
            let _ = tx.send(win::show_certificate(hwnd, &der));
        })
        .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, window, der);
        Err("Viewing certificates is only available on Windows.".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigningCertificate {
    /// SHA-1 thumbprint, hex; identifies the certificate in the user's store.
    pub thumbprint: String,
    pub name: String,
}

/// Lets the user pick one of their certificates (Personal store) in the Windows dialog.
/// Ok(None) when they cancel.
#[tauri::command]
pub async fn pick_signing_certificate(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<SigningCertificate>, String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(win::pick_certificate(hwnd));
        })
        .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, window);
        Err("Signing with a certificate is only available on Windows.".into())
    }
}

/// Signs the body with the certificate `x-thumbprint`: a detached CMS (SHA-256) with the
/// signing time and the signer's certificate. Windows may ask for a PIN or smart card.
#[tauri::command]
pub async fn sign_with_certificate(request: Request<'_>) -> Result<tauri::ipc::Response, String> {
    let thumbprint = header(&request, "x-thumbprint")?;
    let data = raw_body(&request)?;
    #[cfg(windows)]
    {
        let cms = tauri::async_runtime::spawn_blocking(move || win::sign(&thumbprint, &data)).await.map_err(|e| e.to_string())??;
        Ok(tauri::ipc::Response::new(cms))
    }
    #[cfg(not(windows))]
    {
        let _ = (thumbprint, data);
        Err("Signing with a certificate is only available on Windows.".into())
    }
}

/// FILETIME ticks (100 ns since 1601) to ms since 1970, and back.
const EPOCH_DIFF: i64 = 116_444_736_000_000_000;
#[cfg_attr(not(windows), allow(dead_code))]
pub fn filetime_to_ms(ticks: u64) -> i64 {
    (ticks as i64 - EPOCH_DIFF) / 10_000
}
#[cfg_attr(not(windows), allow(dead_code))]
pub fn ms_to_filetime(ms: i64) -> u64 {
    (ms * 10_000 + EPOCH_DIFF) as u64
}

/// Maps a chain's CERT_TRUST_* error bits to a trust verdict, its reason, and whether
/// revocation was checked. Revocation that couldn't be checked (offline) isn't an error.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn classify_chain(errors: u32) -> (&'static str, &'static str, bool) {
    const NOT_TIME_VALID: u32 = 0x1;
    const REVOKED: u32 = 0x4;
    const NOT_SIGNATURE_VALID: u32 = 0x8;
    const UNTRUSTED_ROOT: u32 = 0x20;
    const REVOCATION_UNKNOWN: u32 = 0x40;
    const PARTIAL_CHAIN: u32 = 0x10000;
    const OFFLINE_REVOCATION: u32 = 0x100_0000;
    const EXPLICIT_DISTRUST: u32 = 0x400_0000;
    let revocation_checked = errors & (REVOCATION_UNKNOWN | OFFLINE_REVOCATION) == 0;
    let errors = errors & !(REVOCATION_UNKNOWN | OFFLINE_REVOCATION);
    let (trust, why) = if errors & (REVOKED | EXPLICIT_DISTRUST) != 0 {
        ("revoked", "The signer’s certificate has been revoked or is blocked in Windows.")
    } else if errors & (UNTRUSTED_ROOT | PARTIAL_CHAIN | NOT_SIGNATURE_VALID) != 0 {
        ("untrusted", "The signer’s certificate wasn’t issued by an authority Windows trusts, so their identity can’t be confirmed.")
    } else if errors & NOT_TIME_VALID != 0 {
        ("expired", "The signer’s certificate wasn’t valid at the time of signing.")
    } else if errors != 0 {
        ("untrusted", "Windows couldn’t verify the signer’s certificate.")
    } else {
        ("trusted", "")
    };
    (trust, why, revocation_checked)
}

#[cfg(windows)]
mod win {
    use super::*;
    use base64::Engine;
    use windows::Win32::Foundation::{CRYPT_E_HASH_VALUE, FILETIME, HWND, NTE_BAD_SIGNATURE};
    use windows::Win32::Security::Cryptography::UI::{CryptUIDlgSelectCertificateFromStore, CryptUIDlgViewContext};
    use windows::Win32::Security::Cryptography::*;

    const ENCODING: u32 = X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0;
    const SIGNING_TIME: &[u8] = b"1.2.840.113549.1.9.5";
    const TIMESTAMP_TOKEN: &[u8] = b"1.2.840.113549.1.9.16.2.14";

    /// Owned CERT_CONTEXT.
    pub(super) struct Cert(pub(super) *mut CERT_CONTEXT);
    impl Drop for Cert {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    let _ = CertFreeCertificateContext(Some(self.0));
                }
            }
        }
    }

    struct Msg(*mut core::ffi::c_void);
    impl Drop for Msg {
        fn drop(&mut self) {
            unsafe {
                let _ = CryptMsgClose(Some(self.0));
            }
        }
    }

    struct Store(HCERTSTORE);
    impl Drop for Store {
        fn drop(&mut self) {
            unsafe {
                let _ = CertCloseStore(Some(self.0), 0);
            }
        }
    }

    fn verify_para() -> CRYPT_VERIFY_MESSAGE_PARA {
        CRYPT_VERIFY_MESSAGE_PARA {
            cbSize: std::mem::size_of::<CRYPT_VERIFY_MESSAGE_PARA>() as u32,
            dwMsgAndCertEncodingType: ENCODING,
            ..Default::default()
        }
    }

    fn integrity_failure(e: &windows::core::Error) -> (&'static str, String) {
        if e.code() == CRYPT_E_HASH_VALUE {
            ("modified", "The document was changed after it was signed.".into())
        } else if e.code() == NTE_BAD_SIGNATURE {
            ("invalid", "The signature doesn’t match the signer’s certificate.".into())
        } else {
            ("invalid", format!("The signature can’t be read ({}).", e.message()))
        }
    }

    pub fn verify(kind: Kind, cms: &[u8], data: &[u8], claimed: Option<i64>) -> Result<SignatureCheck, String> {
        let mut out = SignatureCheck { integrity: "intact", trust: "unknown", ..Default::default() };
        let para = verify_para();
        let mut signer: *mut CERT_CONTEXT = std::ptr::null_mut();
        let result = unsafe {
            match kind {
                Kind::Detached => {
                    let ptrs = [data.as_ptr()];
                    let lens = [data.len() as u32];
                    CryptVerifyDetachedMessageSignature(&para, 0, cms, 1, ptrs.as_ptr(), lens.as_ptr(), Some(&mut signer))
                }
                Kind::EmbeddedDigest => {
                    let mut len = 0u32;
                    CryptVerifyMessageSignature(&para, 0, cms, None, Some(&mut len), None).and_then(|_| {
                        let mut content = vec![0u8; len as usize];
                        CryptVerifyMessageSignature(&para, 0, cms, Some(content.as_mut_ptr()), Some(&mut len), Some(&mut signer))?;
                        content.truncate(len as usize);
                        // The content is an OCTET STRING holding the digest; tolerate either form.
                        let digest = strip_octet_string(&content);
                        if digest == data {
                            Ok(())
                        } else {
                            Err(windows::core::Error::from_hresult(CRYPT_E_HASH_VALUE))
                        }
                    })
                }
                Kind::Timestamp => {
                    let mut ctx: *mut CRYPT_TIMESTAMP_CONTEXT = std::ptr::null_mut();
                    let r = CryptVerifyTimeStampSignature(cms, Some(data), None, &mut ctx, &mut signer, None);
                    if r.is_ok() && !ctx.is_null() {
                        out.timestamp = Some(filetime_ms(&(*(*ctx).pTimeStamp).ftTime));
                    }
                    if !ctx.is_null() {
                        CryptMemFree(Some(ctx as *const _));
                    }
                    // The token's own signature is fine but its imprint doesn't match: the bytes changed.
                    r.map_err(|e| {
                        if CryptVerifyMessageSignature(&para, 0, cms, None, None, None).is_ok() {
                            windows::core::Error::from_hresult(CRYPT_E_HASH_VALUE)
                        } else {
                            e
                        }
                    })
                }
            }
        };
        let signer = Cert(signer);
        if let Err(e) = result {
            let (integrity, detail) = integrity_failure(&e);
            out.integrity = integrity;
            out.detail = detail;
        }
        // The signer certificate isn't returned when verification fails; find it anyway so
        // the user can see who claims to have signed.
        let signer = if signer.0.is_null() { find_signer(cms).unwrap_or(signer) } else { signer };
        if kind != Kind::Timestamp {
            read_attributes(cms, kind == Kind::Detached, &mut out);
        }
        if signer.0.is_null() {
            if out.detail.is_empty() {
                out.detail = "The signer’s certificate isn’t included in the signature.".into();
            }
            return Ok(out);
        }
        unsafe {
            let c = &*signer.0;
            out.signer = name(signer.0, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0);
            out.email = name(signer.0, CERT_NAME_EMAIL_TYPE, 0);
            out.issuer = name(signer.0, CERT_NAME_SIMPLE_DISPLAY_TYPE, CERT_NAME_ISSUER_FLAG);
            out.certificate = base64::engine::general_purpose::STANDARD.encode(std::slice::from_raw_parts(c.pbCertEncoded, c.cbCertEncoded as usize));
        }
        if kind == Kind::Timestamp {
            out.timestamp_authority = out.signer.clone();
        }
        // Judge the certificate as of the trusted time if there is one, else the claimed time.
        let when = out.timestamp.or(out.signing_time).or(claimed);
        let (trust, why, revocation_checked) = chain_status(signer.0, cms, when)?;
        out.trust = trust;
        out.revocation_checked = revocation_checked;
        if out.detail.is_empty() {
            out.detail = why.into();
        }
        Ok(out)
    }

    /// DER OCTET STRING (short or long form length) → its contents; anything else unchanged.
    fn strip_octet_string(b: &[u8]) -> &[u8] {
        if b.len() < 2 || b[0] != 0x04 {
            return b;
        }
        let (len, off) = match b[1] {
            n if n < 0x80 => (n as usize, 2),
            0x81 if b.len() > 2 => (b[2] as usize, 3),
            _ => return b,
        };
        if off + len == b.len() { &b[off..] } else { b }
    }

    fn filetime_ms(ft: &FILETIME) -> i64 {
        filetime_to_ms(((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64)
    }

    unsafe fn name(cert: *const CERT_CONTEXT, kind: u32, flags: u32) -> String {
        let len = CertGetNameStringW(cert, kind, flags, None, None);
        if len <= 1 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize];
        let len = CertGetNameStringW(cert, kind, flags, None, Some(&mut buf));
        String::from_utf16_lossy(&buf[..len.saturating_sub(1) as usize])
    }

    fn open_msg(cms: &[u8], detached: bool) -> Option<Msg> {
        unsafe {
            let h = CryptMsgOpenToDecode(ENCODING, if detached { CMSG_DETACHED_FLAG } else { 0 }, 0, None, None, None);
            if h.is_null() {
                return None;
            }
            let msg = Msg(h);
            CryptMsgUpdate(msg.0, Some(cms), true).ok()?;
            Some(msg)
        }
    }

    /// A message parameter, in u64 storage so the structures CryptoAPI writes are aligned
    /// (pointers inside them point into the same buffer).
    struct Param {
        buf: Vec<u64>,
        len: usize,
    }
    impl Param {
        fn bytes(&self) -> &[u8] {
            unsafe { std::slice::from_raw_parts(self.buf.as_ptr().cast::<u8>(), self.len) }
        }
        fn as_ptr<T>(&self) -> *const T {
            self.buf.as_ptr().cast()
        }
    }

    fn get_param(msg: &Msg, param: u32) -> Option<Param> {
        unsafe {
            let mut len = 0u32;
            CryptMsgGetParam(msg.0, param, 0, None, &mut len).ok()?;
            let mut buf = vec![0u64; (len as usize).div_ceil(8)];
            CryptMsgGetParam(msg.0, param, 0, Some(buf.as_mut_ptr().cast()), &mut len).ok()?;
            Some(Param { buf, len: len as usize })
        }
    }

    /// Calls `f` for each (OID, first value) in the signer's signed or unsigned attributes.
    fn for_each_attr(msg: &Msg, param: u32, mut f: impl FnMut(&[u8], &[u8])) {
        let Some(p) = get_param(msg, param) else { return };
        unsafe {
            let attrs = &*p.as_ptr::<CRYPT_ATTRIBUTES>();
            for i in 0..attrs.cAttr as usize {
                let a = &*attrs.rgAttr.add(i);
                if a.cValue == 0 || a.pszObjId.is_null() {
                    continue;
                }
                let v = &*a.rgValue;
                f(a.pszObjId.as_bytes(), std::slice::from_raw_parts(v.pbData, v.cbData as usize));
            }
        }
    }

    /// Signing time (signed attribute) and signature timestamp (unsigned attribute).
    fn read_attributes(cms: &[u8], detached: bool, out: &mut SignatureCheck) {
        let Some(msg) = open_msg(cms, detached) else { return };
        for_each_attr(&msg, CMSG_SIGNER_AUTH_ATTR_PARAM, |oid, value| {
            if oid == SIGNING_TIME {
                let mut ft = FILETIME::default();
                let mut len = std::mem::size_of::<FILETIME>() as u32;
                if unsafe { CryptDecodeObject(CERT_QUERY_ENCODING_TYPE(ENCODING), PKCS_UTC_TIME, value, 0, Some((&mut ft as *mut FILETIME).cast()), &mut len) }.is_ok() {
                    out.signing_time = Some(filetime_ms(&ft));
                }
            }
        });
        let mut token: Option<Vec<u8>> = None;
        for_each_attr(&msg, CMSG_SIGNER_UNAUTH_ATTR_PARAM, |oid, value| {
            if oid == TIMESTAMP_TOKEN {
                token = Some(value.to_vec());
            }
        });
        let (Some(token), Some(digest)) = (token, get_param(&msg, CMSG_ENCRYPTED_DIGEST)) else { return };
        unsafe {
            let mut ctx: *mut CRYPT_TIMESTAMP_CONTEXT = std::ptr::null_mut();
            let mut tsa: *mut CERT_CONTEXT = std::ptr::null_mut();
            // The token stamps the signature value itself.
            if CryptVerifyTimeStampSignature(&token, Some(digest.bytes()), None, &mut ctx, &mut tsa, None).is_ok() {
                out.timestamp = Some(filetime_ms(&(*(*ctx).pTimeStamp).ftTime));
                out.timestamp_authority = name(tsa, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0);
            }
            if !ctx.is_null() {
                CryptMemFree(Some(ctx as *const _));
            }
            drop(Cert(tsa));
        }
    }

    /// The first signer's certificate, looked up among the certificates in the message.
    fn find_signer(cms: &[u8]) -> Option<Cert> {
        let msg = open_msg(cms, true).or_else(|| open_msg(cms, false))?;
        let info = get_param(&msg, CMSG_SIGNER_CERT_INFO_PARAM)?;
        unsafe {
            let store = Store(CertOpenStore(CERT_STORE_PROV_MSG, CERT_QUERY_ENCODING_TYPE(ENCODING), None, CERT_OPEN_STORE_FLAGS(0), Some(msg.0)).ok()?);
            let c = CertGetSubjectCertificateFromStore(store.0, CERT_QUERY_ENCODING_TYPE(ENCODING), info.as_ptr::<CERT_INFO>());
            (!c.is_null()).then(|| Cert(c))
        }
    }

    fn chain_status(cert: *const CERT_CONTEXT, cms: &[u8], when: Option<i64>) -> Result<(&'static str, &'static str, bool), String> {
        unsafe {
            // Intermediate certificates usually travel inside the signature.
            let blob = CRYPT_INTEGER_BLOB { cbData: cms.len() as u32, pbData: cms.as_ptr() as *mut u8 };
            let extra = CertOpenStore(CERT_STORE_PROV_PKCS7, CERT_QUERY_ENCODING_TYPE(ENCODING), None, CERT_OPEN_STORE_FLAGS(0), Some((&blob as *const CRYPT_INTEGER_BLOB).cast())).ok().map(Store);
            let para = CERT_CHAIN_PARA {
                cbSize: std::mem::size_of::<CERT_CHAIN_PARA>() as u32,
                // Don't let an unreachable CRL server hang the UI.
                dwUrlRetrievalTimeout: 8000,
                ..Default::default()
            };
            let time = when.map(|ms| {
                let t = ms_to_filetime(ms);
                FILETIME { dwLowDateTime: t as u32, dwHighDateTime: (t >> 32) as u32 }
            });
            let mut chain: *mut CERT_CHAIN_CONTEXT = std::ptr::null_mut();
            CertGetCertificateChain(
                None,
                cert,
                time.as_ref().map(|t| t as *const FILETIME),
                extra.as_ref().map(|s| s.0),
                &para,
                CERT_CHAIN_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT | CERT_CHAIN_REVOCATION_ACCUMULATIVE_TIMEOUT,
                None,
                &mut chain,
            )
            .map_err(|e| e.message())?;
            let errors = (*chain).TrustStatus.dwErrorStatus;
            CertFreeCertificateChain(chain);
            Ok(classify_chain(errors))
        }
    }

    fn personal_store() -> Result<Store, String> {
        unsafe { CertOpenSystemStoreW(None, windows::core::w!("MY")).map(Store).map_err(|e| e.message()) }
    }

    unsafe fn has_private_key(cert: *const CERT_CONTEXT) -> bool {
        let mut len = 0u32;
        CertGetCertificateContextProperty(cert, CERT_KEY_PROV_INFO_PROP_ID, None, &mut len).is_ok()
    }

    pub fn pick_certificate(hwnd: isize) -> Result<Option<SigningCertificate>, String> {
        let store = personal_store()?;
        unsafe {
            let c = CryptUIDlgSelectCertificateFromStore(
                store.0,
                Some(HWND(hwnd as _)),
                windows::core::w!("Sign with a Certificate"),
                windows::core::w!("Choose the certificate to sign this document with."),
                0,
                0,
                std::ptr::null(),
            );
            if c.is_null() {
                return Ok(None);
            }
            let cert = Cert(c);
            if !has_private_key(cert.0) {
                return Err("This certificate can’t sign: Windows doesn’t have its private key.".into());
            }
            let mut hash = [0u8; 20];
            let mut len = hash.len() as u32;
            CertGetCertificateContextProperty(cert.0, CERT_HASH_PROP_ID, Some(hash.as_mut_ptr().cast()), &mut len).map_err(|e| e.message())?;
            let thumbprint = hash[..len as usize].iter().map(|b| format!("{b:02x}")).collect();
            Ok(Some(SigningCertificate { thumbprint, name: name(cert.0, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0) }))
        }
    }

    pub fn sign(thumbprint: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        let hash: Vec<u8> = (0..thumbprint.len() / 2).filter_map(|i| u8::from_str_radix(thumbprint.get(i * 2..i * 2 + 2)?, 16).ok()).collect();
        if hash.len() != 20 {
            return Err("bad certificate thumbprint".into());
        }
        let store = personal_store()?;
        unsafe {
            let blob = CRYPT_INTEGER_BLOB { cbData: 20, pbData: hash.as_ptr() as *mut u8 };
            let c = CertFindCertificateInStore(store.0, CERT_QUERY_ENCODING_TYPE(ENCODING), 0, CERT_FIND_SHA1_HASH, Some((&blob as *const CRYPT_INTEGER_BLOB).cast()), None);
            if c.is_null() {
                return Err("The certificate is no longer in your certificate store.".into());
            }
            sign_with(&Cert(c), data)
        }
    }

    pub(super) fn sign_with(cert: &Cert, data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            // Signed attribute: signing time, now.
            let now = ms_to_filetime(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as i64);
            let ft = FILETIME { dwLowDateTime: now as u32, dwHighDateTime: (now >> 32) as u32 };
            let mut len = 0u32;
            CryptEncodeObject(CERT_QUERY_ENCODING_TYPE(ENCODING), PKCS_UTC_TIME, (&ft as *const FILETIME).cast(), None, &mut len).map_err(|e| e.message())?;
            let mut time = vec![0u8; len as usize];
            CryptEncodeObject(CERT_QUERY_ENCODING_TYPE(ENCODING), PKCS_UTC_TIME, (&ft as *const FILETIME).cast(), Some(time.as_mut_ptr()), &mut len).map_err(|e| e.message())?;
            let mut value = CRYPT_INTEGER_BLOB { cbData: len, pbData: time.as_mut_ptr() };
            let mut attr = CRYPT_ATTRIBUTE { pszObjId: windows::core::PSTR(szOID_RSA_signingTime.0 as *mut u8), cValue: 1, rgValue: &mut value };
            let mut certs = [cert.0];
            let para = CRYPT_SIGN_MESSAGE_PARA {
                cbSize: std::mem::size_of::<CRYPT_SIGN_MESSAGE_PARA>() as u32,
                dwMsgEncodingType: ENCODING,
                pSigningCert: cert.0,
                HashAlgorithm: CRYPT_ALGORITHM_IDENTIFIER { pszObjId: windows::core::PSTR(szOID_NIST_sha256.0 as *mut u8), ..Default::default() },
                cMsgCert: 1,
                rgpMsgCert: certs.as_mut_ptr(),
                cAuthAttr: 1,
                rgAuthAttr: &mut attr,
                ..Default::default()
            };
            let ptrs = [data.as_ptr()];
            let lens = [data.len() as u32];
            let mut size = 0u32;
            CryptSignMessage(&para, true, 1, Some(ptrs.as_ptr()), lens.as_ptr(), None, &mut size).map_err(|e| e.message())?;
            let mut out = vec![0u8; size as usize];
            CryptSignMessage(&para, true, 1, Some(ptrs.as_ptr()), lens.as_ptr(), Some(out.as_mut_ptr()), &mut size).map_err(|e| e.message())?;
            out.truncate(size as usize);
            Ok(out)
        }
    }

    pub fn show_certificate(hwnd: isize, der: &[u8]) -> Result<(), String> {
        unsafe {
            let c = CertCreateCertificateContext(CERT_QUERY_ENCODING_TYPE(ENCODING), der);
            if c.is_null() {
                return Err(windows::core::Error::from_thread().message());
            }
            let cert = Cert(c);
            let _ = CryptUIDlgViewContext(CERT_STORE_CERTIFICATE_CONTEXT, cert.0 as *const _, Some(HWND(hwnd as _)), windows::core::w!("Certificate"), 0, std::ptr::null());
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_body() {
        let mut body = 3u32.to_le_bytes().to_vec();
        body.extend_from_slice(b"abcdef");
        assert_eq!(split_body(&body).unwrap(), (&b"abc"[..], &b"def"[..]));
        assert!(split_body(&[9, 0, 0, 0, 1]).is_err());
        assert!(split_body(&[0, 0, 0, 0]).is_err());
    }

    #[test]
    fn filetime_round_trip() {
        assert_eq!(filetime_to_ms(116_444_736_000_000_000), 0);
        assert_eq!(filetime_to_ms(ms_to_filetime(1_700_000_000_123)), 1_700_000_000_123);
    }

    #[test]
    fn chain_classification() {
        assert_eq!(classify_chain(0), ("trusted", "", true));
        // Offline revocation alone still counts as trusted.
        assert_eq!(classify_chain(0x40 | 0x100_0000).0, "trusted");
        assert!(!classify_chain(0x40).2);
        assert_eq!(classify_chain(0x20).0, "untrusted");
        assert_eq!(classify_chain(0x4 | 0x20).0, "revoked");
        assert_eq!(classify_chain(0x1).0, "expired");
    }
}

/// Real CryptoAPI checks against OpenSSL-made fixtures (tests/signatures/make-fixtures.ts).
#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    const DATA: &[u8] = include_bytes!("../testdata/data.bin");
    const DETACHED: &[u8] = include_bytes!("../testdata/detached.p7s");
    const EMBEDDED_SHA1: &[u8] = include_bytes!("../testdata/embedded-sha1.p7s");

    #[test]
    fn detached_signature_is_intact_but_self_signed() {
        let r = win::verify(Kind::Detached, DETACHED, DATA, None).unwrap();
        assert_eq!(r.integrity, "intact", "{r:?}");
        assert_eq!(r.trust, "untrusted", "{r:?}");
        assert_eq!(r.signer, "Glance Test Signer");
        assert_eq!(r.email, "test@example.com");
        assert!(r.signing_time.is_some());
        assert!(!r.certificate.is_empty());
    }

    #[test]
    fn changed_bytes_are_detected() {
        let mut data = DATA.to_vec();
        data[0] ^= 1;
        let r = win::verify(Kind::Detached, DETACHED, &data, None).unwrap();
        assert_eq!(r.integrity, "modified", "{r:?}");
        // Still says who signed.
        assert_eq!(r.signer, "Glance Test Signer");
    }

    #[test]
    fn embedded_sha1_digest() {
        use windows::Win32::Security::Cryptography::{BCryptHash, BCRYPT_SHA1_ALG_HANDLE};
        let mut digest = [0u8; 20];
        unsafe { BCryptHash(BCRYPT_SHA1_ALG_HANDLE, None, DATA, &mut digest).ok().unwrap() };
        let r = win::verify(Kind::EmbeddedDigest, EMBEDDED_SHA1, &digest, None).unwrap();
        assert_eq!(r.integrity, "intact", "{r:?}");
        digest[0] ^= 1;
        let r = win::verify(Kind::EmbeddedDigest, EMBEDDED_SHA1, &digest, None).unwrap();
        assert_eq!(r.integrity, "modified", "{r:?}");
    }

    #[test]
    fn signs_and_verifies_round_trip() {
        use windows::Win32::Security::Cryptography::*;
        unsafe {
            let mut len = 0u32;
            let enc = CERT_QUERY_ENCODING_TYPE(X509_ASN_ENCODING.0);
            CertStrToNameW(enc, windows::core::w!("CN=Glance Round Trip"), CERT_X500_NAME_STR, None, None, &mut len, None).unwrap();
            let mut name = vec![0u8; len as usize];
            CertStrToNameW(enc, windows::core::w!("CN=Glance Round Trip"), CERT_X500_NAME_STR, None, Some(name.as_mut_ptr()), &mut len, None).unwrap();
            let blob = CRYPT_INTEGER_BLOB { cbData: len, pbData: name.as_mut_ptr() };
            let c = CertCreateSelfSignCertificate(None, &blob, CERT_CREATE_SELFSIGN_FLAGS(0), None, None, None, None, None);
            assert!(!c.is_null(), "{}", windows::core::Error::from_thread().message());
            let cms = win::sign_with(&win::Cert(c), DATA).unwrap();
            let r = win::verify(Kind::Detached, &cms, DATA, None).unwrap();
            assert_eq!(r.integrity, "intact", "{r:?}");
            assert_eq!(r.signer, "Glance Round Trip");
            assert!(r.signing_time.is_some());
        }
    }

    #[test]
    fn garbage_is_invalid() {
        let r = win::verify(Kind::Detached, &[0x30, 0x03, 0x02, 0x01, 0x07], DATA, None).unwrap();
        assert_eq!(r.integrity, "invalid", "{r:?}");
    }
}
