//! File classification. Kept in sync with `docs/FORMATS.md`.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Pdf,
    Image,
    Model,
    Postscript,
    Xps,
    Archive,
    Preview,
    Unsupported,
}

/// Formats WebView2 decodes itself; served as raw bytes, never re-encoded.
pub const BROWSER_IMAGES: &[&str] = &[
    "jpg", "jpeg", "jfif", "pjpeg", "png", "apng", "gif", "webp", "bmp", "dib", "ico", "cur", "svg", "avif",
];

/// Formats that need the backend decoder (WIC first, then Rust fallbacks).
pub const BACKEND_IMAGES: &[&str] = &[
    "tif", "tiff", "heic", "heif", "hif", "jp2", "j2k", "jpf", "jpx", "j2c", "jxl", "jxr", "wdp", "hdp",
    "exr", "hdr", "tga", "dds", "qoi", "ppm", "pgm", "pbm", "pam", "pnm", "icns", "psd", "psb",
];

pub const RAW_IMAGES: &[&str] = &[
    "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "raf", "orf", "rw2", "raw", "dng", "pef", "srw",
    "x3f", "erf", "mef", "mos", "mrw", "kdc", "dcr", "3fr", "fff", "iiq", "rwl", "gpr",
];

pub const MODELS: &[&str] = &[
    "glb", "gltf", "obj", "stl", "ply", "fbx", "usdz", "usda", "usdc", "dae", "3mf", "3ds",
];

/// Files the frontend previews itself as HTML (src/preview/): Office files, text and
/// code, Markdown, video and audio, e-books, fonts and email. Same list as src/core/previews.ts.
pub const PREVIEWS: &[&str] = &[
    "docx", "docm", "dotx", "dotm", "pptx", "pptm", "ppsx", "ppsm", "potx", "potm", "xlsx", "xlsm", "xltx",
    "xltm", "csv", "tsv", "md", "markdown", "mdown", "mkd", "txt", "text", "log", "nfo", "ini", "cfg", "conf",
    "env", "properties", "toml", "yaml", "yml", "json", "jsonc", "json5", "xml", "plist", "html", "htm",
    "css", "scss", "less", "js", "mjs", "cjs", "ts", "tsx", "jsx", "vue", "svelte", "py", "rb", "php", "pl",
    "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cpp", "cc", "cxx", "hpp", "cs", "fs", "vb", "lua",
    "r", "dart", "scala", "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd", "sql", "graphql", "gql",
    "proto", "tex", "bib", "srt", "vtt", "diff", "patch", "gitignore", "dockerfile", "makefile", "cmake",
    "gradle", "mp4", "m4v", "webm", "mov", "ogv", "mkv", "mp3", "m4a", "aac", "wav", "oga", "ogg", "opus",
    "flac", "weba", "epub", "ttf", "otf", "woff", "woff2", "eml", "msg",
];

pub fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Classifies by magic bytes first (files are often misnamed), then by extension.
pub fn classify(path: &Path, head: &[u8]) -> Kind {
    if head.starts_with(b"%PDF") {
        return Kind::Pdf; // includes PDF-compatible .ai files
    }
    if head.starts_with(b"%!PS") || head.starts_with(&[0xC5, 0xD0, 0xD3, 0xC6]) {
        return Kind::Postscript;
    }
    let ext = extension(path);
    let e = ext.as_str();
    match e {
        "pdf" | "ai" => Kind::Pdf,
        "ps" | "eps" | "epsf" | "epsi" => Kind::Postscript,
        "xps" | "oxps" => Kind::Xps,
        "cbz" => Kind::Archive,
        _ if PREVIEWS.contains(&e) => Kind::Preview,
        _ if BROWSER_IMAGES.contains(&e) || BACKEND_IMAGES.contains(&e) || RAW_IMAGES.contains(&e) => {
            Kind::Image
        }
        _ if MODELS.contains(&e) => Kind::Model,
        _ => {
            // Unknown extension: let the image crate sniff it.
            if image::guess_format(head).is_ok() {
                Kind::Image
            } else {
                Kind::Unsupported
            }
        }
    }
}

pub fn is_browser_native(path: &Path) -> bool {
    BROWSER_IMAGES.contains(&extension(path).as_str())
}

pub fn mime_for(path: &Path) -> &'static str {
    match extension(path).as_str() {
        "pdf" | "ai" => "application/pdf",
        "jpg" | "jpeg" | "jfif" | "pjpeg" => "image/jpeg",
        "png" | "apng" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" | "dib" => "image/bmp",
        "ico" | "cur" => "image/x-icon",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "gltf" => "model/gltf+json",
        "glb" => "model/gltf-binary",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn magic_wins_over_extension() {
        assert_eq!(classify(Path::new("drawing.ai"), b"%PDF-1.6"), Kind::Pdf);
        assert_eq!(classify(Path::new("misnamed.png"), b"%PDF-1.4"), Kind::Pdf);
        assert_eq!(classify(Path::new("x.eps"), &[0xC5, 0xD0, 0xD3, 0xC6]), Kind::Postscript);
    }

    #[test]
    fn extensions_map_to_kinds() {
        assert_eq!(classify(Path::new("a.CR3"), b""), Kind::Image);
        assert_eq!(classify(Path::new("a.heic"), b""), Kind::Image);
        assert_eq!(classify(Path::new("a.usdz"), b""), Kind::Model);
        // Office files are zip archives; the extension decides.
        assert_eq!(classify(Path::new("Plan.docx"), b"PK\x03\x04"), Kind::Preview);
        assert_eq!(classify(Path::new("Deck.PPTX"), b"PK\x03\x04"), Kind::Preview);
        assert_eq!(classify(Path::new("a.oxps"), b""), Kind::Xps);
        assert_eq!(classify(Path::new("a.cbz"), b""), Kind::Archive);
        assert_eq!(classify(Path::new("a.xyz"), b"nothing"), Kind::Unsupported);
        assert_eq!(classify(Path::new("noext"), b"\x89PNG\r\n\x1a\n"), Kind::Image);
    }
}
