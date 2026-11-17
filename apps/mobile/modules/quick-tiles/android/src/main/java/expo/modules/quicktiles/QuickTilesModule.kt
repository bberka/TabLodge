package expo.modules.quicktiles

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.view.ViewTreeObserver
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android 10 and newer hand the clipboard only to the app whose window has focus, which comes a moment after a tile
// brings the app forward. Past this wait the read is tried anyway, for when a dialog's window holds the focus.
private const val FOCUS_WAIT_MS = 2000L

class QuickTilesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QuickTiles")

    // The clipboard's text once the app's window has focus, or null when it is empty or Android refuses.
    AsyncFunction("clipboardText") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }

      activity.runOnUiThread { readWhenFocused(activity, promise) }
    }
  }
}

private fun readWhenFocused(activity: Activity, promise: Promise) {
  val view = activity.window.decorView
  if (view.hasWindowFocus()) {
    promise.resolve(clipboardText(activity))
    return
  }

  var done = false
  val listener = object : ViewTreeObserver.OnWindowFocusChangeListener {
    override fun onWindowFocusChanged(hasFocus: Boolean) {
      if (hasFocus && !done) {
        done = true
        view.viewTreeObserver.removeOnWindowFocusChangeListener(this)
        promise.resolve(clipboardText(activity))
      }
    }
  }
  view.viewTreeObserver.addOnWindowFocusChangeListener(listener)
  view.postDelayed({
    if (!done) {
      done = true
      view.viewTreeObserver.removeOnWindowFocusChangeListener(listener)
      promise.resolve(clipboardText(activity))
    }
  }, FOCUS_WAIT_MS)
}

private fun clipboardText(context: Context): String? {
  val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return null
  val clip = clipboard.primaryClip ?: return null
  return if (clip.itemCount > 0) clip.getItemAt(0).coerceToText(context)?.toString() else null
}
