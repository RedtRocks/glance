//! Camera RAW fallback: extract the largest embedded JPEG preview.
//!
//! Every mainstream RAW format (CR2, CR3, NEF, ARW, RAF, ORF, RW2, DNG, PEF, …)
//! embeds a full- or near-full-size JPEG rendered by the camera. When Windows has no
//! RAW codec installed we show that instead of refusing to open the file.

/// Returns the byte range of the largest well-formed baseline/progressive JPEG.
pub fn largest_embedded_jpeg(data: &[u8]) -> Option<&[u8]> {
    let mut best: Option<&[u8]> = None;
    let mut i = 0;
    while i + 3 < data.len() {
        if data[i] == 0xFF && data[i + 1] == 0xD8 && data[i + 2] == 0xFF {
            if let Some(len) = jpeg_length(&data[i..]) {
                let candidate = &data[i..i + len];
                if best.map_or(true, |b| candidate.len() > b.len()) && has_frame(candidate) {
                    best = Some(candidate);
                }
                i += len;
                continue;
            }
        }
        i += 1;
    }
    best
}

/// Walks JPEG markers from SOI and returns the total length up to and including EOI.
fn jpeg_length(d: &[u8]) -> Option<usize> {
    let mut p = 2;
    loop {
        // Skip fill bytes.
        while p < d.len() && d[p] == 0xFF && d.get(p + 1) == Some(&0xFF) {
            p += 1;
        }
        if p + 1 >= d.len() || d[p] != 0xFF {
            return None;
        }
        let marker = d[p + 1];
        p += 2;
        match marker {
            0xD9 => return Some(p),
            0x01 | 0xD0..=0xD7 => continue,
            _ => {}
        }
        if p + 1 >= d.len() {
            return None;
        }
        let seg = u16::from_be_bytes([d[p], d[p + 1]]) as usize;
        if seg < 2 {
            return None;
        }
        p += seg;
        if marker == 0xDA {
            // Entropy-coded data: scan to the next marker that is not RST or stuffing.
            while p + 1 < d.len() {
                if d[p] == 0xFF {
                    let n = d[p + 1];
                    if n == 0x00 || (0xD0..=0xD7).contains(&n) || n == 0xFF {
                        p += if n == 0xFF { 1 } else { 2 };
                        continue;
                    }
                    break;
                }
                p += 1;
            }
        }
    }
}

/// Lossless-JPEG streams (used for raw sensor data in CR2/DNG) use SOF3; skip those.
fn has_frame(j: &[u8]) -> bool {
    let mut p = 2;
    while p + 4 < j.len() {
        if j[p] != 0xFF {
            return false;
        }
        let m = j[p + 1];
        if matches!(m, 0xC0 | 0xC1 | 0xC2) {
            return true;
        }
        if matches!(m, 0xC3 | 0xDA | 0xD9) {
            return false;
        }
        let seg = u16::from_be_bytes([j[p + 2], j[p + 3]]) as usize;
        p += 2 + seg;
    }
    false
}

/// Reads the EXIF/TIFF Orientation tag (274) from IFD0 of a TIFF-based RAW file.
pub fn tiff_orientation(data: &[u8]) -> Option<u8> {
    let le = match data.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |o: usize| -> Option<u16> {
        let b = data.get(o..o + 2)?;
        Some(if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
    };
    let u32_at = |o: usize| -> Option<u32> {
        let b = data.get(o..o + 4)?;
        let a = [b[0], b[1], b[2], b[3]];
        Some(if le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) })
    };
    let ifd = u32_at(4)? as usize;
    let count = u16_at(ifd)? as usize;
    for n in 0..count.min(512) {
        let e = ifd + 2 + n * 12;
        if u16_at(e)? == 274 {
            let v = u16_at(e + 8)?;
            return (1..=8).contains(&v).then_some(v as u8);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_jpeg(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([200, 100, 50]));
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
            .encode_image(&img)
            .unwrap();
        out
    }

    #[test]
    fn picks_the_largest_preview_among_noise() {
        let small = tiny_jpeg(8, 8);
        let big = tiny_jpeg(64, 48);
        let mut file = b"II*\0garbage-raw-header".to_vec();
        file.extend_from_slice(&small);
        file.extend_from_slice(&[0x12, 0xFF, 0xD8, 0x00, 0x55]); // false SOI
        file.extend_from_slice(&big);
        file.extend_from_slice(b"sensor data follows");
        let found = largest_embedded_jpeg(&file).expect("found");
        assert_eq!(found, big.as_slice());
        let img = image::load_from_memory(found).unwrap();
        assert_eq!((img.width(), img.height()), (64, 48));
    }

    #[test]
    fn reads_orientation_from_ifd0() {
        // Little-endian TIFF, IFD0 at 8 with one entry: Orientation = 6.
        let mut t = b"II*\0".to_vec();
        t.extend_from_slice(&8u32.to_le_bytes());
        t.extend_from_slice(&1u16.to_le_bytes());
        t.extend_from_slice(&274u16.to_le_bytes());
        t.extend_from_slice(&3u16.to_le_bytes());
        t.extend_from_slice(&1u32.to_le_bytes());
        t.extend_from_slice(&6u16.to_le_bytes());
        t.extend_from_slice(&[0, 0]);
        assert_eq!(tiff_orientation(&t), Some(6));
        assert_eq!(tiff_orientation(b"nope"), None);
    }
}
