package expo.modules.awsemchatcrypto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AwsemchatCryptoModule : Module() {
  private var context: Long = 0
  private var durable: DurableStore? = null
  private external fun prepareDurableNative(snapshot: String?, input: String): String
  private val lock = Any()
  private external fun createNative(): Long
  private external fun executeNative(context: Long, input: String): String
  private external fun destroyNative(context: Long)

  override fun definition() = ModuleDefinition {
    Name("AwsemchatCrypto")
    OnCreate {
      synchronized(lock) {
        System.loadLibrary("awsemchat_crypto")
        context = createNative()
        appContext.reactContext?.let { durable = DurableStore(it, ::prepareDurableNative) }
      }
    }
    AsyncFunction("execute") { input: String ->
      synchronized(lock) {
        if (input.length > 131072) "{\"ok\":false,\"code\":\"INPUT_TOO_LARGE\"}"
        else executeNative(context, input)
      }
    }
    AsyncFunction("executeDurable") { namespace: String, input: String ->
      synchronized(lock) { durable?.execute(namespace, input) ?: "{\"ok\":false,\"code\":\"UNAVAILABLE\"}" }
    }
    AsyncFunction("durableProbe") { namespace: String, action: String, input: String ->
      synchronized(lock) { durable?.probe(namespace, action, input) ?: "{\"ok\":false,\"code\":\"UNAVAILABLE\"}" }
    }
    OnDestroy {
      synchronized(lock) {
        destroyNative(context)
        context = 0
        durable = null
      }
    }
  }
}
