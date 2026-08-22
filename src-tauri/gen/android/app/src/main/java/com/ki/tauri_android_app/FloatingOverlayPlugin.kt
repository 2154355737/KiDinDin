package com.ki.tauri_android_app

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

@InvokeArg
class WorkOrderIndexEntryInput {
  lateinit var woHeaderId: String
  var woNumber: String = ""
  var resident: String = ""
  var contactPhone: String = ""
  var address: String = ""
  var eligiblePrefill: Boolean = false
  var rawJson: String = "{}"
}

@InvokeArg
class SyncWorkOrderIndexArgs {
  lateinit var accountKey: String
  lateinit var sourceDate: String
  lateinit var entries: Array<WorkOrderIndexEntryInput>
}

@InvokeArg
class WorkOrderPrefillReportArgs {
  lateinit var woHeaderId: String
  lateinit var state: String
  lateinit var message: String
}

@InvokeArg
class WorkOrderSecurityDateArgs {
  lateinit var woHeaderId: String
  lateinit var securityDate: String
}

@TauriPlugin
class FloatingOverlayPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun status(invoke: Invoke) {
    invoke.resolve(statusObject())
  }

  @Command
  fun requestPermission(invoke: Invoke) {
    try {
      activity.startActivity(
        Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${activity.packageName}"),
        ),
      )
      invoke.resolve(statusObject().put("openedSettings", true))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "无法打开悬浮窗授权页面")
    }
  }

  @Command
  fun show(invoke: Invoke) {
    if (!Settings.canDrawOverlays(activity)) {
      invoke.reject("请先允许 KiDinDin 显示在其他应用上层")
      return
    }
    BackgroundKeepAliveService.showOverlay(activity)
    invoke.resolve(statusObject().put("enabled", true))
  }

  @Command
  fun hide(invoke: Invoke) {
    BackgroundKeepAliveService.hideOverlay(activity)
    invoke.resolve(statusObject().put("enabled", false).put("visible", false))
  }

  @Command
  fun openAccessibilitySettings(invoke: Invoke) {
    try {
      activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
      invoke.resolve(statusObject().put("openedSettings", true))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "无法打开辅助功能设置")
    }
  }

  @Command
  fun syncWorkOrderIndex(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SyncWorkOrderIndexArgs::class.java)
      WorkOrderRecognitionStore.setActiveAccount(activity, args.accountKey)
      val result = WorkOrderIndexDatabase.get(activity).sync(
        args.accountKey,
        args.sourceDate,
        args.entries.toList(),
      )
      invoke.resolve(
        JSObject()
          .put("indexed", result.indexed)
          .put("inserted", result.inserted)
          .put("updated", result.updated)
          .put("total", WorkOrderIndexDatabase.get(activity).count(args.accountKey)),
      )
    } catch (error: Exception) {
      invoke.reject(error.message ?: "同步本地工单索引失败")
    }
  }

  @Command
  fun consumePendingPrefillTarget(invoke: Invoke) {
    val target = WorkOrderRecognitionStore.consumePending(activity)
    invoke.resolve(
      target?.let { recognitionObject(it).put("pending", true) }
        ?: JSObject().put("pending", false),
    )
  }

  @Command
  fun reportWorkOrderPrefill(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(WorkOrderPrefillReportArgs::class.java)
      val updated = WorkOrderRecognitionStore.reportPrefill(
        activity,
        args.woHeaderId,
        args.state,
        args.message,
      )
      if (!updated) {
        invoke.reject("预填日志对应的工单与当前识别结果不一致")
        return
      }
      invoke.resolve(recognitionObject(WorkOrderRecognitionStore.current(activity)))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "更新悬浮窗预填日志失败")
    }
  }

  @Command
  fun reportWorkOrderSecurityDate(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(WorkOrderSecurityDateArgs::class.java)
      if (!WorkOrderRecognitionStore.updateSecurityDate(
          activity,
          args.woHeaderId,
          args.securityDate,
        )) {
        invoke.reject("最近安检日期对应的工单与当前识别结果不一致")
        return
      }
      invoke.resolve(recognitionObject(WorkOrderRecognitionStore.current(activity)))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "更新最近安检日期失败")
    }
  }

  private fun statusObject() = JSObject()
    .put("supported", true)
    .put("permissionGranted", Settings.canDrawOverlays(activity))
    .put("enabled", BackgroundKeepAliveService.isOverlayEnabled(activity))
    .put("visible", BackgroundKeepAliveService.isOverlayVisible())
    .put("accessibilitySupported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
    .put("accessibilityEnabled", isRecognitionAccessibilityEnabled())
    .put("recognition", recognitionObject(WorkOrderRecognitionStore.current(activity)))

  private fun isRecognitionAccessibilityEnabled(): Boolean {
    val expected = ComponentName(
      activity,
      WorkOrderRecognitionAccessibilityService::class.java,
    ).flattenToString()
    val enabled = Settings.Secure.getString(
      activity.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
    ).orEmpty()
    return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
  }

  private fun recognitionObject(source: JSONObject) = JSObject()
    .put("pending", source.optString("state") == "matched")
    .put("state", source.optString("state", "idle"))
    .put("message", source.optString("message", "等待识别钉钉工单"))
    .put("logs", source.optString("logs"))
    .put("recognizedAt", source.optLong("recognizedAt", 0L))
    .put("accountKey", source.optString("accountKey"))
    .put("woHeaderId", source.optString("woHeaderId"))
    .put("woNumber", source.optString("woNumber"))
    .put("resident", source.optString("resident"))
    .put("contactPhone", source.optString("contactPhone"))
    .put("address", source.optString("address"))
    .put("sourceDate", source.optString("sourceDate"))
    .put("securityDate", source.optString("securityDate"))
    .put("prefilled", source.optBoolean("prefilled", false))
    .put("prefilledAt", source.optLong("prefilledAt", 0L))
    .put("rawJson", source.optString("rawJson"))
}
