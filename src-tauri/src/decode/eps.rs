//! PostScript and EPS.
//!
//! Ghostscript is AGPL, so it is never bundled (see ADR 0010). If the user has it
//! installed we run it as a separate program to convert to PDF, which keeps vectors
//! sharp. Otherwise we fall back to the TIFF preview embedded in DOS-EPS files.

#[cfg(not(target_arch = "wasm32"))]
use std::path::{Path, PathBuf};
#[cfg(not(target_arch = "wasm32"))]
use std::process::Command;

/// Locates `gswin64c.exe` / `gswin32c.exe` / `gs` on PATH or in the default install dirs.
#[cfg(not(target_arch = "wasm32"))] // no programs to run in the browser version
pub fn find_ghostscript() -> Option<PathBuf> {
    for name in ["gswin64c", "gswin32c", "gs"] {
        if let Ok(p) = which::which(name) {
            return Some(p);
        }
    }
    #[cfg(windows)]
    for root in [r"C:\Program Files\gs", r"C:\Program Files (x86)\gs"] {
        if let Ok(entries) = std::fs::read_dir(root) {
            let mut dirs: Vec<_> = entries.flatten().map(|e| e.path()).collect();
            dirs.sort();
            for dir in dirs.into_iter().rev() {
                for exe in ["gswin64c.exe", "gswin32c.exe"] {
                    let p = dir.join("bin").join(exe);
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}

/// Converts PS/EPS to PDF with Ghostscript. EPS pages are cropped to the bounding box.
#[cfg(not(target_arch = "wasm32"))]
pub fn to_pdf(gs: &Path, input: &Path, output: &Path) -> Result<(), String> {
    let mut cmd = Command::new(gs);
    cmd.args(["-dSAFER", "-dBATCH", "-dNOPAUSE", "-dQUIET", "-sDEVICE=pdfwrite", "-dEPSCrop"])
        .arg(format!("-sOutputFile={}", output.display()))
        .arg(input);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() && output.exists() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

/// Returns the embedded TIFF preview of a DOS-EPS binary file, if present.
pub fn embedded_tiff_preview(data: &[u8]) -> Option<&[u8]> {
    if !data.starts_with(&[0xC5, 0xD0, 0xD3, 0xC6]) || data.len() < 30 {
        return None;
    }
    let rd = |o: usize| u32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]) as usize;
    let (start, len) = (rd(20), rd(24));
    if start == 0 || len == 0 {
        return None;
    }
    data.get(start..start.checked_add(len)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_dos_eps_tiff_preview() {
        let tiff = b"II*\0fake-tiff";
        let ps = b"%!PS-Adobe-3.0 EPSF-3.0\n";
        let mut f = vec![0xC5, 0xD0, 0xD3, 0xC6];
        let ps_start = 30u32;
        let tiff_start = ps_start + ps.len() as u32;
        for v in [ps_start, ps.len() as u32, 0, 0, tiff_start, tiff.len() as u32] {
            f.extend_from_slice(&v.to_le_bytes());
        }
        f.extend_from_slice(&[0xFF, 0xFF]); // checksum
        f.extend_from_slice(ps);
        f.extend_from_slice(tiff);
        assert_eq!(embedded_tiff_preview(&f), Some(&tiff[..]));
        assert_eq!(embedded_tiff_preview(b"%!PS"), None);
    }
}
