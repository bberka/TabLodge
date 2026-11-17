package expo.modules.bookmarkswidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews

/**
 * The Bookmarks widget: one column of the regular library, read from the snapshot the app writes. It shows a message
 * instead of rows when there is no snapshot, its column is gone, or the column is empty.
 */
class BookmarksWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
    redraw(context, manager, widgetIds)
  }

  override fun onDeleted(context: Context, widgetIds: IntArray) {
    for (widgetId in widgetIds) {
      WidgetData.forget(context, widgetId)
    }
  }

  companion object {
    /** Redraws every placed widget and reloads its rows, after the app writes or deletes the snapshot. */
    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, BookmarksWidgetProvider::class.java))
      if (ids.isEmpty()) {
        return
      }

      redraw(context, manager, ids)
    }

    /**
     * Reloads the rows, then draws each widget. In this order, because on recent Android a data refresh re-sends the
     * views it last had; drawing after it makes the new header and state the last word.
     */
    fun redraw(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
      manager.notifyAppWidgetViewDataChanged(widgetIds, R.id.bookmarks_widget_list)
      val snapshot = WidgetData.read(context)
      for (widgetId in widgetIds) {
        draw(context, manager, widgetId, snapshot)
      }
    }

    private fun draw(context: Context, manager: AppWidgetManager, widgetId: Int, snapshot: WidgetSnapshot?) {
      val views = RemoteViews(context.packageName, R.layout.bookmarks_widget)
      val column = snapshot?.column(WidgetData.columnOf(context, widgetId))
      val openApp = activity(context, widgetId * 4, openAppIntent(context, column?.id))
      val configure = activity(context, widgetId * 4 + 1, configureIntent(context, widgetId))

      views.setTextViewText(
        R.id.bookmarks_widget_title,
        column?.name ?: context.getString(R.string.bookmarks_widget_label),
      )
      views.setContentDescription(
        R.id.bookmarks_widget_header,
        if (column == null) {
          context.getString(R.string.bookmarks_widget_open_tablodge)
        } else {
          context.getString(R.string.bookmarks_widget_open_app, column.name)
        },
      )
      views.setOnClickPendingIntent(R.id.bookmarks_widget_header, openApp)
      views.setOnClickPendingIntent(R.id.bookmarks_widget_settings, configure)

      // A widget with no stored column (it was never configured, or its settings were cleared) is treated like one
      // whose column was deleted: it offers to choose another.
      val message = when {
        snapshot == null -> R.string.bookmarks_widget_not_loaded
        column == null -> R.string.bookmarks_widget_column_gone
        column.links.isEmpty() -> R.string.bookmarks_widget_empty
        else -> null
      }

      if (message == null) {
        views.setViewVisibility(R.id.bookmarks_widget_list, View.VISIBLE)
        views.setViewVisibility(R.id.bookmarks_widget_message, View.GONE)
        val rows = Intent(context, BookmarksWidgetService::class.java)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
          .setData(Uri.parse("tablodge-widget://rows/$widgetId"))
        @Suppress("DEPRECATION")
        views.setRemoteAdapter(R.id.bookmarks_widget_list, rows)
        val template = Intent(context, BookmarksWidgetLinkActivity::class.java)
          .setData(Uri.parse("tablodge-widget://open/$widgetId"))
        // Each row fills in its own address, which needs a mutable template on Android 12 and newer.
        val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        views.setPendingIntentTemplate(
          R.id.bookmarks_widget_list,
          PendingIntent.getActivity(context, widgetId * 4 + 2, template, PendingIntent.FLAG_UPDATE_CURRENT or mutable),
        )
      } else {
        views.setViewVisibility(R.id.bookmarks_widget_list, View.GONE)
        views.setViewVisibility(R.id.bookmarks_widget_message, View.VISIBLE)
        views.setTextViewText(R.id.bookmarks_widget_message, context.getString(message))
        views.setOnClickPendingIntent(
          R.id.bookmarks_widget_message,
          if (message == R.string.bookmarks_widget_column_gone) configure else openApp,
        )
      }

      manager.updateAppWidget(widgetId, views)
    }

    private fun activity(context: Context, requestCode: Int, intent: Intent): PendingIntent =
      PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    /** Opens the app on the column, through the same tablodge:// addresses as the Quick Settings tiles. */
    private fun openAppIntent(context: Context, columnId: String?): Intent {
      val intent = if (columnId == null) {
        context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
      } else {
        Intent(Intent.ACTION_VIEW, Uri.parse("tablodge://column/${Uri.encode(columnId)}"))
          .setPackage(context.packageName)
      }
      return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    private fun configureIntent(context: Context, widgetId: Int): Intent =
      Intent(context, BookmarksWidgetConfigActivity::class.java)
        .setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        .setData(Uri.parse("tablodge-widget://configure/$widgetId"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }
}
