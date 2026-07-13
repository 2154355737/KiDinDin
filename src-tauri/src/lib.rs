use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{header, multipart, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const DEFAULT_TARGET: &str = "https://cis.whng.com.cn";
const DINGTALK_REFERER: &str = "https://2021001142645745.eco.dingtalkapps.com/index.html";
const DINGTALK_APP_ID: &str = "com.alibaba.android.rimet";
const DINGTALK_APP_VERSION: &str = "8.3.35";
const DINGTALK_PLATFORM: &str = "Android 16 · zh-CN";
const MOBILE_USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 16; zh-CN) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 Mobile Safari/537.36 AliApp(DingTalk/8.3.35) com.alibaba.android.rimet";
const FILE_UPLOAD_USER_AGENT: &str = "MiniFileUploaderAliApp(DingTalk/8.3.35) com.alibaba.android.rimet";

#[derive(Clone, Default, Deserialize, Serialize)]
struct CisSession {
    access_token: String,
    cookie: String,
    sign: String,
    target: String,
    username: Option<String>,
    employee_number: Option<String>,
    expires_at: Option<i64>,
}

#[derive(Clone, Deserialize, Serialize)]
struct AuthHistoryEntry {
    id: String,
    last_used_at: u64,
    session: CisSession,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthHistorySummary {
    id: String,
    employee_number: Option<String>,
    last_used_at: u64,
    token_hint: String,
    username: Option<String>,
}

struct CisState {
    client: Client,
    session: Mutex<Option<CisSession>>,
}

impl Default for CisState {
    fn default() -> Self {
        Self {
            client: Client::builder().build().expect("create HTTP client"),
            session: Mutex::new(None),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionInput {
    token_text: String,
    cookie: Option<String>,
    sign: Option<String>,
    target: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatus {
    authenticated: bool,
    employee_number: Option<String>,
    expires_at: Option<i64>,
    username: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentityPreview {
    app_id: String,
    app_version: String,
    platform: String,
    request_agent: String,
    user_agent: String,
    referer: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadedFile {
    base64: String,
    mime: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadFile {
    name: String,
    mime: Option<String>,
    base64: String,
}

fn non_empty(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(String::from)
}

fn session_status(session: Option<&CisSession>) -> SessionStatus {
    SessionStatus {
        authenticated: session.is_some_and(|value| !value.access_token.is_empty()),
        employee_number: session.and_then(|value| value.employee_number.clone()),
        expires_at: session.and_then(|value| value.expires_at),
        username: session.and_then(|value| value.username.clone()),
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn auth_history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| format!("无法定位本机凭据目录：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建本机凭据目录：{error}"))?;
    Ok(directory.join("auth-history.json"))
}

fn read_auth_history(app: &AppHandle) -> Result<Vec<AuthHistoryEntry>, String> {
    let path = auth_history_path(app)?;
    if !path.exists() { return Ok(Vec::new()); }
    let content = fs::read_to_string(path).map_err(|error| format!("读取历史凭据失败：{error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("历史凭据格式无效：{error}"))
}

fn write_auth_history(app: &AppHandle, history: &[AuthHistoryEntry]) -> Result<(), String> {
    let payload = serde_json::to_string(history).map_err(|error| format!("序列化历史凭据失败：{error}"))?;
    fs::write(auth_history_path(app)?, payload).map_err(|error| format!("保存历史凭据失败：{error}"))
}

fn account_key(session: &CisSession) -> String {
    session.employee_number.clone().or_else(|| session.username.clone()).unwrap_or_else(|| session.access_token.chars().take(16).collect())
}

fn token_hint(token: &str) -> String {
    let start: String = token.chars().take(6).collect();
    let end: String = token.chars().rev().take(4).collect::<String>().chars().rev().collect();
    format!("{}…{}", start, end)
}

fn remember_auth_session(app: &AppHandle, session: &CisSession) -> Result<(), String> {
    let key = account_key(session);
    let mut history = read_auth_history(app)?;
    if let Some(entry) = history.iter_mut().find(|entry| account_key(&entry.session) == key) {
        entry.session = session.clone();
        entry.last_used_at = current_timestamp();
    } else {
        history.push(AuthHistoryEntry { id: Uuid::new_v4().to_string(), last_used_at: current_timestamp(), session: session.clone() });
    }
    history.sort_by(|left, right| right.last_used_at.cmp(&left.last_used_at));
    history.truncate(8);
    write_auth_history(app, &history)
}

fn history_summary(entry: &AuthHistoryEntry) -> AuthHistorySummary {
    AuthHistorySummary {
        id: entry.id.clone(),
        employee_number: entry.session.employee_number.clone(),
        last_used_at: entry.last_used_at,
        token_hint: token_hint(&entry.session.access_token),
        username: entry.session.username.clone(),
    }
}

fn parse_session(input: SessionInput) -> Result<CisSession, String> {
    let raw = input.token_text.trim();
    if raw.is_empty() {
        return Err("请粘贴登录响应 JSON 或 Bearer token".into());
    }

    let parsed = serde_json::from_str::<Value>(raw).ok();
    let payload = parsed.as_ref().and_then(|value| value.get("data")).unwrap_or_else(|| parsed.as_ref().unwrap_or(&Value::Null));
    let token = if let Some(value) = parsed.as_ref() {
        non_empty(value.get("access_token"))
            .or_else(|| non_empty(value.get("accessToken")))
            .or_else(|| non_empty(value.get("token")))
            .or_else(|| non_empty(value.get("authorization")))
            .or_else(|| non_empty(payload.get("access_token")))
            .or_else(|| non_empty(payload.get("accessToken")))
            .or_else(|| non_empty(payload.get("token")))
            .or_else(|| non_empty(payload.get("authorization")))
    } else {
        Some(raw.to_string())
    }
    .map(|value| value.trim_start_matches("Bearer ").trim_start_matches("bearer ").trim().to_string())
    .filter(|value| !value.is_empty())
    .ok_or_else(|| "登录数据缺少 access_token".to_string())?;

    let user_info = payload.get("user_info").or_else(|| payload.get("userInfo"));
    let target = input.target.unwrap_or_else(|| DEFAULT_TARGET.into()).trim_end_matches('/').to_string();
    if !target.starts_with("https://") {
        return Err("服务地址必须使用 https://".into());
    }

    Ok(CisSession {
        access_token: token,
        cookie: input.cookie.or_else(|| non_empty(payload.get("cookie"))).unwrap_or_default().trim().to_string(),
        sign: input.sign.or_else(|| non_empty(payload.get("sign"))).unwrap_or_default().trim().to_string(),
        target,
        username: non_empty(user_info.and_then(|value| value.get("username"))).or_else(|| non_empty(payload.get("username"))),
        employee_number: non_empty(user_info.and_then(|value| value.get("employeeNumber"))).or_else(|| non_empty(payload.get("employeeNumber"))),
        expires_at: payload.get("expiresAt").and_then(Value::as_i64),
    })
}

fn request_url(session: &CisSession, path: &str) -> String {
    if path.starts_with("https://") || path.starts_with("http://") { path.to_string() } else { format!("{}{}", session.target, if path.starts_with('/') { path } else { "/" }) }
}

fn apply_headers(mut request: reqwest::RequestBuilder, session: &CisSession, is_upload: bool) -> reqwest::RequestBuilder {
    request = request
        .header(header::AUTHORIZATION, format!("Bearer {}", session.access_token))
        .header("x-request-id", Uuid::new_v4().to_string())
        .header("agent", "DDDigitalCis")
        .header(header::REFERER, DINGTALK_REFERER)
        .header(header::ORIGIN, "https://2021001142645745.eco.dingtalkapps.com")
        .header(header::ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9")
        .header("x-requested-with", "com.alibaba.android.rimet")
        .header(header::USER_AGENT, if is_upload { FILE_UPLOAD_USER_AGENT } else { MOBILE_USER_AGENT });
    if !session.sign.is_empty() { request = request.header("sign", &session.sign); }
    if !session.cookie.is_empty() { request = request.header(header::COOKIE, &session.cookie); }
    request
}

async fn response_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let text = response.text().await.map_err(|error| format!("读取响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("接口返回 {status}：{}", text.chars().take(300).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|_| format!("接口返回不是 JSON：{}", text.chars().take(300).collect::<String>()))
}

#[tauri::command]
fn cis_auth_status(state: State<'_, CisState>) -> Result<SessionStatus, String> {
    let session = state.session.lock().map_err(|_| "会话锁定失败")?;
    Ok(session_status(session.as_ref()))
}

#[tauri::command]
fn cis_configure_session(input: SessionInput, app: AppHandle, state: State<'_, CisState>) -> Result<SessionStatus, String> {
    let session = parse_session(input)?;
    let status = session_status(Some(&session));
    *state.session.lock().map_err(|_| "会话锁定失败")? = Some(session.clone());
    let _ = remember_auth_session(&app, &session);
    Ok(status)
}

#[tauri::command]
fn cis_clear_session(state: State<'_, CisState>) -> Result<SessionStatus, String> {
    *state.session.lock().map_err(|_| "会话锁定失败")? = None;
    Ok(session_status(None))
}

#[tauri::command]
fn cis_auth_history(app: AppHandle) -> Result<Vec<AuthHistorySummary>, String> {
    let mut history = read_auth_history(&app)?;
    history.sort_by(|left, right| right.last_used_at.cmp(&left.last_used_at));
    Ok(history.iter().map(history_summary).collect())
}

#[tauri::command]
fn cis_restore_auth_history(id: String, app: AppHandle, state: State<'_, CisState>) -> Result<SessionStatus, String> {
    let mut history = read_auth_history(&app)?;
    let entry = history.iter_mut().find(|entry| entry.id == id).ok_or_else(|| "未找到该历史凭据".to_string())?;
    entry.last_used_at = current_timestamp();
    let session = entry.session.clone();
    history.sort_by(|left, right| right.last_used_at.cmp(&left.last_used_at));
    write_auth_history(&app, &history)?;
    let status = session_status(Some(&session));
    *state.session.lock().map_err(|_| "会话锁定失败")? = Some(session);
    Ok(status)
}

#[tauri::command]
fn device_identity_preview() -> DeviceIdentityPreview {
    DeviceIdentityPreview {
        app_id: DINGTALK_APP_ID.into(),
        app_version: DINGTALK_APP_VERSION.into(),
        platform: DINGTALK_PLATFORM.into(),
        request_agent: "DDDigitalCis".into(),
        user_agent: MOBILE_USER_AGENT.into(),
        referer: DINGTALK_REFERER.into(),
    }
}

#[tauri::command]
async fn cis_download_file(path: String, file_name: String, state: State<'_, CisState>) -> Result<DownloadedFile, String> {
    if path.trim().is_empty() { return Err("图片下载地址为空".into()); }
    let session = state.session.lock().map_err(|_| "会话锁定失败")?.clone().ok_or_else(|| "登录已失效，请重新粘贴登录凭据".to_string())?;
    let response = apply_headers(state.client.get(request_url(&session, &path)), &session, false)
        .send().await.map_err(|error| format!("下载图片失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("下载图片返回 {status}：{}", text.chars().take(200).collect::<String>()));
    }
    let mime = response.headers().get(header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("image/jpeg").split(';').next().unwrap_or("image/jpeg").to_string();
    let bytes = response.bytes().await.map_err(|error| format!("读取图片失败：{error}"))?;
    Ok(DownloadedFile { base64: STANDARD.encode(bytes), mime, name: file_name })
}

#[tauri::command]
async fn cis_request(
    path: String,
    method: String,
    body: Option<Value>,
    state: State<'_, CisState>,
) -> Result<Value, String> {
    let session = state.session.lock().map_err(|_| "会话锁定失败")?.clone().ok_or_else(|| "登录已失效，请重新粘贴登录凭据".to_string())?;
    let method = Method::from_bytes(method.as_bytes()).map_err(|_| "不支持的请求方法")?;
    let mut request = apply_headers(state.client.request(method, request_url(&session, &path)), &session, false).header(header::ACCEPT, "application/json, text/plain, */*");
    if let Some(body) = body { request = request.json(&body); }
    response_json(request.send().await.map_err(|error| format!("网络请求失败：{error}"))?).await
}

#[tauri::command]
async fn cis_upload_files(files: Vec<UploadFile>, biz_id: Option<String>, state: State<'_, CisState>) -> Result<Value, String> {
    if files.is_empty() { return Err("请至少选择一张图片".into()); }
    let session = state.session.lock().map_err(|_| "会话锁定失败")?.clone().ok_or_else(|| "登录已失效，请重新粘贴登录凭据".to_string())?;
    let mut form = multipart::Form::new()
        .text("watermarkStyle.rotate", "")
        .text("bizId", biz_id.unwrap_or_default())
        .text("isIphone", "false")
        .text("addWatermark", "false")
        .text("watermarkStyle.color", "");
    for file in files {
        let encoded = file.base64.rsplit(',').next().unwrap_or(&file.base64);
        let bytes = STANDARD.decode(encoded).map_err(|_| format!("图片 {} 的编码无效", file.name))?;
        let mut part = multipart::Part::bytes(bytes).file_name(file.name);
        if let Some(mime) = file.mime.filter(|value| !value.is_empty()) { part = part.mime_str(&mime).map_err(|_| "图片 MIME 类型无效")?; }
        form = form.part("multipartFiles", part);
    }
    let request = apply_headers(state.client.post(request_url(&session, "/api/appsys/file/upload")), &session, true)
        .header(header::ACCEPT, "*/*")
        .multipart(form);
    response_json(request.send().await.map_err(|error| format!("上传失败：{error}"))?).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(CisState::default())
        .invoke_handler(tauri::generate_handler![
            cis_auth_status,
            cis_configure_session,
            cis_clear_session,
            cis_auth_history,
            cis_restore_auth_history,
            device_identity_preview,
            cis_download_file,
            cis_request,
            cis_upload_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
