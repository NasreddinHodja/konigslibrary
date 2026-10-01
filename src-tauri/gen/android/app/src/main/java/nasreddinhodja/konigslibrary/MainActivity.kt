package nasreddinhodja.konigslibrary

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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null
  private var immersiveHidden = false

  /// Widths of the left and right system gesture zones (back), in CSS px.
  /// Refreshed on the UI thread whenever the WebView lays out; read from the
  /// JS bridge's thread, hence volatile.
  @Volatile private var gestureInsets = "0,0"

  private var imeVisible = false

  private fun updateGestureInsets(view: WebView) {
    val insets = ViewCompat.getRootWindowInsets(view) ?: return
    val zones = insets.getInsets(WindowInsetsCompat.Type.systemGestures())
    val density = resources.displayMetrics.density
    gestureInsets = "${zones.left / density},${zones.right / density}"
  }

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

  fun applyStatusBarStyle(light: Boolean) {
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = light
    controller.isAppearanceLightNavigationBars = light
  }

  inner class NativeBridge {
    @JavascriptInterface
    fun setImmersive(hidden: Boolean) {
      runOnUiThread { applyImmersive(hidden) }
    }

    @JavascriptInterface
    fun setStatusBarStyle(light: Boolean) {
      runOnUiThread { applyStatusBarStyle(light) }
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

    /// "left,right": how far in from each side the system's back gesture
    /// starts, so the page can leave swipes there to the system.
    @JavascriptInterface
    fun systemGestureInsets(): String = gestureInsets

    @JavascriptInterface
    fun releaseWakeLock() {
      stopService(Intent(this@MainActivity, DownloadService::class.java))
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    webViewRef = webView
    webView.isVerticalScrollBarEnabled = false
    webView.isHorizontalScrollBarEnabled = false
    // Long presses are the page's to handle; the WebView's own one (text
    // selection) only buzzes, with nothing to show for it.
    webView.isHapticFeedbackEnabled = false
    webView.addJavascriptInterface(NativeBridge(), "__kl")
    webView.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ -> updateGestureInsets(v as WebView) }
    // The keyboard can close while its field keeps focus (system back), which
    // the page can't see; it's told whenever the keyboard shows or hides.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
      val visible = insets.isVisible(WindowInsetsCompat.Type.ime())
      if (visible != imeVisible) {
        imeVisible = visible
        (v as WebView).evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('nativeime',{detail:$visible}))", null
        )
      }
      // The WebView's own handling, which feeds the page's safe-area insets.
      ViewCompat.onApplyWindowInsets(v, insets)
    }

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
      // Back from settings, the gesture sensitivity may have changed.
      webViewRef?.let { updateGestureInsets(it) }
    }
  }
}
