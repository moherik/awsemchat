# Native public-key fixture

`native-publication.json` contains only the20 public signed prekeys produced by the pinned vodozemac0.11.1 durable Rust adapter on2026-10-12. No account snapshot, private signing key, ratchet or session token is retained. Go tests validate at each bundle’s recorded issuedAt, so the immutable fixture does not become a failing test after its seven-day lifetime. Runtime validation still uses the server clock.

The fixture was generated with Rust1.90.0 using the repository native Cargo.lock and the existing offline cache. The generator depended on the repository’s awsemchat-crypto Rust library and ran:

```rust
use awsemchat_crypto::durable::prepare;
fn main() {
    let (snapshot, _) = prepare(None, r#"{"op":"initialize"}"#).unwrap();
    let (_, public_output) = prepare(Some(&snapshot), r#"{"op":"preparePublication","operation":"server-interop-fixture"}"#).unwrap();
    println!("{}", public_output);
}
```

The temporary generator lived in /private/tmp/awsem-publication-fixture. Its stdout was the public fixture; the snapshot was held in process memory and never written. The first default-toolchain offline attempt could not resolve a cached dependency; rerunning with the documented pinned toolchain and /private/tmp/awsemchat-native-crypto-target succeeded. Native publication signatures are verified by Go without regenerating or trusting a Go signer. The independent Go-signed tests separately exercise every signed field, format and expiry boundary.
