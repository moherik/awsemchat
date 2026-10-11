package expo.modules.awsemchatcrypto;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.*;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** The bounded records-only wire format is specified in validation/backup/archive-v1.md. */
public final class ArchiveCodec {
  public static final int MAX_ARCHIVE = 384 * 1024;
  private static final int MAX_RECORDS = 128, MAX_PLAIN = 256 * 1024, MAX_FRAME = 36 * 1024;
  private static final byte[] MAGIC = "AWSEMBK1".getBytes(StandardCharsets.US_ASCII);
  private static final SecureRandom RANDOM = new SecureRandom();
  public static final class InvalidArchive extends Exception {
    public InvalidArchive() { super("ARCHIVE_REJECTED"); }
  }
  public record Record(String eventId, String conversationId, List<String> originalAudience,
      String membershipInterval, long receivedAt, String payload) {}
  private ArchiveCodec() {}
  public static byte[] recoveryKey() { byte[] key = new byte[32]; RANDOM.nextBytes(key); return key; }
  private static void require(boolean condition) throws InvalidArchive { if (!condition) throw new InvalidArchive(); }
  private static byte[] hash(byte[] data) throws GeneralSecurityException { return MessageDigest.getInstance("SHA-256").digest(data); }
  private static DataInputStream input(byte[] bytes) { return new DataInputStream(new ByteArrayInputStream(bytes)); }
  private static byte[] read(DataInputStream input, int length) throws IOException {
    byte[] bytes = new byte[length]; input.readFully(bytes); return bytes;
  }
  private static void string(DataOutputStream out, String value, int max, boolean empty) throws Exception {
    require(value != null);
    ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
      .encode(java.nio.CharBuffer.wrap(value));
    byte[] bytes = new byte[encoded.remaining()]; encoded.get(bytes);
    require(bytes.length <= max && (empty || bytes.length > 0)); out.writeInt(bytes.length); out.write(bytes);
  }
  private static String string(DataInputStream in, int max, boolean empty) throws Exception {
    int length = in.readInt(); require(length >= (empty ? 0 : 1) && length <= max && length <= in.available());
    return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(read(in, length))).toString();
  }
  private static byte[] record(Record record) throws Exception {
    var bytes = new ByteArrayOutputStream(); var out = new DataOutputStream(bytes);
    string(out, record.eventId(), 128, false); string(out, record.conversationId(), 128, false);
    require(record.originalAudience() != null && record.originalAudience().size() >= 1 && record.originalAudience().size() <= 20);
    require(new HashSet<>(record.originalAudience()).size() == record.originalAudience().size());
    out.writeInt(record.originalAudience().size());
    for (String id : record.originalAudience()) string(out, id, 128, false);
    string(out, record.membershipInterval(), 128, false);
    require(record.receivedAt() >= 0 && record.receivedAt() <= 9007199254740991L);
    out.writeLong(record.receivedAt()); string(out, record.payload(), 32768, true); return bytes.toByteArray();
  }
  private static Record record(byte[] bytes) throws Exception {
    var in = input(bytes); String id = string(in, 128, false), conversation = string(in, 128, false);
    int count = in.readInt(); require(count >= 1 && count <= 20); List<String> audience = new ArrayList<>();
    for (int i = 0; i < count; i++) audience.add(string(in, 128, false));
    var result = new Record(id, conversation, audience, string(in, 128, false), in.readLong(), string(in, 32768, true));
    require(in.available() == 0); record(result); return result;
  }
  private static byte[] aad(byte[] header, byte[] manifestHash, int type, int index, int length) throws IOException {
    var bytes = new ByteArrayOutputStream(); var out = new DataOutputStream(bytes);
    out.write(header); out.write(manifestHash); out.writeInt(type); out.writeInt(index); out.writeInt(length); return bytes.toByteArray();
  }
  private static byte[] seal(byte[] plain, byte[] key, byte[] header, byte[] mh, int type, int index, Set<String> nonces) throws Exception {
    byte[] nonce = new byte[12]; RANDOM.nextBytes(nonce);
    require(nonces.add(Arrays.toString(nonce)));
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
    cipher.updateAAD(aad(header, mh, type, index, plain.length));
    var bytes = new ByteArrayOutputStream(); var out = new DataOutputStream(bytes);
    out.writeInt(plain.length); out.write(nonce); out.write(cipher.doFinal(plain)); return bytes.toByteArray();
  }
  private static byte[] frame(DataInputStream in) throws Exception {
    int length = in.readInt(); require(length >= 0 && length <= MAX_FRAME && length + 28 <= in.available());
    var bytes = new ByteArrayOutputStream(); var out = new DataOutputStream(bytes);
    out.writeInt(length); out.write(read(in, length + 28)); return bytes.toByteArray();
  }
  private static byte[] unseal(byte[] frame, byte[] key, byte[] header, byte[] mh, int type, int index, Set<String> nonces) throws Exception {
    int length = ByteBuffer.wrap(frame).getInt(); byte[] nonce = Arrays.copyOfRange(frame, 4, 16);
    require(nonces.add(Arrays.toString(nonce)));
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
    cipher.updateAAD(aad(header, mh, type, index, length)); return cipher.doFinal(frame, 16, frame.length - 16);
  }
  public static byte[] encode(String account, List<Record> records, byte[] key) throws InvalidArchive {
    try {
      require(key.length == 32 && records.size() <= MAX_RECORDS);
      var all = new ByteArrayOutputStream(); List<byte[]> chunks = new ArrayList<>(); Set<String> ids = new HashSet<>();
      for (Record value : records) {
        require(ids.add(value.eventId())); byte[] chunk = record(value);
        require(all.size() + chunk.length <= MAX_PLAIN); all.write(chunk); chunks.add(chunk);
      }
      byte[] digest = hash(all.toByteArray()), archiveId = new byte[16]; RANDOM.nextBytes(archiveId);
      var bytes = new ByteArrayOutputStream(); var out = new DataOutputStream(bytes);
      out.write(MAGIC); out.writeInt(1); out.writeInt(1); out.write(archiveId); out.writeInt(records.size());
      byte[] header = bytes.toByteArray(); var manifest = new ByteArrayOutputStream(); var mo = new DataOutputStream(manifest);
      string(mo, account, 128, false); mo.writeInt(1); mo.writeInt(all.size()); mo.write(digest);
      Set<String> nonces = new HashSet<>(); byte[] mf = seal(manifest.toByteArray(), key, header, new byte[32], 0, 0, nonces);
      out.write(mf); byte[] mh = hash(mf); int index = 1;
      for (byte[] chunk : chunks) out.write(seal(chunk, key, header, mh, 1, index++, nonces));
      var end = new ByteArrayOutputStream(); var eo = new DataOutputStream(end); eo.writeInt(all.size()); eo.write(digest);
      out.write(seal(end.toByteArray(), key, header, mh, 2, index, nonces));
      require(bytes.size() <= MAX_ARCHIVE); return bytes.toByteArray();
    } catch (Exception error) { throw new InvalidArchive(); }
  }
  public static List<Record> decode(String account, byte[] archive, byte[] key) throws InvalidArchive {
    try {
      require(key.length == 32 && archive.length <= MAX_ARCHIVE && archive.length >= 36);
      var in = input(archive); require(Arrays.equals(read(in, 8), MAGIC)); require(in.readInt() == 1 && in.readInt() == 1);
      read(in, 16); int count = in.readInt(); require(count >= 0 && count <= MAX_RECORDS);
      byte[] header = Arrays.copyOf(archive, 36); Set<String> nonces = new HashSet<>(); byte[] mf = frame(in);
      var manifest = input(unseal(mf, key, header, new byte[32], 0, 0, nonces));
      require(string(manifest, 128, false).equals(account) && manifest.readInt() == 1);
      int total = manifest.readInt(); require(total >= 0 && total <= MAX_PLAIN);
      byte[] digest = read(manifest, 32); require(manifest.available() == 0);
      byte[] mh = hash(mf); var all = new ByteArrayOutputStream(); List<Record> records = new ArrayList<>(); Set<String> ids = new HashSet<>();
      for (int i = 1; i <= count; i++) {
        byte[] chunk = unseal(frame(in), key, header, mh, 1, i, nonces);
        require(all.size() + chunk.length <= total); Record record = record(chunk); require(ids.add(record.eventId()));
        all.write(chunk); records.add(record);
      }
      var end = input(unseal(frame(in), key, header, mh, 2, count + 1, nonces));
      require(end.readInt() == total && Arrays.equals(read(end, 32), digest) && end.available() == 0);
      require(all.size() == total && MessageDigest.isEqual(hash(all.toByteArray()), digest) && in.available() == 0);
      return records;
    } catch (Exception error) { throw new InvalidArchive(); }
  }
}
