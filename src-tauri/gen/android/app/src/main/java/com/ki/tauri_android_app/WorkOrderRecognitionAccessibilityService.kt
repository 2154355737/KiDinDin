package com.ki.tauri_android_app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import java.util.concurrent.atomic.AtomicBoolean

class WorkOrderRecognitionAccessibilityService : AccessibilityService() {
  private val recognizing = AtomicBoolean(false)
  private val recognizer = lazy {
    TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
  }

  override fun onServiceConnected() {
    currentService = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    if (currentService === this) currentService = null
    if (recognizer.isInitialized()) recognizer.value.close()
    super.onDestroy()
  }

  private fun recognizeCurrentPage() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      BackgroundKeepAliveService.restorePanelAfterRecognitionCapture()
      updateStatus("unsupported", "当前 Android 版本不支持截图识别")
      return
    }
    if (rootInActiveWindow?.packageName?.toString() != DINGTALK_PACKAGE) {
      BackgroundKeepAliveService.restorePanelAfterRecognitionCapture()
      updateStatus("not_dingtalk", "请先打开钉钉工单详情页")
      return
    }
    if (!recognizing.compareAndSet(false, true)) return
    updateStatus("recognizing", "正在识别当前工单…")
    try {
      takeScreenshot(
        Display.DEFAULT_DISPLAY,
        mainExecutor,
        object : TakeScreenshotCallback {
          override fun onSuccess(screenshot: ScreenshotResult) {
            BackgroundKeepAliveService.restorePanelAfterRecognitionCapture()
            val hardwareBuffer = screenshot.hardwareBuffer
            var wrapped: Bitmap? = null
            val cropped = try {
              wrapped = Bitmap.wrapHardwareBuffer(hardwareBuffer, screenshot.colorSpace)
                ?: throw IllegalStateException("Unable to wrap accessibility screenshot")
              val software = wrapped.copy(Bitmap.Config.ARGB_8888, false)
                ?: throw IllegalStateException("Unable to copy accessibility screenshot")
              val cropHeight = (software.height * OCR_TOP_RATIO).toInt().coerceAtLeast(1)
              Bitmap.createBitmap(software, 0, 0, software.width, cropHeight).also {
                if (it !== software) software.recycle()
              }
            } catch (_: Throwable) {
              updateStatus("screenshot_failed", "截图处理失败，请重试")
              null
            } finally {
              runCatching { wrapped?.recycle() }
              runCatching { hardwareBuffer.close() }
            }
            if (cropped == null) {
              recognizing.set(false)
              return
            }
            try {
              recognizeBitmap(cropped)
            } catch (_: Throwable) {
              cropped.recycle()
              recognizing.set(false)
              updateStatus("ocr_failed", "OCR 启动失败，请重试")
            }
          }

          override fun onFailure(errorCode: Int) {
            BackgroundKeepAliveService.restorePanelAfterRecognitionCapture()
            recognizing.set(false)
            updateStatus("screenshot_failed", "系统截图失败，请重试（$errorCode）")
          }
        },
      )
    } catch (_: Throwable) {
      BackgroundKeepAliveService.restorePanelAfterRecognitionCapture()
      recognizing.set(false)
      updateStatus("screenshot_failed", "无法调用系统截图，请检查无障碍权限")
    }
  }

  private fun recognizeBitmap(bitmap: Bitmap) {
    recognizer.value.process(InputImage.fromBitmap(bitmap, 0))
      .addOnSuccessListener { result ->
        val text = result.textBlocks
          .flatMap { it.lines }
          .joinToString("\n") { it.text.trim() }
        val accountKey = WorkOrderRecognitionStore.activeAccount(this)
        val match = WorkOrderIndexDatabase.get(this).matchRecognizedText(accountKey, text)
        WorkOrderRecognitionStore.saveMatch(this, match)
        BackgroundKeepAliveService.refreshRecognition()
      }
      .addOnFailureListener {
        updateStatus("ocr_failed", "OCR 识别失败，请重试")
      }
      .addOnCompleteListener {
        bitmap.recycle()
        recognizing.set(false)
        BackgroundKeepAliveService.refreshRecognition()
      }
  }

  private fun updateStatus(state: String, message: String) {
    WorkOrderRecognitionStore.saveStatus(this, state, message)
    BackgroundKeepAliveService.refreshRecognition()
  }

  companion object {
    private const val DINGTALK_PACKAGE = "com.alibaba.android.rimet"
    private const val OCR_TOP_RATIO = 0.42f

    @Volatile
    private var currentService: WorkOrderRecognitionAccessibilityService? = null

    fun requestRecognition(context: Context) {
      val service = currentService
      if (service == null) {
        BackgroundKeepAliveService.restorePanelAfterRecognitionCapture()
        WorkOrderRecognitionStore.saveStatus(
          context,
          "accessibility_disabled",
          "请先在设置中启用工单识别无障碍服务",
        )
        BackgroundKeepAliveService.refreshRecognition()
        return
      }
      service.recognizeCurrentPage()
    }
  }
}
