use awsemchat_crypto::durable::prepare;
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use serde_json::{json, Value};
use vodozemac::{Ed25519PublicKey, Ed25519Signature};
fn initialized() -> String {
    prepare(None, r#"{"op":"initialize"}"#).unwrap().0
}
fn call(state: &str, request: Value) -> (String, Value) {
    let (next, output) = prepare(Some(state), &request.to_string()).unwrap();
    (next, serde_json::from_str(&output).unwrap())
}
fn proof_bytes(bundles: &Value, account: &str, device: &str, generation: u64) -> Vec<u8> {
    let mut wire = b"awsemchat.olm.account-publication\0".to_vec();
    wire.extend(1u32.to_be_bytes());
    for value in [account, device] {
        wire.extend((value.len() as u16).to_be_bytes());
        wire.extend(value.as_bytes());
    }
    wire.extend(generation.to_be_bytes());
    let bundles = bundles.as_array().unwrap();
    wire.extend((bundles.len() as u16).to_be_bytes());
    for bundle in bundles {
        let mut bytes = b"awsemchat.olm.signed-prekey\0".to_vec();
        bytes.extend(1u32.to_be_bytes());
        for field in ["identity", "signingIdentity", "keyId", "prekey"] {
            bytes.extend(
                STANDARD_NO_PAD
                    .decode(bundle[field].as_str().unwrap())
                    .unwrap(),
            );
        }
        bytes.extend(bundle["issuedAt"].as_u64().unwrap().to_be_bytes());
        bytes.extend(bundle["expiresAt"].as_u64().unwrap().to_be_bytes());
        let operation = bundle["publication"].as_str().unwrap();
        bytes.extend((operation.len() as u16).to_be_bytes());
        bytes.extend(operation.as_bytes());
        wire.extend((bytes.len() as u32).to_be_bytes());
        wire.extend(bytes);
        wire.extend(
            STANDARD_NO_PAD
                .decode(bundle["signature"].as_str().unwrap())
                .unwrap(),
        );
    }
    wire
}
#[test]
fn native_proof_binds_account_device_generation_and_exact_saved_publication() {
    let (state, batch) = call(
        &initialized(),
        json!({"op":"preparePublication","operation":"publication-one"}),
    );
    let request = json!({"op":"signPublication","operation":"publication-one","accountId":"alice","deviceId":"phone-alice","generation":1});
    let (next, result) = call(&state, request.clone());
    assert_eq!(next, state);
    assert_eq!(result["bundles"], batch["bundles"]);
    let (_, retry) = call(&next, request);
    assert_eq!(retry, result);
    let key =
        Ed25519PublicKey::from_base64(result["bundles"][0]["signingIdentity"].as_str().unwrap())
            .unwrap();
    let signature = Ed25519Signature::from_base64(result["proof"].as_str().unwrap()).unwrap();
    key.verify(
        &proof_bytes(&result["bundles"], "alice", "phone-alice", 1),
        &signature,
    )
    .unwrap();
    for (account, device, generation) in [
        ("bob", "phone-alice", 1),
        ("alice", "other-phone", 1),
        ("alice", "phone-alice", 2),
    ] {
        assert!(key
            .verify(
                &proof_bytes(&result["bundles"], account, device, generation),
                &signature
            )
            .is_err());
    }
    let mut tampered = result["bundles"].clone();
    tampered[0]["publication"] = json!("another");
    assert!(key
        .verify(
            &proof_bytes(&tampered, "alice", "phone-alice", 1),
            &signature
        )
        .is_err());
}
#[test]
fn native_proof_rejects_unknown_batches_and_invalid_account_bindings() {
    let (state, _) = call(
        &initialized(),
        json!({"op":"preparePublication","operation":"publication-one"}),
    );
    for (operation, account, device, generation, expected) in [
        ("unknown", "alice", "phone-alice", 1, "UNKNOWN_OPERATION"),
        (
            "publication-one",
            "bad account",
            "phone-alice",
            1,
            "INVALID_INPUT",
        ),
        ("publication-one", "alice", "", 1, "INVALID_INPUT"),
        (
            "publication-one",
            "alice",
            "phone-alice",
            0,
            "INVALID_INPUT",
        ),
        (
            "publication-one",
            "alice",
            "phone-alice",
            9007199254740992u64,
            "INVALID_INPUT",
        ),
    ] {
        let request = json!({"op":"signPublication","operation":operation,"accountId":account,"deviceId":device,"generation":generation});
        assert_eq!(
            prepare(Some(&state), &request.to_string()).err(),
            Some(expected)
        );
    }
}
