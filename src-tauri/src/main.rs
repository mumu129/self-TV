use aes::Aes128;
use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State as AxumState},
    http::{header, Method, Request, Response, StatusCode},
    routing::any,
    Router,
};
use base64::{engine::general_purpose::{STANDARD, URL_SAFE}, Engine};
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use regex::Regex;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{Emitter, Manager, State, Window};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

type Aes128CbcDec = cbc::Decryptor<Aes128>;
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestPayload {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
struct HttpRequestResult {
    ok: bool,
    status: Option<u16>,
    data: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct ParseTvboxResult {
    ok: bool,
    config: Option<Value>,
    error: Option<String>,
}

#[derive(Serialize)]
struct DownloadResult {
    ok: bool,
    path: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    task_id: String,
    completed: usize,
    total: usize,
}

#[derive(Default)]
struct DownloadRegistry {
    tasks: Mutex<HashMap<String, CancellationToken>>,
}

#[derive(Clone)]
struct ProxyState {
    port: u16,
    token: String,
    client: Client,
}

#[derive(Deserialize)]
struct ProxyQuery {
    url: String,
}

#[tauri::command]
async fn http_request(payload: HttpRequestPayload) -> HttpRequestResult {
    let target = match Url::parse(&payload.url) {
        Ok(target) => target,
        Err(error) => return http_error(error.to_string()),
    };
    let method = match Method::from_bytes(payload.method.as_deref().unwrap_or("GET").as_bytes()) {
        Ok(method) => method,
        Err(error) => return http_error(error.to_string()),
    };
    let client = match client_with_timeout(Duration::from_secs(30)) {
        Ok(client) => client,
        Err(error) => return http_error(error),
    };
    let origin = target.origin().ascii_serialization();
    let mut request = client
        .request(method, target.clone())
        .header(header::USER_AGENT, USER_AGENT)
        .header(header::ACCEPT, "application/json, text/plain, */*")
        .header(header::REFERER, format!("{origin}/"))
        .header(header::ORIGIN, origin);
    if let Some(headers) = payload.headers {
        for (name, value) in headers {
            request = request.header(name, value);
        }
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            match response.text().await {
                Ok(data) => HttpRequestResult { ok: true, status: Some(status), data: Some(data), error: None },
                Err(error) => http_error(error.to_string()),
            }
        }
        Err(error) => http_error(error.to_string()),
    }
}

fn http_error(error: String) -> HttpRequestResult {
    HttpRequestResult { ok: false, status: None, data: None, error: Some(error) }
}

#[tauri::command]
fn parse_tvbox_config(raw_text: String) -> ParseTvboxResult {
    match decode_tvbox_json(&raw_text)
        .and_then(|decoded| strip_json_comments(&decoded))
        .and_then(|decoded| serde_json::from_str::<Value>(&decoded).map_err(|error| error.to_string()))
    {
        Ok(config) => ParseTvboxResult { ok: true, config: Some(config), error: None },
        Err(error) => ParseTvboxResult { ok: false, config: None, error: Some(error) },
    }
}

fn decode_tvbox_json(input: &str) -> Result<String, String> {
    if serde_json::from_str::<Value>(&strip_bom(input)).is_ok() {
        return Ok(input.to_owned());
    }

    let mut content = input.to_owned();
    if let Some(marker_index) = find_tvbox_prefix(&content) {
        let encoded = content[marker_index + 10..].split_whitespace().collect::<String>();
        let padded = pad_base64(&encoded);
        let decoded = STANDARD.decode(&padded).or_else(|_| URL_SAFE.decode(&padded)).map_err(|error| error.to_string())?;
        content = String::from_utf8_lossy(&decoded).into_owned();
    }

    if content.starts_with("2423") {
        let data_start = content.find("2324").map(|index| index + 4).ok_or("加密配置格式无效")?;
        let data_end = content.len().checked_sub(26).ok_or("加密配置格式无效")?;
        if data_start > data_end {
            return Err("加密配置格式无效".to_owned());
        }
        let decoded = String::from_utf8_lossy(&hex::decode(&content).map_err(|error| error.to_string())?).to_lowercase();
        let key_start = decoded.find("$#").map(|index| index + 2).ok_or("加密配置缺少密钥")?;
        let key_end = decoded[key_start..].find("#$").map(|index| key_start + index).ok_or("加密配置缺少密钥")?;
        let key = normalize_key(&decoded[key_start..key_end]);
        let iv = normalize_key(&decoded.chars().rev().take(13).collect::<String>().chars().rev().collect::<String>());
        let mut ciphertext = hex::decode(&content[data_start..data_end]).map_err(|error| error.to_string())?;
        let plaintext = Aes128CbcDec::new_from_slices(&key, &iv)
            .map_err(|error| error.to_string())?
            .decrypt_padded_vec_mut::<Pkcs7>(&mut ciphertext)
            .map_err(|error| error.to_string())?;
        content = String::from_utf8(plaintext).map_err(|error| error.to_string())?;
    }

    Ok(content)
}

fn find_tvbox_prefix(content: &str) -> Option<usize> {
    let bytes = content.as_bytes();
    bytes.windows(10).position(|window| {
        window[..8].iter().all(u8::is_ascii_alphanumeric) && window[8] == b'*' && window[9] == b'*'
    })
}

fn pad_base64(input: &str) -> String {
    let mut value = input.to_owned();
    while value.len() % 4 != 0 {
        value.push('=');
    }
    value
}

fn normalize_key(value: &str) -> Vec<u8> {
    let mut bytes = value.trim().as_bytes().to_vec();
    bytes.truncate(16);
    bytes.resize(16, b'0');
    bytes
}

fn strip_bom(input: &str) -> &str {
    input.strip_prefix('\u{feff}').unwrap_or(input)
}

fn strip_json_comments(input: &str) -> Result<String, String> {
    let content = strip_bom(input);
    let characters = content.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(content.len());
    let mut in_string = false;
    let mut escaping = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut index = 0;

    while index < characters.len() {
        let current = characters[index];
        let next = characters.get(index + 1).copied();
        if in_line_comment {
            if current == '\n' || current == '\r' {
                in_line_comment = false;
                output.push(current);
            }
        } else if in_block_comment {
            if current == '*' && next == Some('/') {
                in_block_comment = false;
                index += 1;
            }
        } else if in_string {
            output.push(current);
            if escaping {
                escaping = false;
            } else if current == '\\' {
                escaping = true;
            } else if current == '"' {
                in_string = false;
            }
        } else if current == '"' {
            in_string = true;
            output.push(current);
        } else if current == '/' && next == Some('/') {
            in_line_comment = true;
            index += 1;
        } else if current == '/' && next == Some('*') {
            in_block_comment = true;
            index += 1;
        } else {
            output.push(current);
        }
        index += 1;
    }

    if in_block_comment {
        return Err("JSON 注释未正确闭合".to_owned());
    }
    Ok(output)
}

#[tauri::command]
fn cancel_download(task_id: String, registry: State<'_, DownloadRegistry>) {
    if let Some(token) = registry.tasks.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).get(&task_id) {
        token.cancel();
    }
}

#[tauri::command]
async fn download_episode(
    app: tauri::AppHandle,
    registry: State<'_, DownloadRegistry>,
    url: String,
    filename: String,
    task_id: String,
) -> DownloadResult {
    let token = CancellationToken::new();
    registry.tasks.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(task_id.clone(), token.clone());
    let result = run_download(&app, &url, &filename, &task_id, &token).await;
    registry.tasks.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&task_id);

    match result {
        Ok(path) => DownloadResult { ok: true, path: path.to_str().map(str::to_owned), error: None },
        Err(error) => DownloadResult { ok: false, path: None, error: Some(error) },
    }
}

async fn run_download(
    app: &tauri::AppHandle,
    url: &str,
    filename: &str,
    task_id: &str,
    token: &CancellationToken,
) -> Result<PathBuf, String> {
    let download_root = app.path().download_dir().map_err(|error| error.to_string())?;
    let save_dir = download_root.join("TVBox_Downloads").join(sanitize_filename(filename));
    tokio::fs::create_dir_all(&save_dir).await.map_err(|error| error.to_string())?;
    let result = run_download_inner(app, url, task_id, token, &save_dir).await;
    if matches!(&result, Err(error) if error == "CANCELED") {
        let _ = tokio::fs::remove_dir_all(&save_dir).await;
    }
    result.map(|()| save_dir)
}

async fn run_download_inner(
    app: &tauri::AppHandle,
    url: &str,
    task_id: &str,
    token: &CancellationToken,
    save_dir: &Path,
) -> Result<(), String> {
    let client = client_with_timeout(Duration::from_secs(15))?;
    let mut playlist_url = url.to_owned();
    let mut content = fetch_text(&client, &playlist_url, token).await?;
    let last_url = content.lines().map(str::trim).filter(|line| !line.is_empty()).last().unwrap_or("");
    if last_url.contains(".m3u8") && last_url != playlist_url {
        playlist_url = resolve_url(&playlist_url, last_url);
        content = fetch_text(&client, &playlist_url, token).await?;
    }

    let mut lines = content.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_owned).collect::<Vec<_>>();
    if content.contains("#EXT-X-DISCONTINUITY") {
        lines = remove_ad_blocks(lines);
    }

    let mut segment_urls = Vec::new();
    let mut clean_lines = Vec::new();
    for line in lines {
        if line.starts_with('#') {
            clean_lines.push(line);
        } else {
            let segment_url = resolve_url(&playlist_url, &line);
            let name = url_filename(&segment_url).unwrap_or_else(|| format!("{}.ts", segment_urls.len() + 1));
            segment_urls.push((segment_url, name.clone()));
            clean_lines.push(name);
        }
    }

    let total = segment_urls.len();
    let mut completed = 0;
    for (segment_url, name) in &segment_urls {
        if token.is_cancelled() {
            return Err("CANCELED".to_owned());
        }
        let destination = save_dir.join(name);
        if !tokio::fs::try_exists(&destination).await.unwrap_or(false) {
            match download_file_with_retry(&client, &segment_url, &destination, token).await {
                Ok(()) => {}
                Err(error) if error == "CANCELED" => return Err(error),
                Err(error) if error.starts_with("FAILED_AFTER_") => continue,
                Err(error) => return Err(error),
            }
        }
        completed += 1;
        let _ = app.emit("download-progress", DownloadProgress { task_id: task_id.to_owned(), completed, total });
    }

    if token.is_cancelled() {
        return Err("CANCELED".to_owned());
    }
    tokio::fs::write(save_dir.join("index.m3u8"), clean_lines.join("\n"))
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn fetch_text(client: &Client, url: &str, token: &CancellationToken) -> Result<String, String> {
    let request = request_with_origin(client, url);
    let response = tokio::select! {
        _ = token.cancelled() => return Err("CANCELED".to_owned()),
        response = request.send() => response.map_err(|error| error.to_string())?,
    };
    tokio::select! {
        _ = token.cancelled() => Err("CANCELED".to_owned()),
        text = response.text() => text.map_err(|error| error.to_string()),
    }
}

async fn download_file_with_retry(
    client: &Client,
    url: &str,
    destination: &Path,
    token: &CancellationToken,
) -> Result<(), String> {
    for attempt in 1..=3 {
        if token.is_cancelled() {
            return Err("CANCELED".to_owned());
        }
        match download_single_file(client, url, destination, token).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                let _ = tokio::fs::remove_file(destination).await;
                if token.is_cancelled() {
                    return Err("CANCELED".to_owned());
                }
                if attempt == 3 {
                    return Err("FAILED_AFTER_3_RETRIES".to_owned());
                }
                eprintln!("分片下载失败 (尝试 {attempt}/3): {error}，1秒后重试");
                tokio::select! {
                    _ = token.cancelled() => return Err("CANCELED".to_owned()),
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                }
            }
        }
    }
    Err("FAILED_AFTER_3_RETRIES".to_owned())
}

async fn download_single_file(
    client: &Client,
    url: &str,
    destination: &Path,
    token: &CancellationToken,
) -> Result<(), String> {
    let request = request_with_origin(client, url);
    let mut response = tokio::select! {
        _ = token.cancelled() => return Err("CANCELED".to_owned()),
        response = request.send() => response.map_err(|error| error.to_string())?.error_for_status().map_err(|error| error.to_string())?,
    };
    let mut file = tokio::fs::File::create(destination).await.map_err(|error| error.to_string())?;
    loop {
        let chunk = tokio::select! {
            _ = token.cancelled() => return Err("CANCELED".to_owned()),
            chunk = response.chunk() => chunk.map_err(|error| error.to_string())?,
        };
        match chunk {
            Some(bytes) => file.write_all(&bytes).await.map_err(|error| error.to_string())?,
            None => break,
        }
    }
    file.flush().await.map_err(|error| error.to_string())
}

fn remove_ad_blocks(lines: Vec<String>) -> Vec<String> {
    let fps_values = [24.0, 25.0, 30.0, 60.0];
    let mut fps_counts = [0usize; 4];
    for line in &lines {
        if let Some(duration) = line.strip_prefix("#EXTINF:").and_then(|value| value.split(',').next()).and_then(|value| value.parse::<f64>().ok()) {
            for (index, fps) in fps_values.iter().enumerate() {
                if (duration * fps - (duration * fps).round()).abs() < 0.05 {
                    fps_counts[index] += 1;
                }
            }
        }
    }
    let mut main_fps = 24.0;
    let mut max_match = 0;
    for (index, count) in fps_counts.iter().enumerate() {
        if *count > max_match {
            max_match = *count;
            main_fps = fps_values[index];
        }
    }
    let mut final_lines = Vec::new();
    let mut current_block = Vec::new();
    let mut is_ad = false;

    for line in lines {
        let header_line = line.starts_with("#EXTM3U")
            || line.starts_with("#EXT-X-VERSION")
            || line.starts_with("#EXT-X-TARGETDURATION")
            || line.starts_with("#EXT-X-MEDIA-SEQUENCE")
            || line.starts_with("#EXT-X-PLAYLIST-TYPE")
            || line.starts_with("#EXT-X-ENDLIST");
        if header_line {
            final_lines.push(line);
        } else if line.starts_with("#EXT-X-DISCONTINUITY") {
            flush_block(&mut final_lines, &mut current_block, is_ad);
            current_block.push(line);
            is_ad = false;
        } else {
            if let Some(duration) = line.strip_prefix("#EXTINF:").and_then(|value| value.split(',').next()).and_then(|value| value.parse::<f64>().ok()) {
                if (duration * main_fps - (duration * main_fps).round()).abs() > 0.1 {
                    is_ad = true;
                }
            }
            current_block.push(line);
        }
    }
    flush_block(&mut final_lines, &mut current_block, is_ad);
    final_lines
}

fn flush_block(final_lines: &mut Vec<String>, current_block: &mut Vec<String>, is_ad: bool) {
    if !is_ad {
        final_lines.append(current_block);
    } else {
        current_block.clear();
    }
}

fn sanitize_filename(filename: &str) -> String {
    filename.chars().map(|character| {
        if character.is_control() || "\\/:*?\"<>|".contains(character) { '_' } else { character }
    }).collect()
}

fn url_filename(url: &str) -> Option<String> {
    Url::parse(url).ok()?.path_segments()?.next_back().filter(|name| !name.is_empty()).map(str::to_owned)
}

fn resolve_url(base: &str, relative: &str) -> String {
    Url::parse(base).ok().and_then(|base| base.join(relative).ok()).map(|url| url.to_string()).unwrap_or_else(|| relative.to_owned())
}

fn client_with_timeout(timeout: Duration) -> Result<Client, String> {
    Client::builder().user_agent(USER_AGENT).timeout(timeout).build().map_err(|error| error.to_string())
}

fn client_without_timeout() -> Result<Client, String> {
    Client::builder().user_agent(USER_AGENT).build().map_err(|error| error.to_string())
}

fn request_with_origin(client: &Client, url: &str) -> reqwest::RequestBuilder {
    let request = client.get(url).header(header::USER_AGENT, USER_AGENT);
    match Url::parse(url) {
        Ok(target) => {
            let origin = target.origin().ascii_serialization();
            request.header(header::REFERER, format!("{origin}/")).header(header::ORIGIN, origin)
        }
        Err(_) => request,
    }
}

#[tauri::command]
fn proxy_media_url(url: String, proxy: State<'_, ProxyState>) -> String {
    make_proxy_url(&proxy, &url)
}

fn make_proxy_url(proxy: &ProxyState, url: &str) -> String {
    let mut proxy_url = Url::parse(&format!("http://127.0.0.1:{}/proxy/{}", proxy.port, proxy.token)).expect("local proxy URL is valid");
    proxy_url.query_pairs_mut().append_pair("url", url);
    proxy_url.to_string()
}

async fn proxy_handler(
    AxumPath(token): AxumPath<String>,
    AxumState(proxy): AxumState<ProxyState>,
    Query(query): Query<ProxyQuery>,
    request: Request<Body>,
) -> Response<Body> {
    if token != proxy.token {
        return response_with_cors(StatusCode::NOT_FOUND, Body::empty());
    }
    if request.method() == Method::OPTIONS {
        return response_with_cors(StatusCode::NO_CONTENT, Body::empty());
    }
    let target = match Url::parse(&query.url) {
        Ok(target) if target.scheme() == "http" || target.scheme() == "https" => target,
        _ => return response_with_cors(StatusCode::BAD_REQUEST, Body::empty()),
    };
    let origin = target.origin().ascii_serialization();
    let mut upstream = proxy.client
        .request(request.method().clone(), target.clone())
        .header(header::USER_AGENT, USER_AGENT)
        .header(header::REFERER, format!("{origin}/"))
        .header(header::ORIGIN, origin);
    for name in [header::RANGE, header::IF_RANGE] {
        if let Some(value) = request.headers().get(&name) {
            upstream = upstream.header(name, value.clone());
        }
    }
    let upstream = match upstream.send().await {
        Ok(response) => response,
        Err(error) => return response_with_cors(StatusCode::BAD_GATEWAY, Body::from(error.to_string())),
    };
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream.headers().get(header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("");
    let is_playlist = target.path().to_ascii_lowercase().ends_with(".m3u8")
        || content_type.contains("mpegurl")
        || content_type.contains("vnd.apple.mpegurl");

    if is_playlist {
        let body = match upstream.text().await {
            Ok(body) => rewrite_playlist(&body, &target, &proxy),
            Err(error) => return response_with_cors(StatusCode::BAD_GATEWAY, Body::from(error.to_string())),
        };
        let mut response = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
            .body(Body::from(body))
            .unwrap_or_else(|_| Response::new(Body::empty()));
        add_cors(&mut response);
        return response;
    }

    let mut response_builder = Response::builder().status(status);
    for name in [header::CONTENT_TYPE, header::CONTENT_LENGTH, header::CONTENT_RANGE, header::ACCEPT_RANGES, header::CACHE_CONTROL] {
        if let Some(value) = upstream.headers().get(&name) {
            response_builder = response_builder.header(name, value.clone());
        }
    }
    let body = Body::from_stream(upstream.bytes_stream());
    let mut response = response_builder.body(body).unwrap_or_else(|_| Response::new(Body::empty()));
    add_cors(&mut response);
    response
}

fn rewrite_playlist(content: &str, base: &Url, proxy: &ProxyState) -> String {
    static URI_ATTRIBUTE: OnceLock<Regex> = OnceLock::new();
    let uri_attribute = URI_ATTRIBUTE.get_or_init(|| Regex::new(r#"URI="([^"]+)""#).expect("valid HLS URI expression"));
    content.lines().map(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        if trimmed.starts_with('#') {
            return uri_attribute.replace_all(line, |captures: &regex::Captures<'_>| {
                let value = &captures[1];
                let resolved = base.join(value).map(|url| url.to_string()).unwrap_or_else(|_| value.to_owned());
                format!("URI=\"{}\"", make_proxy_url(proxy, &resolved))
            }).into_owned();
        }
        let resolved = base.join(trimmed).map(|url| url.to_string()).unwrap_or_else(|_| trimmed.to_owned());
        make_proxy_url(proxy, &resolved)
    }).collect::<Vec<_>>().join("\n")
}

fn response_with_cors(status: StatusCode, body: Body) -> Response<Body> {
    let mut response = Response::builder().status(status).body(body).unwrap_or_else(|_| Response::new(Body::empty()));
    add_cors(&mut response);
    response
}

fn add_cors(response: &mut Response<Body>) {
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().expect("valid header"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS".parse().expect("valid header"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range, If-Range, Content-Type".parse().expect("valid header"));
    headers.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Length, Content-Range, Accept-Ranges".parse().expect("valid header"));
}

#[tauri::command]
fn minimize(window: Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn maximize(window: Window) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn close(window: Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_devtools(window: Window) {
    #[cfg(debug_assertions)]
    {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
    }
    #[cfg(not(debug_assertions))]
    let _ = window;
}

fn main() {
    tauri::Builder::default()
        .manage(DownloadRegistry::default())
        .setup(|app| {
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            listener.set_nonblocking(true)?;
            let port = listener.local_addr()?.port();
            let proxy_state = ProxyState {
                port,
                token: uuid::Uuid::new_v4().simple().to_string(),
                client: client_without_timeout().map_err(std::io::Error::other)?,
            };
            let server_state = proxy_state.clone();
            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(listener).expect("convert local media proxy listener");
                let router = Router::new().route("/proxy/:token", any(proxy_handler)).with_state(server_state);
                if let Err(error) = axum::serve(listener, router).await {
                    eprintln!("本地媒体代理已停止: {error}");
                }
            });
            app.manage(proxy_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            http_request,
            parse_tvbox_config,
            download_episode,
            cancel_download,
            proxy_media_url,
            minimize,
            maximize,
            close,
            toggle_devtools,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Self TV 失败");
}
