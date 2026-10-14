//! Comic book archives (.cbz): a zip of images shown as pages.

use std::io::{Read, Seek};
use std::path::Path;

/// Largest page read without asking; real comic pages are a few MB.
pub const MAX_PAGE_BYTES: u64 = 256 * 1024 * 1024;
/// The error for a bigger page; the viewer warns and offers to open it anyway.
pub const TOO_LARGE: &str = "page-too-large";

fn is_image_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !lower.starts_with("__macosx/")
        && [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif", ".jxl"]
            .iter()
            .any(|e| lower.ends_with(e))
}

/// Natural sort so "page2" comes before "page10".
fn natural_key(s: &str) -> Vec<(bool, u64, String)> {
    let mut out = Vec::new();
    let mut num = String::new();
    let mut text = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() {
            if !text.is_empty() {
                out.push((false, 0, std::mem::take(&mut text).to_lowercase()));
            }
            num.push(c);
        } else {
            if !num.is_empty() {
                out.push((true, num.parse().unwrap_or(u64::MAX), String::new()));
                num.clear();
            }
            text.push(c);
        }
    }
    if !num.is_empty() {
        out.push((true, num.parse().unwrap_or(u64::MAX), String::new()));
    }
    if !text.is_empty() {
        out.push((false, 0, text.to_lowercase()));
    }
    out
}

pub fn page_names(path: &Path) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    page_names_in(file)
}

/// Reads one page; `limit` refuses pages bigger than that many bytes (None reads any size).
pub fn read_page(path: &Path, page: usize, limit: Option<u64>) -> Result<(String, Vec<u8>), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    read_page_in(file, page, limit)
}

/// Image entries of a zip, in reading order. Takes any reader, so the browser
/// version (web/decoder) can pass the file's bytes.
pub fn page_names_in<R: Read + Seek>(reader: R) -> Result<Vec<String>, String> {
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    Ok(sorted_pages(&mut zip))
}

pub fn read_page_in<R: Read + Seek>(reader: R, page: usize, limit: Option<u64>) -> Result<(String, Vec<u8>), String> {
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    let name = sorted_pages(&mut zip).get(page).ok_or("page out of range")?.clone();
    let entry = zip.by_name(&name).map_err(|e| e.to_string())?;
    // The size in the zip is the file's own claim; a tiny file can claim terabytes or
    // inflate to gigabytes, which would take the app (or Explorer's thumbnailer) down.
    let max = limit.unwrap_or(u64::MAX);
    if entry.size() > max {
        return Err(TOO_LARGE.into());
    }
    // Never reserve more than the limit up front, even when reading any size.
    let mut buf = Vec::with_capacity(entry.size().min(MAX_PAGE_BYTES) as usize);
    entry.take(max.saturating_add(1)).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    if buf.len() as u64 > max {
        return Err(TOO_LARGE.into());
    }
    Ok((name, buf))
}

fn sorted_pages<R: Read + Seek>(zip: &mut zip::ZipArchive<R>) -> Vec<String> {
    let mut names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .filter(|n| is_image_name(n))
        .collect();
    names.sort_by_cached_key(|n| natural_key(n));
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order() {
        let mut v = vec!["p10.jpg", "p2.jpg", "p1.jpg"];
        v.sort_by_cached_key(|n| natural_key(n));
        assert_eq!(v, ["p1.jpg", "p2.jpg", "p10.jpg"]);
    }

    #[test]
    fn reads_pages_from_zip() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("glance-cbz-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("book.cbz");
        {
            let f = std::fs::File::create(&path).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            for (n, body) in [("10.png", b"ten".as_slice()), ("2.png", b"two"), ("notes.txt", b"x")] {
                z.start_file(n, opts).unwrap();
                z.write_all(body).unwrap();
            }
            z.finish().unwrap();
        }
        assert_eq!(page_names(&path).unwrap(), ["2.png", "10.png"]);
        assert_eq!(read_page(&path, 1, Some(MAX_PAGE_BYTES)).unwrap().1, b"ten");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_a_page_bigger_than_the_limit() {
        use std::io::Write;
        let mut z = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(true);
        z.start_file("bomb.png", opts).unwrap();
        let zeros = vec![0u8; 1024 * 1024];
        for _ in 0..(MAX_PAGE_BYTES / zeros.len() as u64 + 1) {
            z.write_all(&zeros).unwrap();
        }
        let file = z.finish().unwrap();
        assert!(file.get_ref().len() < 2 * 1024 * 1024);
        assert_eq!(read_page_in(file.clone(), 0, Some(MAX_PAGE_BYTES)).unwrap_err(), TOO_LARGE);
        // After the warning, the user can still open it.
        assert_eq!(read_page_in(file, 0, None).unwrap().1.len() as u64, (MAX_PAGE_BYTES / (1024 * 1024) + 1) * 1024 * 1024);
    }
}
