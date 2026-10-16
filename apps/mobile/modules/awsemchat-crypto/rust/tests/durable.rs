use awsemchat_crypto::durable::prepare;
use serde_json::{json, Value};

#[derive(Default)]
struct Store(Option<String>);
impl Store {
    fn call(&mut self, request: Value) -> Value {
        let (next, output) = prepare(self.0.as_deref(), &request.to_string())
            .unwrap_or_else(|error| panic!("request {request}: {error}"));
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
    s.call(json!({"op":"initialize"}));
    let b = s.call(json!({"op":"preparePublication","operation":"initial"}))["bundles"][0].clone();
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
fn receive_with_event_id(wire: &Value, event_id: &str) -> Value {
    let mut request = receive(wire);
    request["serverEventId"] = json!(event_id);
    request
}
fn pair() -> (Store, Store, Value, Value) {
    let (mut a, ab) = init();
    let (mut b, bb) = init();
    pin(&mut a, "bob", &bb);
    pin(&mut b, "alice", &ab);
    a.call(json!({"op":"outbound","peer":"bob","bundle":bb}));
    (a, b, ab, bb)
}

#[test]
fn committed_receive_requires_exact_ciphertext_context_and_live_history() {
    let (mut a, mut b, ab, _) = pair();
    let wire: Value = serde_json::from_str(a.call(send()).as_str().unwrap()).unwrap();
    let mut check = receive(&wire);
    check["op"] = json!("committedReceive");
    check["sender"] = json!({"identity": ab["identity"], "signingIdentity": ab["signingIdentity"]});
    assert_eq!(b.call(check.clone()), json!(false));
    let _candidate = prepare(b.0.as_deref(), &receive(&wire).to_string()).unwrap();
    assert_eq!(b.call(check.clone()), json!(false));
    b.call(receive(&wire));
    b = Store(b.0.clone());
    let before = b.0.clone();
    assert_eq!(b.call(check.clone()), json!(true));
    assert_eq!(b.0, before);
    for (field, value) in [
        ("peer", "other-peer"),
        ("operation", "other-operation"),
        ("conversation", "other-room"),
        ("audience", "other-audience"),
    ] {
        let mut changed = check.clone();
        changed[field] = json!(value);
        assert_eq!(b.call(changed), json!(false));
    }
    let mut altered = check.clone();
    altered["message"]["body"] = json!("different-ciphertext");
    assert_eq!(b.call(altered), json!(false));
    let archive = b.call(json!({"op":"exportHistory"}));
    let (mut restored, _) = init();
    restored.call(json!({"op":"importHistory","records":archive}));
    assert_eq!(restored.call(check.clone()), json!(false));
    let mut legacy: Value = serde_json::from_str(b.0.as_deref().unwrap()).unwrap();
    legacy["history"][0]
        .as_object_mut()
        .unwrap()
        .remove("receipt_digest");
    let mut legacy_store = Store(Some(legacy.to_string()));
    assert_eq!(legacy_store.call(check), json!(false));
}

#[test]
fn server_event_identity_survives_receive_proof_and_archive_round_trip() {
    let (mut alice, mut bob, alice_keys, _) = pair();
    let wire: Value = serde_json::from_str(alice.call(send()).as_str().unwrap()).unwrap();
    let event_id = "server-event-one";
    let incoming = receive_with_event_id(&wire, event_id);
    let mut proof = incoming.clone();
    proof["op"] = json!("committedReceive");
    proof["sender"] = json!({"identity":alice_keys["identity"],"signingIdentity":alice_keys["signingIdentity"]});
    assert_eq!(bob.call(proof.clone()), false);
    let record = bob.call(incoming);
    assert_eq!(record["serverEventId"], event_id);
    bob = Store(bob.0.clone());
    assert_eq!(bob.call(proof), true);

    let archive = bob.call(json!({"op":"exportHistory"}));
    assert_eq!(archive[0]["serverEventId"], event_id);
    let (mut restored, _) = init();
    restored.call(json!({"op":"importHistory","records":archive}));
    let history = restored.call(json!({"op":"history"}));
    assert_eq!(history[0]["serverEventId"], event_id);
}

#[test]
fn confirmed_send_event_id_is_exported_with_outgoing_history() {
    let (mut alice, _, _, _) = pair();
    alice.call(send());
    alice.call(json!({"op":"confirmSend","operation":"one","event":"server-event-one","status":"sent"}));
    let history = alice.call(json!({"op":"exportHistory"}));
    assert_eq!(history[0]["serverEventId"], "server-event-one");
}

#[test]
fn durable_redaction_operations_reject_missing_native_support() {
    let (mut alice, _, _, _) = pair();
    let envelope: Value = serde_json::from_str(alice.call(send()).as_str().unwrap()).unwrap();
    alice.call(json!({"op":"confirmSend","operation":"one","event":"server-event-one","status":"sent"}));
    let target = json!({"eventId":"server-event-one"});
    alice.call(json!({"op":"beginRedaction","target":target,"operation":"notice-one"}));
    let pending = alice.call(json!({"op":"pendingRedactions"}));
    assert_eq!(pending[0]["operation"], "notice-one");
    assert_eq!(pending[0]["confirmed"], false);
    alice.rejects(json!({"op":"retry","operation":"one"}), "REDACTION_PENDING");

    let sender = alice.call(json!({"op":"bundle"}));
    let redaction = json!({"eventId":"server-event-one","conversation":"private-room","audience":"room-revision-1","operation":"one","sender":sender,"cursor":"YWxpY2U6MQ"});
    alice.call(json!({"op":"confirmRedaction","target":target,"redaction":redaction}));
    assert!(alice.call(json!({"op":"history"})).as_array().unwrap().is_empty());
    assert!(alice.call(json!({"op":"outgoingHistory"})).as_array().unwrap().is_empty());
    assert!(alice.call(json!({"op":"exportHistory"})).as_array().unwrap().is_empty(), "confirmed sender deletion must purge backup history too");
    let pending = alice.call(json!({"op":"pendingRedactions"}));
    assert_eq!(pending[0]["confirmed"], true);
    assert_eq!(pending[0]["operation"], "notice-one");
    alice = Store(alice.0.clone());
    assert_eq!(alice.call(json!({"op":"pendingRedactions"}))[0]["operation"], "notice-one");
    alice.call(json!({"op":"completeRedaction","eventId":"server-event-one"}));
    assert!(alice.call(json!({"op":"pendingRedactions"})).as_array().unwrap().is_empty());

    let (mut sender_store, mut recipient_store, sender_keys, _) = pair();
    let encrypted: Value = serde_json::from_str(sender_store.call(send()).as_str().unwrap()).unwrap();
    let incoming = receive_with_event_id(&encrypted, "server-event-recipient");
    recipient_store.call(incoming);
    let sender_identity = json!({"identity":sender_keys["identity"],"signingIdentity":sender_keys["signingIdentity"]});
    let recipient_redaction = json!({"eventId":"server-event-recipient","conversation":"private-room","audience":"room-revision-1","operation":"one","sender":sender_identity,"cursor":"Ym9iOjE"});
    let page = json!({"op":"applyRedactions","previousCursor":null,"cursor":"Ym9iOjE","items":[recipient_redaction]});
    let before = recipient_store.0.clone();
    let mut invalid = page.clone();
    invalid["items"][0]["sender"]["identity"] = json!("bad-key");
    recipient_store.rejects(invalid, "INVALID_INPUT");
    assert_eq!(recipient_store.0, before, "invalid redaction page changed sealed state");
    recipient_store.call(page);
    assert!(recipient_store.call(json!({"op":"history"})).as_array().unwrap().is_empty());
    let cursor = recipient_store.call(json!({"op":"redactionCursor"}));
    assert_eq!(cursor, "Ym9iOjE");
    let before_replay = recipient_store.0.clone();
    recipient_store.rejects(json!({"op":"applyRedactions","previousCursor":null,"cursor":"Ym9iOjE","items":[]}), "OPERATION_CONFLICT");
    assert_eq!(recipient_store.0, before_replay);
    let _ = envelope;
}

#[test]
fn ambiguous_legacy_redaction_target_fails_closed_without_mutating_state() {
    let (mut sender, _, sender_keys, _) = pair();
    sender.call(send());
    sender.call(json!({"op":"confirmSend","operation":"one","event":"server-event-one","status":"sent"}));
    let mut legacy = sender.call(json!({"op":"exportHistory"}))[0].clone();
    legacy.as_object_mut().unwrap().remove("serverEventId");
    let mut conflicting = legacy.clone();
    conflicting["plaintext"] = json!("different restored payload");
    sender.call(json!({"op":"importHistory","records":[legacy,conflicting]}));
    let target = json!({"legacy":{"conversation":"private-room","audience":"room-revision-1","operation":"one","peerKeys":{"identity":sender_keys["identity"],"signingIdentity":sender_keys["signingIdentity"]}}});
    let before = sender.0.clone();
    sender.rejects(json!({"op":"beginRedaction","target":target,"operation":"notice-one"}), "REDACTION_CONFLICT");
    assert_eq!(sender.0, before, "ambiguous legacy match must not change sealed state");
}

#[test]
fn definitive_redaction_rejection_can_restore_message_by_cancelling_pending_operation() {
    let (mut sender, _, _, _) = pair();
    sender.call(send());
    sender.call(json!({"op":"confirmSend","operation":"one","event":"server-event-one","status":"sent"}));
    sender.call(json!({"op":"beginRedaction","target":{"eventId":"server-event-one"},"operation":"notice-one"}));
    sender.call(json!({"op":"cancelRedaction","operation":"notice-one"}));
    assert!(sender.call(json!({"op":"history"})).as_array().unwrap().is_empty());
    assert_eq!(sender.call(json!({"op":"outgoingHistory"})).as_array().unwrap().len(), 1);
    assert!(sender.call(json!({"op":"pendingRedactions"})).as_array().unwrap().is_empty());
    assert!(sender.call(json!({"op":"retry","operation":"one"})).is_string());
}

#[test]
fn pending_redaction_keeps_exact_circle_recipient_route_across_confirmation_and_reopen() {
    let (mut sender, _, sender_keys, _) = pair();
    let mut draft = send();
    draft["conversation"] = json!("circle-one");
    draft["audience"] = json!("circle:2");
    draft["circle"] = json!("circle-one");
    sender.call(draft);
    sender.call(json!({"op":"confirmSend","operation":"one","event":"circle-event-one","status":"sent"}));
    sender.call(json!({"op":"beginRedaction","target":{"eventId":"circle-event-one"},"operation":"notice-one"}));
    let pending = sender.call(json!({"op":"pendingRedactions"}));
    assert_eq!(pending[0]["route"]["circle"], "circle-one");
    assert_eq!(pending[0]["route"]["recipients"], json!(["bob"]));
    let sender_keys = json!({"identity":sender_keys["identity"],"signingIdentity":sender_keys["signingIdentity"]});
    let redaction = json!({"eventId":"circle-event-one","conversation":"circle-one","audience":"circle:2","operation":"one","sender":sender_keys});
    sender.call(json!({"op":"confirmRedaction","target":{"eventId":"circle-event-one"},"redaction":redaction}));
    sender = Store(sender.0.clone());
    assert_eq!(sender.call(json!({"op":"pendingRedactions"}))[0]["route"]["recipients"], json!(["bob"]));
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
    assert_eq!(fresh.call(json!({"op":"bundle"})), peer_keys(&identity));
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

fn peer_keys(bundle: &Value) -> Value {
    json!({"identity":bundle["identity"],"signingIdentity":bundle["signingIdentity"]})
}
fn acknowledge(s: &mut Store, bundle: &Value) {
    s.call(json!({"op":"acknowledgePeer","peer":"bob","keys":peer_keys(bundle)}));
}
#[test]
fn exhausted_pin_history_commits_terminal_quarantine() {
    let (mut a, _, _, original) = pair();
    let (_, replacement) = init();
    for i in 0..15 {
        let keys = if i % 2 == 0 { &replacement } else { &original };
        pin(&mut a, "bob", keys);
        acknowledge(&mut a, keys);
    }
    a.call(json!({"op":"outbound","peer":"bob","bundle":replacement}));
    a.call(send());
    a.call(json!({"op":"verifyPeer","peer":"bob","keys":peer_keys(&replacement)}));
    let observed = a.call(json!({"op":"observePeer","peer":"bob","keys":peer_keys(&original)}));
    assert_eq!(observed["historyExhausted"], true);
    assert_eq!(observed["verified"], false);
    assert_eq!(observed["observed"].as_array().unwrap().len(), 16);
    a = Store(a.0.clone());
    a.rejects(json!({"op":"retry","operation":"one"}), "IDENTITY_CHANGED");
    let mut fresh = send();
    fresh["operation"] = json!("new");
    a.rejects(fresh, "IDENTITY_CHANGED");
    a.rejects(
        json!({"op":"acknowledgePeer","peer":"bob","keys":peer_keys(&original)}),
        "IDENTITY_CHANGED",
    );
    pin(&mut a, "bob", &replacement);
    a.rejects(send(), "IDENTITY_CHANGED");
}
#[test]
fn returning_to_original_identity_does_not_release_original_outbox() {
    let (mut a, mut b, _, original) = pair();
    a.call(send());
    let (_, replacement) = init();
    pin(&mut a, "bob", &replacement);
    acknowledge(&mut a, &replacement);
    pin(&mut a, "bob", &original);
    acknowledge(&mut a, &original);
    a = Store(a.0.clone());
    a.rejects(json!({"op":"retry","operation":"one"}), "IDENTITY_CHANGED");
    let unused =
        b.call(json!({"op":"preparePublication","operation":"initial"}))["bundles"][1].clone();
    a.call(json!({"op":"outbound","peer":"bob","bundle":unused}));
    let mut fresh = send();
    fresh["operation"] = json!("new");
    a.call(fresh);
    a.rejects(send(), "IDENTITY_CHANGED");
}

#[test]
fn inbox_cursor_is_durable_compare_and_swap_and_excluded_from_archives() {
    let (mut store, _) = init();
    assert_eq!(store.call(json!({"op":"inboxCursor"})), Value::Null);
    store.call(json!({"op":"advanceInboxCursor","previous":null,"next":"event-one"}));
    store = Store(store.0.clone());
    assert_eq!(store.call(json!({"op":"inboxCursor"})), json!("event-one"));
    store.rejects(
        json!({"op":"advanceInboxCursor","previous":null,"next":"event-two"}),
        "OPERATION_CONFLICT",
    );
    assert_eq!(store.call(json!({"op":"inboxCursor"})), json!("event-one"));
    store.call(json!({"op":"advanceInboxCursor","previous":"event-one","next":"event-two"}));
    let archive = store.call(json!({"op":"exportHistory"}));
    let (mut restored, _) = init();
    restored.call(json!({"op":"importHistory","records":archive}));
    assert_eq!(restored.call(json!({"op":"inboxCursor"})), Value::Null);
}

#[test]
fn session_readiness_requires_current_pinned_identity_and_survives_reopen() {
    let (mut alice, mut bob, _, _) = pair();
    assert_eq!(
        alice.call(json!({"op":"hasSession","peer":"bob"})),
        json!(true)
    );
    assert_eq!(
        bob.call(json!({"op":"hasSession","peer":"alice"})),
        json!(false)
    );
    alice = Store(alice.0.clone());
    assert_eq!(
        alice.call(json!({"op":"hasSession","peer":"bob"})),
        json!(true)
    );
    let (_, replacement) = init();
    pin(&mut alice, "bob", &replacement);
    alice.rejects(json!({"op":"hasSession","peer":"bob"}), "IDENTITY_CHANGED");
}

#[test]
fn retry_draft_rejects_changed_text_or_destination_after_reopen() {
    let (mut store, _, _, _) = pair();
    let mut draft = send();
    draft["target"] = json!("bob");
    let bytes = store.call(draft);
    store = Store(store.0.clone());
    let request = json!({"op":"retryDraft","operation":"one","target":"bob","circle":null,"plaintext":"synthetic"});
    assert_eq!(store.call(request.clone()), bytes);
    for (field, value) in [("target", "carol"), ("plaintext", "changed")] {
        let mut changed = request.clone();
        changed[field] = json!(value);
        store.rejects(changed, "OPERATION_CONFLICT");
    }
    let mut circle = request;
    circle["target"] = Value::Null;
    circle["circle"] = json!("private-room");
    store.rejects(circle, "OPERATION_CONFLICT");
}

#[test]
fn outgoing_history_persists_queued_sent_and_monotonic_delivery_status() {
    let (mut store, _, _, _) = pair();
    store.call(send());
    store = Store(store.0.clone());
    let queued = store.call(json!({"op":"outgoingHistory"}));
    assert_eq!(queued[0]["operation"], "one");
    assert_eq!(queued[0]["plaintext"], "synthetic");
    assert_eq!(queued[0]["status"], "queued");
    let _uncommitted = prepare(
        store.0.as_deref(),
        &json!({"op":"confirmSend","operation":"one","event":"event-one","status":"sent"})
            .to_string(),
    )
    .unwrap();
    assert_eq!(
        store.call(json!({"op":"outgoingHistory"}))[0]["status"],
        "queued"
    );
    store.call(json!({"op":"confirmSend","operation":"one","event":"event-one","status":"sent"}));
    store = Store(store.0.clone());
    assert_eq!(
        store.call(json!({"op":"outgoingHistory"}))[0]["status"],
        "sent"
    );
    store.call(
        json!({"op":"confirmSend","operation":"one","event":"event-one","status":"delivered"}),
    );
    store.call(json!({"op":"confirmSend","operation":"one","event":"event-one","status":"sent"}));
    assert_eq!(
        store.call(json!({"op":"outgoingHistory"}))[0]["status"],
        "delivered"
    );
    store.rejects(
        json!({"op":"confirmSend","operation":"one","event":"other-event","status":"sent"}),
        "OPERATION_CONFLICT",
    );
    store.rejects(
        json!({"op":"confirmSend","operation":"one","event":"event-one","status":"read"}),
        "INVALID_INPUT",
    );
}

#[test]
fn local_message_sequence_orders_incoming_and_outgoing_across_reopen() {
    let (mut a, mut b, _, _) = pair();
    let wire: Value = serde_json::from_str(a.call(send()).as_str().unwrap()).unwrap();
    b.call(receive(&wire));
    b = Store(b.0.clone());
    let mut reply = send();
    reply["operation"] = json!("reply");
    reply["recipients"] = json!(["alice"]);
    b.call(reply);
    assert_eq!(b.call(json!({"op":"history"}))[0]["sequence"], 1);
    assert_eq!(b.call(json!({"op":"outgoingHistory"}))[0]["sequence"], 2);
}

#[test]
fn history_archive_restores_sent_and_received_without_live_sender_state() {
    let (mut a, mut b, _, _) = pair();
    let sent: Value = serde_json::from_str(a.call(send()).as_str().unwrap()).unwrap();
    b.call(receive(&sent));
    let mut reply = send();
    reply["operation"] = json!("reply");
    reply["recipients"] = json!(["alice"]);
    let replied: Value = serde_json::from_str(b.call(reply).as_str().unwrap()).unwrap();
    let mut incoming = receive(&replied);
    incoming["peer"] = json!("bob");
    incoming["operation"] = json!("reply");
    a.call(incoming);
    let archive = a.call(json!({"op":"exportHistory"}));
    assert_eq!(archive.as_array().unwrap().len(), 2);
    assert!(archive
        .as_array()
        .unwrap()
        .iter()
        .any(|h| h["direction"] == "outgoing"));
    let (mut restored, _) = init();
    restored.call(json!({"op":"importHistory","records":archive}));
    assert!(restored
        .call(json!({"op":"history"}))
        .as_array()
        .unwrap()
        .iter()
        .all(|h| h["archival"] == true));
    assert_eq!(restored.call(json!({"op":"outgoingHistory"})), json!([]));
    restored.rejects(json!({"op":"retry","operation":"one"}), "UNKNOWN_OPERATION");
}

#[test]
fn importing_the_same_history_again_does_not_duplicate_messages() {
    let (mut source, _, _, _) = pair();
    source.call(send());
    let records = source.call(json!({"op":"exportHistory"}));
    let (mut restored, _) = init();
    restored.call(json!({"op":"importHistory","records":records.clone()}));
    restored = Store(restored.0.clone());
    restored.call(json!({"op":"importHistory","records":records}));
    assert_eq!(restored.call(json!({"op":"history"})).as_array().unwrap().len(), 1);
}

#[test]
fn repeated_records_do_not_consume_archive_capacity() {
    let (mut source, _, _, _) = pair();
    source.call(send());
    let record = source.call(json!({"op":"exportHistory"}))[0].clone();
    let (mut restored, _) = init();
    restored.call(json!({"op":"importHistory","records":vec![record.clone(); 100]}));
    restored.call(json!({"op":"importHistory","records":[record]}));
    assert_eq!(restored.call(json!({"op":"history"})).as_array().unwrap().len(), 1);
}

#[test]
fn large_archive_import_allowance_does_not_expand_live_send_requests() {
    let (source, _, _, _) = pair();
    let mut request = send();
    request["plaintext"] = json!("\u{0000}".repeat(32768));
    source.rejects(request, "INPUT_TOO_LARGE");
}

#[test]
fn complete_history_import_can_exceed_live_message_request_size() {
    let (mut source, _, _, _) = pair();
    source.call(send());
    let record = source.call(json!({"op":"exportHistory"}))[0].clone();
    let records: Vec<Value> = (0..768).map(|n| {
        let mut h = record.clone();
        h["operation"] = json!(format!("message-{n}"));
        h["plaintext"] = json!("synthetic ".repeat(100));
        h
    }).collect();
    let (mut restored, _) = init();
    restored.call(json!({"op":"importHistory","records":records}));
    assert_eq!(restored.call(json!({"op":"history"})).as_array().unwrap().len(), 768);
}

#[test]
fn repeating_a_restore_at_full_capacity_is_allowed() {
    let (mut source, _, _, _) = pair();
    source.call(send());
    let mut record = source.call(json!({"op":"exportHistory"}))[0].clone();
    record.as_object_mut().unwrap().remove("sequence");
    let (restored, _) = init();
    let mut snapshot: Value = serde_json::from_str(restored.0.as_ref().unwrap()).unwrap();
    snapshot["archive"] = json!((0..768).map(|n| {
        let mut h = record.clone();
        h["operation"] = json!(format!("record-{n}"));
        h
    }).collect::<Vec<_>>());
    let duplicate = snapshot["archive"][0].clone();
    let mut restored = Store(Some(snapshot.to_string()));
    restored.call(json!({"op":"importHistory","records":[duplicate]}));
    assert_eq!(restored.call(json!({"op":"history"})).as_array().unwrap().len(), 768);
}

#[test]
fn restored_history_and_live_messages_share_the_archive_capacity_bound() {
    let (mut store, _, _, _) = pair();
    store.call(send());
    let record = store.call(json!({"op":"exportHistory"}))[0].clone();
    let mut snapshot: Value = serde_json::from_str(store.0.as_ref().unwrap()).unwrap();
    snapshot["archive"] = json!(vec![record; 768]);
    assert_eq!(
        prepare(Some(&snapshot.to_string()), "{\"op\":\"bundle\"}").err(),
        Some("STATE_INVALID")
    );
}

#[test]
fn circle_profile_type_is_bound_to_ciphertext_retry_and_backup_history() {
    let (mut a, mut b, ab, _) = pair();
    let mut request = send();
    request["conversation"] = json!("circle-one");
    request["circle"] = json!("circle-one");
    request["contentType"] = json!("circle-profile");
    let bytes = a.call(request.clone());
    let wire: Value = serde_json::from_str(bytes.as_str().unwrap()).unwrap();
    assert_eq!(wire["contentType"], json!("circle-profile"));
    assert_eq!(a.call(request.clone()), bytes);
    let mut incoming = receive(&wire);
    incoming["conversation"] = json!("circle-one");
    incoming["contentType"] = json!("circle-profile");
    let mut wrong = incoming.clone();
    wrong["contentType"] = json!("text");
    b.rejects(wrong, "CONTEXT_MISMATCH");
    let record = b.call(incoming.clone());
    assert_eq!(record["contentType"], json!("circle-profile"));
    incoming["op"] = json!("committedReceive");
    incoming["sender"] = json!({"identity":ab["identity"],"signingIdentity":ab["signingIdentity"]});
    assert_eq!(b.call(incoming.clone()), json!(true));
    incoming["contentType"] = json!("text");
    assert_eq!(b.call(incoming), json!(false));
    let mut retry = json!({"op":"retryDraft","operation":"one","circle":"circle-one","plaintext":"synthetic","contentType":"text"});
    a.rejects(retry.clone(), "OPERATION_CONFLICT");
    retry["contentType"] = json!("circle-profile");
    assert_eq!(a.call(retry), bytes);
    a.call(json!({"op":"confirmSend","operation":"one","event":"accepted-profile","status":"sent"}));
    let archive = a.call(json!({"op":"exportHistory"}));
    assert_eq!(archive[0]["contentType"], json!("circle-profile"));
    let (mut restored, _) = init();
    restored.call(json!({"op":"importHistory","records":archive}));
    assert_eq!(restored.call(json!({"op":"history"}))[0]["contentType"], json!("circle-profile"));
}

#[test]
fn private_profile_type_is_bound_to_exact_ciphertext_retry_and_history() {
    let (mut a, mut b, _, _) = pair();
    let mut request = send();
    request["contentType"] = json!("private-profile");
    request["target"] = json!("bob");
    request["conversation"] = json!(format!("private:{}", "b".repeat(64)));
    request["audience"] = json!("friend:request-9");
    let prepared = prepare(a.0.as_deref(), &request.to_string());
    assert!(prepared.is_ok(), "private-profile send rejected: {:?}", prepared.err());
    let (next, output) = prepared.unwrap();
    a.0 = Some(next);
    let bytes: String = serde_json::from_str(&output).unwrap();
    let wire: Value = serde_json::from_str(&bytes).unwrap();
    assert_eq!(wire["contentType"], json!("private-profile"), "wire envelope: {bytes}");
    assert!(!bytes.contains("synthetic"));
    assert_eq!(a.call(request.clone()).as_str().unwrap(), bytes);

    let mut incoming = receive(&wire);
    incoming["conversation"] = wire["conversation"].clone();
    incoming["audience"] = wire["audience"].clone();
    incoming["contentType"] = json!("private-profile");
    assert_eq!(b.call(incoming)["contentType"], json!("private-profile"));
    a.call(json!({"op":"confirmSend","operation":"one","event":"private-profile-event","status":"sent"}));
    let archive = a.call(json!({"op":"exportHistory"}));
    assert_eq!(archive[0]["contentType"], json!("private-profile"));
    let (mut restored, _) = init();
    restored.call(json!({"op":"importHistory","records":archive}));
    assert_eq!(restored.call(json!({"op":"history"}))[0]["contentType"], json!("private-profile"));
}

#[test]
fn ping_and_pong_types_are_bound_to_private_friend_conversations() {
    let (mut alice, _, _, _) = pair();
    let mut request = send();
    request["target"] = json!("bob");
    request["conversation"] = json!(format!("private:{}", "a".repeat(64)));
    request["audience"] = json!("friend:request-1");
    request["contentType"] = json!("ping");
    let ping = alice.call(request.clone());
    let ping_wire: Value = serde_json::from_str(ping.as_str().unwrap()).unwrap();
    assert_eq!(ping_wire["contentType"], json!("ping"));
    assert_eq!(alice.call(request), ping);

    let mut pong = send();
    pong["operation"] = json!("pong-operation");
    pong["target"] = json!("bob");
    pong["conversation"] = json!(format!("private:{}", "a".repeat(64)));
    pong["audience"] = json!("friend:request-1");
    pong["contentType"] = json!("pong");
    let pong_wire: Value = serde_json::from_str(alice.call(pong).as_str().unwrap()).unwrap();
    assert_eq!(pong_wire["contentType"], json!("pong"));

    let mut circle = send();
    circle["circle"] = json!("circle-one");
    circle["conversation"] = json!("circle-one");
    circle["audience"] = json!("circle:1");
    circle["contentType"] = json!("ping");
    alice.rejects(circle, "INVALID_INPUT");
}

#[test]
fn unsupported_content_type_or_private_circle_profile_is_rejected_before_commit() {
    let (a, _, _, _) = pair();
    let before = a.0.clone();
    let mut request = send();
    request["contentType"] = json!("unknown");
    a.rejects(request.clone(), "INVALID_INPUT");
    request["contentType"] = json!("circle-profile");
    a.rejects(request, "INVALID_INPUT");
    assert_eq!(a.0, before);
}

#[test]
fn creator_only_circle_profile_is_durable_without_consuming_a_peer_session() {
    let (mut creator, _) = init();
    let request = json!({"op":"send","operation":"initial-profile","conversation":"circle-one","circle":"circle-one","audience":"circle:1","recipients":[],"contentType":"circle-profile","plaintext":"synthetic private profile"});
    let bytes = creator.call(request.clone());
    let envelope: Value = serde_json::from_str(bytes.as_str().unwrap()).unwrap();
    assert_eq!(envelope["recipients"], json!([]));
    assert!(!bytes.as_str().unwrap().contains("synthetic private profile"));
    creator = Store(creator.0.clone());
    assert_eq!(creator.call(request.clone()), bytes);
    creator.call(json!({"op":"confirmSend","operation":"initial-profile","event":"accepted-profile","status":"sent"}));
    let history = creator.call(json!({"op":"exportHistory"}));
    assert_eq!(history[0]["plaintext"], json!("synthetic private profile"));
    assert_eq!(history[0]["contentType"], json!("circle-profile"));
    let mut text = request;
    text["operation"] = json!("text");
    text["contentType"] = json!("text");
    creator.rejects(text, "INVALID_INPUT");
}

#[test]
fn profile_revision_is_authenticated_in_receive_retry_proof_and_archive() {
 let (mut a, mut b, ab, _) = pair();
 let mut request=send();request["conversation"]=json!("circle-one");request["circle"]=json!("circle-one");request["contentType"]=json!("circle-profile");request["profileRevision"]=json!(2);
 let bytes=a.call(request.clone());let wire:Value=serde_json::from_str(bytes.as_str().unwrap()).unwrap();assert_eq!(wire["profileRevision"],json!(2));
 let mut incoming=receive(&wire);incoming["conversation"]=json!("circle-one");incoming["contentType"]=json!("circle-profile");incoming["profileRevision"]=json!(3);b.rejects(incoming.clone(),"CONTEXT_MISMATCH");incoming["profileRevision"]=json!(2);assert_eq!(b.call(incoming.clone())["profileRevision"],json!(2));
 incoming["op"]=json!("committedReceive");incoming["sender"]=json!({"identity":ab["identity"],"signingIdentity":ab["signingIdentity"]});assert_eq!(b.call(incoming.clone()),json!(true));incoming["profileRevision"]=json!(3);assert_eq!(b.call(incoming),json!(false));
 let mut retry=json!({"op":"retryDraft","operation":"one","circle":"circle-one","plaintext":"synthetic","contentType":"circle-profile","profileRevision":3});a.rejects(retry.clone(),"OPERATION_CONFLICT");retry["profileRevision"]=json!(2);assert_eq!(a.call(retry),bytes);
 a.call(json!({"op":"confirmSend","operation":"one","event":"accepted-profile","status":"sent"}));
 let archive=a.call(json!({"op":"exportHistory"}));assert_eq!(archive[0]["profileRevision"],json!(2));let (mut restored,_)=init();restored.call(json!({"op":"importHistory","records":archive}));assert_eq!(restored.call(json!({"op":"history"}))[0]["profileRevision"],json!(2));
}

#[test]
fn archive_excludes_unaccepted_profiles_but_keeps_queued_chat_and_accepted_profiles() {
 let (mut owner, _) = init();
 let profile=json!({"op":"send","operation":"pending-profile","conversation":"circle-one","circle":"circle-one","audience":"circle:1","recipients":[],"contentType":"circle-profile","profileRevision":1,"plaintext":"pending private name"});
 owner.call(profile);
 assert_eq!(owner.call(json!({"op":"exportHistory"})),json!([]));
 assert_eq!(owner.call(json!({"op":"outgoingHistory"})).as_array().unwrap().len(),1);
 owner.call(json!({"op":"confirmSend","operation":"pending-profile","event":"accepted-profile","status":"sent"}));
 let archive=owner.call(json!({"op":"exportHistory"}));
 assert_eq!(archive.as_array().unwrap().len(),1);assert_eq!(archive[0]["profileRevision"],json!(1));
 assert_eq!(archive[0]["profileAccepted"],json!(true));
 let (mut a,_,_,_)=pair();a.call(send());assert_eq!(a.call(json!({"op":"exportHistory"})).as_array().unwrap().len(),1);
}

#[test]
fn retired_profile_preserves_other_outboxes_and_blocks_operation_reuse_after_reopen() {
 let (mut owner,_)=init();
 let request=json!({"op":"send","operation":"stale-profile","conversation":"circle-one","circle":"circle-one","audience":"circle:1","recipients":[],"contentType":"circle-profile","profileRevision":1,"plaintext":"private draft"});
 let bytes=owner.call(request.clone());
 owner.call(json!({"op":"send","operation":"keep-profile","conversation":"circle-one","circle":"circle-one","audience":"circle:1","recipients":[],"contentType":"circle-profile","profileRevision":2,"plaintext":"accepted name"}));
 owner.call(json!({"op":"confirmSend","operation":"keep-profile","event":"keep-event","status":"sent"}));
 let retire=json!({"op":"retireProfile","operation":"stale-profile","envelope":bytes});
 let mut wrong=retire.clone();wrong["envelope"]=json!("different");owner.rejects(wrong,"OPERATION_CONFLICT");
 owner.call(retire.clone());assert!(!owner.0.as_ref().unwrap().contains("private draft"));let mut reopened=Store(owner.0.clone());reopened.call(retire);
 reopened.rejects(request,"OPERATION_CANCELLED");
 reopened.rejects(json!({"op":"retry","operation":"stale-profile"}),"OPERATION_CANCELLED");
 let history=reopened.call(json!({"op":"outgoingHistory"}));assert_eq!(history.as_array().unwrap().len(),1);assert_eq!(history[0]["operation"],json!("keep-profile"));
 let archive=reopened.call(json!({"op":"exportHistory"}));assert_eq!(archive.as_array().unwrap().len(),1);assert_eq!(archive[0]["plaintext"],json!("accepted name"));
}

#[test]
fn retirement_cannot_remove_committed_profiles_or_text_and_preserves_peer_ratchets() {
 let (mut a,mut b,_,_)=pair();
 let mut request=send();request["operation"]=json!("profile-gap");request["conversation"]=json!("circle-one");request["circle"]=json!("circle-one");request["contentType"]=json!("circle-profile");request["profileRevision"]=json!(1);
 let bytes=a.call(request);
 a.call(json!({"op":"retireProfile","operation":"profile-gap","envelope":bytes}));
 let wire:Value=serde_json::from_str(a.call(send()).as_str().unwrap()).unwrap();assert_eq!(b.call(receive(&wire))["plaintext"],json!("synthetic"));
 a.rejects(json!({"op":"retireProfile","operation":"one","envelope":wire.to_string()}),"INVALID_INPUT");
 let request=json!({"op":"send","operation":"committed","conversation":"circle-one","circle":"circle-one","audience":"circle:1","recipients":[],"contentType":"circle-profile","profileRevision":2,"plaintext":"accepted"});
 let bytes=a.call(request);a.call(json!({"op":"confirmSend","operation":"committed","event":"accepted","status":"sent"}));
 a.rejects(json!({"op":"retireProfile","operation":"committed","envelope":bytes}),"OPERATION_CONFLICT");
}

#[test]
fn profile_retirement_releases_live_outbox_capacity_without_dropping_tombstones() {
 let (mut owner,_)=init();let mut first=None;let mut full=false;
 for i in 0..300 {
  let request=json!({"op":"send","operation":format!("queued-{i}"),"conversation":format!("circle-{i}"),"circle":format!("circle-{i}"),"audience":"circle:1","recipients":[],"contentType":"circle-profile","profileRevision":1,"plaintext":"draft"});
  match prepare(owner.0.as_deref(),&request.to_string()) {
   Ok((next,output))=>{owner.0=Some(next);if i==0{first=Some(serde_json::from_str::<Value>(&output).unwrap());}}
   Err("CAPACITY")=>{full=true;break;}
   Err(error)=>panic!("unexpected send failure: {error}"),
  }
 }
 assert!(full);
 owner.call(json!({"op":"retireProfile","operation":"queued-0","envelope":first.unwrap()}));
 owner.call(json!({"op":"send","operation":"new-profile","conversation":"new-circle","circle":"new-circle","audience":"circle:1","recipients":[],"contentType":"circle-profile","profileRevision":1,"plaintext":"replacement"}));
 owner.rejects(json!({"op":"retry","operation":"queued-0"}),"OPERATION_CANCELLED");
}

#[test]
fn malformed_profile_tombstones_are_rejected_on_reopen() {
 let (owner,_)=init();let mut state:Value=serde_json::from_str(owner.0.as_ref().unwrap()).unwrap();
 state["retired_profiles"]=json!({"operation":"bad digest"});
 Store(Some(state.to_string())).rejects(json!({"op":"bundle"}),"STATE_INVALID");
}

#[test]
fn recovery_reads_exact_profile_ciphertext_after_peer_identity_changes_without_sending() {
 let (mut a,_,_,_)=pair();let mut request=send();request["conversation"]=json!("circle-one");request["circle"]=json!("circle-one");request["contentType"]=json!("circle-profile");request["profileRevision"]=json!(1);
 let bytes=a.call(request);let (_,replacement)=init();pin(&mut a,"bob",&replacement);
 a.rejects(json!({"op":"retry","operation":"one"}),"IDENTITY_CHANGED");
 let recover=json!({"op":"profileRecoveryDraft","operation":"one","circle":"circle-one","plaintext":"synthetic","profileRevision":1});assert_eq!(a.call(recover.clone()),bytes);
 let mut changed=recover;changed["plaintext"]=json!("different");a.rejects(changed,"OPERATION_CONFLICT");
 a.rejects(json!({"op":"retry","operation":"one"}),"IDENTITY_CHANGED");
}

fn collection_send() -> Value {
 let mut request=send();
 request["conversation"]=json!("circle-one");request["audience"]=json!("circle:1");request["circle"]=json!("circle-one");request["contentType"]=json!("circle-collection");request["collectionRevision"]=json!(1);
 request["collectionChange"]=json!({"action":"add","kind":"sticker","item":"item-one"});request
}
fn collection_receive(wire:&Value) -> Value {
 let mut request=receive(wire);request["conversation"]=wire["conversation"].clone();request["audience"]=wire["audience"].clone();
 request["contentType"]=wire["contentType"].clone();request["collectionRevision"]=wire["collectionRevision"].clone();request["collectionChange"]=wire["collectionChange"].clone();request
}
#[test]
fn collection_routing_is_encrypted_and_exact_retries_survive_reopening() {
 let (mut a,mut b,ab,_)=pair();let request=collection_send();
 let bytes=a.call(request.clone());let wire:Value=serde_json::from_str(bytes.as_str().unwrap()).unwrap();
 assert_eq!(wire["collectionRevision"],json!(1));assert_eq!(wire["collectionChange"],request["collectionChange"]);
 a=Store(a.0.clone());assert_eq!(a.call(request),bytes);
 let mut retry=json!({"op":"retryDraft","operation":"one","circle":"circle-one","plaintext":"synthetic","contentType":"circle-collection","collectionRevision":1,"collectionChange":{"action":"add","kind":"sticker","item":"item-one"}});
 assert_eq!(a.call(retry.clone()),bytes);retry["collectionChange"]["item"]=json!("different");a.rejects(retry,"OPERATION_CONFLICT");
 assert_eq!(a.call(json!({"op":"exportHistory"})),json!([]));
 let received=b.call(collection_receive(&wire));assert_eq!(received["collectionAccepted"],json!(true));assert_eq!(received["collectionChange"],wire["collectionChange"]);
 let mut check=collection_receive(&wire);check["op"]=json!("committedReceive");check["sender"]=json!({"identity":ab["identity"],"signingIdentity":ab["signingIdentity"]});
 b=Store(b.0.clone());assert_eq!(b.call(check.clone()),json!(true));check["collectionRevision"]=json!(2);assert_eq!(b.call(check),json!(false));
 a.call(json!({"op":"confirmSend","operation":"one","event":"event-one","status":"sent"}));
 let exported=a.call(json!({"op":"exportHistory"}));assert_eq!(exported[0]["collectionAccepted"],json!(true));assert_eq!(exported[0]["collectionRevision"],json!(1));
 let (mut restored,_)=init();restored.call(json!({"op":"importHistory","records":exported}));assert_eq!(restored.call(json!({"op":"history"}))[0]["collectionChange"],wire["collectionChange"]);
}

#[test]
fn retired_collection_keeps_other_history_and_survives_reopening() {
 let (mut owner,_,_,_)=pair();
 let mut request=collection_send();request["operation"]=json!("stale-collection");
 let bytes=owner.call(request.clone());
 let recovery=json!({"op":"collectionRecoveryDraft","operation":"stale-collection","circle":"circle-one","plaintext":"synthetic","collectionRevision":1,"collectionChange":{"action":"add","kind":"sticker","item":"item-one"}});
 assert_eq!(owner.call(recovery.clone()),bytes);
 let mut changed=recovery;changed["collectionChange"]["item"]=json!("other-item");owner.rejects(changed,"OPERATION_CONFLICT");
 let retire=json!({"op":"retireCollection","operation":"stale-collection","envelope":bytes});
 owner.call(retire.clone());
 let mut reopened=Store(owner.0.clone());reopened.call(retire);
 reopened.rejects(request,"OPERATION_CANCELLED");
 reopened.rejects(json!({"op":"retry","operation":"stale-collection"}),"OPERATION_CANCELLED");
 assert_eq!(reopened.call(json!({"op":"outgoingHistory"})).as_array().unwrap().len(),0);
 let text=send();let text_bytes=reopened.call(text);
 reopened.rejects(json!({"op":"retireCollection","operation":"one","envelope":text_bytes}),"INVALID_INPUT");
 let mut committed=collection_send();committed["operation"]=json!("accepted-collection");let accepted=reopened.call(committed);
 reopened.call(json!({"op":"confirmSend","operation":"accepted-collection","event":"event-one","status":"sent"}));
 reopened.rejects(json!({"op":"retireCollection","operation":"accepted-collection","envelope":accepted}),"OPERATION_CONFLICT");
}
#[test]
fn collection_metadata_tampering_does_not_advance_ratchets_or_history() {
 let(mut a,mut b,_,_)=pair();let wire:Value=serde_json::from_str(a.call(collection_send()).as_str().unwrap()).unwrap();let original=b.0.clone();
 for change in [json!({"action":"remove","kind":"sticker","item":"item-one"}),json!({"action":"add","kind":"emoji","item":"item-one"}),json!({"action":"add","kind":"sticker","item":"other"})] {
  let mut request=collection_receive(&wire);request["collectionChange"]=change;b.rejects(request,"CONTEXT_MISMATCH");assert_eq!(b.0,original);
 }
 let mut changed=collection_receive(&wire);changed["collectionRevision"]=json!(2);b.rejects(changed,"CONTEXT_MISMATCH");
 b.call(collection_receive(&wire));assert_eq!(b.call(json!({"op":"history"})).as_array().unwrap().len(),1);
}
#[test]
fn collection_metadata_is_required_and_cannot_be_attached_to_private_or_text_routes() {
 let(mut a,_,_,_)=pair();let mut request=collection_send();request["recipients"]=json!([]);a.call(request.clone());
 for field in ["collectionRevision","collectionChange"] {let mut invalid=request.clone();invalid.as_object_mut().unwrap().remove(field);a.rejects(invalid,"INVALID_INPUT");}
 let mut invalid=request.clone();invalid["collectionRevision"]=json!(0);a.rejects(invalid,"INVALID_INPUT");
 let mut invalid=request.clone();invalid["contentType"]=json!("text");a.rejects(invalid,"INVALID_INPUT");
 let mut invalid=request.clone();invalid.as_object_mut().unwrap().remove("circle");a.rejects(invalid,"INVALID_INPUT");
 let mut invalid=collection_send();invalid.as_object_mut().unwrap().remove("circle");invalid["target"]=json!("bob");a.rejects(invalid,"INVALID_INPUT");
 let mut invalid=request;invalid["collectionChange"]["key"]=json!("private");a.rejects(invalid,"INVALID_INPUT");
}
#[test]
fn invalid_collection_state_and_dot_item_ids_fail_closed() {
 let(mut a,_,_,_)=pair();let mut invalid=collection_send();invalid["collectionChange"]["item"]=json!(".");a.rejects(invalid,"INVALID_INPUT");
 a.call(collection_send());let mut state:Value=serde_json::from_str(a.0.as_ref().unwrap()).unwrap();state["outbox"]["one"]["input"]["collectionRevision"]=json!(0);
 let corrupted=Store(Some(state.to_string()));corrupted.rejects(json!({"op":"bundle"}),"STATE_INVALID");
}
fn snapshot_send()->Value {
 let mut request=collection_send();request["contentType"]=json!("circle-collection-snapshot");request["collectionRevision"]=json!(0);request.as_object_mut().unwrap().remove("collectionChange");
 request["collectionSnapshot"]=json!({"id":"snapshot-one","part":0,"parts":1,"items":[]});request
}
fn snapshot_receive(wire:&Value)->Value {
 let mut request=collection_receive(wire);request.as_object_mut().unwrap().remove("collectionChange");request["collectionSnapshot"]=wire["collectionSnapshot"].clone();request
}
#[test]
fn snapshot_metadata_round_trip_retry_archive_and_commit_proof_are_bound() {
 let(mut a,mut b,ab,_)=pair();let request=snapshot_send();let bytes=a.call(request.clone());let wire:Value=serde_json::from_str(bytes.as_str().unwrap()).unwrap();
 assert_eq!(wire["collectionSnapshot"],request["collectionSnapshot"]);a=Store(a.0.clone());assert_eq!(a.call(request),bytes);
 let mut retry=json!({"op":"retryDraft","operation":"one","circle":"circle-one","plaintext":"synthetic","contentType":"circle-collection-snapshot","collectionRevision":0,"collectionSnapshot":wire["collectionSnapshot"]});
 assert_eq!(a.call(retry.clone()),bytes);retry["collectionSnapshot"]["id"]=json!("different");a.rejects(retry,"OPERATION_CONFLICT");
 assert_eq!(a.call(json!({"op":"exportHistory"})),json!([]));
 let received=b.call(snapshot_receive(&wire));assert_eq!(received["collectionAccepted"],json!(true));assert_eq!(received["collectionSnapshot"],wire["collectionSnapshot"]);
 let mut proof=snapshot_receive(&wire);proof["op"]=json!("committedReceive");proof["sender"]=json!({"identity":ab["identity"],"signingIdentity":ab["signingIdentity"]});
 b=Store(b.0.clone());assert_eq!(b.call(proof.clone()),json!(true));proof["collectionSnapshot"]["id"]=json!("other");assert_eq!(b.call(proof),json!(false));
 a.call(json!({"op":"confirmSend","operation":"one","event":"snapshot-event","status":"sent"}));let exported=a.call(json!({"op":"exportHistory"}));assert_eq!(exported[0]["collectionSnapshot"],wire["collectionSnapshot"]);
 let(mut restored,_)=init();restored.call(json!({"op":"importHistory","records":exported}));assert_eq!(restored.call(json!({"op":"history"}))[0]["collectionSnapshot"],wire["collectionSnapshot"]);
}
#[test]
fn snapshot_tampering_and_invalid_headers_preserve_native_state() {
 let(mut a,mut b,_,_)=pair();let wire:Value=serde_json::from_str(a.call(snapshot_send()).as_str().unwrap()).unwrap();let before=b.0.clone();
 let mut changed=snapshot_receive(&wire);changed["collectionSnapshot"]["id"]=json!("other");b.rejects(changed,"CONTEXT_MISMATCH");assert_eq!(before,b.0);
 for header in [json!({"id":"snapshot","part":1,"parts":1,"items":[]}),json!({"id":"snapshot","part":0,"parts":257,"items":[]}),json!({"id":"snapshot","part":0,"parts":2,"items":[]}),json!({"id":"snapshot","part":0,"parts":1,"items":[],"key":"private"})] {
  let mut request=snapshot_send();request["collectionSnapshot"]=header;a.rejects(request,"INVALID_INPUT");
 }
 let mut request=snapshot_send();request["contentType"]=json!("text");a.rejects(request,"INVALID_INPUT");
 b.call(snapshot_receive(&wire));assert_eq!(b.call(json!({"op":"history"})).as_array().unwrap().len(),1);
}
#[test]
fn bounded_snapshot_body_with_maximum_metadata_and_circle_audience_fits_relay_ciphertext() {
 let(mut sender,_)=init();let mut peers=vec![];
 for n in 0..19 {let(_,bundle)=init();let peer=format!("peer-{n:02}");pin(&mut sender,&peer,&bundle);sender.call(json!({"op":"outbound","peer":peer,"bundle":bundle}));peers.push(peer);}
 let items:Vec<Value>=(0..50).map(|n|json!({"id":format!("{n:03}{}","x".repeat(125)),"kind":"sticker"})).collect();
 let mut request=snapshot_send();request["recipients"]=json!(peers);request["collectionRevision"]=json!(50);request["collectionSnapshot"]["items"]=json!(items);request["plaintext"]=json!("\"\\".repeat(8192));
 let wire:Value=serde_json::from_str(sender.call(request).as_str().unwrap()).unwrap();
 assert_eq!(wire["recipients"].as_array().unwrap().len(),19);
 assert!(wire["recipients"].as_array().unwrap().iter().all(|recipient|recipient["message"]["body"].as_str().unwrap().len()<=65536));
}
