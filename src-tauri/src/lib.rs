use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{header, multipart, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

const DEFAULT_TARGET: &str = "https://cis.whng.com.cn";
const DINGTALK_REFERER: &str = "https://2021001142645745.eco.dingtalkapps.com/index.html";
const MOBILE_USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 16; zh-CN) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 Mobile Safari/537.36 AliApp(DingTalk/8.3.35) com.alibaba.android.rimet";
const FILE_UPLOAD_USER_AGENT: &str = "MiniFileUploaderAliApp(DingTalk/8.3.35) com.alibaba.android.rimet";

#[derive(Clone, Default)]
struct CisSession {
    access_token: String,
    cookie: String,
    sign: String,
    target: String,
    username: Option<String>,
    employee_number: Option<String>,
    expires_at: Option<i64>,
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
    if path.starts_with("https://") { path.to_string() } else { format!("{}{}", session.target, if path.starts_with('/') { path } else { "/" }) }
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
fn cis_configure_session(input: SessionInput, state: State<'_, CisState>) -> Result<SessionStatus, String> {
    let session = parse_session(input)?;
    let status = session_status(Some(&session));
    *state.session.lock().map_err(|_| "会话锁定失败")? = Some(session);
    Ok(status)
}

#[tauri::command]
fn cis_clear_session(state: State<'_, CisState>) -> Result<SessionStatus, String> {
    *state.session.lock().map_err(|_| "会话锁定失败")? = None;
    Ok(session_status(None))
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
            cis_request,
            cis_upload_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
