use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingOverlayStatus {
    supported: bool,
    permission_granted: bool,
    enabled: bool,
    visible: bool,
    accessibility_supported: bool,
    accessibility_enabled: bool,
    recognition: WorkOrderRecognitionStatus,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkOrderRecognitionStatus {
    pending: bool,
    state: String,
    message: String,
    logs: String,
    recognized_at: i64,
    account_key: String,
    wo_header_id: String,
    wo_number: String,
    resident: String,
    contact_phone: String,
    address: String,
    source_date: String,
    security_date: String,
    prefilled: bool,
    prefilled_at: i64,
    raw_json: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkOrderIndexEntry {
    wo_header_id: String,
    wo_number: String,
    resident: String,
    contact_phone: String,
    address: String,
    eligible_prefill: bool,
    raw_json: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkOrderIndexSyncResult {
    indexed: usize,
    inserted: usize,
    updated: usize,
    total: usize,
}

#[cfg(target_os = "android")]
struct FloatingOverlay<R: Runtime> {
    handle: PluginHandle<R>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = PluginBuilder::<R>::new("floating-overlay");
    #[cfg(target_os = "android")]
    let builder = builder.setup(|app, api| {
        let handle =
            api.register_android_plugin("com.ki.tauri_android_app", "FloatingOverlayPlugin")?;
        app.manage(FloatingOverlay { handle });
        Ok(())
    });
    builder.build()
}

#[cfg(not(target_os = "android"))]
fn unsupported_status() -> FloatingOverlayStatus {
    FloatingOverlayStatus {
        supported: false,
        permission_granted: false,
        enabled: false,
        visible: false,
        accessibility_supported: false,
        accessibility_enabled: false,
        recognition: WorkOrderRecognitionStatus {
            pending: false,
            state: "unsupported".into(),
            message: "工单页面识别仅支持 Android 应用".into(),
            logs: String::new(),
            recognized_at: 0,
            account_key: String::new(),
            wo_header_id: String::new(),
            wo_number: String::new(),
            resident: String::new(),
            contact_phone: String::new(),
            address: String::new(),
            source_date: String::new(),
            security_date: String::new(),
            prefilled: false,
            prefilled_at: 0,
            raw_json: String::new(),
        },
    }
}

#[tauri::command]
pub fn floating_overlay_status(app: AppHandle) -> Result<FloatingOverlayStatus, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<FloatingOverlay<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin("status", serde_json::json!({}))
            .map_err(|error| format!("读取悬浮窗状态失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(unsupported_status())
    }
}

#[tauri::command]
pub fn floating_overlay_request_permission(
    app: AppHandle,
) -> Result<FloatingOverlayStatus, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<FloatingOverlay<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin("requestPermission", serde_json::json!({}))
            .map_err(|error| format!("打开悬浮窗授权页面失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("悬浮窗仅支持 Android 应用".into())
    }
}

#[tauri::command]
pub fn floating_overlay_show(app: AppHandle) -> Result<FloatingOverlayStatus, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<FloatingOverlay<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin("show", serde_json::json!({}))
            .map_err(|error| format!("开启悬浮窗失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("悬浮窗仅支持 Android 应用".into())
    }
}

#[tauri::command]
pub fn floating_overlay_hide(app: AppHandle) -> Result<FloatingOverlayStatus, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<FloatingOverlay<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin("hide", serde_json::json!({}))
            .map_err(|error| format!("关闭悬浮窗失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("悬浮窗仅支持 Android 应用".into())
    }
}

#[tauri::command]
pub fn floating_overlay_open_accessibility_settings(
    app: AppHandle,
) -> Result<FloatingOverlayStatus, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<FloatingOverlay<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin("openAccessibilitySettings", serde_json::json!({}))
            .map_err(|error| format!("打开工单识别辅助功能失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("工单页面识别仅支持 Android 应用".into())
    }
}

#[tauri::command]
pub fn work_order_index_sync(
    app: AppHandle,
    account_key: String,
    source_date: String,
    entries: Vec<WorkOrderIndexEntry>,
) -> Result<WorkOrderIndexSyncResult, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<FloatingOverlay<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin(
                "syncWorkOrderIndex",
                serde_json::json!({
                    "accountKey": account_key,
                    "sourceDate": source_date,
                    "entries": entries,
                }),
            )
            .map_err(|error| format!("同步本地工单索引失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, account_key, source_date, entries);
        Ok(WorkOrderIndexSyncResult {
            indexed: 0,
            inserted: 0,
            updated: 0,
            total: 0,
        })
    }
}

#[tauri::command]
pub fn consume_pending_prefill_target(app: AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<FloatingOverlay<tauri::Wry>>();
        return state
            .handle
            .run_mobile_plugin("consumePendingPrefillTarget", serde_json::json!({}))
            .map_err(|error| format!("读取悬浮窗安检预填目标失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(serde_json::json!({ "pending": false }))
    }
}

#[tauri::command]
pub fn report_work_order_prefill(
    app: AppHandle,
    wo_header_id: String,
    state: String,
    message: String,
) -> Result<WorkOrderRecognitionStatus, String> {
    #[cfg(target_os = "android")]
    {
        let plugin = app.state::<FloatingOverlay<tauri::Wry>>();
        return plugin
            .handle
            .run_mobile_plugin(
                "reportWorkOrderPrefill",
                serde_json::json!({
                    "woHeaderId": wo_header_id,
                    "state": state,
                    "message": message,
                }),
            )
            .map_err(|error| format!("更新悬浮窗安检预填日志失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, wo_header_id, state, message);
        Err("悬浮窗安检预填仅支持 Android 应用".into())
    }
}

#[tauri::command]
pub fn report_work_order_security_date(
    app: AppHandle,
    wo_header_id: String,
    security_date: String,
) -> Result<WorkOrderRecognitionStatus, String> {
    #[cfg(target_os = "android")]
    {
        let plugin = app.state::<FloatingOverlay<tauri::Wry>>();
        return plugin
            .handle
            .run_mobile_plugin(
                "reportWorkOrderSecurityDate",
                serde_json::json!({
                    "woHeaderId": wo_header_id,
                    "securityDate": security_date,
                }),
            )
            .map_err(|error| format!("更新悬浮窗最近安检日期失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, wo_header_id, security_date);
        Err("悬浮窗最近安检日期仅支持 Android 应用".into())
    }
}
