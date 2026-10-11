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
        let before = self.0.clone();
        assert_eq!(
            prepare(self.0.as_deref(), &request.to_string()).err(),
            Some(code)
        );
        assert_eq!(self.0, before);
    }
}
fn init() -> Store {
    let mut store = Store::default();
    store.call(json!({"op":"initialize"}));
    store
}
fn publication(s: &mut Store, operation: &str) -> Value {
    s.call(json!({"op":"preparePublication","operation":operation}))
}
fn pin(s: &mut Store, peer: &str, bundle: &Value) {
    s.call(json!({"op":"observePeer","peer":peer,"keys":keys(bundle)}));
}
fn keys(b: &Value) -> Value {
    json!({"identity":b["identity"],"signingIdentity":b["signingIdentity"]})
}
fn outbound(b: &Value) -> Value {
    json!({"op":"outbound","peer":"bob","bundle":b})
}
fn incoming(a: &mut Store, operation: &str) -> Value {
    let wire = a.call(json!({"op":"send","operation":operation,"conversation":"room","audience":"one","recipients":["bob"],"plaintext":"synthetic"}));
    let wire: Value = serde_json::from_str(wire.as_str().unwrap()).unwrap();
    json!({"op":"receive","peer":"alice","operation":operation,"conversation":"room","audience":"one","message":wire["recipients"][0]["message"]})
}
fn pair() -> (Store, Store, Value) {
    let mut a = init();
    let mut b = init();
    let ap = a.call(json!({"op":"bundle"}));
    let batch = publication(&mut b, "batch-one");
    let bundle = batch["bundles"][0].clone();
    pin(&mut a, "bob", &bundle);
    pin(&mut b, "alice", &ap);
    (a, b, batch)
}
#[test]
fn signed_bundle_is_required_and_accepted() {
    let (mut a, _, batch) = pair();
    let bundle = &batch["bundles"][0];
    a.rejects(
        json!({"op":"outbound","peer":"bob","prekey":bundle["prekey"]}),
        "INVALID_INPUT",
    );
    a.call(outbound(bundle));
    assert!(incoming(&mut a, "one")["message"]["body"].is_string());
}
#[test]
fn altered_bundle_fields_and_noncanonical_encoding_leave_state_unchanged() {
    let (mut a, _, batch) = pair();
    let bundle = &batch["bundles"][0];
    let other = &batch["bundles"][1];
    let mut stranger = init();
    let stranger = publication(&mut stranger, "other")["bundles"][0].clone();
    for (field, value, code) in [
        ("prekey", other["prekey"].clone(), "SIGNATURE_REJECTED"),
        ("identity", stranger["identity"].clone(), "IDENTITY_CHANGED"),
        (
            "signingIdentity",
            stranger["signingIdentity"].clone(),
            "IDENTITY_CHANGED",
        ),
        (
            "signature",
            other["signature"].clone(),
            "SIGNATURE_REJECTED",
        ),
        ("signature", json!("not-base64"), "INVALID_INPUT"),
        (
            "prekey",
            json!(format!("{}=", bundle["prekey"].as_str().unwrap())),
            "INVALID_INPUT",
        ),
        (
            "signature",
            json!(format!("{}==", bundle["signature"].as_str().unwrap())),
            "INVALID_INPUT",
        ),
        ("version", json!(2), "BUNDLE_VERSION"),
        ("context", json!("other"), "BUNDLE_VERSION"),
        ("publication", json!("other-batch"), "SIGNATURE_REJECTED"),
        ("keyId", other["keyId"].clone(), "SIGNATURE_REJECTED"),
    ] {
        let mut altered = bundle.clone();
        altered[field] = value;
        a.rejects(outbound(&altered), code);
    }
    a.call(outbound(bundle));
}
#[test]
fn pending_pin_change_blocks_signed_outbound_and_ack_does_not_reuse_key() {
    let (mut a, _, batch) = pair();
    let bundle = &batch["bundles"][0];
    a.call(outbound(bundle));
    let mut other = init();
    let replacement = publication(&mut other, "other")["bundles"][0].clone();
    pin(&mut a, "bob", &replacement);
    a.rejects(outbound(bundle), "IDENTITY_CHANGED");
    a.call(json!({"op":"acknowledgePeer","peer":"bob","keys":keys(&replacement)}));
    a.rejects(outbound(bundle), "IDENTITY_CHANGED");
    pin(&mut a, "bob", bundle);
    a.call(json!({"op":"acknowledgePeer","peer":"bob","keys":keys(bundle)}));
    a = Store(a.0.clone());
    a.rejects(outbound(bundle), "PREKEY_REUSED");
    a.call(outbound(&batch["bundles"][1]));
}
#[test]
fn publication_retry_and_ack_are_exact_and_do_not_mark_new_batch() {
    let (mut a, mut b, batch) = pair();
    assert_eq!(batch["bundles"].as_array().unwrap().len(), 20);
    b = Store(b.0.clone());
    assert_eq!(publication(&mut b, "batch-one"), batch);
    b.rejects(
        json!({"op":"preparePublication","operation":"blocked"}),
        "PUBLICATION_PENDING",
    );
    b.rejects(
        json!({"op":"confirmPublication","operation":"unknown"}),
        "UNKNOWN_OPERATION",
    );
    b.call(json!({"op":"confirmPublication","operation":"batch-one"}));
    assert_eq!(
        b.call(json!({"op":"prekeyStatus"})),
        json!({"stored":20,"unpublished":0,"pending":null})
    );
    b.rejects(
        json!({"op":"preparePublication","operation":"full"}),
        "PREKEY_CAPACITY",
    );
    a.call(outbound(&batch["bundles"][0]));
    b.call(incoming(&mut a, "one"));
    let next = publication(&mut b, "batch-two");
    assert_eq!(next["bundles"].as_array().unwrap().len(), 1);
    assert!(!batch["bundles"]
        .as_array()
        .unwrap()
        .iter()
        .any(|old| old["prekey"] == next["bundles"][0]["prekey"]));
    b.call(json!({"op":"confirmPublication","operation":"batch-one"}));
    assert_eq!(b.call(json!({"op":"prekeyStatus"}))["unpublished"], 1);
    assert_eq!(publication(&mut b, "batch-one"), batch);
    b.call(json!({"op":"confirmPublication","operation":"batch-two"}));
    assert_eq!(b.call(json!({"op":"prekeyStatus"}))["unpublished"], 0);
}
#[test]
fn rollback_publication_and_consumption_recover_coherently() {
    let mut b = init();
    let before = b.0.clone();
    let request = json!({"op":"preparePublication","operation":"one"});
    let _discarded = prepare(b.0.as_deref(), &request.to_string()).unwrap();
    assert_eq!(b.0, before);
    assert_eq!(b.call(json!({"op":"prekeyStatus"}))["stored"], 0);
    let batch = b.call(request.clone());
    b = Store(b.0.clone());
    assert_eq!(b.call(request), batch);
    let mut a = init();
    let ap = a.call(json!({"op":"bundle"}));
    pin(&mut b, "alice", &ap);
    pin(&mut a, "bob", &batch["bundles"][0]);
    a.call(outbound(&batch["bundles"][0]));
    let receive = incoming(&mut a, "one");
    let _discarded = prepare(b.0.as_deref(), &receive.to_string()).unwrap();
    assert_eq!(b.call(json!({"op":"prekeyStatus"}))["stored"], 20);
    let mut invalid = receive.clone();
    invalid["conversation"] = json!("other");
    b.rejects(invalid, "CONTEXT_MISMATCH");
    assert_eq!(b.call(json!({"op":"prekeyStatus"}))["stored"], 20);
    b.call(receive.clone());
    b = Store(b.0.clone());
    assert_eq!(b.call(json!({"op":"prekeyStatus"}))["stored"], 19);
    b.rejects(receive, "REPLAY");
    assert_eq!(b.call(json!({"op":"history"})).as_array().unwrap().len(), 1);
    // Delivery before publication acknowledgement is possible after a lost network response.
    b.call(json!({"op":"confirmPublication","operation":"one"}));
    assert_eq!(
        publication(&mut b, "refill")["bundles"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn server_reissue_cannot_create_second_inbound_session() {
    let (mut a, mut b, batch) = pair();
    let bundle = &batch["bundles"][0];
    let mut c = init();
    let cp = c.call(json!({"op":"bundle"}));
    pin(&mut b, "carol", &cp);
    pin(&mut c, "bob", bundle);
    a.call(outbound(bundle));
    c.call(outbound(bundle));
    b.call(incoming(&mut a, "one"));
    let mut reissued = incoming(&mut c, "two");
    reissued["peer"] = json!("carol");
    b = Store(b.0.clone());
    b.rejects(reissued, "CRYPTO_REJECTED");
    assert_eq!(b.call(json!({"op":"prekeyStatus"}))["stored"], 19);
}
#[test]
fn old_snapshot_explicitly_rejected_without_reset() {
    let s = init();
    let mut old: Value = serde_json::from_str(s.0.as_ref().unwrap()).unwrap();
    old["version"] = json!(1);
    for field in ["publications", "pending_publication", "used_prekeys"] {
        old.as_object_mut().unwrap().remove(field);
    }
    assert_eq!(
        prepare(Some(&old.to_string()), "{\"op\":\"bundle\"}").err(),
        Some("STATE_VERSION")
    );
}
#[test]
fn publication_ledger_capacity_fails_closed_after_real_consumption() {
    let mut b = init();
    for i in 0..64 {
        let operation = format!("batch-{i}");
        let batch = publication(&mut b, &operation);
        b.call(json!({"op":"confirmPublication","operation":operation}));
        let mut a = init();
        let ap = a.call(json!({"op":"bundle"}));
        let peer = format!("alice-{i}");
        pin(&mut b, &peer, &ap);
        pin(&mut a, "bob", &batch["bundles"][0]);
        a.call(outbound(&batch["bundles"][0]));
        let mut received = incoming(&mut a, &format!("event-{i}"));
        received["peer"] = json!(peer);
        b.call(received);
    }
    b = Store(b.0.clone());
    b.rejects(
        json!({"op":"preparePublication","operation":"excess"}),
        "CAPACITY",
    );
    assert_eq!(b.call(json!({"op":"prekeyStatus"}))["stored"], 19);
}
