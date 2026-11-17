package expo.modules.quicktiles

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * A Quick Settings tile that opens the app at `tablodge://<route>` and closes the panel. It has no on or off state.
 * The JavaScript side reads the address and opens the screen.
 */
abstract class LaunchTileService(private val route: String) : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    val tile = qsTile ?: return
    tile.state = Tile.STATE_INACTIVE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.subtitle = applicationInfo.loadLabel(packageManager)
    }
    tile.updateTile()
  }

  // On a locked phone, startActivityAndCollapse asks for the unlock first and then opens the app. unlockAndRun would
  // too, but once the phone unlocks the panel opens again over the app, which then never gets focus.
  override fun onClick() {
    super.onClick()
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("tablodge://$route"))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Android 14 takes only a PendingIntent here. Each route needs its own request code, or the two would share one.
      val pending = PendingIntent.getActivity(
        this,
        route.hashCode(),
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}

class SaveLinkTileService : LaunchTileService("save")

class SearchTileService : LaunchTileService("search")
