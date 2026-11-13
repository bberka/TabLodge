package expo.modules.openlinks

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
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
