package expo.modules.awsemchatcrypto

import android.app.Activity
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicReference

class GoogleDriveAuthorizationModule : Module() {
  private val pending = AtomicReference<Promise?>(null)
  private val requestCode = 47261
  private fun fail() { pending.getAndSet(null)?.reject("UNAVAILABLE", "Google authorization unavailable", null) }
  private fun complete(result: AuthorizationResult) {
    val token = result.accessToken
    if (token.isNullOrBlank()) { fail(); return }
    pending.getAndSet(null)?.resolve(mapOf("cancelled" to false, "accessToken" to token, "grantedScopes" to result.grantedScopes))
  }
  override fun definition() = ModuleDefinition {
    Name("AwsemchatGoogleDrive")
    AsyncFunction("authorize") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) { promise.reject("UNAVAILABLE", "Activity unavailable", null); return@AsyncFunction }
      if (!pending.compareAndSet(null, promise)) { promise.reject("BUSY", "Authorization active", null); return@AsyncFunction }
      activity.runOnUiThread {
        try {
          val request = AuthorizationRequest.builder().setRequestedScopes(listOf(
            Scope("https://www.googleapis.com/auth/drive.appdata"), Scope("openid")
          )).build()
          Identity.getAuthorizationClient(activity).authorize(request)
            .addOnSuccessListener { result ->
              if (pending.get() !== promise) return@addOnSuccessListener
              try {
                if (result.hasResolution()) {
                  val intent = result.pendingIntent ?: throw IllegalStateException()
                  activity.startIntentSenderForResult(intent.intentSender, requestCode, null, 0, 0, 0)
                } else complete(result)
              } catch (_: Exception) { fail() }
            }
            .addOnFailureListener { if (pending.get() === promise) fail() }
        } catch (_: Exception) { fail() }
      }
    }
    OnActivityResult { activity, result ->
      if (result.requestCode == requestCode && pending.get() != null) {
        if (result.resultCode == Activity.RESULT_CANCELED) pending.getAndSet(null)?.resolve(mapOf("cancelled" to true))
        else try { complete(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.data)) }
        catch (_: Exception) { fail() }
      }
    }
    OnDestroy { fail() }
  }
}
