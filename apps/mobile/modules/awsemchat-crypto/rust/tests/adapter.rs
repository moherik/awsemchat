use awsemchat_crypto::Engine;
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use serde_json::{json, Value};
fn run(e: &mut Engine, request: Value) -> Value {
    serde_json::from_str(&e.execute(&request.to_string())).unwrap()
}
fn ok(e: &mut Engine, request: Value) -> Value {
    let r = run(e, request);
    assert_eq!(r["ok"], true);
    r["value"].clone()
}
fn account(e: &mut Engine) -> Value {
    ok(e, json!({"op":"createAccount"}))
}
#[test]
fn exchange_rejection_and_lifecycle() {
    let mut e = Engine::default();
    let a = account(&mut e);
    let b = account(&mut e);
    let outsider = account(&mut e);
    let ab = ok(&mut e, json!({"op":"publicBundle","account":a}));
    let bb = ok(&mut e, json!({"op":"publicBundle","account":b}));
    let s = ok(
        &mut e,
        json!({"op":"outbound","account":a,"identity":bb["identity"],"prekey":bb["prekey"]}),
    );
    let first = ok(
        &mut e,
        json!({"op":"encrypt","session":s,"plaintext":"synthetic"}),
    );
    assert_eq!(
        run(
            &mut e,
            json!({"op":"inbound","account":outsider,"identity":ab["identity"],"message":first})
        )["code"],
        "CRYPTO_REJECTED"
    );
    assert_eq!(
        run(
            &mut e,
            json!({"op":"inbound","account":b,"identity":bb["identity"],"message":first})
        )["code"],
        "CRYPTO_REJECTED"
    );
    let inbound = ok(
        &mut e,
        json!({"op":"inbound","account":b,"identity":ab["identity"],"message":first}),
    );
    assert_eq!(inbound["plaintext"], "synthetic");
    let reply = ok(
        &mut e,
        json!({"op":"encrypt","session":inbound["session"],"plaintext":"reply"}),
    );
    assert_eq!(
        ok(&mut e, json!({"op":"decrypt","session":s,"message":reply})),
        "reply"
    );
    let message = ok(
        &mut e,
        json!({"op":"encrypt","session":s,"plaintext":"payload"}),
    );
    let mut damaged = message.clone();
    let mut bytes = STANDARD_NO_PAD
        .decode(message["body"].as_str().unwrap())
        .unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    damaged["body"] = json!(STANDARD_NO_PAD.encode(bytes));
    assert_eq!(
        run(
            &mut e,
            json!({"op":"decrypt","session":inbound["session"],"message":damaged})
        )["code"],
        "CRYPTO_REJECTED"
    );
    assert_eq!(
        ok(
            &mut e,
            json!({"op":"decrypt","session":inbound["session"],"message":message})
        ),
        "payload"
    );
    assert_eq!(
        run(
            &mut e,
            json!({"op":"decrypt","session":inbound["session"],"message":message})
        )["code"],
        "CRYPTO_REJECTED"
    );
    ok(&mut e, json!({"op":"disposeAccount","account":a}));
    assert_eq!(
        run(
            &mut e,
            json!({"op":"encrypt","session":s,"plaintext":"payload"})
        )["code"],
        "INVALID_HANDLE"
    );
    ok(
        &mut e,
        json!({"op":"disposeSession","session":inbound["session"]}),
    );
    assert_eq!(
        run(
            &mut e,
            json!({"op":"disposeSession","session":inbound["session"]})
        )["code"],
        "INVALID_HANDLE"
    );
}
#[test]
fn malformed_oversized_and_exhausted_inputs() {
    let mut e = Engine::default();
    for input in ["not JSON", "{\"op\":\"createAccount\",\"extra\":true}"] {
        assert!(e.execute(input).contains("INVALID_INPUT"));
    }
    assert!(e.execute(&"x".repeat(131073)).contains("INPUT_TOO_LARGE"));
    assert_eq!(
        run(&mut e, json!({"op":"publicBundle","account":"missing"}))["code"],
        "INVALID_HANDLE"
    );
    for _ in 0..128 {
        account(&mut e);
    }
    assert_eq!(
        run(&mut e, json!({"op":"createAccount"}))["code"],
        "CAPACITY"
    );
}

#[test]
fn handles_do_not_alias_between_engines() {
    let mut first = Engine::default();
    let mut second = Engine::default();
    let a = account(&mut first);
    let b = account(&mut second);
    assert_ne!(a, b);
    assert_eq!(
        run(&mut second, json!({"op":"publicBundle","account":a}))["code"],
        "INVALID_HANDLE"
    );
}

#[test]
fn invalid_crypto_input_and_plaintext_limit() {
    let mut e = Engine::default();
    let a = account(&mut e);
    let b = account(&mut e);
    let bundle = ok(&mut e, json!({"op":"publicBundle","account":b}));
    assert_eq!(
        run(
            &mut e,
            json!({"op":"outbound","account":a,"identity":"invalid","prekey":bundle["prekey"]})
        )["code"],
        "INVALID_INPUT"
    );
    let s = ok(
        &mut e,
        json!({"op":"outbound","account":a,"identity":bundle["identity"],"prekey":bundle["prekey"]}),
    );
    assert_eq!(
        run(
            &mut e,
            json!({"op":"encrypt","session":s,"plaintext":"x".repeat(32769)})
        )["code"],
        "INPUT_TOO_LARGE"
    );
    for message in [
        json!({"kind":9,"body":"AAAA"}),
        json!({"kind":0,"body":"!invalid!"}),
    ] {
        assert_eq!(
            run(
                &mut e,
                json!({"op":"decrypt","session":s,"message":message})
            )["code"],
            "INVALID_INPUT"
        );
    }
    let ciphertext = ok(
        &mut e,
        json!({"op":"encrypt","session":s,"plaintext":"synthetic after failed input"}),
    );
    let sender = ok(&mut e, json!({"op":"publicBundle","account":a}));
    let inbound = ok(
        &mut e,
        json!({"op":"inbound","account":b,"identity":sender["identity"],"message":ciphertext}),
    );
    assert_eq!(inbound["plaintext"], "synthetic after failed input");
    assert_eq!(
        run(&mut e, json!({"op":"publicBundle","account":b}))["code"],
        "PREKEY_EXHAUSTED"
    );
}
