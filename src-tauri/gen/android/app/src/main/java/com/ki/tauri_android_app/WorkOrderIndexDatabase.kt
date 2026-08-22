package com.ki.tauri_android_app

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

data class IndexedWorkOrder(
  val accountKey: String,
  val woHeaderId: String,
  val woNumber: String,
  val resident: String,
  val contactPhone: String,
  val address: String,
  val sourceDate: String,
  val rawJson: String,
)

data class WorkOrderMatch(
  val state: String,
  val message: String,
  val target: IndexedWorkOrder? = null,
)

data class WorkOrderIndexSyncResult(
  val indexed: Int,
  val inserted: Int,
  val updated: Int,
)

data class NativeDatabaseImportStats(
  val workOrdersImported: Int,
  val prefillHistoryImported: Int,
  val workOrderTotal: Int,
  val prefillHistoryTotal: Int,
)

data class NativeDatabaseValidationStats(
  val workOrderCount: Int,
  val prefillHistoryCount: Int,
)

private data class WorkOrderIndexBackupRow(
  val accountKey: String,
  val woHeaderId: String,
  val woNumber: String,
  val resident: String,
  val residentNormalized: String,
  val contactPhone: String,
  val address: String,
  val addressNormalized: String,
  val sourceDate: String,
  val eligiblePrefill: Boolean,
  val rawJson: String,
  val firstSeenAt: Long,
  val lastSeenAt: Long,
)

private data class PrefillHistoryBackupRow(
  val accountKey: String,
  val woHeaderId: String,
  val completedAt: Long,
  val resultMessage: String,
)

private data class ParsedNativeDatabaseBackup(
  val workOrders: List<WorkOrderIndexBackupRow>,
  val prefillHistory: List<PrefillHistoryBackupRow>,
  val floatingOverlayEnabled: Boolean?,
)

private const val NATIVE_BACKUP_KIND = "kidindin-native-sqlite"
private const val NATIVE_BACKUP_FORMAT_VERSION = 1
private const val MAX_NATIVE_BACKUP_CHARACTERS = 64 * 1024 * 1024
private const val MAX_NATIVE_BACKUP_ROWS_PER_TABLE = 200_000

private fun requireBackupString(
  source: JSONObject,
  field: String,
  location: String,
  maxLength: Int,
  allowEmpty: Boolean = true,
): String {
  val value = source.opt(field)
  if (value !is String || (!allowEmpty && value.isBlank()) || value.length > maxLength) {
    throw IllegalArgumentException(
      "$location.$field 必须是${if (allowEmpty) "不超过 $maxLength 字符的字符串" else "非空且不超过 $maxLength 字符的字符串"}",
    )
  }
  return value
}

private fun requireBackupLong(
  source: JSONObject,
  field: String,
  location: String,
): Long {
  val value = source.opt(field)
  val number = value as? Number
    ?: throw IllegalArgumentException("$location.$field 必须是非负整数")
  val doubleValue = number.toDouble()
  val longValue = number.toLong()
  if (!doubleValue.isFinite() || doubleValue != longValue.toDouble() || longValue < 0L) {
    throw IllegalArgumentException("$location.$field 必须是非负整数")
  }
  return longValue
}

private fun requireBackupBoolean(
  source: JSONObject,
  field: String,
  location: String,
): Boolean = source.opt(field) as? Boolean
  ?: throw IllegalArgumentException("$location.$field 必须是布尔值")

private fun parseNativeDatabaseBackup(
  payload: String,
  supportedDatabaseVersion: Int,
): ParsedNativeDatabaseBackup {
  if (payload.isBlank()) throw IllegalArgumentException("原生 SQLite 备份内容为空")
  if (payload.length > MAX_NATIVE_BACKUP_CHARACTERS) {
    throw IllegalArgumentException("原生 SQLite 备份超过 64MB 安全上限")
  }
  val root = try {
    JSONObject(payload)
  } catch (error: Exception) {
    throw IllegalArgumentException("原生 SQLite 备份 JSON 无效：${error.message}")
  }
  if (root.opt("kind") != NATIVE_BACKUP_KIND) {
    throw IllegalArgumentException("不是受支持的 KiDinDin 原生 SQLite 备份")
  }
  if (requireBackupLong(root, "version", "备份") != NATIVE_BACKUP_FORMAT_VERSION.toLong()) {
    throw IllegalArgumentException("不支持该原生 SQLite 备份格式版本")
  }
  if (root.opt("databaseName") != "kidindin_work_order_index.db") {
    throw IllegalArgumentException("原生 SQLite 备份数据库名称不匹配")
  }
  val databaseVersion = requireBackupLong(root, "databaseVersion", "备份")
  if (databaseVersion < 1L || databaseVersion > supportedDatabaseVersion.toLong()) {
    throw IllegalArgumentException("备份数据库版本 $databaseVersion 高于当前支持版本 $supportedDatabaseVersion")
  }
  val floatingOverlayEnabled = if (root.has("preferences")) {
    val preferences = root.opt("preferences") as? JSONObject
      ?: throw IllegalArgumentException("原生 SQLite 备份 preferences 必须是对象")
    requireBackupBoolean(
      preferences,
      "floating_overlay_enabled",
      "preferences",
    )
  } else {
    // Keep version-1 backups created before native preferences were added importable.
    null
  }
  val tables = root.opt("tables") as? JSONObject
    ?: throw IllegalArgumentException("原生 SQLite 备份缺少 tables")
  val workOrderArray = tables.opt("workOrderIndex") as? JSONArray
    ?: throw IllegalArgumentException("原生 SQLite 备份缺少 workOrderIndex 表")
  val prefillArray = tables.opt("residentSecurityPrefillHistory") as? JSONArray
    ?: throw IllegalArgumentException("原生 SQLite 备份缺少 residentSecurityPrefillHistory 表")
  if (workOrderArray.length() > MAX_NATIVE_BACKUP_ROWS_PER_TABLE) {
    throw IllegalArgumentException("workOrderIndex 表超过 200000 条安全上限")
  }
  if (prefillArray.length() > MAX_NATIVE_BACKUP_ROWS_PER_TABLE) {
    throw IllegalArgumentException("residentSecurityPrefillHistory 表超过 200000 条安全上限")
  }

  val workOrderKeys = mutableSetOf<Pair<String, String>>()
  val workOrders = buildList {
    for (index in 0 until workOrderArray.length()) {
      val location = "workOrderIndex 第 ${index + 1} 行"
      val row = workOrderArray.opt(index) as? JSONObject
        ?: throw IllegalArgumentException("$location 必须是对象")
      val accountKey = requireBackupString(row, "accountKey", location, 512, false)
      val woHeaderId = requireBackupString(row, "woHeaderId", location, 512, false)
      if (!workOrderKeys.add(accountKey to woHeaderId)) {
        throw IllegalArgumentException("$location 与备份中的其他工单主键重复")
      }
      val firstSeenAt = requireBackupLong(row, "firstSeenAt", location)
      val lastSeenAt = requireBackupLong(row, "lastSeenAt", location)
      if (firstSeenAt > lastSeenAt) {
        throw IllegalArgumentException("$location.firstSeenAt 不能晚于 lastSeenAt")
      }
      add(
        WorkOrderIndexBackupRow(
          accountKey = accountKey,
          woHeaderId = woHeaderId,
          woNumber = requireBackupString(row, "woNumber", location, 512),
          resident = requireBackupString(row, "resident", location, 1024),
          residentNormalized = requireBackupString(row, "residentNormalized", location, 2048),
          contactPhone = requireBackupString(row, "contactPhone", location, 128),
          address = requireBackupString(row, "address", location, 8192),
          addressNormalized = requireBackupString(row, "addressNormalized", location, 8192),
          sourceDate = requireBackupString(row, "sourceDate", location, 64),
          eligiblePrefill = requireBackupBoolean(row, "eligiblePrefill", location),
          rawJson = requireBackupString(row, "rawJson", location, 2 * 1024 * 1024),
          firstSeenAt = firstSeenAt,
          lastSeenAt = lastSeenAt,
        ),
      )
    }
  }

  val prefillKeys = mutableSetOf<Pair<String, String>>()
  val prefillHistory = buildList {
    for (index in 0 until prefillArray.length()) {
      val location = "residentSecurityPrefillHistory 第 ${index + 1} 行"
      val row = prefillArray.opt(index) as? JSONObject
        ?: throw IllegalArgumentException("$location 必须是对象")
      val accountKey = requireBackupString(row, "accountKey", location, 512, false)
      val woHeaderId = requireBackupString(row, "woHeaderId", location, 512, false)
      if (!prefillKeys.add(accountKey to woHeaderId)) {
        throw IllegalArgumentException("$location 与备份中的其他预填历史主键重复")
      }
      add(
        PrefillHistoryBackupRow(
          accountKey = accountKey,
          woHeaderId = woHeaderId,
          completedAt = requireBackupLong(row, "completedAt", location),
          resultMessage = requireBackupString(row, "resultMessage", location, 16 * 1024),
        ),
      )
    }
  }
  return ParsedNativeDatabaseBackup(workOrders, prefillHistory, floatingOverlayEnabled)
}

class WorkOrderIndexDatabase private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION) {
  private val applicationContext = context.applicationContext

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE work_order_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_key TEXT NOT NULL,
        wo_header_id TEXT NOT NULL,
        wo_number TEXT NOT NULL DEFAULT '',
        resident TEXT NOT NULL DEFAULT '',
        resident_normalized TEXT NOT NULL DEFAULT '',
        contact_phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        address_normalized TEXT NOT NULL DEFAULT '',
        source_date TEXT NOT NULL DEFAULT '',
        eligible_prefill INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(account_key, wo_header_id)
      )
      """.trimIndent(),
    )
    db.execSQL(
      "CREATE INDEX idx_work_order_account_phone ON work_order_index(account_key, contact_phone)",
    )
    db.execSQL(
      "CREATE INDEX idx_work_order_account_resident_address ON work_order_index(account_key, resident_normalized, address_normalized)",
    )
    db.execSQL(
      "CREATE INDEX idx_work_order_account_date ON work_order_index(account_key, source_date)",
    )
    createPrefillHistory(db)
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < 1) onCreate(db)
    if (oldVersion < 2) createPrefillHistory(db)
  }

  private fun createPrefillHistory(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS resident_security_prefill_history (
        account_key TEXT NOT NULL,
        wo_header_id TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        result_message TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(account_key, wo_header_id)
      )
      """.trimIndent(),
    )
    db.execSQL(
      "CREATE INDEX IF NOT EXISTS idx_prefill_history_completed ON resident_security_prefill_history(account_key, completed_at)",
    )
  }

  @Synchronized
  fun validateBackup(payload: String): NativeDatabaseValidationStats {
    val backup = parseNativeDatabaseBackup(payload, DATABASE_VERSION)
    return NativeDatabaseValidationStats(
      workOrderCount = backup.workOrders.size,
      prefillHistoryCount = backup.prefillHistory.size,
    )
  }

  @Synchronized
  fun exportBackup(): JSONObject {
    val db = readableDatabase
    val workOrders = JSONArray()
    val prefillHistory = JSONArray()
    db.beginTransaction()
    try {
      db.query(
        "work_order_index",
        arrayOf(
          "id",
          "account_key",
          "wo_header_id",
          "wo_number",
          "resident",
          "resident_normalized",
          "contact_phone",
          "address",
          "address_normalized",
          "source_date",
          "eligible_prefill",
          "raw_json",
          "first_seen_at",
          "last_seen_at",
        ),
        null,
        null,
        null,
        null,
        "account_key ASC, wo_header_id ASC",
      ).use { cursor ->
        while (cursor.moveToNext()) {
          workOrders.put(
            JSONObject()
              .put("id", cursor.getLong(0))
              .put("accountKey", cursor.getString(1).orEmpty())
              .put("woHeaderId", cursor.getString(2).orEmpty())
              .put("woNumber", cursor.getString(3).orEmpty())
              .put("resident", cursor.getString(4).orEmpty())
              .put("residentNormalized", cursor.getString(5).orEmpty())
              .put("contactPhone", cursor.getString(6).orEmpty())
              .put("address", cursor.getString(7).orEmpty())
              .put("addressNormalized", cursor.getString(8).orEmpty())
              .put("sourceDate", cursor.getString(9).orEmpty())
              .put("eligiblePrefill", cursor.getInt(10) != 0)
              .put("rawJson", cursor.getString(11).orEmpty())
              .put("firstSeenAt", cursor.getLong(12))
              .put("lastSeenAt", cursor.getLong(13)),
          )
        }
      }
      db.query(
        "resident_security_prefill_history",
        arrayOf("account_key", "wo_header_id", "completed_at", "result_message"),
        null,
        null,
        null,
        null,
        "account_key ASC, wo_header_id ASC",
      ).use { cursor ->
        while (cursor.moveToNext()) {
          prefillHistory.put(
            JSONObject()
              .put("accountKey", cursor.getString(0).orEmpty())
              .put("woHeaderId", cursor.getString(1).orEmpty())
              .put("completedAt", cursor.getLong(2))
              .put("resultMessage", cursor.getString(3).orEmpty()),
          )
        }
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    return JSONObject()
      .put("kind", NATIVE_BACKUP_KIND)
      .put("version", NATIVE_BACKUP_FORMAT_VERSION)
      .put("databaseName", DATABASE_NAME)
      .put("databaseVersion", DATABASE_VERSION)
      // Deliberately whitelist only the stable overlay preference. Active account,
      // recognition JSON/log/result and PENDING_TARGET remain device-local state.
      .put(
        "preferences",
        JSONObject().put(
          "floating_overlay_enabled",
          BackgroundKeepAliveService.isOverlayEnabled(applicationContext),
        ),
      )
      .put(
        "tables",
        JSONObject()
          .put("workOrderIndex", workOrders)
          .put("residentSecurityPrefillHistory", prefillHistory),
      )
  }

  @Synchronized
  fun importBackup(payload: String): NativeDatabaseImportStats {
    val backup = parseNativeDatabaseBackup(payload, DATABASE_VERSION)
    val db = writableDatabase
    var workOrdersImported = 0
    var prefillHistoryImported = 0
    val restoredOverlayEnabled = backup.floatingOverlayEnabled
    val previousOverlayEnabled = restoredOverlayEnabled?.let {
      BackgroundKeepAliveService.isOverlayEnabled(applicationContext)
    }
    val preferenceNeedsWrite = restoredOverlayEnabled != null &&
      restoredOverlayEnabled != previousOverlayEnabled
    var preferenceWriteAttempted = false

    val result = try {
      db.beginTransaction()
      try {
        for (row in backup.workOrders) {
          val existing = workOrderTimes(db, row.accountKey, row.woHeaderId)
          if (existing == null) {
            val inserted = db.insertWithOnConflict(
              "work_order_index",
              null,
              workOrderValues(row, row.firstSeenAt),
              SQLiteDatabase.CONFLICT_ABORT,
            )
            if (inserted < 0L) {
              throw IllegalStateException("导入工单 ${row.woHeaderId} 失败")
            }
            workOrdersImported += 1
          } else if (row.lastSeenAt > existing.second) {
            val updated = db.update(
              "work_order_index",
              workOrderValues(row, minOf(existing.first, row.firstSeenAt)).apply {
                remove("account_key")
                remove("wo_header_id")
              },
              "account_key = ? AND wo_header_id = ?",
              arrayOf(row.accountKey, row.woHeaderId),
            )
            if (updated != 1) {
              throw IllegalStateException("更新导入工单 ${row.woHeaderId} 失败")
            }
            workOrdersImported += 1
          }
        }

        for (row in backup.prefillHistory) {
          val existingCompletedAt = prefillCompletedAt(db, row.accountKey, row.woHeaderId)
          if (existingCompletedAt == null) {
            val inserted = db.insertWithOnConflict(
              "resident_security_prefill_history",
              null,
              prefillHistoryValues(row),
              SQLiteDatabase.CONFLICT_ABORT,
            )
            if (inserted < 0L) {
              throw IllegalStateException("导入预填历史 ${row.woHeaderId} 失败")
            }
            prefillHistoryImported += 1
          } else if (row.completedAt > existingCompletedAt) {
            val updated = db.update(
              "resident_security_prefill_history",
              prefillHistoryValues(row).apply {
                remove("account_key")
                remove("wo_header_id")
              },
              "account_key = ? AND wo_header_id = ?",
              arrayOf(row.accountKey, row.woHeaderId),
            )
            if (updated != 1) {
              throw IllegalStateException("更新预填历史 ${row.woHeaderId} 失败")
            }
            prefillHistoryImported += 1
          }
        }

        val stats = NativeDatabaseImportStats(
          workOrdersImported = workOrdersImported,
          prefillHistoryImported = prefillHistoryImported,
          workOrderTotal = totalRowCount(db, "work_order_index"),
          prefillHistoryTotal = totalRowCount(db, "resident_security_prefill_history"),
        )
        if (preferenceNeedsWrite && restoredOverlayEnabled != null) {
          preferenceWriteAttempted = true
          BackgroundKeepAliveService.persistOverlayEnabled(
            applicationContext,
            restoredOverlayEnabled,
          )
        }
        db.setTransactionSuccessful()
        stats
      } finally {
        db.endTransaction()
      }
    } catch (error: Exception) {
      if (preferenceWriteAttempted && previousOverlayEnabled != null) {
        try {
          BackgroundKeepAliveService.persistOverlayEnabled(
            applicationContext,
            previousOverlayEnabled,
          )
        } catch (rollbackError: Exception) {
          error.addSuppressed(rollbackError)
        }
      }
      throw error
    }

    restoredOverlayEnabled?.let { enabled ->
      BackgroundKeepAliveService.synchronizeOverlayEnabled(applicationContext, enabled)
    }
    return result
  }

  private fun workOrderValues(row: WorkOrderIndexBackupRow, firstSeenAt: Long) =
    ContentValues().apply {
      put("account_key", row.accountKey)
      put("wo_header_id", row.woHeaderId)
      put("wo_number", row.woNumber)
      put("resident", row.resident)
      put("resident_normalized", row.residentNormalized)
      put("contact_phone", row.contactPhone)
      put("address", row.address)
      put("address_normalized", row.addressNormalized)
      put("source_date", row.sourceDate)
      put("eligible_prefill", if (row.eligiblePrefill) 1 else 0)
      put("raw_json", row.rawJson)
      put("first_seen_at", firstSeenAt)
      put("last_seen_at", row.lastSeenAt)
    }

  private fun prefillHistoryValues(row: PrefillHistoryBackupRow) =
    ContentValues().apply {
      put("account_key", row.accountKey)
      put("wo_header_id", row.woHeaderId)
      put("completed_at", row.completedAt)
      put("result_message", row.resultMessage)
    }

  private fun workOrderTimes(
    db: SQLiteDatabase,
    accountKey: String,
    woHeaderId: String,
  ): Pair<Long, Long>? = db.query(
    "work_order_index",
    arrayOf("first_seen_at", "last_seen_at"),
    "account_key = ? AND wo_header_id = ?",
    arrayOf(accountKey, woHeaderId),
    null,
    null,
    null,
    "1",
  ).use { cursor ->
    if (cursor.moveToFirst()) cursor.getLong(0) to cursor.getLong(1) else null
  }

  private fun prefillCompletedAt(
    db: SQLiteDatabase,
    accountKey: String,
    woHeaderId: String,
  ): Long? = db.query(
    "resident_security_prefill_history",
    arrayOf("completed_at"),
    "account_key = ? AND wo_header_id = ?",
    arrayOf(accountKey, woHeaderId),
    null,
    null,
    null,
    "1",
  ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else null }

  private fun totalRowCount(db: SQLiteDatabase, table: String): Int = db.rawQuery(
    "SELECT COUNT(*) FROM $table",
    null,
  ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }

  fun sync(
    accountKey: String,
    sourceDate: String,
    entries: List<WorkOrderIndexEntryInput>,
  ): WorkOrderIndexSyncResult {
    if (accountKey.isBlank()) throw IllegalArgumentException("本地工单索引缺少账号标识")
    val now = System.currentTimeMillis()
    var inserted = 0
    var updated = 0
    writableDatabase.beginTransaction()
    try {
      for (entry in entries) {
        if (entry.woHeaderId.isBlank()) continue
        val values = ContentValues().apply {
          put("account_key", accountKey)
          put("wo_header_id", entry.woHeaderId)
          put("wo_number", entry.woNumber)
          put("resident", entry.resident)
          put("resident_normalized", normalizeText(entry.resident))
          put("contact_phone", digits(entry.contactPhone))
          put("address", entry.address)
          put("address_normalized", normalizeText(entry.address))
          put("source_date", sourceDate)
          put("eligible_prefill", if (entry.eligiblePrefill) 1 else 0)
          put("raw_json", entry.rawJson)
          put("first_seen_at", now)
          put("last_seen_at", now)
        }
        val rowId = writableDatabase.insertWithOnConflict(
          "work_order_index",
          null,
          values,
          SQLiteDatabase.CONFLICT_IGNORE,
        )
        if (rowId >= 0) {
          inserted += 1
        } else {
          values.remove("account_key")
          values.remove("wo_header_id")
          values.remove("first_seen_at")
          updated += writableDatabase.update(
            "work_order_index",
            values,
            "account_key = ? AND wo_header_id = ?",
            arrayOf(accountKey, entry.woHeaderId),
          )
        }
      }
      pruneOldRows(accountKey)
      writableDatabase.setTransactionSuccessful()
    } finally {
      writableDatabase.endTransaction()
    }
    return WorkOrderIndexSyncResult(inserted + updated, inserted, updated)
  }

  fun matchRecognizedText(accountKey: String, recognizedText: String): WorkOrderMatch {
    if (accountKey.isBlank()) return WorkOrderMatch("unavailable", "请先打开 KiDinDin 同步工单")
    val normalizedText = normalizeText(recognizedText)
    if (!PAGE_TITLES.any(normalizedText::contains)) {
      return WorkOrderMatch("not_detail", "请打开钉钉工单的安全画像或入户情况")
    }
    val compactDigits = digits(recognizedText)
    val normalizedLines = recognizedText.lineSequence()
      .map(::normalizeText)
      .filter { it.length >= 4 }
      .toList()
    val scored = mutableListOf<Pair<Int, IndexedWorkOrder>>()
    readableDatabase.query(
      "work_order_index",
      arrayOf(
        "account_key", "wo_header_id", "wo_number", "resident",
        "contact_phone", "address", "address_normalized", "source_date", "raw_json",
      ),
      "account_key = ? AND eligible_prefill = 1",
      arrayOf(accountKey),
      null,
      null,
      "last_seen_at DESC",
    ).use { cursor ->
      while (cursor.moveToNext()) {
        val resident = cursor.getString(3).orEmpty()
        val phone = cursor.getString(4).orEmpty()
        val address = cursor.getString(5).orEmpty()
        val addressNormalized = cursor.getString(6).orEmpty()
        val residentMatch = normalizeText(resident).let { it.length >= 2 && normalizedText.contains(it) }
        val phoneMatch = phone.length >= 7 && compactDigits.contains(phone)
        val exactAddressMatch = addressNormalized.length >= 6 && normalizedText.contains(addressNormalized)
        val similarity = if (exactAddressMatch) 1.0 else normalizedLines.maxOfOrNull {
          diceSimilarity(addressNormalized, it)
        } ?: 0.0
        val safeMatch =
          (residentMatch && (exactAddressMatch || similarity >= 0.82)) ||
            (phoneMatch && (residentMatch || exactAddressMatch || similarity >= 0.68))
        if (!safeMatch) continue
        val score =
          (if (phoneMatch) 120 else 0) +
            (if (exactAddressMatch) 100 else (similarity * 70).toInt()) +
            (if (residentMatch) 40 else 0)
        scored += score to IndexedWorkOrder(
          accountKey = cursor.getString(0),
          woHeaderId = cursor.getString(1),
          woNumber = cursor.getString(2),
          resident = resident,
          contactPhone = phone,
          address = address,
          sourceDate = cursor.getString(7),
          rawJson = cursor.getString(8),
        )
      }
    }
    if (scored.isEmpty()) return WorkOrderMatch("no_match", "本地索引没有唯一匹配的待处理安检工单")
    val sorted = scored.sortedByDescending { it.first }
    val best = sorted.first()
    if (sorted.size > 1 && best.first - sorted[1].first < 20) {
      return WorkOrderMatch("ambiguous", "匹配到多张相似工单，已停止自动预填")
    }
    return WorkOrderMatch(
      "matched",
      "已识别 ${best.second.woNumber.ifBlank { best.second.woHeaderId }}",
      best.second,
    )
  }

  fun count(accountKey: String): Int = readableDatabase.rawQuery(
    "SELECT COUNT(*) FROM work_order_index WHERE account_key = ?",
    arrayOf(accountKey),
  ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }

  fun lastPrefilledAt(accountKey: String, woHeaderId: String): Long = readableDatabase.query(
    "resident_security_prefill_history",
    arrayOf("completed_at"),
    "account_key = ? AND wo_header_id = ?",
    arrayOf(accountKey, woHeaderId),
    null,
    null,
    null,
    "1",
  ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }

  fun markPrefilled(accountKey: String, woHeaderId: String, message: String) {
    if (accountKey.isBlank() || woHeaderId.isBlank()) return
    writableDatabase.insertWithOnConflict(
      "resident_security_prefill_history",
      null,
      ContentValues().apply {
        put("account_key", accountKey)
        put("wo_header_id", woHeaderId)
        put("completed_at", System.currentTimeMillis())
        put("result_message", message)
      },
      SQLiteDatabase.CONFLICT_REPLACE,
    )
  }

  private fun pruneOldRows(accountKey: String) {
    val calendar = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -RETENTION_DAYS) }
    val cutoff = String.format(
      Locale.US,
      "%04d-%02d-%02d",
      calendar.get(Calendar.YEAR),
      calendar.get(Calendar.MONTH) + 1,
      calendar.get(Calendar.DAY_OF_MONTH),
    )
    writableDatabase.delete(
      "work_order_index",
      "account_key = ? AND source_date <> '' AND source_date < ?",
      arrayOf(accountKey, cutoff),
    )
  }

  companion object {
    private const val DATABASE_NAME = "kidindin_work_order_index.db"
    private const val DATABASE_VERSION = 2
    private const val RETENTION_DAYS = 400
    private val PAGE_TITLES = listOf("安全画像", "入户情况", "工单详情")

    @Volatile
    private var instance: WorkOrderIndexDatabase? = null

    fun get(context: Context): WorkOrderIndexDatabase = instance ?: synchronized(this) {
      instance ?: WorkOrderIndexDatabase(context).also { instance = it }
    }

    fun normalizeText(value: String): String = Normalizer
      .normalize(value, Normalizer.Form.NFKC)
      .lowercase(Locale.ROOT)
      .replace(Regex("[\\s\\p{P}\\p{S}]+"), "")

    private fun digits(value: String) = value.filter(Char::isDigit)

    private fun diceSimilarity(left: String, right: String): Double {
      if (left.length < 2 || right.length < 2) return 0.0
      val leftPairs = left.windowed(2).groupingBy { it }.eachCount().toMutableMap()
      var overlap = 0
      for (pair in right.windowed(2)) {
        val remaining = leftPairs[pair] ?: 0
        if (remaining > 0) {
          overlap += 1
          leftPairs[pair] = remaining - 1
        }
      }
      return 2.0 * overlap / (left.length - 1 + right.length - 1)
    }
  }
}

object WorkOrderRecognitionStore {
  private const val PREFS_NAME = "kidindin_native_settings"
  private const val ACTIVE_ACCOUNT = "work_order_index_active_account"
  private const val RECOGNITION_JSON = "work_order_recognition_json"
  private const val PENDING_TARGET = "work_order_prefill_pending"
  private const val LOGS_JSON = "work_order_recognition_logs"
  private const val LAST_RESULT_JSON = "work_order_prefill_last_result"

  fun setActiveAccount(context: Context, accountKey: String) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    if (prefs.getString(ACTIVE_ACCOUNT, "") != accountKey) {
      prefs.edit()
        .putString(ACTIVE_ACCOUNT, accountKey)
        .remove(RECOGNITION_JSON)
        .remove(PENDING_TARGET)
        .remove(LOGS_JSON)
        .remove(LAST_RESULT_JSON)
        .apply()
      return
    }
    val previous = try {
      JSONObject(prefs.getString(RECOGNITION_JSON, "{}").orEmpty())
    } catch (_: Exception) {
      JSONObject()
    }
    if (
      previous.optString("state") == "prefill_success" &&
      previous.optString("woHeaderId").isNotBlank()
    ) {
      WorkOrderIndexDatabase.get(context).markPrefilled(
        accountKey,
        previous.optString("woHeaderId"),
        previous.optString("message"),
      )
      previous
        .put("prefilled", true)
        .put("prefilledAt", System.currentTimeMillis())
        .put("message", "")
      prefs.edit()
        .putString(RECOGNITION_JSON, previous.toString())
        .remove(PENDING_TARGET)
        .remove(LOGS_JSON)
        .apply()
      BackgroundKeepAliveService.refreshRecognition()
    }
  }

  fun activeAccount(context: Context): String = context
    .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    .getString(ACTIVE_ACCOUNT, "")
    .orEmpty()

  fun saveMatch(context: Context, match: WorkOrderMatch) {
    val json = JSONObject()
      .put("state", match.state)
      .put("message", match.message)
      .put("recognizedAt", System.currentTimeMillis())
    match.target?.let { target ->
      json.put("accountKey", target.accountKey)
      json.put("woHeaderId", target.woHeaderId)
      json.put("woNumber", target.woNumber)
      json.put("resident", target.resident)
      json.put("contactPhone", target.contactPhone)
      json.put("address", target.address)
      json.put("sourceDate", target.sourceDate)
      json.put("securityDate", "")
      json.put("rawJson", target.rawJson)
      val prefilledAt = WorkOrderIndexDatabase.get(context).lastPrefilledAt(
        target.accountKey,
        target.woHeaderId,
      )
      json.put("prefilled", prefilledAt > 0L)
      json.put("prefilledAt", prefilledAt)
    }
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(RECOGNITION_JSON, json.toString())
      .remove(LAST_RESULT_JSON)
      .apply()
    appendLog(context, match.message)
  }

  fun saveStatus(context: Context, state: String, message: String) {
    val json = JSONObject()
      .put("state", state)
      .put("message", message)
      .put("recognizedAt", System.currentTimeMillis())
    val editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(RECOGNITION_JSON, json.toString())
      .remove(PENDING_TARGET)
    if (state == "recognizing") editor.remove(LAST_RESULT_JSON)
    editor.apply()
    appendLog(context, message)
  }

  fun current(context: Context): JSONObject {
    val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(RECOGNITION_JSON, null)
    return try {
      val current = if (raw.isNullOrBlank()) JSONObject()
        .put("state", "idle")
        .put("message", "等待识别钉钉工单")
      else JSONObject(raw)
      current.put("logs", logs(context))
      val result = try {
        JSONObject(
          context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(LAST_RESULT_JSON, "{}").orEmpty(),
        )
      } catch (_: Exception) {
        JSONObject()
      }
      current
        .put("resultState", result.optString("state"))
        .put("resultMessage", result.optString("message"))
        .put("resultAt", result.optLong("completedAt", 0L))
    } catch (_: Exception) {
      JSONObject()
        .put("state", "idle")
        .put("message", "等待识别钉钉工单")
        .put("logs", logs(context))
    }
  }

  fun returnHome(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(RECOGNITION_JSON)
      .remove(PENDING_TARGET)
      .remove(LOGS_JSON)
      .apply()
    BackgroundKeepAliveService.refreshRecognition()
  }

  fun updateSecurityDate(
    context: Context,
    woHeaderId: String,
    securityDate: String,
  ): Boolean {
    val current = current(context)
    if (woHeaderId.isBlank() || current.optString("woHeaderId") != woHeaderId) return false
    val normalized = Regex("\\d{4}-\\d{2}-\\d{2}").find(securityDate)?.value
      ?: securityDate.trim().take(24)
    current.put("securityDate", normalized)
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(RECOGNITION_JSON, current.toString())
      .apply()
    BackgroundKeepAliveService.refreshRecognition()
    return true
  }

  fun markPending(context: Context): Boolean {
    val current = current(context)
    if (
      current.optString("state") !in setOf("matched", "repeat_confirm", "prefill_error") ||
      current.optString("woHeaderId").isBlank()
    ) {
      return false
    }
    if (current.optString("state") == "matched") {
      val lastPrefilledAt = WorkOrderIndexDatabase.get(context).lastPrefilledAt(
        current.optString("accountKey", activeAccount(context)),
        current.optString("woHeaderId"),
      )
      if (lastPrefilledAt > 0L) {
        val completedAt = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)
          .format(Date(lastPrefilledAt))
        val message = "该工单已于 $completedAt 完成过预填，请再次点击确认"
        current
          .put("state", "repeat_confirm")
          .put("message", message)
          .put("updatedAt", System.currentTimeMillis())
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
          .edit()
          .putString(RECOGNITION_JSON, current.toString())
          .apply()
        appendLog(context, message)
        BackgroundKeepAliveService.refreshRecognition()
        return true
      }
    }
    val queued = JSONObject(current.toString())
      .put("state", "prefill_queued")
      .put("message", "已提交安检预填，等待后台处理…")
      .put("updatedAt", System.currentTimeMillis())
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(PENDING_TARGET, current.toString())
      .putString(RECOGNITION_JSON, queued.toString())
      .remove(LAST_RESULT_JSON)
      .apply()
    appendLog(context, "已提交安检预填")
    BackgroundKeepAliveService.refreshRecognition()
    BackgroundKeepAliveService.schedulePrefillQueueTimeout(current.optString("woHeaderId"))
    return true
  }

  fun reportPrefill(
    context: Context,
    woHeaderId: String,
    state: String,
    message: String,
  ): Boolean {
    val current = current(context)
    if (current.optString("woHeaderId") != woHeaderId || woHeaderId.isBlank()) return false
    if (state == "prefill_success") {
      WorkOrderIndexDatabase.get(context).markPrefilled(
        current.optString("accountKey", activeAccount(context)),
        woHeaderId,
        message,
      )
      val completedAt = System.currentTimeMillis()
      val result = JSONObject()
        .put("state", "success")
        .put("message", message)
        .put("completedAt", completedAt)
      current
        .put("state", "prefill_success")
        .put("message", "")
        .put("prefilled", true)
        .put("prefilledAt", completedAt)
        .put("updatedAt", completedAt)
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(LAST_RESULT_JSON, result.toString())
        .putString(RECOGNITION_JSON, current.toString())
        .remove(PENDING_TARGET)
        .remove(LOGS_JSON)
        .apply()
      BackgroundKeepAliveService.refreshRecognition()
      return true
    }
    current
      .put("state", state)
      .put("message", message)
      .put("updatedAt", System.currentTimeMillis())
    val editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(RECOGNITION_JSON, current.toString())
    if (state == "prefill_error") {
      editor.putString(
        LAST_RESULT_JSON,
        JSONObject()
          .put("state", "error")
          .put("message", message)
          .put("completedAt", System.currentTimeMillis())
          .toString(),
      )
    }
    editor.apply()
    appendLog(context, message)
    BackgroundKeepAliveService.refreshRecognition()
    return true
  }

  fun consumePending(context: Context): JSONObject? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(PENDING_TARGET, null) ?: return null
    prefs.edit().remove(PENDING_TARGET).apply()
    return try { JSONObject(raw) } catch (_: Exception) { null }
  }

  @Synchronized
  private fun appendLog(context: Context, message: String) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val history = try {
      JSONArray(prefs.getString(LOGS_JSON, "[]"))
    } catch (_: Exception) {
      JSONArray()
    }
    val time = SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(Date())
    history.put("$time  $message")
    while (history.length() > 5) history.remove(0)
    prefs.edit().putString(LOGS_JSON, history.toString()).apply()
  }

  private fun logs(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val history = try {
      JSONArray(prefs.getString(LOGS_JSON, "[]"))
    } catch (_: Exception) {
      JSONArray()
    }
    return buildList {
      for (index in 0 until history.length()) add(history.optString(index))
    }.joinToString("\n")
  }

}
