package expo.modules.openlinks

import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.browser.customtabs.CustomTabsIntent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Opens several links in one call, in the default browser, an in-app tab, or a chosen browser. Android only lets the
 * app that is on screen start another app's screen, and the first link puts the browser on screen, so a loop of single opens stops after one. `startActivities` hands
 * the whole stack to the system at once, while this app is still in front.
 */
class OpenLinksModule : Module() {
  private var screenOffReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("OpenLinks")

    // Tells the app when the screen turns off, which is when the phone locks, so the private library can lock too.
    Events("screenOff")

    OnCreate {
      val context = appContext.reactContext
      if (context != null) {
        val receiver = object : BroadcastReceiver() {
          override fun onReceive(context: Context?, intent: Intent?) {
            sendEvent("screenOff", mapOf<String, Any>())
          }
        }
        val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
          context.registerReceiver(receiver, filter)
        }
        screenOffReceiver = receiver
      }
    }

    OnDestroy {
      screenOffReceiver?.let { appContext.reactContext?.unregisterReceiver(it) }
      screenOffReceiver = null
    }

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

    // The browsers installed on the phone, as [package name, label] pairs, for the "open links in" choice.
    Function("browsers") {
      val context = appContext.currentActivity ?: appContext.reactContext
      if (context == null) {
        emptyList()
      } else {
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")).addCategory(Intent.CATEGORY_BROWSABLE)
        @Suppress("DEPRECATION")
        context.packageManager.queryIntentActivities(probe, PackageManager.MATCH_ALL)
          .map { it.activityInfo.packageName to it.loadLabel(context.packageManager).toString() }
          .filter { it.first != context.packageName }
          .distinctBy { it.first }
          .sortedBy { it.second.lowercase() }
          .map { listOf(it.first, it.second) }
      }
    }

    // Opens the links with `how`: "system" (the default browser), "inapp" (a Custom Tab over this app), or "app" (the
    // browser named by `packageName`). Returns false when nothing could start them, so the caller can fall back.
    Function("openAll") { urls: List<String>, how: String, packageName: String? ->
      val context = appContext.currentActivity ?: appContext.reactContext
      val intents = urls
        .filter { it.startsWith("http://") || it.startsWith("https://") }
        .map {
          val uri = Uri.parse(it)
          val intent = if (how == "inapp") {
            CustomTabsIntent.Builder().build().intent.setData(uri)
          } else {
            Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
          }
          if (how == "app" && !packageName.isNullOrEmpty()) {
            intent.setPackage(packageName)
          }
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
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
