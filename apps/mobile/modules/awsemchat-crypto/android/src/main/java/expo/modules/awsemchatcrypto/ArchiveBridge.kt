package expo.modules.awsemchatcrypto

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

internal object ArchiveBridge {
  private fun requireFields(value: JSONObject, fields: Set<String>) {
    require(value.keys().asSequence().toSet() == fields)
  }
  private fun string(value: JSONObject, field: String): String = (value.get(field) as? String) ?: error("Invalid input")
  private fun recoveryKey(value: String): ByteArray {
    require(value.matches(Regex("[a-f0-9]{64}")))
    return ByteArray(32) { value.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  }
  private fun decodeBase64(value: String): ByteArray {
    require(value.length <= 524288)
    val bytes = Base64.decode(value, Base64.NO_WRAP)
    require(Base64.encodeToString(bytes, Base64.NO_WRAP) == value)
    return bytes
  }
  private fun record(value: JSONObject): ArchiveCodec.Record {
    requireFields(value, setOf("eventId", "conversationId", "originalAudience", "membershipInterval", "receivedAt", "payload"))
    val audience = value.getJSONArray("originalAudience")
    require(audience.length() in 1..20)
    val timestamp = value.get("receivedAt")
    require(timestamp is Number && timestamp.toString().matches(Regex("[0-9]{1,16}")))
    return ArchiveCodec.Record(string(value, "eventId"), string(value, "conversationId"),
      (0 until audience.length()).map { (audience.get(it) as? String) ?: error("Invalid input") },
      string(value, "membershipInterval"), timestamp.toString().toLong(), string(value, "payload"))
  }
  private fun json(value: ArchiveCodec.Record): JSONObject = JSONObject()
    .put("eventId", value.eventId()).put("conversationId", value.conversationId())
    .put("originalAudience", JSONArray(value.originalAudience())).put("membershipInterval", value.membershipInterval())
    .put("receivedAt", value.receivedAt()).put("payload", value.payload())

  fun execute(input: String): String {
    if (input.length > 600000 || input.toByteArray(Charsets.UTF_8).size > 800000) return "{\"ok\":false,\"code\":\"INPUT_TOO_LARGE\"}"
    return try {
      val request = JSONObject(input)
      val result = when (string(request, "op")) {
        "encode" -> {
          requireFields(request, setOf("op", "account", "records"))
          val values = request.getJSONArray("records")
          require(values.length() <= 128)
          val records = (0 until values.length()).map { record(values.getJSONObject(it)) }
          val key = ArchiveCodec.recoveryKey()
          try {
            val archive = ArchiveCodec.encode(string(request, "account"), records, key)
            JSONObject().put("archive", Base64.encodeToString(archive, Base64.NO_WRAP))
              .put("recoveryKey", key.joinToString("") { "%02x".format(it.toInt() and 255) })
          } finally { key.fill(0) }
        }
        "decode" -> {
          requireFields(request, setOf("op", "account", "archive", "recoveryKey"))
          val key = recoveryKey(string(request, "recoveryKey"))
          try {
            val records = ArchiveCodec.decode(string(request, "account"), decodeBase64(string(request, "archive")), key)
            JSONObject().put("records", JSONArray(records.map(::json)))
          } finally { key.fill(0) }
        }
        else -> error("Invalid input")
      }
      JSONObject().put("ok", true).put("value", result).toString()
    } catch (_: Exception) { "{\"ok\":false,\"code\":\"ARCHIVE_REJECTED\"}" }
  }
}
