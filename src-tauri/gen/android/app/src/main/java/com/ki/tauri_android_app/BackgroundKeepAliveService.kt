package com.ki.tauri_android_app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import kotlin.math.abs

class BackgroundKeepAliveService : Service() {
  private var overlayView: View? = null
  private var overlayPanel: View? = null
  private var overlayLayoutParams: WindowManager.LayoutParams? = null
  private var overlayPanelLayoutParams: WindowManager.LayoutParams? = null
  private var overlayPanelAttached = false
  private var overlayBackButton: TextView? = null
  private var overlayOrderLabel: TextView? = null
  private var overlayPhoneLabel: TextView? = null
  private var overlaySecurityDateLabel: TextView? = null
  private var overlayResultLabel: TextView? = null
  private var overlayLogLabel: TextView? = null
  private var overlayStatusBadge: TextView? = null
  private var overlayActionButton: Button? = null
  private lateinit var windowManager: WindowManager

  override fun onCreate() {
    super.onCreate()
    currentService = this
    windowManager = getSystemService(WindowManager::class.java)
    createNotificationChannel()
    startInForeground()
    if (overlayPreferences().getBoolean(PREF_OVERLAY_ENABLED, false)) {
      showOverlay()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startInForeground()
    when (intent?.action) {
      ACTION_SHOW_OVERLAY -> showOverlay()
      ACTION_HIDE_OVERLAY -> hideOverlay(persist = true)
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    hideOverlay(persist = false)
    if (currentService === this) currentService = null
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.background_service_channel_name),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.background_service_text)
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun startInForeground() {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    val notification = builder
      .setSmallIcon(R.drawable.ic_background_service)
      .setContentTitle(getString(R.string.background_service_title))
      .setContentText(getString(R.string.background_service_text))
      .setContentIntent(pendingIntent)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun overlayPreferences() =
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun roundedBackground(color: Int, radiusDp: Float, strokeColor: Int? = null) =
    GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      setColor(color)
      cornerRadius = dp(radiusDp).toFloat()
      if (strokeColor != null) setStroke(dp(1f), strokeColor)
    }

  private fun dp(value: Float): Int =
    (value * resources.displayMetrics.density + 0.5f).toInt()

  private fun showOverlay(): Boolean {
    if (!Settings.canDrawOverlays(this)) return false
    if (overlayView != null) return true

    val bubble = ImageView(this).apply {
      setImageResource(R.mipmap.ic_launcher)
      scaleType = ImageView.ScaleType.FIT_CENTER
      setPadding(dp(3f), dp(3f), dp(3f), dp(3f))
      background = roundedBackground(
        Color.WHITE,
        19f,
        Color.argb(36, 38, 62, 92),
      )
      elevation = dp(6f).toFloat()
      contentDescription = "打开 KiDinDin 工单助手"
      layoutParams = LinearLayout.LayoutParams(dp(38f), dp(38f))
    }
    val panel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      visibility = View.GONE
      setPadding(dp(9f), dp(8f), dp(9f), dp(8f))
      background = roundedBackground(
        Color.argb(246, 255, 255, 255),
        12f,
        Color.argb(45, 38, 62, 92),
      )
      elevation = dp(8f).toFloat()
      layoutParams = LinearLayout.LayoutParams(dp(176f), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
        topMargin = dp(5f)
      }
    }
    val statusBadge = TextView(this).apply {
      text = "已预填"
      textSize = 8f
      includeFontPadding = false
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      setPadding(dp(5f), dp(2f), dp(5f), dp(2f))
      background = roundedBackground(Color.rgb(22, 145, 92), 8f)
      visibility = View.GONE
    }
    val backButton = TextView(this).apply {
      text = "‹ 返回"
      textSize = 9f
      includeFontPadding = false
      setTextColor(Color.rgb(28, 110, 232))
      setPadding(0, dp(2f), dp(5f), dp(2f))
      contentDescription = "返回工单识别首页"
      visibility = View.GONE
      setOnClickListener {
        WorkOrderRecognitionStore.returnHome(this@BackgroundKeepAliveService)
      }
    }
    panel.addView(LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      addView(backButton)
      addView(TextView(this@BackgroundKeepAliveService).apply {
        text = "KiDinDin 工单助手"
        textSize = 11f
        includeFontPadding = false
        setTextColor(Color.rgb(35, 49, 69))
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      })
      addView(statusBadge)
      setPadding(dp(1f), 0, dp(1f), dp(4f))
    })
    val orderLabel = TextView(this).apply {
      textSize = 9f
      maxLines = 1
      includeFontPadding = false
      setTextColor(Color.rgb(83, 101, 126))
      setPadding(dp(1f), dp(2f), dp(1f), 0)
    }
    panel.addView(orderLabel)
    val phoneLabel = TextView(this).apply {
      textSize = 9f
      maxLines = 1
      includeFontPadding = false
      setTextColor(Color.rgb(28, 110, 232))
      paintFlags = paintFlags or android.graphics.Paint.UNDERLINE_TEXT_FLAG
      setPadding(dp(1f), dp(2f), dp(1f), dp(1f))
      visibility = View.GONE
      contentDescription = "点击复制手机号"
      setOnClickListener {
        val phone = WorkOrderRecognitionStore.current(this@BackgroundKeepAliveService)
          .optString("contactPhone")
        if (phone.isBlank()) return@setOnClickListener
        val clipboard = getSystemService(ClipboardManager::class.java)
        clipboard.setPrimaryClip(ClipData.newPlainText("手机号", phone))
        Toast.makeText(this@BackgroundKeepAliveService, "手机号已复制", Toast.LENGTH_SHORT).show()
      }
    }
    panel.addView(phoneLabel)
    val securityDateLabel = TextView(this).apply {
      textSize = 9f
      maxLines = 1
      includeFontPadding = false
      setTextColor(Color.rgb(83, 101, 126))
      setPadding(dp(1f), 0, dp(1f), dp(3f))
      visibility = View.GONE
    }
    panel.addView(securityDateLabel)
    val resultLabel = TextView(this).apply {
      textSize = 8f
      maxLines = 3
      includeFontPadding = false
      setPadding(dp(5f), dp(4f), dp(5f), dp(4f))
      visibility = View.GONE
    }
    panel.addView(resultLabel)
    val logLabel = TextView(this).apply {
      textSize = 8f
      maxLines = 3
      includeFontPadding = false
      setTextColor(Color.rgb(111, 126, 146))
      setPadding(dp(1f), 0, dp(1f), dp(5f))
      visibility = View.GONE
    }
    panel.addView(logLabel)
    val actionButton = Button(this).apply {
      text = "识别当前工单"
      textSize = 11f
      isAllCaps = false
      minHeight = 0
      minWidth = 0
      setPadding(dp(6f), 0, dp(6f), 0)
      setTextColor(Color.WHITE)
      background = roundedBackground(Color.rgb(28, 110, 232), 9f)
      setOnClickListener {
        handleOverlayAction(panel)
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dp(34f),
      )
    }
    panel.addView(actionButton)
    val windowType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val overlayFlags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
      WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
    val params = WindowManager.LayoutParams(
      dp(38f),
      dp(38f),
      windowType,
      overlayFlags,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = resources.displayMetrics.widthPixels - dp(19f)
      y = dp(170f)
    }
    val panelParams = WindowManager.LayoutParams(
      dp(176f),
      WindowManager.LayoutParams.WRAP_CONTENT,
      windowType,
      overlayFlags,
      PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }
    installDragAndTap(bubble, params)

    return try {
      windowManager.addView(bubble, params)
      overlayView = bubble
      overlayPanel = panel
      overlayLayoutParams = params
      overlayPanelLayoutParams = panelParams
      overlayPanelAttached = false
      overlayBackButton = backButton
      overlayOrderLabel = orderLabel
      overlayPhoneLabel = phoneLabel
      overlaySecurityDateLabel = securityDateLabel
      overlayResultLabel = resultLabel
      overlayLogLabel = logLabel
      overlayStatusBadge = statusBadge
      overlayActionButton = actionButton
      updateRecognitionUi()
      overlayPreferences().edit().putBoolean(PREF_OVERLAY_ENABLED, true).apply()
      overlayVisible = true
      true
    } catch (_: Exception) {
      overlayView = null
      overlayPanel = null
      overlayLayoutParams = null
      overlayPanelLayoutParams = null
      overlayPanelAttached = false
      overlayBackButton = null
      overlayOrderLabel = null
      overlayPhoneLabel = null
      overlaySecurityDateLabel = null
      overlayResultLabel = null
      overlayLogLabel = null
      overlayStatusBadge = null
      overlayActionButton = null
      overlayVisible = false
      false
    }
  }

  private fun installDragAndTap(
    bubble: View,
    params: WindowManager.LayoutParams,
  ) {
    var downRawX = 0f
    var downRawY = 0f
    var startX = 0
    var startY = 0
    var panelWasVisible = false
    var dragging = false
    bubble.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downRawX = event.rawX
          downRawY = event.rawY
          startX = params.x
          startY = params.y
          panelWasVisible = overlayPanelAttached
          dragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val moved = abs(event.rawX - downRawX) + abs(event.rawY - downRawY)
          if (!dragging && moved >= dp(8f)) {
            dragging = true
            hidePanel()
          }
          val nextX = startX + (event.rawX - downRawX).toInt()
          val nextY = startY + (event.rawY - downRawY).toInt()
          params.x = nextX.coerceIn(0, (resources.displayMetrics.widthPixels - bubble.width).coerceAtLeast(0))
          params.y = nextY.coerceIn(0, (resources.displayMetrics.heightPixels - bubble.height).coerceAtLeast(0))
          updateOverlayLayout(bubble, params)
          true
        }
        MotionEvent.ACTION_UP -> {
          val moved = abs(event.rawX - downRawX) + abs(event.rawY - downRawY)
          if (moved < dp(8f)) {
            if (panelWasVisible) hidePanel() else showPanel()
          } else {
            val dockRight = params.x + bubble.width / 2 >= resources.displayMetrics.widthPixels / 2
            params.x = if (dockRight) {
              resources.displayMetrics.widthPixels - bubble.width / 2
            } else {
              -bubble.width / 2
            }
            params.y = params.y.coerceIn(
              0,
              (resources.displayMetrics.heightPixels - bubble.height).coerceAtLeast(0),
            )
            updateOverlayLayout(bubble, params)
          }
          true
        }
        else -> false
      }
    }
  }

  private fun showPanel() {
    if (overlayPanelAttached) return
    val bubble = overlayView ?: return
    val bubbleParams = overlayLayoutParams ?: return
    val panel = overlayPanel ?: return
    val panelParams = overlayPanelLayoutParams ?: return
    val panelWidth = dp(176f)
    val bubbleCenterX = bubbleParams.x + bubble.width / 2
    panelParams.x = if (bubbleCenterX >= resources.displayMetrics.widthPixels / 2) {
      resources.displayMetrics.widthPixels - panelWidth
    } else {
      0
    }
    panel.visibility = View.VISIBLE
    panel.measure(
      View.MeasureSpec.makeMeasureSpec(panelWidth, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
    )
    val belowY = bubbleParams.y + bubble.height + dp(5f)
    panelParams.y = if (belowY + panel.measuredHeight <= resources.displayMetrics.heightPixels) {
      belowY
    } else {
      (bubbleParams.y - panel.measuredHeight - dp(5f)).coerceAtLeast(0)
    }
    updateRecognitionUi()
    try {
      windowManager.addView(panel, panelParams)
      overlayPanelAttached = true
    } catch (_: Exception) {
      overlayPanelAttached = false
    }
  }

  private fun hidePanel() {
    if (!overlayPanelAttached) return
    overlayPanel?.let { panel ->
      try {
        windowManager.removeView(panel)
      } catch (_: Exception) {
        // The panel may already have been removed with the service window token.
      }
    }
    overlayPanelAttached = false
  }

  private fun updateOverlayLayout(view: View, params: WindowManager.LayoutParams) {
    try {
      windowManager.updateViewLayout(view, params)
    } catch (_: Exception) {
      // The service may be tearing down while the final touch event arrives.
    }
  }

  private fun hideOverlay(persist: Boolean) {
    hidePanel()
    overlayView?.let { view ->
      try {
        windowManager.removeView(view)
      } catch (_: Exception) {
        // The system may already have removed the overlay after permission revocation.
      }
    }
    overlayView = null
    overlayPanel = null
    overlayLayoutParams = null
    overlayPanelLayoutParams = null
    overlayPanelAttached = false
    overlayBackButton = null
    overlayOrderLabel = null
    overlayPhoneLabel = null
    overlaySecurityDateLabel = null
    overlayResultLabel = null
    overlayLogLabel = null
    overlayStatusBadge = null
    overlayActionButton = null
    overlayVisible = false
    if (persist) {
      overlayPreferences().edit().putBoolean(PREF_OVERLAY_ENABLED, false).apply()
    }
  }

  private fun handleOverlayAction(panel: View) {
    when (WorkOrderRecognitionStore.current(this).optString("state")) {
      "matched", "repeat_confirm", "prefill_error" -> {
        if (!WorkOrderRecognitionStore.markPending(this)) updateRecognitionUi()
      }
      "recognizing", "prefill_queued", "prefill_running" -> Unit
      else -> {
        panel.visibility = View.INVISIBLE
        panel.postDelayed(
          {
            WorkOrderRecognitionAccessibilityService.requestRecognition(this)
          },
          180L,
        )
      }
    }
  }

  private fun updateRecognitionUi() {
    val recognition = WorkOrderRecognitionStore.current(this)
    val state = recognition.optString("state")
    val logs = recognition.optString("logs")
    val hasTarget = recognition.optString("woHeaderId").isNotBlank()
    val busy = state in setOf("recognizing", "prefill_queued", "prefill_running")
    overlayOrderLabel?.text = if (hasTarget) {
      "用户：${recognition.optString("resident", "未知")}"
    } else {
      recognition.optString("message", "等待识别当前工单")
    }
    overlayPhoneLabel?.apply {
      val phone = recognition.optString("contactPhone")
      text = "手机：${phone.ifBlank { "未提供" }}"
      visibility = if (hasTarget) View.VISIBLE else View.GONE
      isEnabled = phone.isNotBlank()
      alpha = if (phone.isNotBlank()) 1f else 0.65f
    }
    overlaySecurityDateLabel?.apply {
      text = "最近安检日期：${recognition.optString("securityDate").ifBlank { "查询中…" }}"
      visibility = if (hasTarget) View.VISIBLE else View.GONE
    }
    overlayResultLabel?.apply {
      val resultMessage = recognition.optString("resultMessage")
      val resultState = recognition.optString("resultState")
      text = "上次结果：$resultMessage"
      setTextColor(
        if (resultState == "success") Color.rgb(17, 122, 75)
        else Color.rgb(186, 58, 58),
      )
      background = roundedBackground(
        if (resultState == "success") Color.rgb(231, 248, 239)
        else Color.rgb(255, 238, 238),
        6f,
      )
      visibility = if (resultMessage.isBlank()) View.GONE else View.VISIBLE
    }
    overlayBackButton?.apply {
      visibility = if (hasTarget) View.VISIBLE else View.GONE
      isEnabled = !busy
      alpha = if (busy) 0.45f else 1f
    }
    overlayLogLabel?.apply {
      text = logs
      visibility = if (logs.isBlank()) View.GONE else View.VISIBLE
    }
    overlayStatusBadge?.visibility = if (
      hasTarget && recognition.optBoolean("prefilled", false)
    ) {
      View.VISIBLE
    } else {
      View.GONE
    }
    overlayActionButton?.apply {
      val matched = state == "matched" && recognition.optString("woHeaderId").isNotBlank()
      val repeatConfirm = state == "repeat_confirm" && recognition.optString("woHeaderId").isNotBlank()
      val retry = state == "prefill_error" && recognition.optString("woHeaderId").isNotBlank()
      isEnabled = !busy
      text = when {
        state == "recognizing" -> "识别中…"
        state in setOf("prefill_queued", "prefill_running") -> "安检预填中…"
        matched -> "安检预填"
        repeatConfirm -> "确认再次预填"
        retry -> "重试安检预填"
        state == "prefill_success" -> "识别当前工单"
        else -> "识别当前工单"
      }
      setTextColor(if (busy) Color.rgb(132, 145, 162) else Color.WHITE)
      background = roundedBackground(
        when {
          busy -> Color.rgb(232, 236, 241)
          matched -> Color.rgb(22, 145, 92)
          repeatConfirm || retry -> Color.rgb(211, 126, 24)
          else -> Color.rgb(28, 110, 232)
        },
        9f,
      )
    }
  }

  companion object {
    private const val CHANNEL_ID = "kidindin_background_tasks"
    private const val NOTIFICATION_ID = 20260803
    private const val PREFS_NAME = "kidindin_native_settings"
    private const val PREF_OVERLAY_ENABLED = "floating_overlay_enabled"
    private const val ACTION_SHOW_OVERLAY = "com.ki.tauri_android_app.action.SHOW_OVERLAY"
    private const val ACTION_HIDE_OVERLAY = "com.ki.tauri_android_app.action.HIDE_OVERLAY"

    @Volatile
    private var overlayVisible = false

    @Volatile
    private var currentService: BackgroundKeepAliveService? = null

    fun refreshRecognition() {
      val service = currentService ?: return
      Handler(Looper.getMainLooper()).post { service.updateRecognitionUi() }
    }

    fun restorePanelAfterRecognitionCapture() {
      val service = currentService ?: return
      Handler(Looper.getMainLooper()).post {
        if (service.overlayPanel?.visibility == View.INVISIBLE) {
          service.overlayPanel?.visibility = View.VISIBLE
          service.updateRecognitionUi()
        }
      }
    }

    fun schedulePrefillQueueTimeout(woHeaderId: String) {
      val service = currentService ?: return
      Handler(Looper.getMainLooper()).postDelayed(
        {
          val current = WorkOrderRecognitionStore.current(service)
          if (
            current.optString("state") == "prefill_queued" &&
            current.optString("woHeaderId") == woHeaderId
          ) {
            WorkOrderRecognitionStore.reportPrefill(
              service,
              woHeaderId,
              "prefill_error",
              "后台预填未响应，请确认 KiDinDin 登录仍有效后重试",
            )
          }
        },
        12_000L,
      )
    }

    fun start(context: Context) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, BackgroundKeepAliveService::class.java),
      )
    }

    fun showOverlay(context: Context) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, BackgroundKeepAliveService::class.java).setAction(ACTION_SHOW_OVERLAY),
      )
    }

    fun hideOverlay(context: Context) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, BackgroundKeepAliveService::class.java).setAction(ACTION_HIDE_OVERLAY),
      )
    }

    fun isOverlayVisible(): Boolean = overlayVisible

    fun isOverlayEnabled(context: Context): Boolean =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getBoolean(PREF_OVERLAY_ENABLED, false)
  }
}
