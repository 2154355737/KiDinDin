use tauri::{plugin::{Builder, TauriPlugin}, AppHandle, Runtime};
#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
struct NoticeCode<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::<R>::new("notice-code");
    #[cfg(target_os = "android")]
    let builder = builder.setup(|app, api| {
        let handle = api.register_android_plugin("com.ki.tauri_android_app", "NoticeCodePlugin")?;
        app.manage(NoticeCode(handle));
        Ok(())
    });
    builder.build()
}

#[tauri::command]
pub async fn recognize_notice_code(app: AppHandle, image_base64: String) -> Result<serde_json::Value, String> {
    if image_base64.is_empty() || image_base64.len() > 12 * 1024 * 1024 {
        return Err("编码识别图片大小无效".into());
    }
    #[cfg(target_os = "android")]
    {
        // Do not block the WebView or the async runtime while ML Kit processes the image.
        return tauri::async_runtime::spawn_blocking(move || {
            app.state::<NoticeCode<tauri::Wry>>().0.run_mobile_plugin(
                "recognize", serde_json::json!({ "imageBase64": image_base64 }),
            ).map_err(|error| format!("本地编码识别失败：{error}"))
        }).await.map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("当前平台不支持 Android 本地编码识别，可手动填写或继续".into())
    }
}
