package com.ki.tauri_android_app

import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class GalleryImageInput {
  lateinit var path: String
  lateinit var displayName: String
  lateinit var mime: String
}

@InvokeArg
class SaveGalleryImagesArgs {
  lateinit var images: Array<GalleryImageInput>
  var relativePath: String = "本次提取"
}

@TauriPlugin
class MediaStorePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun saveImages(invoke: Invoke) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      invoke.reject("空房取单相册保存需要 Android 10 或更高版本")
      return
    }

    try {
      val args = invoke.parseArgs(SaveGalleryImagesArgs::class.java)
      if (args.images.isEmpty()) {
        invoke.reject("没有可保存的图片")
        return
      }

      val cacheRoot = File(activity.cacheDir, "vacant-room-images").canonicalFile
      val safeRelativePath = sanitizePathPart(args.relativePath, "本次提取")
      val resolver = activity.contentResolver
      val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      val saved = JSArray()
      val relativeDirectory = "${Environment.DIRECTORY_PICTURES}/KiDinDin/空房取单/$safeRelativePath/"

      for (item in args.images) {
        val source = File(item.path).canonicalFile
        val expectedPrefix = cacheRoot.path + File.separator
        if (!source.isFile || !source.path.startsWith(expectedPrefix)) {
          throw IllegalArgumentException("图片缓存路径无效")
        }

        val displayName = sanitizeFileName(item.displayName, "历史安检照片.jpg")
        val existingUri = findExistingImage(collection, displayName, relativeDirectory)
        if (existingUri != null) {
          saved.put(
            JSObject()
              .put("displayName", displayName)
              .put("uri", existingUri.toString())
          )
          continue
        }
        val values = ContentValues().apply {
          put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
          put(MediaStore.Images.Media.MIME_TYPE, item.mime)
          put(
            MediaStore.Images.Media.RELATIVE_PATH,
            relativeDirectory
          )
          put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values)
          ?: throw IllegalStateException("系统相册拒绝创建 $displayName")

        try {
          resolver.openOutputStream(uri, "w").use { output ->
            if (output == null) throw IllegalStateException("无法写入 $displayName")
            source.inputStream().use { input -> input.copyTo(output) }
          }
          values.clear()
          values.put(MediaStore.Images.Media.IS_PENDING, 0)
          resolver.update(uri, values, null, null)
          saved.put(
            JSObject()
              .put("displayName", displayName)
              .put("uri", uri.toString())
          )
        } catch (error: Exception) {
          resolver.delete(uri, null, null)
          throw error
        }
      }

      invoke.resolve(JSObject().put("saved", saved))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "保存到系统相册失败")
    }
  }

  private fun findExistingImage(collection: Uri, displayName: String, relativePath: String): Uri? {
    val projection = arrayOf(MediaStore.Images.Media._ID)
    val selection = "${MediaStore.Images.Media.DISPLAY_NAME} = ? AND ${MediaStore.Images.Media.RELATIVE_PATH} = ?"
    activity.contentResolver.query(
      collection,
      projection,
      selection,
      arrayOf(displayName, relativePath),
      null
    ).use { cursor ->
      if (cursor != null && cursor.moveToFirst()) {
        return ContentUris.withAppendedId(collection, cursor.getLong(0))
      }
    }
    return null
  }

  private fun sanitizePathPart(value: String, fallback: String): String {
    val sanitized = value.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
      .trim()
      .trim('.')
      .take(64)
    return sanitized.ifEmpty { fallback }
  }

  private fun sanitizeFileName(value: String, fallback: String): String {
    val sanitized = value.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
      .trim()
      .trim('.')
      .take(96)
    return sanitized.ifEmpty { fallback }
  }
}
