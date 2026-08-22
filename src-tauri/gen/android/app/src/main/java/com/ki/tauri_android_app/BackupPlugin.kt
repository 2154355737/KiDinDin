package com.ki.tauri_android_app

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

private const val LEGACY_DOWNLOADS_PERMISSION = "legacyDownloads"
private const val MAX_LARGE_BACKUP_CHUNK_CHARACTERS = 4 * 1024 * 1024
private const val MAX_ACTIVE_LARGE_BACKUPS = 4

@InvokeArg
class NativeDatabaseImportArgs {
  lateinit var payload: String
}

@InvokeArg
class SaveBackupFileArgs {
  lateinit var fileName: String
  lateinit var payload: String
}

@InvokeArg
class BeginLargeBackupArgs {
  lateinit var fileName: String
}

@InvokeArg
class AppendLargeBackupArgs {
  lateinit var sessionId: String
  lateinit var chunk: String
}

@InvokeArg
class FinishLargeBackupArgs {
  lateinit var sessionId: String
  var expectedSize: Long = -1L
  lateinit var expectedSha256: String
}

@InvokeArg
class AbortLargeBackupArgs {
  lateinit var sessionId: String
}

private data class SavedBackupFile(
  val fileName: String,
  val destination: String,
  val uri: Uri,
  val size: Long,
  val sha256: String,
)

private data class ParsedSaveBackupFile(
  val fileName: String,
  val payload: String,
)

private sealed interface LargeBackupDestination {
  data class MediaStoreFile(
    val uri: Uri,
    val relativePath: String,
  ) : LargeBackupDestination

  data class LegacyPublicFile(
    val temporary: File,
    var destination: File,
  ) : LargeBackupDestination
}

private data class LargeBackupSession(
  val id: String,
  val requestedFileName: String,
  val destination: LargeBackupDestination,
  val output: FileOutputStream,
  val digest: MessageDigest = MessageDigest.getInstance("SHA-256"),
  var size: Long = 0L,
  var closed: Boolean = false,
  var writerClosed: Boolean = false,
)

@TauriPlugin(
  permissions = [
    Permission(
      strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE],
      alias = LEGACY_DOWNLOADS_PERMISSION,
    ),
  ],
)
class BackupPlugin(private val activity: Activity) : Plugin(activity) {
  private val largeBackupSessions = ConcurrentHashMap<String, LargeBackupSession>()

  @Command
  fun exportDatabase(invoke: Invoke) {
    try {
      val backup = WorkOrderIndexDatabase.get(activity).exportBackup()
      val tables = backup.getJSONObject("tables")
      val workOrderCount = tables.getJSONArray("workOrderIndex").length()
      val prefillHistoryCount = tables
        .getJSONArray("residentSecurityPrefillHistory")
        .length()
      invoke.resolve(
        JSObject()
          .put("supported", true)
          .put("backup", backup)
          .put("databaseName", backup.getString("databaseName"))
          .put("workOrderCount", workOrderCount)
          .put("prefillHistoryCount", prefillHistoryCount),
      )
    } catch (error: Exception) {
      invoke.reject(error.message ?: "导出原生 SQLite 数据库失败")
    }
  }

  @Command
  fun validateDatabase(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(NativeDatabaseImportArgs::class.java)
      val result = WorkOrderIndexDatabase.get(activity).validateBackup(args.payload)
      invoke.resolve(
        JSObject()
          .put("supported", true)
          .put("valid", true)
          .put("workOrderCount", result.workOrderCount)
          .put("prefillHistoryCount", result.prefillHistoryCount),
      )
    } catch (error: Exception) {
      invoke.reject(error.message ?: "校验原生 SQLite 备份失败")
    }
  }

  @Command
  fun importDatabase(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(NativeDatabaseImportArgs::class.java)
      val result = WorkOrderIndexDatabase.get(activity).importBackup(args.payload)
      invoke.resolve(
        JSObject()
          .put("supported", true)
          .put("workOrdersImported", result.workOrdersImported)
          .put("prefillHistoryImported", result.prefillHistoryImported)
          .put("workOrderTotal", result.workOrderTotal)
          .put("prefillHistoryTotal", result.prefillHistoryTotal),
      )
    } catch (error: Exception) {
      invoke.reject(error.message ?: "导入原生 SQLite 数据库失败")
    }
  }

  @Command
  @Synchronized
  fun saveBackupFile(invoke: Invoke) {
    try {
      val args = parseSaveBackupFile(invoke)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        saveAndResolve(invoke, args)
        return
      }
      when (getPermissionState(LEGACY_DOWNLOADS_PERMISSION)) {
        PermissionState.GRANTED -> saveAndResolve(invoke, args)
        PermissionState.PROMPT,
        PermissionState.PROMPT_WITH_RATIONALE,
        -> requestPermissionForAlias(
          LEGACY_DOWNLOADS_PERMISSION,
          invoke,
          "legacyDownloadsPermissionCallback",
        )
        PermissionState.DENIED,
        null,
        -> invoke.reject("保存到公共 Download/KiDinDin 需要存储权限，当前未写入文件")
      }
    } catch (error: Exception) {
      invoke.reject(error.message ?: "保存完整备份文件失败")
    }
  }

  @PermissionCallback
  fun legacyDownloadsPermissionCallback(invoke: Invoke) {
    try {
      if (getPermissionState(LEGACY_DOWNLOADS_PERMISSION) != PermissionState.GRANTED) {
        invoke.reject("未授予公共下载目录存储权限，备份文件未写入")
        return
      }
      saveAndResolve(invoke, parseSaveBackupFile(invoke))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "保存完整备份文件失败")
    }
  }

  @Command
  fun beginLargeBackup(invoke: Invoke) {
    try {
      val fileName = parseLargeBackupFileName(invoke)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        beginLargeBackupAndResolve(invoke, fileName)
        return
      }
      when (getPermissionState(LEGACY_DOWNLOADS_PERMISSION)) {
        PermissionState.GRANTED -> beginLargeBackupAndResolve(invoke, fileName)
        PermissionState.PROMPT,
        PermissionState.PROMPT_WITH_RATIONALE,
        -> requestPermissionForAlias(
          LEGACY_DOWNLOADS_PERMISSION,
          invoke,
          "legacyDownloadsLargeBackupPermissionCallback",
        )
        PermissionState.DENIED,
        null,
        -> invoke.reject("创建公共 Download/KiDinDin 大型备份需要存储权限，当前未创建文件")
      }
    } catch (error: Exception) {
      invoke.reject(error.message ?: "创建大型备份文件失败")
    }
  }

  @PermissionCallback
  fun legacyDownloadsLargeBackupPermissionCallback(invoke: Invoke) {
    try {
      if (getPermissionState(LEGACY_DOWNLOADS_PERMISSION) != PermissionState.GRANTED) {
        invoke.reject("未授予公共下载目录存储权限，大型备份文件未创建")
        return
      }
      beginLargeBackupAndResolve(invoke, parseLargeBackupFileName(invoke))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "创建大型备份文件失败")
    }
  }

  @Command
  fun appendLargeBackup(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(AppendLargeBackupArgs::class.java)
      val sessionId = requireLargeBackupSessionId(args.sessionId)
      if (args.chunk.length > MAX_LARGE_BACKUP_CHUNK_CHARACTERS) {
        throw IllegalArgumentException("大型备份单次追加不能超过 4MiB 字符")
      }
      val session = requireLargeBackupSession(sessionId)
      val (appendedSize, total) = synchronized(session) {
        requireOpenLargeBackupSession(session)
        val bytes = args.chunk.toByteArray(Charsets.UTF_8)
        if (session.size > Long.MAX_VALUE - bytes.size.toLong()) {
          throw IllegalStateException("大型备份累计大小超过系统支持范围")
        }
        try {
          session.output.write(bytes)
          session.digest.update(bytes)
          session.size += bytes.size.toLong()
          bytes.size.toLong() to session.size
        } catch (error: Exception) {
          failLargeBackupSession(session, error)
          throw error
        }
      }
      invoke.resolve(
        JSObject()
          .put("supported", true)
          .put("sessionId", session.id)
          .put("appendedSize", appendedSize)
          .put("size", total),
      )
    } catch (error: Exception) {
      invoke.reject(error.message ?: "追加大型备份数据失败")
    }
  }

  @Command
  fun finishLargeBackup(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(FinishLargeBackupArgs::class.java)
      val sessionId = requireLargeBackupSessionId(args.sessionId)
      if (args.expectedSize < 0L) throw IllegalArgumentException("大型备份预期大小无效")
      val expectedSha256 = args.expectedSha256.trim().lowercase()
      if (!expectedSha256.matches(Regex("^[a-f0-9]{64}$"))) {
        throw IllegalArgumentException("大型备份预期 SHA-256 无效")
      }
      val session = requireLargeBackupSession(sessionId)
      val saved = synchronized(session) {
        requireOpenLargeBackupSession(session)
        session.closed = true
        var published = false
        try {
          closeLargeBackupWriter(session, sync = true)
          if (session.size != args.expectedSize) {
            throw IllegalStateException(
              "大型备份大小不一致：应为 ${args.expectedSize} 字节，实际为 ${session.size} 字节",
            )
          }
          val actualSha256 = session.digest.digest().toHex()
          if (actualSha256 != expectedSha256) {
            throw IllegalStateException("大型备份 SHA-256 校验失败，未发布文件")
          }
          val result = publishLargeBackupSession(session, actualSha256)
          published = true
          result
        } catch (error: Exception) {
          if (!published) cleanupLargeBackupSession(session, error)
          throw error
        } finally {
          largeBackupSessions.remove(session.id, session)
        }
      }
      invoke.resolve(savedBackupObject(saved))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "完成大型备份文件失败")
    }
  }

  @Command
  fun abortLargeBackup(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(AbortLargeBackupArgs::class.java)
      val sessionId = requireLargeBackupSessionId(args.sessionId)
      val session = largeBackupSessions[sessionId]
      val aborted = if (session == null) {
        false
      } else {
        synchronized(session) {
          if (session.closed || largeBackupSessions[session.id] !== session) {
            false
          } else {
            session.closed = true
            try {
              cleanupLargeBackupSession(session)
              true
            } finally {
              largeBackupSessions.remove(session.id, session)
            }
          }
        }
      }
      invoke.resolve(
        JSObject()
          .put("supported", true)
          .put("sessionId", sessionId)
          .put("aborted", aborted),
      )
    } catch (error: Exception) {
      invoke.reject(error.message ?: "取消大型备份文件失败")
    }
  }

  private fun parseLargeBackupFileName(invoke: Invoke): String {
    val args = invoke.parseArgs(BeginLargeBackupArgs::class.java)
    if (args.fileName.isBlank()) throw IllegalArgumentException("大型备份文件名不能为空")
    return safeBackupFileName(args.fileName)
  }

  private fun beginLargeBackupAndResolve(invoke: Invoke, fileName: String) {
    val session = synchronized(largeBackupSessions) {
      if (largeBackupSessions.size >= MAX_ACTIVE_LARGE_BACKUPS) {
        throw IllegalStateException("同时进行的大型备份会话不能超过 $MAX_ACTIVE_LARGE_BACKUPS 个")
      }
      val sessionId = UUID.randomUUID().toString()
      createLargeBackupSession(sessionId, fileName).also { created ->
        largeBackupSessions[sessionId] = created
      }
    }
    try {
      invoke.resolve(
        JSObject()
          .put("supported", true)
          .put("sessionId", session.id)
          .put("fileName", session.requestedFileName),
      )
    } catch (error: Exception) {
      synchronized(session) {
        session.closed = true
        largeBackupSessions.remove(session.id, session)
        cleanupLargeBackupSession(session, error)
      }
      throw error
    }
  }

  private fun createLargeBackupSession(
    sessionId: String,
    fileName: String,
  ): LargeBackupSession = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
    createMediaStoreLargeBackupSession(sessionId, fileName)
  } else {
    createLegacyLargeBackupSession(sessionId, fileName)
  }

  private fun createMediaStoreLargeBackupSession(
    sessionId: String,
    fileName: String,
  ): LargeBackupSession {
    val resolver = activity.contentResolver
    val relativePath = "${Environment.DIRECTORY_DOWNLOADS}/KiDinDin"
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, ".kidindin-large-$sessionId.pending")
      put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
      put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("系统下载目录拒绝创建大型备份文件")
    var descriptor: ParcelFileDescriptor? = null
    var output: FileOutputStream? = null
    try {
      descriptor = resolver.openFileDescriptor(uri, "w")
        ?: throw IllegalStateException("无法打开系统下载目录中的大型备份文件")
      output = ParcelFileDescriptor.AutoCloseOutputStream(descriptor)
      descriptor = null
      return LargeBackupSession(
        id = sessionId,
        requestedFileName = fileName,
        destination = LargeBackupDestination.MediaStoreFile(uri, relativePath),
        output = output,
      )
    } catch (error: Exception) {
      runCatching { output?.close() }
      runCatching { descriptor?.close() }
      runCatching { resolver.delete(uri, null, null) }
      throw error
    }
  }

  @Suppress("DEPRECATION")
  private fun createLegacyLargeBackupSession(
    sessionId: String,
    fileName: String,
  ): LargeBackupSession {
    if (Environment.getExternalStorageState() != Environment.MEDIA_MOUNTED) {
      throw IllegalStateException("Android 公共存储当前不可写，未创建大型备份文件")
    }
    val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    val directory = File(downloads, "KiDinDin")
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("无法创建公共 Download/KiDinDin 目录")
    }
    val destination = availableLargeBackupDestination(directory, fileName)
    val temporary = File.createTempFile(".kidindin-large-$sessionId-", ".pending", directory)
    try {
      return LargeBackupSession(
        id = sessionId,
        requestedFileName = fileName,
        destination = LargeBackupDestination.LegacyPublicFile(temporary, destination),
        output = FileOutputStream(temporary),
      )
    } catch (error: Exception) {
      runCatching { temporary.delete() }
      throw error
    }
  }

  private fun availableLargeBackupDestination(
    directory: File,
    fileName: String,
    ignoredSessionId: String? = null,
  ): File {
    val extensionAt = fileName.lastIndexOf('.')
    val stem = if (extensionAt > 0) fileName.substring(0, extensionAt) else fileName
    val extension = if (extensionAt > 0) fileName.substring(extensionAt) else ""
    for (index in 0..9999) {
      val candidate = if (index == 0) {
        File(directory, fileName)
      } else {
        File(directory, "$stem ($index)$extension")
      }
      val reserved = largeBackupSessions.values.any { session ->
        session.id != ignoredSessionId &&
          (session.destination as? LargeBackupDestination.LegacyPublicFile)
            ?.destination?.absolutePath == candidate.absolutePath
      }
      if (!candidate.exists() && !reserved) return candidate
    }
    throw IllegalStateException("公共下载目录中同名大型备份文件过多")
  }

  private fun requireLargeBackupSessionId(value: String): String {
    val sessionId = value.trim()
    return try {
      UUID.fromString(sessionId).toString()
    } catch (_: IllegalArgumentException) {
      throw IllegalArgumentException("大型备份会话标识无效")
    }
  }

  private fun requireLargeBackupSession(sessionId: String): LargeBackupSession =
    largeBackupSessions[sessionId]
      ?: throw IllegalArgumentException("大型备份会话不存在或已经结束")

  private fun requireOpenLargeBackupSession(session: LargeBackupSession) {
    if (session.closed || largeBackupSessions[session.id] !== session) {
      throw IllegalStateException("大型备份会话已经结束")
    }
  }

  private fun failLargeBackupSession(session: LargeBackupSession, cause: Exception) {
    session.closed = true
    largeBackupSessions.remove(session.id, session)
    cleanupLargeBackupSession(session, cause)
  }

  private fun closeLargeBackupWriter(session: LargeBackupSession, sync: Boolean) {
    if (session.writerClosed) return
    var failure: Exception? = null
    try {
      if (sync) {
        session.output.flush()
        session.output.fd.sync()
      }
    } catch (error: Exception) {
      failure = error
    }
    try {
      session.output.close()
    } catch (error: Exception) {
      if (failure == null) failure = error else failure.addSuppressed(error)
    }
    session.writerClosed = true
    failure?.let { throw it }
  }

  private fun cleanupLargeBackupSession(
    session: LargeBackupSession,
    cause: Exception? = null,
  ) {
    var failure: Exception? = null
    try {
      closeLargeBackupWriter(session, sync = false)
    } catch (error: Exception) {
      failure = error
    }
    try {
      when (val destination = session.destination) {
        is LargeBackupDestination.MediaStoreFile ->
          activity.contentResolver.delete(destination.uri, null, null)
        is LargeBackupDestination.LegacyPublicFile -> {
          if (destination.temporary.exists() && !destination.temporary.delete()) {
            throw IllegalStateException("无法删除未完成的大型备份临时文件")
          }
        }
      }
    } catch (error: Exception) {
      if (failure == null) failure = error else failure.addSuppressed(error)
    }
    if (failure != null) {
      if (cause != null) cause.addSuppressed(failure) else throw failure
    }
  }

  private fun publishLargeBackupSession(
    session: LargeBackupSession,
    sha256: String,
  ): SavedBackupFile = when (val destination = session.destination) {
    is LargeBackupDestination.MediaStoreFile -> {
      val resolver = activity.contentResolver
      val storedSize = resolver.openFileDescriptor(destination.uri, "r")
        ?.use { it.statSize } ?: -1L
      if (storedSize >= 0L && storedSize != session.size) {
        throw IllegalStateException(
          "大型备份写入不完整：应为 ${session.size} 字节，实际为 $storedSize 字节",
        )
      }
      val completed = resolver.update(
        destination.uri,
        ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, session.requestedFileName)
          put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
          put(MediaStore.MediaColumns.IS_PENDING, 0)
        },
        null,
        null,
      )
      if (completed != 1) throw IllegalStateException("系统未能发布大型备份文件")
      val actualName = runCatching {
        displayName(destination.uri, session.requestedFileName)
      }.getOrDefault(session.requestedFileName)
      SavedBackupFile(
        fileName = actualName,
        destination = "${destination.relativePath}/$actualName",
        uri = destination.uri,
        size = session.size,
        sha256 = sha256,
      )
    }
    is LargeBackupDestination.LegacyPublicFile -> {
      if (destination.temporary.length() != session.size) {
        throw IllegalStateException("大型备份临时文件长度与累计写入大小不一致")
      }
      val actualDestination = synchronized(largeBackupSessions) {
        if (destination.destination.exists()) {
          destination.destination = availableLargeBackupDestination(
            destination.destination.parentFile
              ?: throw IllegalStateException("无法定位公共下载目录"),
            session.requestedFileName,
            session.id,
          )
        }
        destination.destination
      }
      val uri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        actualDestination,
      )
      if (!destination.temporary.renameTo(actualDestination)) {
        throw IllegalStateException("无法完成公共下载目录大型备份文件落盘")
      }
      SavedBackupFile(
        fileName = actualDestination.name,
        destination = actualDestination.absolutePath,
        uri = uri,
        size = session.size,
        sha256 = sha256,
      )
    }
  }

  private fun savedBackupObject(saved: SavedBackupFile): JSObject = JSObject()
    .put("supported", true)
    .put("fileName", saved.fileName)
    .put("destination", saved.destination)
    .put("uri", saved.uri.toString())
    .put("size", saved.size)
    .put("sha256", saved.sha256)

  private fun ByteArray.toHex(): String = joinToString("") { byte ->
    (byte.toInt() and 0xff).toString(16).padStart(2, '0')
  }

  private fun parseSaveBackupFile(invoke: Invoke): ParsedSaveBackupFile {
    val args = invoke.parseArgs(SaveBackupFileArgs::class.java)
    if (args.payload.isEmpty()) throw IllegalArgumentException("备份文件内容为空")
    return ParsedSaveBackupFile(
      fileName = safeBackupFileName(args.fileName),
      payload = args.payload,
    )
  }

  @Synchronized
  private fun saveAndResolve(invoke: Invoke, args: ParsedSaveBackupFile) {
    val bytes = args.payload.toByteArray(Charsets.UTF_8)
    val saved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      saveToMediaStore(args.fileName, bytes)
    } else {
      saveToLegacyPublicDownloads(args.fileName, bytes)
    }
    invoke.resolve(
      JSObject()
        .put("supported", true)
        .put("fileName", saved.fileName)
        .put("destination", saved.destination)
        .put("uri", saved.uri.toString())
        .put("size", saved.size)
        .put("sha256", saved.sha256),
    )
  }

  private fun saveToMediaStore(fileName: String, bytes: ByteArray): SavedBackupFile {
    val resolver = activity.contentResolver
    val relativePath = "${Environment.DIRECTORY_DOWNLOADS}/KiDinDin"
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
      put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
      put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("系统下载目录拒绝创建备份文件")
    try {
      val descriptor = resolver.openFileDescriptor(uri, "w")
        ?: throw IllegalStateException("无法打开系统下载目录中的备份文件")
      descriptor.use { parcelFileDescriptor ->
        FileOutputStream(parcelFileDescriptor.fileDescriptor).use { output ->
          output.write(bytes)
          output.flush()
          output.fd.sync()
        }
      }
      val storedSize = resolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L
      if (storedSize >= 0L && storedSize != bytes.size.toLong()) {
        throw IllegalStateException("备份文件写入不完整：应为 ${bytes.size} 字节，实际为 $storedSize 字节")
      }
      val completed = resolver.update(
        uri,
        ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
        null,
        null,
      )
      if (completed != 1) throw IllegalStateException("系统未能完成备份文件发布")
      val actualName = displayName(uri, fileName)
      return SavedBackupFile(
        fileName = actualName,
        destination = "$relativePath/$actualName",
        uri = uri,
        size = bytes.size.toLong(),
        sha256 = sha256(bytes),
      )
    } catch (error: Exception) {
      resolver.delete(uri, null, null)
      throw error
    }
  }

  @Suppress("DEPRECATION")
  private fun saveToLegacyPublicDownloads(fileName: String, bytes: ByteArray): SavedBackupFile {
    if (Environment.getExternalStorageState() != Environment.MEDIA_MOUNTED) {
      throw IllegalStateException("Android 公共存储当前不可写，未创建备份文件")
    }
    val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    val directory = File(downloads, "KiDinDin")
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("无法创建公共 Download/KiDinDin 目录")
    }
    val destination = availableDestination(directory, fileName)
    val temporary = File.createTempFile(".kidindin-backup-", ".tmp", directory)
    try {
      FileOutputStream(temporary).use { output ->
        output.write(bytes)
        output.flush()
        output.fd.sync()
      }
      if (temporary.length() != bytes.size.toLong()) {
        throw IllegalStateException("备份文件写入不完整")
      }
      if (!temporary.renameTo(destination)) {
        throw IllegalStateException("无法完成公共下载目录备份文件落盘")
      }
    } finally {
      if (temporary.exists()) temporary.delete()
    }
    val uri = FileProvider.getUriForFile(
      activity,
      "${activity.packageName}.fileprovider",
      destination,
    )
    return SavedBackupFile(
      fileName = destination.name,
      destination = destination.absolutePath,
      uri = uri,
      size = bytes.size.toLong(),
      sha256 = sha256(bytes),
    )
  }

  private fun displayName(uri: Uri, fallback: String): String = activity.contentResolver.query(
    uri,
    arrayOf(OpenableColumns.DISPLAY_NAME),
    null,
    null,
    null,
  )?.use { cursor ->
    if (cursor.moveToFirst()) cursor.getString(0).orEmpty().ifBlank { fallback } else fallback
  } ?: fallback

  private fun availableDestination(directory: File, fileName: String): File {
    val first = File(directory, fileName)
    if (!first.exists()) return first
    val extensionAt = fileName.lastIndexOf('.')
    val stem = if (extensionAt > 0) fileName.substring(0, extensionAt) else fileName
    val extension = if (extensionAt > 0) fileName.substring(extensionAt) else ""
    for (index in 1..9999) {
      val candidate = File(directory, "$stem ($index)$extension")
      if (!candidate.exists()) return candidate
    }
    throw IllegalStateException("应用外部下载目录中同名备份文件过多")
  }

  private fun safeBackupFileName(value: String): String {
    val sanitized = value
      .substringAfterLast('/')
      .substringAfterLast('\\')
      .trim()
      .map { character ->
        if (character.code < 32 || character in "\\/:*?\"<>|") '_' else character
      }
      .joinToString("")
      .trim(' ', '.')
      .ifBlank { "kidindin-full-backup.json" }
    val withExtension = if (sanitized.endsWith(".json", ignoreCase = true)) {
      sanitized
    } else {
      "$sanitized.json"
    }
    if (withExtension.length <= 160) return withExtension
    return "${withExtension.take(155)}.json"
  }

  private fun sha256(bytes: ByteArray): String = MessageDigest
    .getInstance("SHA-256")
    .digest(bytes)
    .joinToString("") { byte ->
      (byte.toInt() and 0xff).toString(16).padStart(2, '0')
    }
}
