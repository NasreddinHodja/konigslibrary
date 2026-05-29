package com.konigslibrary.reader

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin
class ImmersivePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun setImmersive(invoke: Invoke) {
    val hidden = invoke.getArgs().getBoolean("hidden")
    activity.runOnUiThread {
      (activity as? MainActivity)?.applyImmersive(hidden)
    }
    invoke.resolve()
  }
}
