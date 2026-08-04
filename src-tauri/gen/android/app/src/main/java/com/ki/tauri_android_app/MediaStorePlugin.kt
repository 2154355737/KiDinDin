package com.ki.tauri_android_app

import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.media.ExifInterface
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

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
  private data class ExistingImage(val uri: Uri, val displayName: String)

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
      val newestCapturedAt = System.currentTimeMillis()

      for ((index, item) in args.images.withIndex()) {
        val source = File(item.path).canonicalFile
        val expectedPrefix = cacheRoot.path + File.separator
        if (!source.isFile || !source.path.startsWith(expectedPrefix)) {
          throw IllegalArgumentException("图片缓存路径无效")
        }

        val legacyDisplayName = sanitizeFileName(item.displayName, "历史安检照片.jpg")
        val fingerprint = "KiDinDin:${source.nameWithoutExtension}"
        val capturedAt = newestCapturedAt - index * 1_000L
        val existing = findExistingImage(
          collection,
          fingerprint,
          legacyDisplayName,
          relativeDirectory
        )
        if (existing != null) {
          val existingDisplayName = if (existing.displayName.startsWith("MIe")) {
            existing.displayName
          } else {
            randomDisplayName(item.mime)
          }
          val updateValues = galleryValues(
            existingDisplayName,
            item.mime,
            relativeDirectory,
            fingerprint,
            capturedAt,
            false
          )
          val updated = try {
            resolver.update(existing.uri, updateValues, null, null)
          } catch (_: SecurityException) {
            0
          }
          if (updated > 0) {
            writeCapturedAt(existing.uri, item.mime, capturedAt)
            saved.put(
              JSObject()
                .put("displayName", existingDisplayName)
                .put("uri", existing.uri.toString())
            )
            continue
          }
        }
        val displayName = randomDisplayName(item.mime)
        val values = galleryValues(
          displayName,
          item.mime,
          relativeDirectory,
          fingerprint,
          capturedAt,
          true
        )
        val uri = resolver.insert(collection, values)
          ?: throw IllegalStateException("系统相册拒绝创建 $displayName")

        try {
          resolver.openOutputStream(uri, "w").use { output ->
            if (output == null) throw IllegalStateException("无法写入 $displayName")
            source.inputStream().use { input -> input.copyTo(output) }
          }
          writeCapturedAt(uri, item.mime, capturedAt)
          values.clear()
          values.put(MediaStore.Images.Media.IS_PENDING, 0)
          values.put(MediaStore.Images.Media.DATE_TAKEN, capturedAt)
          values.put(MediaStore.Images.Media.DATE_ADDED, capturedAt / 1_000L)
          values.put(MediaStore.Images.Media.DATE_MODIFIED, capturedAt / 1_000L)
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

  private fun galleryValues(
    displayName: String,
    mime: String,
    relativePath: String,
    fingerprint: String,
    capturedAt: Long,
    pending: Boolean
  ) = ContentValues().apply {
    put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
    put(MediaStore.Images.Media.MIME_TYPE, mime)
    put(MediaStore.Images.Media.RELATIVE_PATH, relativePath)
    put(MediaStore.Images.Media.DESCRIPTION, fingerprint)
    put(MediaStore.Images.Media.DATE_TAKEN, capturedAt)
    put(MediaStore.Images.Media.DATE_ADDED, capturedAt / 1_000L)
    put(MediaStore.Images.Media.DATE_MODIFIED, capturedAt / 1_000L)
    if (pending) put(MediaStore.Images.Media.IS_PENDING, 1)
  }

  private fun findExistingImage(
    collection: Uri,
    fingerprint: String,
    legacyDisplayName: String,
    relativePath: String
  ): ExistingImage? {
    val projection = arrayOf(
      MediaStore.Images.Media._ID,
      MediaStore.Images.Media.DISPLAY_NAME
    )
    val selection = "(${MediaStore.Images.Media.DESCRIPTION} = ? OR ${MediaStore.Images.Media.DISPLAY_NAME} = ?) AND ${MediaStore.Images.Media.RELATIVE_PATH} = ?"
    activity.contentResolver.query(
      collection,
      projection,
      selection,
      arrayOf(fingerprint, legacyDisplayName, relativePath),
      null
    ).use { cursor ->
      if (cursor != null && cursor.moveToFirst()) {
        return ExistingImage(
          ContentUris.withAppendedId(collection, cursor.getLong(0)),
          cursor.getString(1) ?: legacyDisplayName
        )
      }
    }
    return null
  }

  private fun randomDisplayName(mime: String): String {
    val extension = when (mime.lowercase()) {
      "image/png" -> "png"
      "image/webp" -> "webp"
      else -> "jpg"
    }
    val randomPart = UUID.randomUUID().toString().replace("-", "").take(20)
    return "MIe$randomPart.$extension"
  }

  private fun writeCapturedAt(uri: Uri, mime: String, capturedAt: Long) {
    if (!mime.equals("image/jpeg", ignoreCase = true)) return
    try {
      activity.contentResolver.openFileDescriptor(uri, "rw").use { descriptor ->
        if (descriptor == null) return
        val timestamp = SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US)
          .format(Date(capturedAt))
        ExifInterface(descriptor.fileDescriptor).apply {
          setAttribute(ExifInterface.TAG_DATETIME, timestamp)
          setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, timestamp)
          setAttribute(ExifInterface.TAG_DATETIME_DIGITIZED, timestamp)
          saveAttributes()
        }
      }
    } catch (_: Exception) {
      // DATE_TAKEN remains the fallback for providers that do not expose a seekable descriptor.
    }
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
