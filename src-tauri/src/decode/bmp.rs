//! Minimal 32-bit BMP (BITMAPV4HEADER) encoder.
//!
//! Decoded pixels are handed to WebView2 as BMP because it is the cheapest format
//! Chromium decodes natively: no compression, a fixed 122-byte header, and
//! straight alpha through BI_BITFIELDS masks.

const FILE_HEADER: usize = 14;
const INFO_HEADER: usize = 108;

/// Encode top-down RGBA8 pixels as a 32-bit BMP with alpha.
pub fn encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let pixels = (width as usize) * (height as usize);
    debug_assert_eq!(rgba.len(), pixels * 4);
    let data_offset = FILE_HEADER + INFO_HEADER;
    let file_size = data_offset + pixels * 4;
    let mut out = Vec::with_capacity(file_size);

    // BITMAPFILEHEADER
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(file_size as u32).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(data_offset as u32).to_le_bytes());

    // BITMAPV4HEADER
    out.extend_from_slice(&(INFO_HEADER as u32).to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(-(height as i32)).to_le_bytes()); // negative = top-down
    out.extend_from_slice(&1u16.to_le_bytes()); // planes
    out.extend_from_slice(&32u16.to_le_bytes()); // bpp
    out.extend_from_slice(&3u32.to_le_bytes()); // BI_BITFIELDS
    out.extend_from_slice(&((pixels * 4) as u32).to_le_bytes());
    out.extend_from_slice(&2835i32.to_le_bytes()); // 72 DPI
    out.extend_from_slice(&2835i32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // palette colors
    out.extend_from_slice(&0u32.to_le_bytes()); // important colors
    // Masks for bytes stored in memory as R, G, B, A.
    out.extend_from_slice(&0x0000_00FFu32.to_le_bytes());
    out.extend_from_slice(&0x0000_FF00u32.to_le_bytes());
    out.extend_from_slice(&0x00FF_0000u32.to_le_bytes());
    out.extend_from_slice(&0xFF00_0000u32.to_le_bytes());
    out.extend_from_slice(b"BGRs"); // LCS_sRGB, little-endian 'sRGB'
    out.extend_from_slice(&[0u8; 36]); // CIEXYZTRIPLE endpoints
    out.extend_from_slice(&[0u8; 12]); // gamma R, G, B

    out.extend_from_slice(rgba);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_is_well_formed_and_round_trips_through_image_crate() {
        let rgba = [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 40];
        let bmp = encode_rgba(2, 2, &rgba);
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(bmp.len(), 14 + 108 + 16);
        let img = image::load_from_memory_with_format(&bmp, image::ImageFormat::Bmp)
            .expect("decodes")
            .to_rgba8();
        assert_eq!(img.dimensions(), (2, 2));
        assert_eq!(img.as_raw().as_slice(), &rgba);
    }
}
