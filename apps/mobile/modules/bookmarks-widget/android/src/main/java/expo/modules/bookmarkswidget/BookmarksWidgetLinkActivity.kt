package expo.modules.bookmarkswidget

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle

const val EXTRA_URL = "expo.modules.bookmarkswidget.URL"

// The extra that turns a plain VIEW intent into a Custom Tab; what androidx.browser's CustomTabsIntent sets.
private const val CUSTOM_TABS_SESSION = "android.support.customtabs.extra.SESSION"

/**
 * Opens a widget row's link the way **Settings › Open links** says, then closes. It has no window and its own empty
 * task, so TabLodge does not come to the front. A chosen browser that is gone falls back to the default one.
 */
class BookmarksWidgetLinkActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val url = intent.getStringExtra(EXTRA_URL)
    if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
      open(Uri.parse(url))
    }
    finish()
  }

  private fun open(uri: Uri) {
    val snapshot = WidgetData.read(this)
    val chosen = Intent(Intent.ACTION_VIEW, uri)
      .addCategory(Intent.CATEGORY_BROWSABLE)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    when (snapshot?.openWith) {
      "inapp" -> chosen.putExtras(Bundle().apply { putBinder(CUSTOM_TABS_SESSION, null) })
      "app" -> if (snapshot.openApp.isNotEmpty()) chosen.setPackage(snapshot.openApp)
    }
    try {
      startActivity(chosen)
    } catch (_: ActivityNotFoundException) {
      try {
        startActivity(
          Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      } catch (_: ActivityNotFoundException) {
        // No app on the phone opens web links.
      }
    }
  }
}
