use awsemchat_crypto::durable::prepare;
use serde_json::{json, Value};

#[derive(Default)]
struct Store(Option<String>);
impl Store {
    fn call(&mut self, request: Value) -> Value {
        let (next, output) = prepare(self.0.as_deref(), &request.to_string()).unwrap();
        self.0 = Some(next);
        serde_json::from_str(&output).unwrap()
    }
    fn rejects(&self, request: Value, code: &str) {
        assert_eq!(
            prepare(self.0.as_deref(), &request.to_string()).err(),
            Some(code)
        );
    }
}
fn init() -> (Store, Value) {
    let mut s = Store::default();
    let b = s.call(json!({"op":"initialize"}));
    (s, b)
}
fn pin(s: &mut Store, peer: &str, b: &Value) {
    s.call(json!({"op":"observePeer","peer":peer,"keys":{"identity":b["identity"],"signingIdentity":b["signingIdentity"]}}));
}
fn send() -> Value {
    json!({"op":"send","operation":"one","conversation":"private-room","audience":"room-revision-1","recipients":["bob"],"plaintext":"synthetic"})
}
fn receive(w: &Value) -> Value {
    json!({"op":"receive","peer":"alice","operation":"one","conversation":"private-room","audience":"room-revision-1","message":w["recipients"][0]["message"]})
}
fn pair() -> (Store, Store, Value, Value) {
    let (mut a, ab) = init();
    let (mut b, bb) = init();
    pin(&mut a, "bob", &bb);
    pin(&mut b, "alice", &ab);
    a.call(json!({"op":"outbound","peer":"bob","prekey":bb["prekey"]}));
    (a, b, ab, bb)
}
#[test]
fn rollback_retry_reopen_and_atomic_incoming_history() {
    let (mut a, mut b, _, _) = pair();
    let before = a.0.clone();
    let _uncommitted = prepare(a.0.as_deref(), &send().to_string()).unwrap();
    assert_eq!(a.0, before);
    let bytes = a.call(send());
    let wire: Value = serde_json::from_str(bytes.as_str().unwrap()).unwrap();
    let reopened = a.0.clone();
    a = Store(reopened);
    assert_eq!(a.call(send()), bytes);
    let mut altered = send();
    altered["plaintext"] = json!("other");
    a.rejects(altered, "OPERATION_CONFLICT");
    let before = b.0.clone();
    let _candidate = prepare(b.0.as_deref(), &receive(&wire).to_string()).unwrap();
    assert_eq!(b.0, before);
    assert_eq!(b.call(receive(&wire))["plaintext"], "synthetic");
    b = Store(b.0.clone());
    b.rejects(receive(&wire), "REPLAY");
    assert_eq!(b.call(json!({"op":"history"})).as_array().unwrap().len(), 1);
}
#[test]
fn changed_keys_block_new_and_pending_sends_even_after_ack() {
    let (mut a, _, _, bb) = pair();
    a.call(send());
    let keys = json!({"identity":bb["identity"],"signingIdentity":bb["signingIdentity"]});
    assert_eq!(
        a.call(json!({"op":"verifyPeer","peer":"bob","keys":keys}))["verified"],
        true
    );
    let (_, replacement) = init();
    pin(&mut a, "bob", &replacement);
    a.rejects(send(), "IDENTITY_CHANGED");
    a.rejects(
        json!({"op":"acknowledgePeer","peer":"bob","keys":keys}),
        "IDENTITY_CHANGED",
    );
    let keys = json!({"identity":replacement["identity"],"signingIdentity":replacement["signingIdentity"]});
    assert_eq!(
        a.call(json!({"op":"acknowledgePeer","peer":"bob","keys":keys}))["verified"],
        false
    );
    a.rejects(send(), "IDENTITY_CHANGED");
}
#[test]
fn history_restore_excludes_live_state_and_corruption_fails() {
    let (mut a, mut b, _, _) = pair();
    let wire: Value = serde_json::from_str(a.call(send()).as_str().unwrap()).unwrap();
    b.call(receive(&wire));
    let records = b.call(json!({"op":"exportHistory"}));
    let (mut fresh, identity) = init();
    fresh.call(json!({"op":"importHistory","records":records}));
    assert_eq!(fresh.call(json!({"op":"bundle"})), identity);
    fresh.rejects(send(), "UNKNOWN_PEER");
    fresh.rejects(
        json!({"op":"importHistory","records":[],"sessions":{}}),
        "INVALID_INPUT",
    );
    assert_eq!(
        prepare(Some("{}"), "{\"op\":\"bundle\"}").err(),
        Some("STATE_INVALID")
    );
    let mut corrupt: Value = serde_json::from_str(fresh.0.as_ref().unwrap()).unwrap();
    corrupt["version"] = json!(99);
    assert_eq!(
        prepare(Some(&corrupt.to_string()), "{\"op\":\"bundle\"}").err(),
        Some("STATE_VERSION")
    );
}

#[test]
fn failed_context_fanout_and_capacity_preserve_ratchet() {
    let (mut a, mut b, _, _) = pair();
    let (_, third) = init();
    pin(&mut a, "carol", &third);
    let mut invalid = send();
    invalid["recipients"] = json!(["bob", "carol"]);
    a.rejects(invalid, "NO_SESSION");
    let wire: Value = serde_json::from_str(a.call(send()).as_str().unwrap()).unwrap();
    let mut mismatched = receive(&wire);
    mismatched["audience"] = json!("other");
    b.rejects(mismatched, "CONTEXT_MISMATCH");
    assert_eq!(b.call(json!({"op":"history"})), json!([]));
    assert_eq!(b.call(receive(&wire))["plaintext"], "synthetic");
    for i in 1..256 {
        let mut req = send();
        req["operation"] = json!(format!("op-{i}"));
        a.call(req);
    }
    let mut excess = send();
    excess["operation"] = json!("excess");
    a.rejects(excess, "CAPACITY");
    assert_eq!(
        a.call(json!({"op":"retry","operation":"one"})),
        json!(wire.to_string())
    );
}

#[test]
fn signing_key_change_and_reobservation_cannot_clear_warning() {
    let (mut a, _, _, bb) = pair();
    let (_, new) = init();
    let keys = json!({"identity":bb["identity"],"signingIdentity":new["signingIdentity"]});
    a.call(json!({"op":"observePeer","peer":"bob","keys":keys}));
    pin(&mut a, "bob", &bb);
    a.rejects(send(), "IDENTITY_CHANGED");
    a.rejects(
        json!({"op":"verifyPeer","peer":"bob","keys":keys}),
        "IDENTITY_CHANGED",
    );
    let observed = a.call(json!({"op":"peer","peer":"bob"}));
    assert_eq!(observed["verified"], false);
    assert_eq!(observed["observed"].as_array().unwrap().len(), 2);
}

#[test]
fn conversation_is_protected_and_cannot_be_relabelled() {
    let (mut a, mut b, _, _) = pair();
    let mut req = send();
    req["conversation"] = json!("private-room");
    let bytes = a.call(req);
    let wire: Value = serde_json::from_str(bytes.as_str().unwrap()).unwrap();
    let mut received = receive(&wire);
    received["conversation"] = json!("other-room");
    b.rejects(received.clone(), "CONTEXT_MISMATCH");
    received["conversation"] = json!("private-room");
    assert_eq!(b.call(received)["conversation"], "private-room");
}

#[test]
fn durable_bidirectional_ratchet_and_event_binding() {
    let (mut a, mut b, _, _) = pair();
    let bytes = a.call(send());
    let wire: Value = serde_json::from_str(bytes.as_str().unwrap()).unwrap();
    let mut altered = receive(&wire);
    altered["operation"] = json!("relabelled");
    b.rejects(altered, "CONTEXT_MISMATCH");
    b.call(receive(&wire));
    let mut reply = send();
    reply["operation"] = json!("reply");
    reply["recipients"] = json!(["alice"]);
    let reply = b.call(reply);
    let reply: Value = serde_json::from_str(reply.as_str().unwrap()).unwrap();
    let mut incoming = receive(&reply);
    incoming["operation"] = json!("reply");
    incoming["peer"] = json!("bob");
    assert!(a.call(incoming)["plaintext"] == "synthetic");
    assert!(a.call(send()) == bytes);
}
