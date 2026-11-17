package expo.modules.bookmarkswidget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Supplies the rows of one placed widget: the links of its column, from the snapshot. */
class BookmarksWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    Rows(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID))
}

private class Rows(private val context: Context, private val widgetId: Int) : RemoteViewsService.RemoteViewsFactory {
  private var links: List<WidgetLink> = emptyList()

  override fun onCreate() {}

  override fun onDataSetChanged() {
    links = WidgetData.read(context)?.column(WidgetData.columnOf(context, widgetId))?.links ?: emptyList()
  }

  override fun onDestroy() {
    links = emptyList()
  }

  override fun getCount() = links.size

  override fun getViewAt(position: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.bookmarks_widget_row)
    val link = links.getOrNull(position) ?: return views
    val letter = link.host.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "#"
    views.setTextViewText(R.id.bookmarks_widget_letter, letter)
    views.setTextViewText(R.id.bookmarks_widget_row_title, link.title)
    // An untitled link is named by its site, which then needs no second line.
    val untitled = link.title == link.host
    views.setTextViewText(R.id.bookmarks_widget_row_host, link.host)
    views.setViewVisibility(R.id.bookmarks_widget_row_host, if (untitled) View.GONE else View.VISIBLE)
    views.setContentDescription(R.id.bookmarks_widget_row, if (untitled) link.host else "${link.title}, ${link.host}")
    views.setOnClickFillInIntent(R.id.bookmarks_widget_row, Intent().putExtra(EXTRA_URL, link.url))
    return views
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount() = 1

  override fun getItemId(position: Int) = position.toLong()

  override fun hasStableIds() = false
}
