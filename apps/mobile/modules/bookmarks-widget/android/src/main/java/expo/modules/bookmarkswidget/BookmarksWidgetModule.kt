package expo.modules.bookmarkswidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Takes the widget snapshot from the app (src/library/widget-sync.ts) and redraws the placed widgets. */
class BookmarksWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BookmarksWidget")

    // Writes the snapshot JSON, or deletes it when given null.
    Function("writeSnapshot") { json: String? ->
      val context = appContext.reactContext ?: return@Function
      WidgetData.write(context, json)
      BookmarksWidgetProvider.refreshAll(context)
    }
  }
}
