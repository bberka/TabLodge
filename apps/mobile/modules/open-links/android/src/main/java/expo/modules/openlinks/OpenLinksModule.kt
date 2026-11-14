package expo.modules.openlinks

import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.util.Base64
import java.io.ByteArrayOutputStream
import android.net.Uri
import android.os.Build
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Opens several links in one call, in the default browser, an in-app tab, or a chosen browser. Android only lets the
 * app that is on screen start another app's screen, and the first link puts the browser on screen, so a loop of single opens stops after one. `startActivities` hands
 * the whole stack to the system at once, while this app is still in front.
 */
class OpenLinksModule : Module() {
  private var screenOffReceiver: BroadcastReceiver? = null

  // An app's icon as a 96 pixel PNG in base64, drawn whatever kind of drawable it is (launcher icons are adaptive).
  private fun iconBase64(drawable: Drawable, size: Int = 96): String {
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    drawable.setBounds(0, 0, size, size)
    drawable.draw(Canvas(bitmap))
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }

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

    // How much of the screen's bottom the on-screen keyboard covers right now, in dp (0 while it is closed). It is read
    // from the window itself, so it is right even when the keyboard's show and hide events were missed.
    Function("keyboardHeight") {
      val activity = appContext.currentActivity
      val insets = activity?.window?.decorView?.let { ViewCompat.getRootWindowInsets(it) }
      if (activity == null || insets == null || !insets.isVisible(WindowInsetsCompat.Type.ime())) {
        0.0
      } else {
        insets.getInsets(WindowInsetsCompat.Type.ime()).bottom / activity.resources.displayMetrics.density.toDouble()
      }
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

    // The browsers installed on the phone, as [package name, label, icon] triples, for the "open links in" choice. The
    // icon is a small PNG as base64, drawn from the app's own launcher icon.
    Function("browsers") {
      val context = appContext.currentActivity ?: appContext.reactContext
      if (context == null) {
        emptyList()
      } else {
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")).addCategory(Intent.CATEGORY_BROWSABLE)
        @Suppress("DEPRECATION")
        val icons = mutableMapOf<String, String>()
        context.packageManager.queryIntentActivities(probe, PackageManager.MATCH_ALL)
          .map {
            icons.putIfAbsent(it.activityInfo.packageName, iconBase64(it.loadIcon(context.packageManager)))
            it.activityInfo.packageName to it.loadLabel(context.packageManager).toString()
          }
          .filter { it.first != context.packageName }
          .distinctBy { it.first }
          .sortedBy { it.second.lowercase() }
          .map { listOf(it.first, it.second, icons[it.first] ?: "") }
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
