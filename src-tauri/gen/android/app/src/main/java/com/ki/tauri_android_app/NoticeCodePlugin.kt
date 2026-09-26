package com.ki.tauri_android_app

import android.app.Activity
import android.graphics.BitmapFactory
import android.os.SystemClock
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@InvokeArg
class NoticeCodeArgs { lateinit var imageBase64: String }

@TauriPlugin
class NoticeCodePlugin(activity: Activity) : Plugin(activity) {
  private val worker = Executors.newSingleThreadExecutor()
  private val busy = AtomicBoolean(false)

  @Command
  fun recognize(invoke: Invoke) {
    if (!busy.compareAndSet(false, true)) {
      invoke.reject("编码识别正在处理其他图片，本张可稍后重试或跳过")
      return
    }
    val args = try { invoke.parseArgs(NoticeCodeArgs::class.java) } catch (error: Exception) {
      busy.set(false)
      invoke.reject("编码识别参数无效")
      return
    }
    worker.execute {
      var scanner: BarcodeScanner? = null
      var recognizer: TextRecognizer? = null
      try {
      scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(
        Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39, Barcode.FORMAT_CODE_93,
        Barcode.FORMAT_CODABAR, Barcode.FORMAT_ITF, Barcode.FORMAT_EAN_13,
        Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E
      ).build())
      recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        if (args.imageBase64.length > 12 * 1024 * 1024) throw IllegalArgumentException("图片过大")
        val bytes = Base64.decode(args.imageBase64, Base64.DEFAULT)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth !in 1..2400 || bounds.outHeight !in 1..2400) throw IllegalArgumentException("图片尺寸无效")
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalArgumentException("图片无法解码")
        val deadline = SystemClock.elapsedRealtime() + 4200
        val codes = linkedSetOf<String>()
        val texts = linkedSetOf<String>()
        val numeric = Regex("^[0-9]{6,32}$")
        // QR is deliberately excluded: the service QR is shared across notices.
        for (rotation in listOf(0, 90, 180, 270)) {
          val remaining = deadline - SystemClock.elapsedRealtime()
          if (remaining < 200) break
          val image = InputImage.fromBitmap(bitmap, rotation)
          val barTask = scanner.process(image)
          val textTask = recognizer.process(image)
          val bars = try { Tasks.await(barTask, minOf(remaining, 1400), TimeUnit.MILLISECONDS) } catch (_: Exception) { emptyList() }
          val numericBars = bars.filter { numeric.matches(it.rawValue ?: "") }
          numericBars.forEach { codes.add(it.rawValue!!) }
          val text = try { Tasks.await(textTask, maxOf(1, deadline - SystemClock.elapsedRealtime()), TimeUnit.MILLISECONDS) } catch (_: Exception) { null }
          val width = if (rotation % 180 == 0) bitmap.width else bitmap.height
          val height = if (rotation % 180 == 0) bitmap.height else bitmap.width
          text?.textBlocks?.flatMap { it.lines }?.forEach { line ->
            val box = line.boundingBox ?: return@forEach
            val value = line.text.replace(Regex("\\s"), "")
            if (!numeric.matches(value)) return@forEach
            val nearBarcode = numericBars.any { barcode ->
              val bar = barcode.boundingBox ?: return@any false
              box.centerX() >= bar.left - bar.width() / 3 && box.centerX() <= bar.right + bar.width() / 3 &&
                box.top >= bar.top && box.top <= bar.bottom + maxOf(bar.height(), box.height() * 3)
            }
            val upperRight = box.centerX() > width * 0.45 && box.bottom < height * 0.30
            if (nearBarcode || (numericBars.isEmpty() && upperRight)) texts.add(value)
          }
          if (codes.isNotEmpty() || texts.isNotEmpty()) break
        }
        val output = JSObject()
        output.put("barcodes", JSArray().apply { codes.forEach { put(it) } })
        output.put("texts", JSArray().apply { texts.forEach { put(it) } })
        invoke.resolve(output)
      } catch (_: Exception) {
        invoke.reject("本地编码识别失败，可手动填写或继续")
      } finally {
        try { scanner?.close(); recognizer?.close() } finally { busy.set(false) }
      }
    }
  }
}
