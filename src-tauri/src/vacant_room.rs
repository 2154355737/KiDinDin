use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageReader};
use reqwest::{header, redirect, Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

const IMAGE_HOST: &str = "whng-digitial-cis.oss-cn-shanghai.aliyuncs.com";
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const CACHE_FOLDER: &str = "vacant-room-images";
const CACHE_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

pub struct VacantRoomImageState {
    client: Client,
}

impl Default for VacantRoomImageState {
    fn default() -> Self {
        Self {
            client: Client::builder()
                .redirect(redirect::Policy::none())
                .timeout(Duration::from_secs(35))
                .build()
                .expect("create vacant-room image client"),
        }
    }
}

impl VacantRoomImageState {
    pub async fn download_image(
        &self,
        path: &str,
    ) -> Result<(Vec<u8>, image::ImageFormat, &'static str), String> {
        let url = validate_image_url(path.trim())?;
        let mut response = self
            .client
            .get(url)
            .header(
                header::ACCEPT,
                "image/jpeg,image/png,image/webp,image/*;q=0.8",
            )
            .send()
            .await
            .map_err(|error| format!("下载历史安检图片失败：{error}"))?;
        if response.status().is_redirection() {
            return Err("图片服务返回了未允许的重定向".into());
        }
        if !response.status().is_success() {
            return Err(format!("图片下载返回 {}，请重新提取", response.status()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_IMAGE_BYTES as u64)
        {
            return Err("单张图片超过 20MB 安全上限".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("读取历史安检图片失败：{error}"))?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
                return Err("单张图片超过 20MB 安全上限".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() {
            return Err("图片内容为空".into());
        }
        let format = image::guess_format(&bytes).map_err(|_| "下载内容不是有效图片".to_string())?;
        let (_, mime) = image_extension(format)?;
        Ok((bytes, format, mime))
    }
}

#[cfg(target_os = "android")]
struct VacantRoomMedia<R: Runtime> {
    handle: PluginHandle<R>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = PluginBuilder::<R>::new("vacant-room-media");
    #[cfg(target_os = "android")]
    let builder = builder.setup(|app, api| {
        let handle = api.register_android_plugin("com.ki.tauri_android_app", "MediaStorePlugin")?;
        app.manage(VacantRoomMedia { handle });
        Ok(())
    });
    builder.build()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedVacantRoomImage {
    cache_key: String,
    mime: String,
    original_name: String,
    preview_data_url: String,
    sha256: String,
    size: usize,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedImageSaveInput {
    cache_key: String,
    display_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    display_name: String,
    uri: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImagesResult {
    saved: Vec<SavedImage>,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidImageSaveInput {
    path: String,
    display_name: String,
    mime: String,
}

fn cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位图片缓存目录：{error}"))?
        .join(CACHE_FOLDER);
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建图片缓存目录：{error}"))?;
    Ok(directory)
}

fn clear_stale_files(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > CACHE_MAX_AGE);
        if stale && path.is_file() {
            let _ = fs::remove_file(path);
        }
    }
}

fn validate_image_url(path: &str) -> Result<Url, String> {
    let url = Url::parse(path).map_err(|_| "图片下载地址格式无效".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some(IMAGE_HOST)
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("图片下载地址不在允许的 OSS 安全域名内".into());
    }
    Ok(url)
}

fn image_extension(format: image::ImageFormat) -> Result<(&'static str, &'static str), String> {
    match format {
        image::ImageFormat::Jpeg => Ok(("jpg", "image/jpeg")),
        image::ImageFormat::Png => Ok(("png", "image/png")),
        image::ImageFormat::WebP => Ok(("webp", "image/webp")),
        _ => Err("仅支持 JPEG、PNG 或 WebP 图片".into()),
    }
}

fn safe_display_name(value: &str, fallback: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect::<String>();
    let trimmed = sanitized.trim().trim_matches('.').trim();
    let selected = if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    };
    selected.chars().take(96).collect()
}

fn cached_path(directory: &Path, cache_key: &str) -> Result<PathBuf, String> {
    if cache_key.is_empty()
        || cache_key.len() > 80
        || cache_key.contains('/')
        || cache_key.contains('\\')
        || cache_key.contains("..")
    {
        return Err("图片缓存标识无效".into());
    }
    let path = directory.join(cache_key);
    if !path.is_file() {
        return Err("图片缓存已失效，请重新提取".into());
    }
    Ok(path)
}

#[cfg(target_os = "android")]
fn cached_image_mime(path: &Path) -> Result<&'static str, String> {
    match path.extension().and_then(|value| value.to_str()) {
        Some("jpg") => Ok("image/jpeg"),
        Some("png") => Ok("image/png"),
        Some("webp") => Ok("image/webp"),
        _ => Err("图片缓存格式无效，请重新提取".into()),
    }
}

#[tauri::command]
pub async fn cis_cache_vacant_room_image(
    app: AppHandle,
    path: String,
    file_name: String,
    state: tauri::State<'_, VacantRoomImageState>,
) -> Result<CachedVacantRoomImage, String> {
    let (bytes, format, mime) = state.download_image(&path).await?;
    let (extension, _) = image_extension(format)?;
    let image = ImageReader::with_format(Cursor::new(bytes.as_slice()), format)
        .decode()
        .map_err(|_| "图片内容损坏，无法解码".to_string())?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let cache_key = format!("{sha256}.{extension}");
    let directory = cache_directory(&app)?;
    clear_stale_files(&directory);
    let file_path = directory.join(&cache_key);
    if !file_path.exists() {
        fs::write(&file_path, &bytes).map_err(|error| format!("写入图片缓存失败：{error}"))?;
    }

    let thumbnail = image.thumbnail(360, 360).to_rgb8();
    let mut preview = Vec::new();
    JpegEncoder::new_with_quality(&mut preview, 76)
        .encode_image(&thumbnail)
        .map_err(|_| "生成图片预览失败".to_string())?;

    Ok(CachedVacantRoomImage {
        cache_key,
        mime: mime.into(),
        original_name: safe_display_name(&file_name, "历史安检照片"),
        preview_data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(preview)),
        sha256,
        size: bytes.len(),
    })
}

#[tauri::command]
pub fn clear_vacant_room_image_cache(app: AppHandle) -> Result<(), String> {
    let directory = cache_directory(&app)?;
    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|error| format!("清除图片缓存失败：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_vacant_room_images(
    app: AppHandle,
    images: Vec<CachedImageSaveInput>,
    relative_path: String,
) -> Result<SaveImagesResult, String> {
    if images.is_empty() {
        return Err("没有可保存的图片".into());
    }
    if images.len() > 200 {
        return Err("单次最多保存 200 张图片".into());
    }
    let directory = cache_directory(&app)?;
    let relative_path = safe_display_name(&relative_path, "本次提取");

    #[cfg(target_os = "android")]
    {
        let state = app.state::<VacantRoomMedia<tauri::Wry>>();
        let mobile_images = images
            .into_iter()
            .map(|image| {
                let path = cached_path(&directory, &image.cache_key)?;
                let mime = cached_image_mime(&path)?;
                Ok(AndroidImageSaveInput {
                    path: path.to_string_lossy().into_owned(),
                    display_name: safe_display_name(&image.display_name, "历史安检照片.jpg"),
                    mime: mime.into(),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        return state
            .handle
            .run_mobile_plugin(
                "saveImages",
                serde_json::json!({
                    "images": mobile_images,
                    "relativePath": relative_path,
                }),
            )
            .map_err(|error| format!("保存到系统相册失败：{error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let output_directory = app
            .path()
            .picture_dir()
            .map_err(|error| format!("无法定位图片目录：{error}"))?
            .join("KiDinDin")
            .join("空房取单")
            .join(relative_path);
        fs::create_dir_all(&output_directory)
            .map_err(|error| format!("创建图片保存目录失败：{error}"))?;
        let mut saved = Vec::with_capacity(images.len());
        for image in images {
            let source = cached_path(&directory, &image.cache_key)?;
            let display_name = safe_display_name(&image.display_name, "历史安检照片.jpg");
            let destination = output_directory.join(&display_name);
            fs::copy(source, &destination)
                .map_err(|error| format!("保存 {display_name} 失败：{error}"))?;
            saved.push(SavedImage {
                display_name,
                uri: destination.to_string_lossy().into_owned(),
            });
        }
        Ok(SaveImagesResult { saved })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAugmentInput {
    base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AugmentResultItem {
    cache_key: String,
    preview_data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAugmentResult {
    augmented: AugmentResultItem,
}

#[tauri::command]
pub async fn verify_augment_image(
    app: AppHandle,
    input: VerifyAugmentInput,
) -> Result<VerifyAugmentResult, String> {
    tauri::async_runtime::spawn_blocking(move || verify_augment_image_blocking(&app, input))
        .await
        .map_err(|error| format!("图片验证任务异常终止：{error}"))?
}

fn verify_augment_image_blocking(
    app: &AppHandle,
    input: VerifyAugmentInput,
) -> Result<VerifyAugmentResult, String> {
    let raw = input.base64.rsplit(',').next().unwrap_or(&input.base64);
    let bytes = STANDARD
        .decode(raw)
        .map_err(|_| "图片 Base64 编码无效".to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!("图片不能超过 {} MB", MAX_IMAGE_BYTES / 1024 / 1024));
    }
    let format = image::guess_format(&bytes).map_err(|_| "无法识别图片格式".to_string())?;

    let original_image = ImageReader::with_format(Cursor::new(bytes.as_slice()), format)
        .decode()
        .map_err(|_| "图片内容损坏，无法解码".to_string())?;
    let prepared_image = crate::img_augment::prepare_image_for_augmentation(original_image);
    let directory = cache_directory(app)?;
    clear_stale_files(&directory);
    let augmented = build_augment_result(&prepared_image, &directory)?;

    Ok(VerifyAugmentResult { augmented })
}

fn build_augment_result(
    image: &DynamicImage,
    directory: &Path,
) -> Result<AugmentResultItem, String> {
    let (bytes, preview) = crate::img_augment::augment_prepared_image_with_preview(image)?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let cache_key = format!("verify-{sha256}.jpg");
    fs::write(directory.join(&cache_key), &bytes)
        .map_err(|error| format!("缓存增广图片失败：{error}"))?;
    Ok(AugmentResultItem {
        cache_key,
        preview_data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(preview)),
    })
}
