package com.konigslibrary.reader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

class DownloadService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private lateinit var notificationManager: NotificationManager
  private var currentLabel: String = "Downloading…"
  private var pendingCurrent: Int = 0
  private var pendingTotal: Int = 0
  private var updateScheduled = false
  private val handler = Handler(Looper.getMainLooper())

  companion object {
    const val ACTION_START = "ACTION_START"
    const val ACTION_PROGRESS = "ACTION_PROGRESS"
    const val EXTRA_LABEL = "label"
    const val EXTRA_CURRENT = "current"
    const val EXTRA_TOTAL = "total"
    const val NOTIFICATION_ID = 1001
    const val CHANNEL_ID = "kl_download"
    const val NOTIFY_INTERVAL_MS = 300L
  }

  private val flushNotification = Runnable {
    updateScheduled = false
    notificationManager.notify(NOTIFICATION_ID, buildNotification(currentLabel, pendingCurrent, pendingTotal))
  }

  private fun scheduleNotify() {
    if (!updateScheduled) {
      updateScheduled = true
      handler.postDelayed(flushNotification, NOTIFY_INTERVAL_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    notificationManager = getSystemService(NotificationManager::class.java)
    notificationManager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW)
    )

    val pm = getSystemService(PowerManager::class.java)
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "konigslibrary:download")
    wakeLock?.acquire(30 * 60 * 1000L)

    val initial = buildNotification(currentLabel, 0, 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, initial, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, initial)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        currentLabel = intent.getStringExtra(EXTRA_LABEL) ?: "Downloading…"
        pendingTotal = intent.getIntExtra(EXTRA_TOTAL, 0)
        pendingCurrent = 0
        handler.removeCallbacks(flushNotification)
        updateScheduled = false
        notificationManager.notify(NOTIFICATION_ID, buildNotification(currentLabel, 0, pendingTotal))
      }
      ACTION_PROGRESS -> {
        pendingCurrent = intent.getIntExtra(EXTRA_CURRENT, 0)
        pendingTotal = intent.getIntExtra(EXTRA_TOTAL, pendingTotal)
        scheduleNotify()
      }
    }
    return START_NOT_STICKY
  }

  private fun buildNotification(label: String, current: Int, total: Int): Notification {
    val tapIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val tapPending = PendingIntent.getActivity(
      this, 0, tapIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val builder = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle(label)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentIntent(tapPending)
      .setOnlyAlertOnce(true)
      .setOngoing(true)

    if (total > 0) {
      val pct = current * 100 / total
      builder
        .setContentText("$current / $total pages · $pct%")
        .setProgress(total, current, false)
    } else {
      builder
        .setContentText("Downloading…")
        .setProgress(0, 0, true)
    }

    return builder.build()
  }

  override fun onDestroy() {
    handler.removeCallbacks(flushNotification)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    notificationManager.cancel(NOTIFICATION_ID)
    wakeLock?.release()
    wakeLock = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
