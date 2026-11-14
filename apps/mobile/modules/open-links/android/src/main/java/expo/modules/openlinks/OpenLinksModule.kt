package expo.modules.openlinks

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Opens several links in one call. Android only lets the app that is on screen start another app's screen, and
 * the first link puts the browser on screen, so a loop of single opens stops after one. `startActivities` hands
 * the whole stack to the system at once, while this app is still in front.
 */
class OpenLinksModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpenLinks")

    // The phone's own accent color, as the light and the dark shade Android's Material You palette uses for a
    // primary color, or null before Android 12, which has no such palette.
    Function("systemAccent") {
      val context = appContext.currentActivity ?: appContext.reactContext
      if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        null
      } else {
        val resources = context.resources
        fun hex(id: Int) = String.format("#%06x", resources.getColor(id, context.theme) and 0xFFFFFF)
        listOf(hex(android.R.color.system_accent1_600), hex(android.R.color.system_accent1_200))
      }
    }

    Function("openAll") { urls: List<String> ->
      val context = appContext.currentActivity ?: appContext.reactContext
      val intents = urls
        .filter { it.startsWith("http://") || it.startsWith("https://") }
        .map {
          Intent(Intent.ACTION_VIEW, Uri.parse(it))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        .toTypedArray()
      if (context == null || intents.isEmpty()) {
        false
      } else {
        try {
          context.startActivities(intents)
          true
        } catch (_: ActivityNotFoundException) {
          false
        }
      }
    }
  }
}
