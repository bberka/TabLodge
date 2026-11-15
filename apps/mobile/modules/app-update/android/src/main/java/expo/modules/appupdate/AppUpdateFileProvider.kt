package expo.modules.appupdate

import androidx.core.content.FileProvider

// Its own class, so it cannot clash with the provider another library declares from the same base class.
class AppUpdateFileProvider : FileProvider()
