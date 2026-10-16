package expo.modules.awsemchatcrypto

import android.content.ComponentName
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSessionManager
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AwsemchatMediaSessionListenerService : NotificationListenerService()

class AwsemchatMediaSessionsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AwsemchatMediaSessions")

    AsyncFunction("hasNotificationAccess") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      val target = ComponentName(context, AwsemchatMediaSessionListenerService::class.java)
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return@AsyncFunction false
      enabled.split(':').any { ComponentName.unflattenFromString(it) == target }
    }

    AsyncFunction("openNotificationAccessSettings") {
      val context = appContext.reactContext ?: throw IllegalStateException("UNAVAILABLE")
      context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    AsyncFunction("getActiveTrack") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      val component = ComponentName(context, AwsemchatMediaSessionListenerService::class.java)
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        ?.split(':')?.any { ComponentName.unflattenFromString(it) == component } == true
      if (!enabled) return@AsyncFunction null
      try {
        val manager = context.getSystemService(MediaSessionManager::class.java) ?: return@AsyncFunction null
        val session = manager.getActiveSessions(component).firstOrNull { controller ->
          controller.playbackState?.state == android.media.session.PlaybackState.STATE_PLAYING
        } ?: return@AsyncFunction null
        val metadata: MediaMetadata = session.metadata ?: return@AsyncFunction null
        val title = metadata.getString(MediaMetadata.METADATA_KEY_TITLE)?.trim().orEmpty()
        val artist = metadata.getString(MediaMetadata.METADATA_KEY_ARTIST)?.trim().orEmpty()
        if (title.isEmpty() || artist.isEmpty() || title.length > 160 || artist.length > 120 ||
          title.any { it.isISOControl() } || artist.any { it.isISOControl() }) return@AsyncFunction null
        mapOf("title" to title, "artist" to artist)
      } catch (error: SecurityException) {
        Log.i("AwsemChatMedia", "Media session access is not currently enabled")
        null
      }
    }
  }
}
