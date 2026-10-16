package expo.modules.awsemchatcrypto

import android.content.Context
import android.content.pm.ApplicationInfo
import android.database.sqlite.SQLiteDatabase
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** This database contains sealed snapshots only; it never opens the Expo SQLCipher history DB. */
internal class DurableStore(private val context: Context, private val prepare: (String?, String) -> String) {
  companion object {
    private val lock = Any()
    private val faults = mutableMapOf<String, String>()
    private const val MAX_STATE = 8 * 1024 * 1024
    private const val MAX_SEAL = MAX_STATE + 29
  }
  private class Rejected(val code: String) : Exception()
  private fun reject(code: String): Nothing = throw Rejected(code)
  private fun error(code: String) = JSONObject().put("ok", false).put("code", code).toString()
  private fun success(value: Any = JSONObject.NULL) = JSONObject().put("ok", true).put("value", value).toString()
  private fun digest(input: String) = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
  private fun identity(namespace: String): String {
    if (!namespace.matches(Regex("[a-z0-9-]{1,40}"))) reject("INVALID_INPUT")
    return digest(namespace).joinToString("") { "%02x".format(it) }
  }
  private fun root(): File = File(context.noBackupFilesDir, "durable-crypto-v1").also {
    if (!it.isDirectory && !it.mkdirs()) reject("STATE_UNAVAILABLE")
  }
  private fun file(id: String) = File(root(), "$id.db")
  private fun alias(id: String) = "awsemchat.durable.v1.$id"
  private fun keystore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun key(id: String): SecretKey = keystore().getKey(alias(id), null) as? SecretKey ?: reject("STATE_UNAVAILABLE")
  private fun createKey(id: String): SecretKey {
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder(alias(id), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build())
    return generator.generateKey()
  }
  private fun seal(id: String, key: SecretKey, state: String): ByteArray {
    val plain = state.toByteArray(Charsets.UTF_8)
    try {
      if (plain.size > MAX_STATE) reject("CAPACITY")
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key)
      cipher.updateAAD("awsemchat.durable.v1:$id".toByteArray(Charsets.UTF_8))
      if (cipher.iv.size != 12) reject("STATE_UNAVAILABLE")
      return byteArrayOf(1) + cipher.iv + cipher.doFinal(plain)
    } finally { plain.fill(0) }
  }
  private fun unseal(id: String, key: SecretKey, sealed: ByteArray): String {
    if (sealed.size < 29 || sealed.size > MAX_SEAL) reject("STATE_UNAVAILABLE")
    if (sealed[0].toInt() != 1) reject("STATE_VERSION")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed, 1, 12))
    cipher.updateAAD("awsemchat.durable.v1:$id".toByteArray(Charsets.UTF_8))
    val plain = cipher.doFinal(sealed, 13, sealed.size - 13)
    try { return plain.toString(Charsets.UTF_8) } finally { plain.fill(0) }
  }
  private fun open(id: String): SQLiteDatabase {
    val path = file(id)
    if (path.length() > 32L * 1024 * 1024) reject("STATE_UNAVAILABLE")
    return SQLiteDatabase.openDatabase(path.path, null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY,
      { _ -> reject("STATE_UNAVAILABLE") }).also { db ->
      try {
        db.rawQuery("PRAGMA journal_mode = DELETE", null).use {
          if (!it.moveToFirst() || it.getString(0).lowercase() != "delete") reject("STATE_UNAVAILABLE")
        }
        db.execSQL("PRAGMA synchronous = FULL")
        db.execSQL("PRAGMA temp_store = MEMORY")
      } catch (e: Exception) { db.close(); throw e }
    }
  }
  private fun read(db: SQLiteDatabase): ByteArray {
    val size = db.rawQuery("SELECT length(payload) FROM sealed WHERE slot = 1", null).use {
      if (!it.moveToFirst() || it.isNull(0)) reject("STATE_UNAVAILABLE")
      it.getLong(0)
    }
    if (size < 29 || size > MAX_SEAL) reject("STATE_UNAVAILABLE")
    // Keep every cursor below Android's CursorWindow limit, including on API24.
    val output = ByteArrayOutputStream(size.toInt())
    var offset = 1
    while (offset <= size) {
      db.rawQuery("SELECT substr(payload, ?, 65536) FROM sealed WHERE slot = 1", arrayOf(offset.toString())).use {
        if (!it.moveToFirst()) reject("STATE_UNAVAILABLE")
        val chunk = it.getBlob(0)
        if (chunk.isEmpty()) reject("STATE_UNAVAILABLE")
        output.write(chunk); offset += chunk.size
      }
    }
    return output.toByteArray()
  }
  fun execute(namespace: String, input: String): String = synchronized(lock) {
    try {
      val inputBytes = input.toByteArray(Charsets.UTF_8).size
      if (inputBytes > 8 * 1024 * 1024) reject("INPUT_TOO_LARGE")
      val operation = JSONObject(input).optString("op")
      if (inputBytes > 131072 && operation != "importHistory") reject("INPUT_TOO_LARGE")
      val id = identity(namespace)
      val initialize = operation == "initialize"
      val exists = file(id).exists()
      val hasKey = keystore().containsAlias(alias(id))
      if (initialize && (exists || hasKey)) reject("ALREADY_EXISTS")
      if (!initialize && (!exists || !hasKey)) reject("STATE_UNAVAILABLE")
      if (initialize && (root().listFiles()?.count { it.name.endsWith(".db") } ?: 0) >= 8) reject("CAPACITY")

      val key = if (initialize) createKey(id) else key(id)
      val fault = faults.remove(id)

      open(id).use { db ->

        if (initialize) db.execSQL("CREATE TABLE sealed (slot INTEGER PRIMARY KEY CHECK(slot = 1), payload BLOB NOT NULL)")
        db.beginTransaction()
        val output: String
        try {

          val snapshot = if (initialize) null else unseal(id, key, read(db))

          val candidate = JSONObject(prepare(snapshot, input))
          if (!candidate.getBoolean("ok")) reject(candidate.getString("code"))

          val sealed = seal(id, key, candidate.getString("state"))
          output = candidate.getString("output")

          db.execSQL("INSERT OR REPLACE INTO sealed(slot,payload) VALUES(1,?)", arrayOf(sealed))
          if (fault == "rollback") reject("COMMIT_FAILED")
          if (fault == "killBeforeCommit") android.os.Process.killProcess(android.os.Process.myPid())
          db.setTransactionSuccessful()
        } finally {
          try { db.endTransaction() } catch (_: Exception) { reject("COMMIT_UNKNOWN") }
        }
        if (fault == "killAfterCommit") android.os.Process.killProcess(android.os.Process.myPid())
        if (fault == "afterCommit") reject("COMMIT_UNKNOWN")
        // The private candidate is never returned. Only its public result crosses Expo after commit.
        "{\"ok\":true,\"value\":$output}"
      }
    } catch (e: Rejected) { error(e.code) }
      catch (_: Exception) { error("STATE_UNAVAILABLE") }
  }
  fun probe(namespace: String, action: String, input: String): String = synchronized(lock) {
    try {
      if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0 || !namespace.startsWith("probe-")) reject("UNAVAILABLE")
      val id = identity(namespace)
      if (input.toByteArray(Charsets.UTF_8).size > 2 * 1024 * 1024) reject("INPUT_TOO_LARGE")
      when (action) {
        "reset" -> {
          SQLiteDatabase.deleteDatabase(file(id)); keystore().deleteEntry(alias(id)); faults.remove(id)
          File(root(), "$id.checkpoint").delete()
        }
        "rollback", "afterCommit", "killBeforeCommit", "killAfterCommit" -> {
          if (faults.size >= 8) reject("CAPACITY")
          faults[id] = action
        }
        "deleteKey" -> keystore().deleteEntry(alias(id))
        "wrongKey" -> { keystore().deleteEntry(alias(id)); createKey(id) }
        "deleteRow" -> open(id).use { it.execSQL("DELETE FROM sealed") }
        "corrupt", "wrongVersion" -> open(id).use { db ->
          val bytes = read(db)
          if (action == "corrupt") bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
          else bytes[0] = 99
          db.execSQL("UPDATE sealed SET payload = ? WHERE slot = 1", arrayOf(bytes))
        }
        "checkpoint" -> File(root(), "$id.checkpoint").outputStream().use { stream -> stream.write(digest(input)); stream.fd.sync() }
        "compareCheckpoint" -> return@synchronized success(MessageDigest.isEqual(File(root(), "$id.checkpoint").readBytes(), digest(input)))
        else -> reject("INVALID_INPUT")
      }
      success()
    } catch (e: Rejected) { error(e.code) } catch (_: Exception) { error("STATE_UNAVAILABLE") }
  }
}
