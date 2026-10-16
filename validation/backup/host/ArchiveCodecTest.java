package expo.modules.awsemchatcrypto;

import java.util.*;

/** Shared JCA codec behavior, also exercised through the real Android module. */
public final class ArchiveCodecTest {
  static void check(boolean value) { if (!value) throw new AssertionError(); }
  interface Attempt { void run() throws Exception; }
  static void rejects(Attempt action) throws Exception {
    try { action.run(); } catch (ArchiveCodec.InvalidArchive expected) { return; }
    throw new AssertionError("Expected archive rejection");
  }
  static List<byte[]> frames(byte[] archive) {
    List<byte[]> result = new ArrayList<>();
    int offset = 36;
    while (offset < archive.length) {
      int size = java.nio.ByteBuffer.wrap(archive, offset, 4).getInt() + 32;
      result.add(Arrays.copyOfRange(archive, offset, offset + size)); offset += size;
    }
    return result;
  }
  static byte[] join(byte[] archive, List<byte[]> frames) throws Exception {
    var output = new java.io.ByteArrayOutputStream(); output.write(archive, 0, 36);
    for (byte[] frame : frames) output.write(frame);
    return output.toByteArray();
  }
  public static void main(String[] args) throws Exception {
    byte[] key = ArchiveCodec.recoveryKey();
    List<ArchiveCodec.Record> records = List.of(
      new ArchiveCodec.Record("one", "chat", List.of("alice", "bob"), "before-removal", 12, "hello"),
      new ArchiveCodec.Record("two", "chat", List.of("alice"), "after-removal", 14, "world"));
    List<ArchiveCodec.Record> fullHistory = new ArrayList<>();
    for (int i = 0; i < 768; i++) fullHistory.add(new ArchiveCodec.Record("message-" + i, "self-history", List.of("account"), "history-only", 0, "synthetic ".repeat(100)));
    byte[] fullArchive = ArchiveCodec.encode("account", fullHistory, key);
    check(ArchiveCodec.decode("account", fullArchive, key).equals(fullHistory));
    List<ArchiveCodec.Record> stickerArchiveRecords = new ArrayList<>();
    for (int i = 0; i < 763; i++) stickerArchiveRecords.add(new ArchiveCodec.Record("entry-" + i, "self-history", List.of("account"), "history-only", 0, "synthetic ".repeat(100)));
    String stickerImage = "data:image/png;base64," + "A".repeat(700_000);
    int stickerParts = (stickerImage.length() + 160 * 1024 - 1) / (160 * 1024);
    for (int part = 0; part < stickerParts; part++) {
      String data = stickerImage.substring(part * 160 * 1024, Math.min(stickerImage.length(), (part + 1) * 160 * 1024));
      String payload = "{\"kind\":\"personal-sticker.v1\",\"stickerIndex\":0,\"part\":" + part + ",\"parts\":" + stickerParts + ",\"data\":\"" + data + "\"" +
        (part == 0 ? ",\"sticker\":{\"id\":\"local-large\",\"artwork\":{\"image\":\"\",\"title\":\"Large\",\"text\":\"\",\"textColor\":\"#FFFFFF\",\"textSize\":26,\"textY\":72,\"background\":null,\"pack\":\"Saved\"}}" : "") + "}";
      check(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 256 * 1024);
      stickerArchiveRecords.add(new ArchiveCodec.Record("sticker-0-" + part, "awsemchat.personal-stickers.v1", List.of("account"), "personal-library", 0, payload));
    }
    check(stickerArchiveRecords.size() == 768);
    byte[] stickerArchive = ArchiveCodec.encode("account", stickerArchiveRecords, key);
    check(ArchiveCodec.decode("account", stickerArchive, key).equals(stickerArchiveRecords));
    List<ArchiveCodec.Record> escaped = List.of(new ArchiveCodec.Record("escaped", "self-history", List.of("account"), "history-only", 0, "\\u0000".repeat(32768)));
    check(ArchiveCodec.decode("account", ArchiveCodec.encode("account", escaped, key), key).equals(escaped));
    byte[] archive = ArchiveCodec.encode("account", records, key);
    check(ArchiveCodec.decode("account", archive, key).equals(records));
    rejects(() -> ArchiveCodec.decode("other", archive, key));
    rejects(() -> ArchiveCodec.decode("account", archive, ArchiveCodec.recoveryKey()));
    for (int i = 0; i < archive.length; i++) {
      byte[] changed = archive.clone(); changed[i] ^= 1;
      rejects(() -> ArchiveCodec.decode("account", changed, key));
      final int length = i;
      rejects(() -> ArchiveCodec.decode("account", Arrays.copyOf(archive, length), key));
    }
    rejects(() -> ArchiveCodec.decode("account", Arrays.copyOf(archive, archive.length + 1), key));
    rejects(() -> ArchiveCodec.encode("account", List.of(records.get(0), records.get(0)), key));
    rejects(() -> ArchiveCodec.encode("account", Collections.nCopies(129, records.get(0)), key));
    rejects(() -> ArchiveCodec.encode("account", List.of(new ArchiveCodec.Record("x", "chat", List.of("a", "a"), "i", 0, "p")), key));
    rejects(() -> ArchiveCodec.encode("account", List.of(new ArchiveCodec.Record("x", "chat", List.of("a"), "i", -1, "p")), key));
    rejects(() -> ArchiveCodec.encode("account", List.of(new ArchiveCodec.Record("x", "chat", List.of("a"), "i", 0, "p".repeat(262145))), key));
    List<ArchiveCodec.Record> capacity = new ArrayList<>();
    for (int i = 0; i < 65; i++) capacity.add(new ArchiveCodec.Record("id" + i, "chat", List.of("a"), "i", i, "p".repeat(262144)));
    rejects(() -> ArchiveCodec.encode("account", capacity, key));
    // Frames carry their original ciphertext/nonce when moved: position authentication must fail.
    List<byte[]> frames = frames(archive);
    Collections.swap(frames, 1, 2);
    rejects(() -> ArchiveCodec.decode("account", join(archive, frames), key));
    frames.set(2, frames.get(1));
    rejects(() -> ArchiveCodec.decode("account", join(archive, frames), key));
    check(ArchiveCodec.decode("account", ArchiveCodec.encode("account", List.of(), key), key).isEmpty());
    List<ArchiveCodec.Record> unicode = List.of(new ArchiveCodec.Record("photo", "circle", List.of("alice"), "joined", 9007199254740991L, "Café 🌻"));
    check(ArchiveCodec.decode("account", ArchiveCodec.encode("account", unicode, key), key).equals(unicode));
    rejects(() -> ArchiveCodec.encode("account", List.of(new ArchiveCodec.Record("bad", "circle", List.of("alice"), "joined", 0, "\uD800")), key));
    System.out.println("PASS: JCA roundtrip, all-byte tamper/truncation, wrong key/account, trailing, capacity, schema, reorder/duplicate, empty archive");
  }
}
