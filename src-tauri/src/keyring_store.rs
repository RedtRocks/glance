//! Linux secrets share one login-keyring service, never a file or memory fallback.

pub const SERVICE: &str = "io.github.redtrocks.glance";
pub const UNAVAILABLE: &str = "Saved signatures need the system keyring (GNOME Keyring or KWallet), which isn't available.";

pub fn entry(name: &str) -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, name)
}
