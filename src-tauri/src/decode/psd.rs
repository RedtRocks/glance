//! Photoshop (PSD/PSB) composite reader.
//!
//! Photoshop stores a flattened copy of the whole document after the layer data (the
//! "Image Data" section, present when "Maximize compatibility" is on, which is the
//! default). That is all a viewer needs, so we read just that section instead of
//! parsing layers.

use super::Decoded;

struct Reader<'a> {
    d: &'a [u8],
    p: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.p.checked_add(n).filter(|&e| e <= self.d.len()).ok_or("truncated PSD file")?;
        let s = &self.d[self.p..end];
        self.p = end;
        Ok(s)
    }
    fn u16(&mut self) -> Result<u16, String> {
        let b = self.take(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }
    fn u32(&mut self) -> Result<u32, String> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn u64(&mut self) -> Result<u64, String> {
        let b = self.take(8)?;
        Ok(u64::from_be_bytes(b.try_into().unwrap()))
    }
    fn skip_section(&mut self, wide: bool) -> Result<(), String> {
        let len = if wide { self.u64()? as usize } else { self.u32()? as usize };
        self.take(len).map(|_| ())
    }
}

/// PackBits decompression of one scanline into `out`.
fn unpack_bits(src: &[u8], out: &mut [u8]) -> Result<(), String> {
    let (mut i, mut o) = (0, 0);
    while o < out.len() && i < src.len() {
        let n = src[i] as i8;
        i += 1;
        if n >= 0 {
            let len = n as usize + 1;
            let chunk = src.get(i..i + len).ok_or("bad RLE data")?;
            let dst = out.get_mut(o..o + len).ok_or("bad RLE data")?;
            dst.copy_from_slice(chunk);
            i += len;
            o += len;
        } else if n != -128 {
            let len = (1 - n as isize) as usize;
            let v = *src.get(i).ok_or("bad RLE data")?;
            out.get_mut(o..o + len).ok_or("bad RLE data")?.fill(v);
            i += 1;
            o += len;
        }
    }
    if o == out.len() { Ok(()) } else { Err("bad RLE data".into()) }
}

pub fn decode(data: &[u8]) -> Result<Decoded, String> {
    let mut r = Reader { d: data, p: 0 };
    if r.take(4)? != b"8BPS" {
        return Err("not a Photoshop file".into());
    }
    let version = r.u16()?;
    let wide = version == 2; // PSB
    r.take(6)?;
    let channels = r.u16()? as usize;
    let height = r.u32()? as usize;
    let width = r.u32()? as usize;
    let depth = r.u16()?;
    let mode = r.u16()?;
    if width == 0 || height == 0 || width * height > 400_000_000 {
        return Err("unsupported image size".into());
    }
    if depth != 8 && depth != 16 {
        return Err(format!("{depth}-bit Photoshop files are not supported yet"));
    }
    let base = match mode {
        1 | 8 => 1, // grayscale, duotone (shown as grayscale)
        3 => 3,     // RGB
        4 => 4,     // CMYK
        _ => return Err("this Photoshop color mode is not supported yet".into()),
    };
    if channels < base {
        return Err("corrupt channel count".into());
    }
    r.skip_section(false)?; // color mode data
    r.skip_section(false)?; // image resources
    r.skip_section(wide)?; // layer and mask info

    let compression = r.u16()?;
    let bps = (depth / 8) as usize;
    let row_bytes = width * bps;
    let used = (base + usize::from(channels > base)).min(channels);
    let mut planes = vec![vec![0u8; row_bytes * height]; used];

    match compression {
        0 => {
            for plane in planes.iter_mut() {
                plane.copy_from_slice(r.take(row_bytes * height)?);
            }
        }
        1 => {
            let mut counts = Vec::with_capacity(channels * height);
            for _ in 0..channels * height {
                counts.push(if wide { r.u32()? as usize } else { r.u16()? as usize });
            }
            for c in 0..channels {
                for y in 0..height {
                    let src = r.take(counts[c * height + y])?;
                    if let Some(plane) = planes.get_mut(c) {
                        unpack_bits(src, &mut plane[y * row_bytes..(y + 1) * row_bytes])?;
                    }
                }
            }
        }
        _ => return Err("this Photoshop compression is not supported yet".into()),
    }

    // Take the high byte of 16-bit samples.
    let sample = |plane: &[u8], i: usize| plane[i * bps];
    let mut rgba = vec![255u8; width * height * 4];
    for i in 0..width * height {
        let px = &mut rgba[i * 4..i * 4 + 4];
        match base {
            1 => {
                let g = sample(&planes[0], i);
                px[..3].fill(g);
            }
            3 => {
                for c in 0..3 {
                    px[c] = sample(&planes[c], i);
                }
            }
            _ => {
                // Photoshop stores CMYK inverted (255 = no ink); naive conversion.
                let k = sample(&planes[3], i) as u32;
                for c in 0..3 {
                    px[c] = ((sample(&planes[c], i) as u32 * k) / 255) as u8;
                }
            }
        }
        if used > base {
            px[3] = sample(&planes[base], i);
        }
    }
    Ok(Decoded { width: width as u32, height: height as u32, rgba })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn psd(width: u32, height: u32, channels: u16, rle: bool, planes: &[Vec<u8>]) -> Vec<u8> {
        let mut f = b"8BPS".to_vec();
        f.extend_from_slice(&1u16.to_be_bytes());
        f.extend_from_slice(&[0; 6]);
        f.extend_from_slice(&channels.to_be_bytes());
        f.extend_from_slice(&height.to_be_bytes());
        f.extend_from_slice(&width.to_be_bytes());
        f.extend_from_slice(&8u16.to_be_bytes());
        f.extend_from_slice(&3u16.to_be_bytes());
        for _ in 0..3 {
            f.extend_from_slice(&0u32.to_be_bytes());
        }
        if rle {
            f.extend_from_slice(&1u16.to_be_bytes());
            // Each row: one "repeat" run covering the full width.
            let run = |v: u8| vec![(1 - width as i32) as i8 as u8, v];
            for _ in 0..channels as u32 * height {
                f.extend_from_slice(&2u16.to_be_bytes());
            }
            for p in planes {
                for y in 0..height as usize {
                    f.extend(run(p[y * width as usize]));
                }
            }
        } else {
            f.extend_from_slice(&0u16.to_be_bytes());
            for p in planes {
                f.extend_from_slice(p);
            }
        }
        f
    }

    #[test]
    fn reads_raw_rgb_composite() {
        let planes = vec![vec![10, 20], vec![30, 40], vec![50, 60]];
        let d = decode(&psd(2, 1, 3, false, &planes)).unwrap();
        assert_eq!(d.rgba, vec![10, 30, 50, 255, 20, 40, 60, 255]);
    }

    #[test]
    fn reads_rle_rgba_composite() {
        let planes = vec![vec![1; 4], vec![2; 4], vec![3; 4], vec![128; 4]];
        let d = decode(&psd(2, 2, 4, true, &planes)).unwrap();
        assert_eq!((d.width, d.height), (2, 2));
        assert_eq!(&d.rgba[0..4], &[1, 2, 3, 128]);
    }

    #[test]
    fn rejects_garbage_without_panicking() {
        assert!(decode(b"8BPS\0\x01").is_err());
        assert!(decode(b"nope").is_err());
        let mut truncated = psd(2, 1, 3, false, &[vec![1, 2], vec![3, 4], vec![5, 6]]);
        truncated.truncate(truncated.len() - 3);
        assert!(decode(&truncated).is_err());
    }
}
