//! Color profiles for export: converts sRGB pixels into another RGB space (or gray)
//! and generates the matching ICC profile to embed, so no .icc files ship with Glance.

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Profile {
    Srgb,
    DisplayP3,
    AdobeRgb,
    Gray,
}

impl Profile {
    pub fn parse(s: &str) -> Option<Profile> {
        Some(match s {
            "srgb" => Profile::Srgb,
            "p3" => Profile::DisplayP3,
            "adobergb" => Profile::AdobeRgb,
            "gray" => Profile::Gray,
            _ => return None,
        })
    }

    fn name(self) -> &'static str {
        match self {
            Profile::Srgb => "sRGB IEC61966-2.1",
            Profile::DisplayP3 => "Display P3",
            Profile::AdobeRgb => "Adobe RGB (1998) compatible",
            Profile::Gray => "Gray Gamma 2.2",
        }
    }

    /// Red, green, blue chromaticities (all these spaces use a D65 white).
    fn primaries(self) -> [[f64; 2]; 3] {
        match self {
            Profile::Srgb | Profile::Gray => [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]],
            Profile::DisplayP3 => [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060]],
            Profile::AdobeRgb => [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]],
        }
    }

    fn gamma(self) -> Option<f64> {
        match self {
            Profile::AdobeRgb => Some(563.0 / 256.0),
            Profile::Gray => Some(2.2),
            _ => None, // the sRGB curve
        }
    }

    fn encode(self, v: f64) -> f64 {
        let v = v.clamp(0.0, 1.0);
        match self.gamma() {
            Some(g) => v.powf(1.0 / g),
            None if v <= 0.003_130_8 => v * 12.92,
            None => 1.055 * v.powf(1.0 / 2.4) - 0.055,
        }
    }
}

fn srgb_linear(v: u8) -> f64 {
    let c = v as f64 / 255.0;
    if c <= 0.040_45 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

type M3 = [[f64; 3]; 3];

fn mul(a: &M3, b: &M3) -> M3 {
    let mut m = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    m
}

fn apply(m: &M3, v: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|i| m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2])
}

fn inverse(m: &M3) -> M3 {
    let [a, b, c] = m[0];
    let [d, e, f] = m[1];
    let [g, h, i] = m[2];
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    [
        [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
        [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
        [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ]
}

const D65: [f64; 3] = [0.950_47, 1.0, 1.088_83];
const D50: [f64; 3] = [0.964_2, 1.0, 0.824_9];

/// Linear RGB → XYZ (D65) from chromaticities.
fn rgb_to_xyz(p: Profile) -> M3 {
    let xyz = |[x, y]: [f64; 2]| [x / y, 1.0, (1.0 - x - y) / y];
    let [r, g, b] = p.primaries().map(xyz);
    let m = [[r[0], g[0], b[0]], [r[1], g[1], b[1]], [r[2], g[2], b[2]]];
    let s = apply(&inverse(&m), D65);
    [0, 1, 2].map(|i| [m[i][0] * s[0], m[i][1] * s[1], m[i][2] * s[2]])
}

/// Bradford adaptation D65 → D50 (ICC connection space).
fn d65_to_d50() -> M3 {
    let b: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
    let src = apply(&b, D65);
    let dst = apply(&b, D50);
    let scale: M3 = [[dst[0] / src[0], 0.0, 0.0], [0.0, dst[1] / src[1], 0.0], [0.0, 0.0, dst[2] / src[2]]];
    mul(&inverse(&b), &mul(&scale, &b))
}

/// Converts straight-alpha sRGB RGBA pixels in place into the profile's space.
pub fn convert(rgba: &mut [u8], to: Profile) {
    if to == Profile::Srgb {
        return;
    }
    let lut: Vec<f64> = (0..=255u8).map(srgb_linear).collect();
    let m = mul(&inverse(&rgb_to_xyz(to)), &rgb_to_xyz(Profile::Srgb));
    for px in rgba.chunks_exact_mut(4) {
        let lin = [lut[px[0] as usize], lut[px[1] as usize], lut[px[2] as usize]];
        if to == Profile::Gray {
            let y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
            let g = (to.encode(y) * 255.0).round() as u8;
            px[..3].copy_from_slice(&[g, g, g]);
        } else {
            let out = apply(&m, lin);
            for c in 0..3 {
                px[c] = (to.encode(out[c]) * 255.0).round() as u8;
            }
        }
    }
}

fn s15(v: f64) -> [u8; 4] {
    ((v * 65536.0).round() as i32).to_be_bytes()
}

fn xyz_tag(v: [f64; 3]) -> Vec<u8> {
    let mut t = b"XYZ \0\0\0\0".to_vec();
    for c in v {
        t.extend(s15(c));
    }
    t
}

fn curve_tag(p: Profile) -> Vec<u8> {
    let mut t = b"curv\0\0\0\0".to_vec();
    match p.gamma() {
        Some(g) => {
            t.extend(1u32.to_be_bytes());
            t.extend(((g * 256.0).round() as u16).to_be_bytes());
        }
        None => {
            let n = 1024u32;
            t.extend(n.to_be_bytes());
            for i in 0..n {
                let c = i as f64 / (n - 1) as f64;
                let lin = if c <= 0.040_45 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
                t.extend(((lin * 65535.0).round() as u16).to_be_bytes());
            }
        }
    }
    t
}

fn desc_tag(s: &str) -> Vec<u8> {
    // ICC v2 textDescriptionType: ASCII part, then empty Unicode and ScriptCode parts.
    let mut t = b"desc\0\0\0\0".to_vec();
    t.extend((s.len() as u32 + 1).to_be_bytes());
    t.extend(s.as_bytes());
    t.push(0);
    t.extend([0u8; 4 + 4 + 2 + 1 + 67]);
    t
}

fn text_tag(s: &str) -> Vec<u8> {
    let mut t = b"text\0\0\0\0".to_vec();
    t.extend(s.as_bytes());
    t.push(0);
    t
}

/// A small ICC v2.4 display profile (matrix/TRC, or gray TRC).
pub fn icc(p: Profile) -> Vec<u8> {
    let mut tags: Vec<([u8; 4], Vec<u8>)> = vec![(*b"desc", desc_tag(p.name())), (*b"cprt", text_tag("No copyright, use freely")), (*b"wtpt", xyz_tag(D50))];
    if p == Profile::Gray {
        tags.push((*b"kTRC", curve_tag(p)));
    } else {
        let m = mul(&d65_to_d50(), &rgb_to_xyz(p));
        for (i, sig) in [b"rXYZ", b"gXYZ", b"bXYZ"].into_iter().enumerate() {
            tags.push((*sig, xyz_tag([m[0][i], m[1][i], m[2][i]])));
        }
        let trc = curve_tag(p);
        for sig in [b"rTRC", b"gTRC", b"bTRC"] {
            tags.push((*sig, trc.clone()));
        }
    }
    let table_len = 4 + 12 * tags.len();
    let mut data: Vec<u8> = Vec::new();
    let mut table: Vec<u8> = (tags.len() as u32).to_be_bytes().to_vec();
    for (sig, body) in &tags {
        let offset = 128 + table_len + data.len();
        table.extend(sig);
        table.extend((offset as u32).to_be_bytes());
        table.extend((body.len() as u32).to_be_bytes());
        data.extend(body);
        while data.len() % 4 != 0 {
            data.push(0);
        }
    }
    let size = 128 + table.len() + data.len();
    let mut h = vec![0u8; 128];
    h[0..4].copy_from_slice(&(size as u32).to_be_bytes());
    h[8..12].copy_from_slice(&0x0240_0000u32.to_be_bytes());
    h[12..16].copy_from_slice(b"mntr");
    h[16..20].copy_from_slice(if p == Profile::Gray { b"GRAY" } else { b"RGB " });
    h[20..24].copy_from_slice(b"XYZ ");
    h[24..36].copy_from_slice(&[0x07, 0xea, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]); // 2026-01-01
    h[36..40].copy_from_slice(b"acsp");
    h[40..44].copy_from_slice(b"MSFT");
    for (k, v) in D50.iter().enumerate() {
        h[68 + k * 4..72 + k * 4].copy_from_slice(&s15(*v));
    }
    h[80..84].copy_from_slice(b"GLNC");
    [h, table, data].concat()
}

/// The profile's description (v2 `desc` or v4 `mluc`), e.g. "Display P3".
pub fn profile_name(icc: &[u8]) -> Option<String> {
    let u32at = |o: usize| icc.get(o..o + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize);
    let count = u32at(128)?;
    for i in 0..count.min(100) {
        let e = 132 + i * 12;
        if icc.get(e..e + 4)? != b"desc" {
            continue;
        }
        let off = u32at(e + 4)?;
        let body = icc.get(off..off + u32at(e + 8)?)?;
        return match body.get(0..4)? {
            b"desc" => {
                let n = u32::from_be_bytes(body.get(8..12)?.try_into().ok()?) as usize;
                Some(String::from_utf8_lossy(body.get(12..12 + n)?).trim_end_matches('\0').to_string())
            }
            b"mluc" => {
                let len = u32::from_be_bytes(body.get(20..24)?.try_into().ok()?) as usize;
                let start = u32::from_be_bytes(body.get(24..28)?.try_into().ok()?) as usize;
                let units: Vec<u16> = body.get(start..start + len)?.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                Some(String::from_utf16_lossy(&units))
            }
            _ => None,
        };
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srgb_matrix_matches_the_standard() {
        let m = rgb_to_xyz(Profile::Srgb);
        assert!((m[0][0] - 0.4124).abs() < 1e-3 && (m[1][1] - 0.7152).abs() < 1e-3 && (m[2][2] - 0.9505).abs() < 1e-3);
    }

    #[test]
    fn converting_keeps_white_and_black_and_desaturates_into_wider_spaces() {
        let mut px = vec![255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255];
        convert(&mut px, Profile::DisplayP3);
        assert_eq!(&px[0..3], &[255, 255, 255]);
        assert_eq!(&px[4..7], &[0, 0, 0]);
        // Pure sRGB red sits inside P3, so its P3 coordinates are less saturated.
        assert!(px[8] < 255 && px[9] > 0 && px[10] > 0, "{:?}", &px[8..11]);
    }

    #[test]
    fn gray_uses_luminance() {
        let mut px = vec![0, 255, 0, 255];
        convert(&mut px, Profile::Gray);
        assert_eq!(px[0], px[1]);
        assert!(px[0] > 200); // green is bright
    }

    #[test]
    fn generated_profiles_are_well_formed_and_named() {
        for p in [Profile::Srgb, Profile::DisplayP3, Profile::AdobeRgb, Profile::Gray] {
            let icc = icc(p);
            assert_eq!(u32::from_be_bytes(icc[0..4].try_into().unwrap()) as usize, icc.len());
            assert_eq!(&icc[36..40], b"acsp");
            assert_eq!(profile_name(&icc).as_deref(), Some(p.name()));
        }
    }
}
