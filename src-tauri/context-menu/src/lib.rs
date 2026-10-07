//! Windows 11's top-level Explorer context menu for the Microsoft Store package: Open in
//! Glance, Combine into PDF and Remove Location Info (ADR 0009).
//!
//! Windows 11 shows only commands from apps with a package identity in its new menu. The
//! Store package declares one `IExplorerCommand` COM class per verb (scripts/packaging.ts,
//! `windows.fileExplorerContextMenus`), served by this DLL in a surrogate host that runs
//! with the package's identity. Unlike a classic verb, a command gets the whole selection
//! at once, so it starts Glance.exe (next to this DLL) with every file on one command line.
//! The installer version can't have a package identity without a signed sparse package, so
//! it keeps the classic verbs under "Show more options" (src-tauri/windows/hooks.nsh).

#[cfg(windows)]
mod com;

/// One of Glance's Explorer verbs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verb {
    Open,
    Combine,
    RemoveLocation,
}

pub const VERBS: [Verb; 3] = [Verb::Open, Verb::Combine, Verb::RemoveLocation];

impl Verb {
    /// The COM class Explorer creates for this verb; the same GUIDs are in scripts/packaging.ts.
    pub const fn clsid(self) -> u128 {
        match self {
            Verb::Open => 0xd479f676_6ff1_4114_be81_5c7dfb4f7514,
            Verb::Combine => 0x4f22f3ee_52e1_4591_acbc_74dbe703bdbe,
            Verb::RemoveLocation => 0x0a5189eb_b743_41cd_897e_d0c9401bdeee,
        }
    }

    pub fn from_clsid(clsid: u128) -> Option<Self> {
        VERBS.into_iter().find(|v| v.clsid() == clsid)
    }

    /// Menu text, the same as the installer's classic verbs.
    pub const fn title(self) -> &'static str {
        match self {
            Verb::Open => "Open in Glance",
            Verb::Combine => "Combine into PDF",
            Verb::RemoveLocation => "Remove Location Info",
        }
    }

    /// The flag Glance reads (src-tauri/src/explorer.rs); opening needs none.
    pub const fn flag(self) -> Option<&'static str> {
        match self {
            Verb::Open => None,
            Verb::Combine => Some("--combine-pdf"),
            Verb::RemoveLocation => Some("--remove-location"),
        }
    }

    /// Whether the verb applies to a selection. The package manifest already limits each
    /// verb to its file types, but a mixed selection can include others.
    pub fn applies_to<S: AsRef<str>>(self, paths: &[S]) -> bool {
        match self {
            Verb::RemoveLocation => !paths.is_empty() && paths.iter().all(|p| has_location_type(p.as_ref())),
            Verb::Open | Verb::Combine => !paths.is_empty(),
        }
    }
}

/// Formats whose location info Glance can remove (src-tauri/src/metadata.rs); the same list
/// as hooks.nsh and scripts/packaging.ts (tests/packaging.test.ts checks they agree).
pub const LOCATION_TYPES: [&str; 10] = ["jpg", "jpeg", "jfif", "png", "tif", "tiff", "webp", "heic", "heif", "jxl"];

fn has_location_type(path: &str) -> bool {
    let ext = std::path::Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("");
    LOCATION_TYPES.iter().any(|t| t.eq_ignore_ascii_case(ext))
}

/// A Windows command line holds at most 32,767 characters. Long selections are split over
/// several launches, which Glance gathers back into one request (src-tauri/src/explorer.rs).
const MAX_ARGS_LEN: usize = 30_000;

/// The argument lists to start Glance with, one per launch.
pub fn launches<S: AsRef<str>>(verb: Verb, paths: &[S]) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut len = 0;
    for p in paths {
        let p = p.as_ref();
        // Quotes and a space around each path.
        let cost = p.len() + 3;
        if out.is_empty() || len + cost > MAX_ARGS_LEN {
            out.push(verb.flag().map(String::from).into_iter().collect());
            len = verb.flag().map_or(0, |f| f.len() + 1);
        }
        out.last_mut().unwrap().push(p.to_string());
        len += cost;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clsids_round_trip() {
        for v in VERBS {
            assert_eq!(Verb::from_clsid(v.clsid()), Some(v));
        }
        assert_eq!(Verb::from_clsid(0), None);
    }

    #[test]
    fn remove_location_only_for_supported_types() {
        assert!(Verb::RemoveLocation.applies_to(&[r"C:\a\photo.JPG", r"C:\a\b.heic"]));
        assert!(!Verb::RemoveLocation.applies_to(&[r"C:\a\photo.jpg", r"C:\a\scan.pdf"]));
        assert!(!Verb::RemoveLocation.applies_to::<&str>(&[]));
        assert!(Verb::Combine.applies_to(&[r"C:\a\scan.pdf", r"C:\a\photo.jpg"]));
    }

    #[test]
    fn one_launch_with_the_flag_and_every_file() {
        assert_eq!(launches(Verb::Combine, &["a.pdf", "b.jpg"]), vec![vec!["--combine-pdf", "a.pdf", "b.jpg"]]);
        assert_eq!(launches(Verb::Open, &["a.pdf"]), vec![vec!["a.pdf"]]);
        assert!(launches(Verb::Open, &[] as &[&str]).is_empty());
    }

    #[test]
    fn long_selections_are_split() {
        let path = format!(r"C:\{}\photo.jpg", "x".repeat(200));
        let paths = vec![path; 500];
        let runs = launches(Verb::RemoveLocation, &paths);
        assert!(runs.len() > 1);
        for run in &runs {
            assert_eq!(run[0], "--remove-location");
            assert!(run.iter().map(|a| a.len() + 3).sum::<usize>() <= MAX_ARGS_LEN + 3);
        }
        assert_eq!(runs.iter().map(|r| r.len() - 1).sum::<usize>(), 500);
    }
}
