package expo.modules.appupdate

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Starts Android's installer on an APK this app downloaded. Android 8 and newer ask the person to allow installs from
 * this app once, in Settings; older versions have no such switch.
 */
class AppUpdateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppUpdate")

    // Whether Android lets this app start an install right now.
    Function("canInstall") {
      val context = appContext.reactContext
      context != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls())
    }

    // Opens the Settings page where the person allows installs from this app.
    Function("openInstallSettings") {
      val context = appContext.currentActivity ?: appContext.reactContext
      if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startActivity(
          Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
      }
    }

    // Opens the installer on the file at `path`, which must be under the cache's `updates` folder. Returns false when
    // nothing could start it.
    Function("install") { path: String ->
      val context = appContext.currentActivity ?: appContext.reactContext
      if (context == null) {
        false
      } else {
        try {
          val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", File(path))
          context.startActivity(
            Intent(Intent.ACTION_VIEW)
              .setDataAndType(uri, "application/vnd.android.package-archive")
              .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
          )
          true
        } catch (_: ActivityNotFoundException) {
          false
        } catch (_: IllegalArgumentException) {
          false
        }
      }
    }
  }
}
