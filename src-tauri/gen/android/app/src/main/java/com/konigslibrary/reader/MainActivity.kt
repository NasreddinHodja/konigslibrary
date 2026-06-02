package com.konigslibrary.reader

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null
  private var immersiveHidden = false

  private val requestNotificationPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

  fun applyImmersive(hidden: Boolean) {
    immersiveHidden = hidden
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    if (hidden) {
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.systemBars())
    } else {
      controller.show(WindowInsetsCompat.Type.systemBars())
    }
  }

  inner class NativeBridge {
    @JavascriptInterface
    fun setImmersive(hidden: Boolean) {
      runOnUiThread { applyImmersive(hidden) }
    }

    @JavascriptInterface
    fun acquireWakeLock(label: String, total: Int) {
      startForegroundService(Intent(this@MainActivity, DownloadService::class.java).apply {
        action = DownloadService.ACTION_START
        putExtra(DownloadService.EXTRA_LABEL, label)
        putExtra(DownloadService.EXTRA_TOTAL, total)
      })
    }

    @JavascriptInterface
    fun updateDownloadProgress(current: Int, total: Int) {
      startService(Intent(this@MainActivity, DownloadService::class.java).apply {
        action = DownloadService.ACTION_PROGRESS
        putExtra(DownloadService.EXTRA_CURRENT, current)
        putExtra(DownloadService.EXTRA_TOTAL, total)
      })
    }

    @JavascriptInterface
    fun releaseWakeLock() {
      stopService(Intent(this@MainActivity, DownloadService::class.java))
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    webViewRef = webView
    webView.isVerticalScrollBarEnabled = false
    webView.isHorizontalScrollBarEnabled = false
    webView.addJavascriptInterface(NativeBridge(), "__kl")

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = webViewRef ?: run {
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          isEnabled = true
          return
        }
        wv.evaluateJavascript(
          "(function(){var e=new CustomEvent('nativeback',{cancelable:true,bubbles:false});return !window.dispatchEvent(e)})()"
        ) { result ->
          if (result != "true") {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    })
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
          != PackageManager.PERMISSION_GRANTED) {
        requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
      }
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      applyImmersive(immersiveHidden)
    }
  }
}
