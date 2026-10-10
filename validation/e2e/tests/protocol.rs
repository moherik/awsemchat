use vodozemac::megolm::{GroupSession, InboundGroupSession, SessionConfig};
use vodozemac::olm::{Account, OlmMessage, SessionConfig as OlmConfig};

#[test]
fn private_exchange_rejects_outsider() {
    let alice = Account::new();
    let mut bob = Account::new();
    let mut outsider = Account::new();
    bob.generate_one_time_keys(1);
    let key = *bob.one_time_keys().values().next().unwrap();
    let mut outgoing = alice.create_outbound_session(OlmConfig::version_1(), bob.curve25519_key(), key).unwrap();
    let encrypted = outgoing.encrypt("private message").unwrap();
    let OlmMessage::PreKey(prekey) = encrypted else { panic!("expected prekey") };
    assert!(outsider.create_inbound_session(OlmConfig::version_1(), alice.curve25519_key(), &prekey).is_err());
    let mut incoming = bob.create_inbound_session(OlmConfig::version_1(), alice.curve25519_key(), &prekey).unwrap();
    assert_eq!(incoming.plaintext, b"private message");
    let reply = incoming.session.encrypt("reply").unwrap();
    assert_eq!(outgoing.decrypt(&reply).unwrap(), b"reply");
}

#[test]
fn joining_at_current_ratchet_cannot_decrypt_history() {
    let mut sender = GroupSession::new(SessionConfig::version_1());
    let before_join = sender.encrypt("old moment");
    let mut new_member = InboundGroupSession::new(&sender.session_key(), SessionConfig::version_1());
    assert!(new_member.decrypt(&before_join).is_err());
    let after_join = sender.encrypt("new moment");
    assert_eq!(new_member.decrypt(&after_join).unwrap().plaintext, b"new moment");
}

#[test]
fn removal_requires_rotating_the_sender_session() {
    let mut sender = GroupSession::new(SessionConfig::version_1());
    let mut removed = InboundGroupSession::new(&sender.session_key(), SessionConfig::version_1());
    let before_removal = sender.encrypt("before removal");
    assert!(removed.decrypt(&before_removal).is_ok());
    let mut rotated = GroupSession::new(SessionConfig::version_1());
    let mut remaining = InboundGroupSession::new(&rotated.session_key(), SessionConfig::version_1());
    let after_removal = rotated.encrypt("remaining members only");
    assert!(removed.decrypt(&after_removal).is_err());
    assert_eq!(remaining.decrypt(&after_removal).unwrap().plaintext, b"remaining members only");
}
