package expo.modules.bookmarkswidget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.util.TypedValue
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView

/**
 * Chooses the column a Bookmarks widget shows, when it is placed and again from its header button. Only columns of the
 * regular library are offered, since the snapshot holds nothing else. Backing out leaves the widget as it was, and a
 * widget being placed is not added.
 */
class BookmarksWidgetConfigActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }

    val columns = WidgetData.read(this)?.columns.orEmpty()
    if (columns.isEmpty()) {
      showNoColumns()
      return
    }

    val list = ListView(this)
    list.choiceMode = ListView.CHOICE_MODE_SINGLE
    list.adapter = ArrayAdapter(
      this,
      android.R.layout.simple_list_item_single_choice,
      columns.map { getString(R.string.bookmarks_widget_column_count, it.name, it.count) },
    )
    val current = columns.indexOfFirst { it.id == WidgetData.columnOf(this, widgetId) }
    if (current >= 0) {
      list.setItemChecked(current, true)
    }
    list.setOnItemClickListener { _, _, position, _ ->
      WidgetData.setColumn(this, widgetId, columns[position].id)
      BookmarksWidgetProvider.redraw(this, AppWidgetManager.getInstance(this), intArrayOf(widgetId))
      setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
      finish()
    }
    setContentView(list)
  }

  private fun showNoColumns() {
    val padding = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 24f, resources.displayMetrics).toInt()
    val layout = LinearLayout(this)
    layout.orientation = LinearLayout.VERTICAL
    layout.setPadding(padding, padding, padding, padding)
    val text = TextView(this)
    text.setText(R.string.bookmarks_widget_no_columns)
    text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    val open = Button(this)
    open.setText(R.string.bookmarks_widget_open_tablodge)
    open.setOnClickListener {
      packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
      finish()
    }
    layout.addView(text)
    layout.addView(open)
    setContentView(layout)
  }
}
