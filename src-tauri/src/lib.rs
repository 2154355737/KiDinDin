use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{header, multipart, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
mod vacant_room;
mod img_augment;
mod floating_overlay;
#[cfg(mobile)]
use tauri_plugin_biometric::{AuthOptions, BiometricExt};

const DEFAULT_TARGET: &str = "https://cis.whng.com.cn";
const AUTH_REFRESH_PATH: &str = "/api/auth/oauth/token";
const AUTH_REFRESH_BASIC_AUTH: &str = "Basic cGlnOnBpZw==";
const AUTH_TENANT_ID: &str = "1";
const EXPORT_SHARED_PASSWORD: &str = "ahk12378dx";
const DINGTALK_REFERER: &str = "https://2021001142645745.eco.dingtalkapps.com/index.html";
const DINGTALK_APP_ID: &str = "com.alibaba.android.rimet";
const DINGTALK_APP_VERSION: &str = "8.3.35";
const DINGTALK_PLATFORM: &str = "Android 16 · zh-CN";
const MOBILE_USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 16; zh-CN) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 Mobile Safari/537.36 AliApp(DingTalk/8.3.35) com.alibaba.android.rimet";
const FILE_UPLOAD_USER_AGENT: &str = "MiniFileUploaderAliApp(DingTalk/8.3.35) com.alibaba.android.rimet";

#[derive(Clone, Default, Deserialize, Serialize)]
struct CisSession {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    scope: Option<String>,
    license: Option<String>,
    active: Option<bool>,
    user_info: Option<Value>,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshTokenInput {
    refresh_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportAuthInput {
    verification: String,
    password: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatus {
    authenticated: bool,
    employee_number: Option<String>,
    expires_at: Option<i64>,
    refresh_available: bool,
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

fn random_jpeg_file_name() -> String {
    let random_part = Uuid::new_v4().simple().to_string();
    format!("MIe{}.jpg", &random_part[..20])
}

#[derive(Serialize)]
struct ExportedAuthSession {
    access_token: String,
    token_type: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    license: Option<String>,
    active: bool,
    user_info: Value,
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

fn first_text(root: &Value, payload: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| non_empty(root.get(*key)).or_else(|| non_empty(payload.get(*key))))
}

fn numeric_value(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| value.as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_str().and_then(|value| value.trim().parse::<i64>().ok())))
}

fn expiration_timestamp(root: &Value, payload: &Value) -> Option<i64> {
    let expires_at = ["expiresAt", "expires_at"].iter()
        .find_map(|key| numeric_value(root.get(*key)).or_else(|| numeric_value(payload.get(*key))));
    if let Some(value) = expires_at.filter(|value| *value > 0) {
        return Some(if value < 2_000_000_000 { value * 1000 } else { value });
    }
    let expires_in = ["expires_in", "expiresIn"].iter()
        .find_map(|key| numeric_value(root.get(*key)).or_else(|| numeric_value(payload.get(*key))));
    expires_in.filter(|value| *value > 0).map(|value| current_timestamp_millis() + value * 1000)
}

fn session_status(session: Option<&CisSession>) -> SessionStatus {
    SessionStatus {
        authenticated: session.is_some_and(|value| !value.access_token.is_empty()),
        employee_number: session.and_then(|value| value.employee_number.clone()),
        expires_at: session.and_then(|value| value.expires_at),
        refresh_available: session.and_then(|value| value.refresh_token.as_ref()).is_some_and(|value| !value.is_empty()),
        username: session.and_then(|value| value.username.clone()),
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn current_timestamp_millis() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64
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

fn same_auth_session(left: &CisSession, right: &CisSession) -> bool {
    let left_account = left.employee_number.as_ref().or(left.username.as_ref());
    let right_account = right.employee_number.as_ref().or(right.username.as_ref());
    match (left_account, right_account) {
        (Some(left_account), Some(right_account)) => left_account == right_account,
        _ => left.access_token == right.access_token
            || left.refresh_token.as_ref().is_some_and(|token| right.refresh_token.as_ref().is_some_and(|other| token == other)),
    }
}

fn remember_auth_session(app: &AppHandle, session: &CisSession, previous_session: Option<&CisSession>) -> Result<(), String> {
    let key = account_key(session);
    let mut history = read_auth_history(app)?;
    if let Some(entry) = history.iter_mut().find(|entry| {
        account_key(&entry.session) == key
            || same_auth_session(&entry.session, session)
            || previous_session.is_some_and(|previous| same_auth_session(&entry.session, previous))
    }) {
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
    let root = parsed.as_ref().unwrap_or(&Value::Null);
    let payload = root.get("data").unwrap_or(root);
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
        refresh_token: first_text(root, payload, &["refresh_token", "refreshToken"]),
        token_type: first_text(root, payload, &["token_type", "tokenType"]),
        scope: first_text(root, payload, &["scope"]),
        license: first_text(root, payload, &["license"]),
        active: root.get("active").and_then(Value::as_bool).or_else(|| payload.get("active").and_then(Value::as_bool)),
        user_info: payload.get("user_info").or_else(|| payload.get("userInfo")).cloned(),
        cookie: input.cookie.or_else(|| non_empty(payload.get("cookie"))).unwrap_or_default().trim().to_string(),
        sign: input.sign.or_else(|| non_empty(payload.get("sign"))).unwrap_or_default().trim().to_string(),
        target,
        username: non_empty(user_info.and_then(|value| value.get("username"))).or_else(|| non_empty(payload.get("username"))),
        employee_number: non_empty(user_info.and_then(|value| value.get("employeeNumber"))).or_else(|| non_empty(payload.get("employeeNumber"))),
        expires_at: expiration_timestamp(root, payload),
    })
}

fn refreshed_session(current: &CisSession, response: &Value) -> Result<CisSession, String> {
    if numeric_value(response.get("code")).is_some_and(|code| code != 0) {
        return Err(non_empty(response.get("msg")).unwrap_or_else(|| "Token 续期被服务端拒绝".into()));
    }
    let payload = response.get("data").unwrap_or(response);
    let access_token = first_text(response, payload, &["access_token", "accessToken", "token", "authorization"])
        .map(|value| value.trim_start_matches("Bearer ").trim_start_matches("bearer ").trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "续期响应缺少 access_token".to_string())?;
    let user_info = payload.get("user_info").or_else(|| payload.get("userInfo"));
    let mut next = current.clone();
    next.access_token = access_token;
    next.refresh_token = first_text(response, payload, &["refresh_token", "refreshToken"]).or_else(|| current.refresh_token.clone());
    next.token_type = first_text(response, payload, &["token_type", "tokenType"]).or_else(|| current.token_type.clone());
    next.scope = first_text(response, payload, &["scope"]).or_else(|| current.scope.clone());
    next.license = first_text(response, payload, &["license"]).or_else(|| current.license.clone());
    next.active = response.get("active").and_then(Value::as_bool).or_else(|| payload.get("active").and_then(Value::as_bool)).or(current.active);
    next.user_info = payload.get("user_info").or_else(|| payload.get("userInfo")).cloned().or_else(|| current.user_info.clone());
    next.expires_at = expiration_timestamp(response, payload);
    if let Some(cookie) = first_text(response, payload, &["cookie"]) { next.cookie = cookie; }
    if let Some(sign) = first_text(response, payload, &["sign"]) { next.sign = sign; }
    next.username = non_empty(user_info.and_then(|value| value.get("username"))).or_else(|| non_empty(payload.get("username"))).or(next.username);
    next.employee_number = non_empty(user_info.and_then(|value| value.get("employeeNumber"))).or_else(|| non_empty(payload.get("employeeNumber"))).or(next.employee_number);
    Ok(next)
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
    let _ = remember_auth_session(&app, &session, None);
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
fn cis_set_refresh_token(input: RefreshTokenInput, app: AppHandle, state: State<'_, CisState>) -> Result<SessionStatus, String> {
    let refresh_token = input.refresh_token.trim();
    if refresh_token.is_empty() { return Err("请粘贴 refresh_token".into()); }
    let current = state.session.lock().map_err(|_| "会话锁定失败")?.clone().ok_or_else(|| "当前没有可更新的登录会话".to_string())?;
    let mut next = current.clone();
    next.refresh_token = Some(refresh_token.to_string());
    let status = session_status(Some(&next));
    *state.session.lock().map_err(|_| "会话锁定失败")? = Some(next.clone());
    let _ = remember_auth_session(&app, &next, Some(&current));
    Ok(status)
}

fn exported_auth_session(session: &CisSession) -> ExportedAuthSession {
    let expires_in = session.expires_at.map(|expires_at| ((expires_at - current_timestamp_millis()) / 1000).max(0));
    let user_info = session.user_info.clone().unwrap_or_else(|| {
        serde_json::json!({
            "username": session.username,
            "employeeNumber": session.employee_number,
        })
    });
    ExportedAuthSession {
        access_token: session.access_token.clone(),
        token_type: session.token_type.clone().unwrap_or_else(|| "bearer".into()),
        refresh_token: session.refresh_token.clone(),
        expires_in,
        scope: session.scope.clone(),
        license: session.license.clone(),
        active: session.active.unwrap_or(true),
        user_info,
    }
}

#[tauri::command]
fn cis_export_auth_session(input: ExportAuthInput, app: AppHandle, state: State<'_, CisState>) -> Result<String, String> {
    match input.verification.as_str() {
        "password" => {
            if input.password.as_deref() != Some(EXPORT_SHARED_PASSWORD) {
                return Err("公用密码不正确".into());
            }
        }
        "biometric" => {
            #[cfg(mobile)]
            app.biometric().authenticate(
                "验证指纹后导出当前登录 JSON".into(),
                AuthOptions {
                    allow_device_credential: false,
                    cancel_title: Some("取消".into()),
                    title: Some("验证身份".into()),
                    subtitle: Some("导出当前登录凭据".into()),
                    confirmation_required: Some(false),
                    ..Default::default()
                },
            ).map_err(|error| format!("生物识别未通过：{error}"))?;
            #[cfg(not(mobile))]
            {
                let _ = app;
                return Err("仅支持在 Android 应用内进行指纹验证".into());
            }
        }
        _ => return Err("不支持的导出验证方式".into()),
    }

    let session = state.session.lock().map_err(|_| "会话锁定失败")?.clone().ok_or_else(|| "当前没有可导出的登录会话".to_string())?;
    serde_json::to_string_pretty(&exported_auth_session(&session)).map_err(|error| format!("导出登录 JSON 失败：{error}"))
}

#[tauri::command]
async fn cis_refresh_auth_session(app: AppHandle, state: State<'_, CisState>) -> Result<SessionStatus, String> {
    let current = state.session.lock().map_err(|_| "会话锁定失败")?.clone().ok_or_else(|| "当前没有可续期的登录会话".to_string())?;
    let refresh_token = current.refresh_token.clone().filter(|value| !value.trim().is_empty()).ok_or_else(|| "当前会话没有 refresh_token，请重新粘贴完整登录响应 JSON".to_string())?;
    let timestamp = current_timestamp_millis().to_string();
    let mut request = state.client.post(request_url(&current, AUTH_REFRESH_PATH))
        .query(&[("grant_type", "refresh_token"), ("refresh_token", refresh_token.as_str())])
        .header(header::AUTHORIZATION, AUTH_REFRESH_BASIC_AUTH)
        .header("tenant-id", AUTH_TENANT_ID)
        .header("x-request-id", Uuid::new_v4().to_string())
        .header("ts", timestamp)
        .header("agent", "DDDigitalCis")
        .header(header::USER_AGENT, MOBILE_USER_AGENT)
        .header(header::ACCEPT, "application/json, text/plain, */*");
    if !current.cookie.is_empty() { request = request.header(header::COOKIE, &current.cookie); }
    let response = response_json(request.send().await.map_err(|error| format!("Token 续期网络失败：{error}"))?).await?;
    let next = refreshed_session(&current, &response)?;
    let status = session_status(Some(&next));
    *state.session.lock().map_err(|_| "会话锁定失败")? = Some(next.clone());
    let _ = remember_auth_session(&app, &next, Some(&current));
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
fn is_mobile_runtime() -> bool {
    cfg!(mobile)
}

#[tauri::command]
async fn cis_download_file(
    path: String,
    image_state: State<'_, vacant_room::VacantRoomImageState>,
) -> Result<DownloadedFile, String> {
    if path.trim().is_empty() { return Err("图片下载地址为空".into()); }
    let (bytes, format, _mime) = image_state.download_image(&path).await?;
    // 自动历史照片在上传前统一走增广；CPU 密集处理不占用异步请求线程。
    let augmented = tauri::async_runtime::spawn_blocking(move || {
        crate::img_augment::augment_image(&bytes, format)
    })
    .await
    .map_err(|error| format!("图片增广任务异常终止：{error}"))??;
    Ok(DownloadedFile {
        base64: STANDARD.encode(&augmented),
        mime: "image/jpeg".into(),
        name: random_jpeg_file_name(),
    })
}

#[tauri::command]
async fn cis_request(
    path: String,
    method: String,
    body: Option<Value>,
    state: State<'_, CisState>,
) -> Result<Value, String> {
    if !path.starts_with("/api/") {
        return Err("业务请求只允许使用相对 /api/ 路径".into());
    }
    let session = state.session.lock().map_err(|_| "会话锁定失败")?.clone().ok_or_else(|| "登录已失效，请重新粘贴登录凭据".to_string())?;
    let method = Method::from_bytes(method.as_bytes()).map_err(|_| "不支持的请求方法")?;
    let mut request = apply_headers(state.client.request(method, request_url(&session, &path)), &session, false).header(header::ACCEPT, "application/json, text/plain, */*");
    if let Some(body) = body { request = request.json(&body); }
    response_json(request.send().await.map_err(|error| format!("网络请求失败：{error}"))?).await
}

#[tauri::command]
async fn cis_upload_files(
    files: Vec<UploadFile>,
    biz_id: Option<String>,
    add_watermark: Option<bool>,
    state: State<'_, CisState>,
) -> Result<Value, String> {
    if files.is_empty() {
        return Err("请至少选择一张图片".into());
    }
    let session = state.session.lock().map_err(|_| "会话锁定失败")?.clone().ok_or_else(|| "登录已失效，请重新粘贴登录凭据".to_string())?;
    let security_watermark = add_watermark.unwrap_or(false);
    let mut form = multipart::Form::new()
        .text(
            "watermarkStyle.rotate",
            if security_watermark { "0" } else { "" },
        )
        .text("bizId", biz_id.unwrap_or_default())
        .text("isIphone", "false")
        .text(
            "addWatermark",
            if security_watermark { "true" } else { "false" },
        )
        .text(
            "watermarkStyle.color",
            if security_watermark { "EE2C2C" } else { "" },
        );
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(floating_overlay::init())
        .plugin(vacant_room::init());
    #[cfg(mobile)]
    let builder = builder
        .plugin(tauri_plugin_biometric::init())
        .plugin(tauri_plugin_barcode_scanner::init());
    builder
        .manage(CisState::default())
        .manage(vacant_room::VacantRoomImageState::default())
        .invoke_handler(tauri::generate_handler![
            cis_auth_status,
            cis_configure_session,
            cis_clear_session,
            cis_auth_history,
            cis_restore_auth_history,
            cis_set_refresh_token,
            cis_refresh_auth_session,
            cis_export_auth_session,
            device_identity_preview,
            is_mobile_runtime,
            floating_overlay::floating_overlay_status,
            floating_overlay::floating_overlay_request_permission,
            floating_overlay::floating_overlay_show,
            floating_overlay::floating_overlay_hide,
            floating_overlay::floating_overlay_open_accessibility_settings,
            floating_overlay::work_order_index_sync,
            floating_overlay::consume_pending_prefill_target,
            floating_overlay::report_work_order_prefill,
            floating_overlay::report_work_order_security_date,
            cis_download_file,
            vacant_room::cis_cache_vacant_room_image,
            vacant_room::clear_vacant_room_image_cache,
            vacant_room::save_vacant_room_images,
            vacant_room::verify_augment_image,
            cis_request,
            cis_upload_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::random_jpeg_file_name;

    #[test]
    fn jpeg_file_name_is_random_and_matches_reencoded_content() {
        let first = random_jpeg_file_name();
        let second = random_jpeg_file_name();
        assert_ne!(first, second);
        for name in [first, second] {
            assert_eq!(name.len(), 27);
            assert!(name.starts_with("MIe"));
            assert!(name.ends_with(".jpg"));
            assert!(name[3..23].chars().all(|character| character.is_ascii_hexdigit()));
        }
    }
}
