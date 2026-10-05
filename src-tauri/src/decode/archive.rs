//! Comic book archives (.cbz): a zip of images shown as pages.

use std::io::{Read, Seek};
use std::path::Path;

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

pub fn read_page(path: &Path, page: usize) -> Result<(String, Vec<u8>), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    read_page_in(file, page)
}

/// Image entries of a zip, in reading order. Takes any reader, so the browser
/// version (web/decoder) can pass the file's bytes.
pub fn page_names_in<R: Read + Seek>(reader: R) -> Result<Vec<String>, String> {
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    Ok(sorted_pages(&mut zip))
}

pub fn read_page_in<R: Read + Seek>(reader: R, page: usize) -> Result<(String, Vec<u8>), String> {
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    let name = sorted_pages(&mut zip).get(page).ok_or("page out of range")?.clone();
    let mut entry = zip.by_name(&name).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
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
        assert_eq!(read_page(&path, 1).unwrap().1, b"ten");
        std::fs::remove_dir_all(&dir).ok();
    }
}
