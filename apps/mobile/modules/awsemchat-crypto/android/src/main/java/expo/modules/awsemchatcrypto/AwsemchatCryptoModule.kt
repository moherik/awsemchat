package expo.modules.awsemchatcrypto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AwsemchatCryptoModule : Module() {
  private var context: Long = 0
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
      }
    }
    AsyncFunction("execute") { input: String ->
      synchronized(lock) {
        if (input.length > 131072) "{\"ok\":false,\"code\":\"INPUT_TOO_LARGE\"}"
        else executeNative(context, input)
      }
    }
    OnDestroy {
      synchronized(lock) {
        destroyNative(context)
        context = 0
      }
    }
  }
}
