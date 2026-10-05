//! Glance's image decoders for the browser (see src/platform/webDecode.ts).
//!
//! The decoding code is the desktop app's own (src-tauri/src/decode), compiled to
//! WebAssembly. The interface is a plain C ABI so no binding generator is needed:
//! JS copies the file into memory from `alloc`, calls a function, then reads the
//! result from `result_ptr` / `result_len`.

#[allow(dead_code)]
#[path = "../../../src-tauri/src/decode/mod.rs"]
mod decode;

use std::cell::RefCell;
use std::io::Cursor;

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn set_result(bytes: Vec<u8>) {
    RESULT.with(|r| *r.borrow_mut() = bytes);
}

/// 0 = ok (the result holds the output), 1 = error (the result holds a UTF-8 message).
fn finish(res: Result<Vec<u8>, String>) -> u32 {
    match res {
        Ok(b) => {
            set_result(b);
            0
        }
        Err(e) => {
            set_result(e.into_bytes());
            1
        }
    }
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` and `len` must come from one `alloc` call.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

/// Frees the last result once JS has copied it.
#[no_mangle]
pub extern "C" fn result_clear() {
    set_result(Vec::new());
}

unsafe fn slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(ptr, len)
    }
}

/// Decodes an image file into a 32-bit BMP, which every browser shows natively
/// (the desktop app hands decoded pixels to WebView2 the same way).
///
/// # Safety
/// Both pointer/length pairs must point at memory from `alloc`.
#[no_mangle]
pub unsafe extern "C" fn decode_image(ext_ptr: *const u8, ext_len: usize, data_ptr: *const u8, data_len: usize) -> u32 {
    let ext = String::from_utf8_lossy(slice(ext_ptr, ext_len)).to_ascii_lowercase();
    let data = slice(data_ptr, data_len);
    finish(decode::decode_data(&ext, data).map(|d| decode::bmp::encode_rgba(d.width, d.height, &d.rgba)))
}

/// Page names of a comic book archive, one per line.
///
/// # Safety
/// The pointer/length pair must point at memory from `alloc`.
#[no_mangle]
pub unsafe extern "C" fn archive_pages(data_ptr: *const u8, data_len: usize) -> u32 {
    let data = slice(data_ptr, data_len);
    finish(decode::archive::page_names_in(Cursor::new(data)).map(|n| n.join("\n").into_bytes()))
}

/// The raw bytes of one page of a comic book archive.
///
/// # Safety
/// The pointer/length pair must point at memory from `alloc`.
#[no_mangle]
pub unsafe extern "C" fn archive_page(data_ptr: *const u8, data_len: usize, page: usize) -> u32 {
    let data = slice(data_ptr, data_len);
    finish(decode::archive::read_page_in(Cursor::new(data), page).map(|(_, b)| b))
}
