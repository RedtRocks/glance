//! Image metadata for the Inspector: every EXIF field in readable form, the GPS
//! position, and removing location data from the file itself.

use serde::Serialize;
use std::io::Cursor;
use std::path::Path;

#[derive(Serialize, Default)]
pub struct Field {
    pub label: String,
    pub value: String,
}

#[derive(Serialize, Default)]
pub struct Group {
    pub title: &'static str,
    pub fields: Vec<Field>,
}

#[derive(Serialize, Default)]
pub struct ImageMetadata {
    pub groups: Vec<Group>,
    /// Decimal degrees, when the photo records where it was taken.
    pub location: Option<(f64, f64)>,
    /// Any GPS field at all (even without a usable position).
    pub has_location: bool,
    /// Whether Glance can rewrite this format to remove location.
    pub can_remove_location: bool,
}

fn little_type(path: &Path) -> Option<little_exif::filetype::FileExtension> {
    use little_exif::filetype::FileExtension as F;
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "jpg" | "jpeg" | "jfif" | "jpe" => F::JPEG,
        "png" => F::PNG { as_zTXt_chunk: false },
        "tif" | "tiff" => F::TIFF,
        "webp" => F::WEBP,
        "heic" | "heif" => F::HEIF,
        "jxl" => F::JXL,
        _ => return None,
    })
}

fn degrees(exif: &exif::Exif, value: exif::Tag, reference: exif::Tag) -> Option<f64> {
    let f = exif.get_field(value, exif::In::PRIMARY)?;
    let exif::Value::Rational(ref v) = f.value else { return None };
    if v.len() < 3 {
        return None;
    }
    let d = v[0].to_f64() + v[1].to_f64() / 60.0 + v[2].to_f64() / 3600.0;
    let negative = exif
        .get_field(reference, exif::In::PRIMARY)
        .map(|r| matches!(r.display_value().to_string().trim_matches('"'), "S" | "W"))
        .unwrap_or(false);
    d.is_finite().then_some(if negative { -d } else { d })
}

pub fn read(path: &Path, bytes: &[u8]) -> ImageMetadata {
    let mut out = ImageMetadata { can_remove_location: little_type(path).is_some(), ..Default::default() };
    let Ok(exif) = exif::Reader::new().read_from_container(&mut Cursor::new(bytes)) else { return out };
    let mut camera = Group { title: "Camera", ..Default::default() };
    let mut image = Group { title: "Image", ..Default::default() };
    let mut gps = Group { title: "Location", ..Default::default() };
    let mut other = Group { title: "Other", ..Default::default() };
    for f in exif.fields() {
        if f.ifd_num != exif::In::PRIMARY {
            continue; // thumbnail IFD
        }
        // Binary blobs (maker notes, embedded data) aren't readable.
        if matches!(f.value, exif::Value::Undefined(ref v, _) if v.len() > 64) {
            continue;
        }
        let value = f.display_value().with_unit(&exif).to_string();
        if value.is_empty() {
            continue;
        }
        let field = Field { label: f.tag.to_string(), value: value.trim_matches('"').to_string() };
        use exif::Tag as T;
        match f.tag.context() {
            exif::Context::Gps => gps.fields.push(field),
            _ => match f.tag {
                T::Make | T::Model | T::LensMake | T::LensModel | T::ExposureTime | T::FNumber | T::PhotographicSensitivity
                | T::FocalLength | T::FocalLengthIn35mmFilm | T::ExposureProgram | T::ExposureBiasValue | T::MeteringMode
                | T::Flash | T::WhiteBalance | T::DateTimeOriginal | T::DateTimeDigitized | T::BodySerialNumber => camera.fields.push(field),
                T::ImageWidth | T::ImageLength | T::PixelXDimension | T::PixelYDimension | T::Orientation | T::XResolution
                | T::YResolution | T::ResolutionUnit | T::ColorSpace | T::BitsPerSample | T::Software | T::DateTime
                | T::Artist | T::Copyright | T::ImageDescription => image.fields.push(field),
                _ => other.fields.push(field),
            },
        }
    }
    out.has_location = !gps.fields.is_empty();
    out.location = degrees(&exif, exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef)
        .zip(degrees(&exif, exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef));
    out.groups = [camera, image, gps, other].into_iter().filter(|g| !g.fields.is_empty()).collect();
    out
}

/// Removes every GPS field from the file's EXIF, keeping the rest (camera, dates…).
pub fn strip_location(path: &Path, bytes: &[u8]) -> Result<Vec<u8>, String> {
    use little_exif::ifd::ExifTagGroup;
    let kind = little_type(path).ok_or("Removing location isn’t supported for this format.")?;
    let mut meta = little_exif::metadata::Metadata::new_from_vec(&bytes.to_vec(), kind).map_err(|e| e.to_string())?;
    let tags: Vec<u16> = meta.get_ifd(ExifTagGroup::GPS, 0).map(|ifd| ifd.get_tags().iter().map(|t| t.as_u16()).collect()).unwrap_or_default();
    for hex in tags {
        meta.remove_tag_by_hex_group(hex, ExifTagGroup::GPS);
    }
    // The pointer to the (now empty) GPS directory goes too.
    meta.remove_tag_by_hex_group(0x8825, ExifTagGroup::GENERIC);
    let mut out = bytes.to_vec();
    meta.write_to_vec(&mut out, kind).map_err(|e| e.to_string())?;
    // Verify before anything is written: no GPS field may survive.
    if let Ok(exif) = exif::Reader::new().read_from_container(&mut Cursor::new(&out)) {
        if exif.fields().any(|f| f.tag.context() == exif::Context::Gps) {
            return Err("Location data could not be removed from this file.".into());
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn image_metadata(path: String) -> Result<ImageMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        Ok(read(Path::new(&path), &bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Rewrites the file without location (atomically). `paths` allows batch use.
#[tauri::command]
pub async fn remove_location(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut failed = Vec::new();
        for p in paths {
            let path = Path::new(&p);
            let result = std::fs::read(path).map_err(|e| e.to_string()).and_then(|b| {
                let has_gps = read(path, &b).has_location;
                if !has_gps {
                    return Ok(());
                }
                crate::commands::write_atomic(path, &strip_location(path, &b)?)
            });
            if let Err(e) = result {
                failed.push(format!("{}: {e}", path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()));
            }
        }
        Ok(failed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use little_exif::exif_tag::ExifTag;
    use little_exif::rational::uR64;

    fn jpeg_with_gps() -> Vec<u8> {
        let img = image::RgbImage::from_pixel(16, 16, image::Rgb([200, 100, 50]));
        let mut jpg = Vec::new();
        image::DynamicImage::ImageRgb8(img).write_to(&mut Cursor::new(&mut jpg), image::ImageFormat::Jpeg).unwrap();
        let mut meta = little_exif::metadata::Metadata::new();
        let r = |n: u32| uR64 { nominator: n, denominator: 1 };
        meta.set_tag(ExifTag::Model("Glance Test Cam".into()));
        meta.set_tag(ExifTag::GPSLatitudeRef("N".into()));
        meta.set_tag(ExifTag::GPSLatitude(vec![r(48), r(51), r(24)]));
        meta.set_tag(ExifTag::GPSLongitudeRef("E".into()));
        meta.set_tag(ExifTag::GPSLongitude(vec![r(2), r(21), r(0)]));
        meta.write_to_vec(&mut jpg, little_exif::filetype::FileExtension::JPEG).unwrap();
        jpg
    }

    #[test]
    fn reads_camera_fields_and_position() {
        let m = read(Path::new("x.jpg"), &jpeg_with_gps());
        assert!(m.has_location);
        let (lat, lon) = m.location.unwrap();
        assert!((lat - 48.8567).abs() < 1e-3 && (lon - 2.35).abs() < 1e-3, "{lat},{lon}");
        assert!(m.groups.iter().flat_map(|g| &g.fields).any(|f| f.value.contains("Glance Test Cam")));
    }

    #[test]
    fn removes_location_but_keeps_other_exif_and_pixels() {
        let original = jpeg_with_gps();
        let stripped = strip_location(Path::new("x.jpg"), &original).unwrap();
        let m = read(Path::new("x.jpg"), &stripped);
        assert!(!m.has_location && m.location.is_none());
        assert!(m.groups.iter().flat_map(|g| &g.fields).any(|f| f.value.contains("Glance Test Cam")));
        let img = image::load_from_memory(&stripped).unwrap();
        assert_eq!((img.width(), img.height()), (16, 16));
    }

    #[test]
    fn files_without_exif_have_no_metadata() {
        let m = read(Path::new("x.png"), b"not an image");
        assert!(m.groups.is_empty() && !m.has_location);
    }
}
