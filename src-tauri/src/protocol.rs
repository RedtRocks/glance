//! `glance://` URI scheme. Files and decoded pixels go straight from disk to
//! WebView2 without passing through JSON IPC.
//!
//! Routes:
//! - `/file?path=…`                     raw bytes of a file (PDFs, browser-native images, models)
//! - `/decode?path=…&page=N&max=PX`     any image decoded by the backend, as 32-bit BMP
//! - `/archive?path=…&page=N`           one image entry of a CBZ, raw

use crate::decode;
use percent_encoding::percent_decode_str;
use std::path::PathBuf;
use tauri::http::{header, Request, Response, StatusCode};

fn query(uri: &tauri::http::Uri) -> Vec<(String, String)> {
    uri.query()
        .unwrap_or("")
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| {
            let v = v.replace('+', " ");
            (k.to_string(), percent_decode_str(&v).decode_utf8_lossy().into_owned())
        })
        .collect()
}

fn param<'a>(q: &'a [(String, String)], key: &str) -> Option<&'a str> {
    q.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

fn respond(status: StatusCode, mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .expect("valid response")
}

fn error(status: StatusCode, msg: impl Into<String>) -> Response<Vec<u8>> {
    respond(status, "text/plain; charset=utf-8", msg.into().into_bytes())
}

pub fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let q = query(uri);
    let Some(path) = param(&q, "path").map(PathBuf::from) else {
        return error(StatusCode::BAD_REQUEST, "missing path");
    };
    let page: u32 = param(&q, "page").and_then(|p| p.parse().ok()).unwrap_or(0);
    let max: Option<u32> = param(&q, "max").and_then(|p| p.parse().ok()).filter(|m| *m > 0);

    match uri.path() {
        "/file" => match std::fs::read(&path) {
            Ok(bytes) => respond(StatusCode::OK, decode::formats::mime_for(&path), bytes),
            Err(e) => error(StatusCode::NOT_FOUND, e.to_string()),
        },
        "/archive" => match decode::archive::read_page(&path, page as usize) {
            Ok((name, bytes)) => respond(StatusCode::OK, decode::formats::mime_for(std::path::Path::new(&name)), bytes),
            Err(e) => error(StatusCode::NOT_FOUND, e),
        },
        "/decode" => match decode::decode(&path, page, max) {
            Ok(d) => respond(StatusCode::OK, "image/bmp", decode::bmp::encode_rgba(d.width, d.height, &d.rgba)),
            Err(e) => error(StatusCode::UNPROCESSABLE_ENTITY, e),
        },
        _ => error(StatusCode::NOT_FOUND, "unknown route"),
    }
}
