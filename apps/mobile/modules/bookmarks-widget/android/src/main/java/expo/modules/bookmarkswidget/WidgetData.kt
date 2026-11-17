package expo.modules.bookmarkswidget

import android.content.Context
import org.json.JSONObject
import java.io.File

// The version src/library/widget-snapshot.ts writes. Any other is treated as no snapshot.
private const val SNAPSHOT_VERSION = 1
private const val PREFS = "tablodge_bookmarks_widget"

class WidgetLink(val title: String, val url: String, val host: String)

class WidgetColumn(val id: String, val name: String, val count: Int, val links: List<WidgetLink>)

class WidgetSnapshot(val openWith: String, val openApp: String, val columns: List<WidgetColumn>) {
  fun column(id: String?): WidgetColumn? = columns.firstOrNull { it.id == id }
}

/**
 * The widget's copy of the regular library, which the app writes, and the column each placed widget shows. Both stay
 * in the app's private storage.
 */
object WidgetData {
  private fun file(context: Context) = File(context.filesDir, "widgets/bookmarks.json")

  /** Writes the snapshot through a temporary file, so a widget never reads half of one; null deletes it. */
  fun write(context: Context, json: String?) {
    val target = file(context)
    if (json == null) {
      target.delete()
      return
    }

    target.parentFile?.mkdirs()
    val temporary = File(target.parentFile, "bookmarks.json.tmp")
    temporary.writeText(json)
    if (!temporary.renameTo(target)) {
      target.writeText(json)
      temporary.delete()
    }
  }

  /** The snapshot, or null when there is none or it cannot be read, which the widget shows as "not loaded". */
  fun read(context: Context): WidgetSnapshot? = try {
    val target = file(context)
    if (!target.exists()) null else parse(JSONObject(target.readText()))
  } catch (_: Exception) {
    null
  }

  private fun parse(json: JSONObject): WidgetSnapshot? {
    if (json.optInt("v") != SNAPSHOT_VERSION) {
      return null
    }

    val open = json.optJSONObject("open")
    val columns = json.optJSONArray("columns") ?: return null
    return WidgetSnapshot(
      open?.optString("how", "system") ?: "system",
      open?.optString("app", "") ?: "",
      (0 until columns.length()).mapNotNull { index ->
        val column = columns.optJSONObject(index) ?: return@mapNotNull null
        val links = column.optJSONArray("links")
        WidgetColumn(
          column.optString("id"),
          column.optString("name"),
          column.optInt("count"),
          (0 until (links?.length() ?: 0)).mapNotNull { at ->
            val link = links?.optJSONObject(at) ?: return@mapNotNull null
            WidgetLink(link.optString("title"), link.optString("url"), link.optString("host"))
          },
        )
      },
    )
  }

  fun columnOf(context: Context, widgetId: Int): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("column_$widgetId", null)

  fun setColumn(context: Context, widgetId: Int, columnId: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("column_$widgetId", columnId).apply()
  }

  fun forget(context: Context, widgetId: Int) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("column_$widgetId").apply()
  }
}
