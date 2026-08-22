use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
const MAX_LARGE_BACKUP_CHUNK_CHARACTERS: usize = 4 * 1024 * 1024;

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDatabaseExportResult {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    backup: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    database_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    work_order_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prefill_history_count: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDatabaseImportResult {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    work_orders_imported: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prefill_history_imported: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    work_order_total: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prefill_history_total: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDatabaseValidationResult {
    supported: bool,
    valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    work_order_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prefill_history_count: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackupFileResult {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    destination: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginLargeBackupResult {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendLargeBackupResult {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    appended_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbortLargeBackupResult {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aborted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[cfg(target_os = "android")]
struct NativeBackup<R: Runtime> {
    handle: PluginHandle<R>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = PluginBuilder::<R>::new("backup");
    #[cfg(target_os = "android")]
    let builder = builder.setup(|app, api| {
        let handle = api.register_android_plugin("com.ki.tauri_android_app", "BackupPlugin")?;
        app.manage(NativeBackup { handle });
        Ok(())
    });
    builder.build()
}

#[cfg(not(target_os = "android"))]
fn unsupported_export() -> NativeDatabaseExportResult {
    NativeDatabaseExportResult {
        supported: false,
        backup: None,
        database_name: None,
        work_order_count: None,
        prefill_history_count: None,
    }
}

#[cfg(not(target_os = "android"))]
fn unsupported_import() -> NativeDatabaseImportResult {
    NativeDatabaseImportResult {
        supported: false,
        work_orders_imported: None,
        prefill_history_imported: None,
        work_order_total: None,
        prefill_history_total: None,
    }
}

#[cfg(not(target_os = "android"))]
fn unsupported_validation() -> NativeDatabaseValidationResult {
    NativeDatabaseValidationResult {
        supported: false,
        valid: false,
        work_order_count: None,
        prefill_history_count: None,
    }
}

#[cfg(not(target_os = "android"))]
fn unsupported_save() -> SaveBackupFileResult {
    SaveBackupFileResult {
        supported: false,
        file_name: None,
        destination: None,
        uri: None,
        size: None,
        sha256: None,
        error: Some("当前平台不支持原生备份文件保存".into()),
    }
}

#[cfg(not(target_os = "android"))]
fn unsupported_large_backup_begin() -> BeginLargeBackupResult {
    BeginLargeBackupResult {
        supported: false,
        session_id: None,
        file_name: None,
        error: Some("当前平台不支持大型备份文件流式写入".into()),
    }
}

#[cfg(not(target_os = "android"))]
fn unsupported_large_backup_append() -> AppendLargeBackupResult {
    AppendLargeBackupResult {
        supported: false,
        session_id: None,
        appended_size: None,
        size: None,
        error: Some("当前平台不支持大型备份文件流式写入".into()),
    }
}

#[cfg(not(target_os = "android"))]
fn unsupported_large_backup_abort() -> AbortLargeBackupResult {
    AbortLargeBackupResult {
        supported: false,
        session_id: None,
        aborted: None,
        error: Some("当前平台不支持大型备份文件流式写入".into()),
    }
}

#[cfg(not(target_os = "android"))]
fn unsupported_large_backup_finish() -> SaveBackupFileResult {
    SaveBackupFileResult {
        supported: false,
        file_name: None,
        destination: None,
        uri: None,
        size: None,
        sha256: None,
        error: Some("当前平台不支持大型备份文件流式写入".into()),
    }
}

#[cfg(target_os = "android")]
fn validated_large_backup_session_id(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    uuid::Uuid::parse_str(trimmed)
        .map(|session_id| session_id.to_string())
        .map_err(|_| "大型备份会话标识无效".into())
}

#[tauri::command]
pub fn native_database_export(app: AppHandle) -> Result<NativeDatabaseExportResult, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<NativeBackup<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin("exportDatabase", serde_json::json!({}))
            .map_err(|error| format!("导出原生 SQLite 数据库失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(unsupported_export())
    }
}

#[tauri::command]
pub fn native_database_import(
    app: AppHandle,
    payload: String,
) -> Result<NativeDatabaseImportResult, String> {
    #[cfg(target_os = "android")]
    {
        if payload.trim().is_empty() {
            return Err("原生 SQLite 备份内容为空".into());
        }
        let state = app.state::<NativeBackup<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin("importDatabase", serde_json::json!({ "payload": payload }))
            .map_err(|error| format!("导入原生 SQLite 数据库失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, payload);
        Ok(unsupported_import())
    }
}

#[tauri::command]
pub fn native_database_validate(
    app: AppHandle,
    payload: String,
) -> Result<NativeDatabaseValidationResult, String> {
    #[cfg(target_os = "android")]
    {
        if payload.trim().is_empty() {
            return Err("原生 SQLite 备份内容为空".into());
        }
        let state = app.state::<NativeBackup<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin(
                "validateDatabase",
                serde_json::json!({ "payload": payload }),
            )
            .map_err(|error| format!("校验原生 SQLite 备份失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, payload);
        Ok(unsupported_validation())
    }
}

#[tauri::command]
pub fn save_backup_file(
    app: AppHandle,
    file_name: String,
    payload: String,
) -> Result<SaveBackupFileResult, String> {
    #[cfg(target_os = "android")]
    {
        if file_name.trim().is_empty() {
            return Err("备份文件名不能为空".into());
        }
        if payload.is_empty() {
            return Err("备份文件内容为空".into());
        }
        let state = app.state::<NativeBackup<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin(
                "saveBackupFile",
                serde_json::json!({
                    "fileName": file_name,
                    "payload": payload,
                }),
            )
            .map_err(|error| format!("保存完整备份文件失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, file_name, payload);
        Ok(unsupported_save())
    }
}

#[tauri::command]
pub fn begin_large_backup(
    app: AppHandle,
    file_name: String,
) -> Result<BeginLargeBackupResult, String> {
    #[cfg(target_os = "android")]
    {
        let file_name = file_name.trim();
        if file_name.is_empty() {
            return Err("大型备份文件名不能为空".into());
        }
        let state = app.state::<NativeBackup<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin(
                "beginLargeBackup",
                serde_json::json!({ "fileName": file_name }),
            )
            .map_err(|error| format!("创建大型备份文件失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, file_name);
        Ok(unsupported_large_backup_begin())
    }
}

#[tauri::command]
pub fn append_large_backup(
    app: AppHandle,
    session_id: String,
    chunk: String,
) -> Result<AppendLargeBackupResult, String> {
    #[cfg(target_os = "android")]
    {
        let session_id = validated_large_backup_session_id(session_id)?;
        if chunk
            .encode_utf16()
            .take(MAX_LARGE_BACKUP_CHUNK_CHARACTERS + 1)
            .count()
            > MAX_LARGE_BACKUP_CHUNK_CHARACTERS
        {
            return Err("大型备份单次追加不能超过 4MiB 字符".into());
        }
        let state = app.state::<NativeBackup<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin(
                "appendLargeBackup",
                serde_json::json!({
                    "sessionId": session_id,
                    "chunk": chunk,
                }),
            )
            .map_err(|error| format!("追加大型备份数据失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, session_id, chunk);
        Ok(unsupported_large_backup_append())
    }
}

#[tauri::command]
pub fn finish_large_backup(
    app: AppHandle,
    session_id: String,
    expected_size: u64,
    expected_sha256: String,
) -> Result<SaveBackupFileResult, String> {
    #[cfg(target_os = "android")]
    {
        let session_id = validated_large_backup_session_id(session_id)?;
        if expected_size > i64::MAX as u64 {
            return Err("大型备份预期大小超过 Android 支持范围".into());
        }
        let expected_sha256 = expected_sha256.trim().to_ascii_lowercase();
        if expected_sha256.len() != 64
            || !expected_sha256
                .bytes()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err("大型备份预期 SHA-256 无效".into());
        }
        let state = app.state::<NativeBackup<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin(
                "finishLargeBackup",
                serde_json::json!({
                    "sessionId": session_id,
                    "expectedSize": expected_size,
                    "expectedSha256": expected_sha256,
                }),
            )
            .map_err(|error| format!("完成大型备份文件失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, session_id, expected_size, expected_sha256);
        Ok(unsupported_large_backup_finish())
    }
}

#[tauri::command]
pub fn abort_large_backup(
    app: AppHandle,
    session_id: String,
) -> Result<AbortLargeBackupResult, String> {
    #[cfg(target_os = "android")]
    {
        let session_id = validated_large_backup_session_id(session_id)?;
        let state = app.state::<NativeBackup<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin(
                "abortLargeBackup",
                serde_json::json!({ "sessionId": session_id }),
            )
            .map_err(|error| format!("取消大型备份文件失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, session_id);
        Ok(unsupported_large_backup_abort())
    }
}
