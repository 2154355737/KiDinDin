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

class WorkOrderIndexDatabase private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION) {

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
