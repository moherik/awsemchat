//! Native candidate transactions. Callers must seal and commit before releasing `output`.
use crate::{Result, WireMessage, MAX_INPUT, MAX_PLAINTEXT};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use vodozemac::{
    olm::{Account, AccountPickle, OlmMessage, Session, SessionConfig, SessionPickle},
    Curve25519PublicKey, Ed25519PublicKey,
};

pub const MAX_STATE: usize = 8 * 1024 * 1024;
const MAX_PEERS: usize = 64;
const MAX_OUTBOX: usize = 256;
const MAX_HISTORY: usize = 512;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Initialize {},
    Bundle {},
    ObservePeer {
        peer: String,
        keys: Keys,
    },
    AcknowledgePeer {
        peer: String,
        keys: Keys,
    },
    VerifyPeer {
        peer: String,
        keys: Keys,
    },
    Peer {
        peer: String,
    },
    Outbound {
        peer: String,
        prekey: String,
    },
    Send {
        operation: String,
        conversation: String,
        audience: String,
        recipients: Vec<String>,
        plaintext: String,
    },
    Retry {
        operation: String,
    },
    Receive {
        peer: String,
        operation: String,
        conversation: String,
        audience: String,
        message: WireMessage,
    },
    History {},
    ExportHistory {},
    ImportHistory {
        records: Vec<History>,
    },
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Keys {
    identity: String,
    signing_identity: String,
}
impl Keys {
    fn validate(&self) -> Result<()> {
        Curve25519PublicKey::from_base64(&self.identity).map_err(|_| "INVALID_INPUT")?;
        Ed25519PublicKey::from_base64(&self.signing_identity).map_err(|_| "INVALID_INPUT")?;
        Ok(())
    }
    fn account(a: &Account) -> Self {
        Self {
            identity: a.curve25519_key().to_base64(),
            signing_identity: a.ed25519_key().to_base64(),
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pin {
    #[serde(default, rename = "historyExhausted")]
    history_exhausted: bool,
    current: Keys,
    pending: Option<Keys>,
    observed: Vec<Keys>,
    verified: bool,
    revision: u32,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedSession {
    revision: u32,
    pickle: SessionPickle,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct SendInput {
    operation: String,
    conversation: String,
    audience: String,
    recipients: Vec<String>,
    plaintext: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Outgoing {
    input: SendInput,
    revisions: BTreeMap<String, u32>,
    bytes: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct History {
    operation: String,
    conversation: String,
    audience: String,
    sender: Keys,
    plaintext: String,
    archival: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Protected {
    version: u32,
    operation: String,
    conversation: String,
    audience: String,
    sender: Keys,
    recipients: Vec<Keys>,
    plaintext: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct State {
    version: u32,
    account: AccountPickle,
    peers: BTreeMap<String, Pin>,
    sessions: BTreeMap<String, SavedSession>,
    outbox: BTreeMap<String, Outgoing>,
    history: Vec<History>,
    archive: Vec<History>,
}
fn id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
    {
        Err("INVALID_INPUT")
    } else {
        Ok(())
    }
}
fn text(value: &str) -> Result<()> {
    if value.len() > MAX_PLAINTEXT {
        Err("INPUT_TOO_LARGE")
    } else {
        Ok(())
    }
}
impl State {
    fn new() -> Self {
        let mut a = Account::new();
        a.generate_one_time_keys(20);
        Self {
            version: 1,
            account: a.pickle(),
            peers: BTreeMap::new(),
            sessions: BTreeMap::new(),
            outbox: BTreeMap::new(),
            history: vec![],
            archive: vec![],
        }
    }
    fn bundle(&self) -> Result<Value> {
        let a = self.account_copy()?;
        let prekey = a
            .one_time_keys()
            .values()
            .min_by_key(|key| key.to_base64())
            .copied()
            .ok_or("PREKEY_EXHAUSTED")?;
        Ok(
            json!({"identity":a.curve25519_key().to_base64(),"signingIdentity":a.ed25519_key().to_base64(),"prekey":prekey.to_base64()}),
        )
    }
    fn account_copy(&self) -> Result<Account> {
        // Upstream pickles are serde-owned; this clone stays strictly inside native memory.
        let bytes = serde_json::to_vec(&self.account).map_err(|_| "STATE_INVALID")?;
        Ok(Account::from_pickle(
            serde_json::from_slice(&bytes).map_err(|_| "STATE_INVALID")?,
        ))
    }
    fn pin(&self, peer: &str) -> Result<&Pin> {
        id(peer)?;
        let p = self.peers.get(peer).ok_or("UNKNOWN_PEER")?;
        if p.history_exhausted || p.pending.is_some() {
            return Err("IDENTITY_CHANGED");
        }
        Ok(p)
    }
    fn retry(&self, operation: &str) -> Result<Value> {
        let out = self.outbox.get(operation).ok_or("UNKNOWN_OPERATION")?;
        for (peer, revision) in &out.revisions {
            if self.pin(peer)?.revision != *revision {
                return Err("IDENTITY_CHANGED");
            }
        }
        Ok(json!(out.bytes))
    }
    fn apply(&mut self, request: Request) -> Result<Value> {
        match request {
            Request::Initialize {} => Err("ALREADY_EXISTS"),
            Request::Bundle {} => self.bundle(),
            Request::ObservePeer { peer, keys } => {
                id(&peer)?;
                keys.validate()?;
                if let Some(pin) = self.peers.get_mut(&peer) {
                    if !pin.history_exhausted
                        && keys != pin.current
                        && pin.pending.as_ref() != Some(&keys)
                    {
                        pin.verified = false;
                        if pin.observed.len() >= 16 {
                            // Return a committed terminal status: an error would discard quarantine.
                            pin.history_exhausted = true;
                        } else {
                            pin.observed.push(keys.clone());
                            pin.pending = Some(keys);
                        }
                    }
                } else {
                    if self.peers.len() >= MAX_PEERS {
                        return Err("CAPACITY");
                    }
                    self.peers.insert(
                        peer.clone(),
                        Pin {
                            history_exhausted: false,
                            current: keys.clone(),
                            pending: None,
                            observed: vec![keys],
                            verified: false,
                            revision: 1,
                        },
                    );
                }
                Ok(json!(self.peers[&peer]))
            }
            Request::Peer { peer } => {
                id(&peer)?;
                Ok(json!(self.peers.get(&peer).ok_or("UNKNOWN_PEER")?))
            }
            Request::AcknowledgePeer { peer, keys } => {
                id(&peer)?;
                keys.validate()?;
                let pin = self.peers.get_mut(&peer).ok_or("UNKNOWN_PEER")?;
                if pin.history_exhausted || pin.pending.as_ref() != Some(&keys) {
                    return Err("IDENTITY_CHANGED");
                }
                pin.current = keys;
                pin.pending = None;
                pin.verified = false;
                pin.revision = pin.revision.checked_add(1).ok_or("CAPACITY")?;
                self.sessions.remove(&peer);
                Ok(json!(pin))
            }
            Request::VerifyPeer { peer, keys } => {
                if self.pin(&peer)?.current != keys {
                    return Err("IDENTITY_CHANGED");
                }
                let pin = self.peers.get_mut(&peer).ok_or("UNKNOWN_PEER")?;
                pin.verified = true;
                Ok(json!(pin))
            }
            Request::Outbound { peer, prekey } => {
                let pin = self.pin(&peer)?;
                if self.sessions.contains_key(&peer) {
                    return Err("SESSION_EXISTS");
                }
                let identity = Curve25519PublicKey::from_base64(&pin.current.identity)
                    .map_err(|_| "STATE_INVALID")?;
                let prekey =
                    Curve25519PublicKey::from_base64(&prekey).map_err(|_| "INVALID_INPUT")?;
                let session = self
                    .account_copy()?
                    .create_outbound_session(SessionConfig::version_1(), identity, prekey)
                    .map_err(|_| "CRYPTO_REJECTED")?;
                self.sessions.insert(
                    peer,
                    SavedSession {
                        revision: pin.revision,
                        pickle: session.pickle(),
                    },
                );
                Ok(Value::Null)
            }
            Request::Send {
                operation,
                conversation,
                audience,
                recipients,
                plaintext,
            } => {
                id(&operation)?;
                id(&conversation)?;
                id(&audience)?;
                text(&plaintext)?;
                if recipients.is_empty()
                    || recipients.len() > 19
                    || recipients.iter().collect::<BTreeSet<_>>().len() != recipients.len()
                {
                    return Err("INVALID_INPUT");
                }
                for p in &recipients {
                    self.pin(p)?;
                }
                let input = SendInput {
                    operation: operation.clone(),
                    conversation: conversation.clone(),
                    audience: audience.clone(),
                    recipients: recipients.clone(),
                    plaintext: plaintext.clone(),
                };
                if let Some(old) = self.outbox.get(&operation) {
                    if old.input != input {
                        return Err("OPERATION_CONFLICT");
                    }
                    return self.retry(&operation);
                }
                if self.outbox.len() >= MAX_OUTBOX {
                    return Err("CAPACITY");
                }
                let sender = Keys::account(&self.account_copy()?);
                let keys: Vec<_> = recipients
                    .iter()
                    .map(|p| self.peers[p].current.clone())
                    .collect();
                if keys
                    .iter()
                    .map(|k| &k.identity)
                    .collect::<BTreeSet<_>>()
                    .len()
                    != keys.len()
                {
                    return Err("INVALID_INPUT");
                }
                let protected = serde_json::to_string(&Protected {
                    version: 1,
                    operation: operation.clone(),
                    conversation: conversation.clone(),
                    audience: audience.clone(),
                    sender: sender.clone(),
                    recipients: keys,
                    plaintext,
                })
                .map_err(|_| "INVALID_INPUT")?;
                let mut envelopes = vec![];
                let mut revisions = BTreeMap::new();
                for peer in recipients {
                    let pin = self.pin(&peer)?;
                    let revision = pin.revision;
                    let keys = pin.current.clone();
                    let saved = self.sessions.remove(&peer).ok_or("NO_SESSION")?;
                    if saved.revision != revision {
                        return Err("IDENTITY_CHANGED");
                    }
                    let mut session = Session::from_pickle(saved.pickle);
                    let (kind, bytes) = session
                        .encrypt(&protected)
                        .map_err(|_| "CRYPTO_REJECTED")?
                        .to_parts();
                    self.sessions.insert(
                        peer.clone(),
                        SavedSession {
                            revision,
                            pickle: session.pickle(),
                        },
                    );
                    revisions.insert(peer.clone(), revision);
                    envelopes.push(json!({"peer":peer,"keys":keys,"message":{"kind":kind,"body":STANDARD_NO_PAD.encode(bytes)}}));
                }
                let bytes = json!({"version":1,"operation":operation,"conversation":conversation,"audience":audience,"sender":sender,"recipients":envelopes}).to_string();
                self.outbox.insert(
                    operation,
                    Outgoing {
                        input,
                        revisions,
                        bytes: bytes.clone(),
                    },
                );
                Ok(json!(bytes))
            }
            Request::Retry { operation } => {
                id(&operation)?;
                self.retry(&operation)
            }
            Request::Receive {
                peer,
                operation,
                conversation,
                audience,
                message,
            } => {
                id(&operation)?;
                id(&conversation)?;
                id(&audience)?;
                let pin = self.pin(&peer)?;
                let sender = pin.current.clone();
                let revision = pin.revision;
                if self
                    .history
                    .iter()
                    .any(|h| h.sender.identity == sender.identity && h.operation == operation)
                {
                    return Err("REPLAY");
                }
                if self.history.len() >= MAX_HISTORY {
                    return Err("CAPACITY");
                }
                let mut account = self.account_copy()?;
                let own = Keys::account(&account);
                let message = message.decode()?;
                let (session, plaintext) = if let Some(saved) = self.sessions.remove(&peer) {
                    if saved.revision != revision {
                        return Err("IDENTITY_CHANGED");
                    }
                    let mut session = Session::from_pickle(saved.pickle);
                    let plaintext = session.decrypt(&message).map_err(|_| "CRYPTO_REJECTED")?;
                    (session, plaintext)
                } else {
                    let OlmMessage::PreKey(prekey) = message else {
                        return Err("NO_SESSION");
                    };
                    let identity = Curve25519PublicKey::from_base64(&sender.identity)
                        .map_err(|_| "STATE_INVALID")?;
                    let result = account
                        .create_inbound_session(SessionConfig::version_1(), identity, &prekey)
                        .map_err(|_| "CRYPTO_REJECTED")?;
                    (result.session, result.plaintext)
                };
                let protected: Protected =
                    serde_json::from_slice(&plaintext).map_err(|_| "INVALID_PLAINTEXT")?;
                if protected.version != 1
                    || protected.operation != operation
                    || protected.conversation != conversation
                    || protected.audience != audience
                    || protected.sender != sender
                    || !protected.recipients.contains(&own)
                    || protected.recipients.len() > 19
                    || protected
                        .recipients
                        .iter()
                        .map(|k| &k.identity)
                        .collect::<BTreeSet<_>>()
                        .len()
                        != protected.recipients.len()
                {
                    return Err("CONTEXT_MISMATCH");
                }
                text(&protected.plaintext)?;
                let record = History {
                    operation,
                    conversation,
                    audience,
                    sender,
                    plaintext: protected.plaintext,
                    archival: false,
                };
                self.history.push(record.clone());
                self.account = account.pickle();
                self.sessions.insert(
                    peer,
                    SavedSession {
                        revision,
                        pickle: session.pickle(),
                    },
                );
                Ok(json!(record))
            }
            Request::History {} | Request::ExportHistory {} => Ok(json!(self
                .history
                .iter()
                .chain(self.archive.iter())
                .collect::<Vec<_>>())),
            Request::ImportHistory { records } => {
                if self.archive.len() + records.len() > MAX_HISTORY {
                    return Err("CAPACITY");
                }
                for mut h in records {
                    id(&h.operation)?;
                    id(&h.conversation)?;
                    id(&h.audience)?;
                    h.sender.validate()?;
                    text(&h.plaintext)?;
                    h.archival = true;
                    self.archive.push(h);
                }
                Ok(Value::Null)
            }
        }
    }
}

/// Native-only transaction boundary, never exposed as a JS snapshot API.
pub fn prepare(snapshot: Option<&str>, input: &str) -> Result<(String, String)> {
    if input.len() > MAX_INPUT {
        return Err("INPUT_TOO_LARGE");
    }
    let request: Request = serde_json::from_str(input).map_err(|_| "INVALID_INPUT")?;
    let (mut state, initializing) = match snapshot {
        Some(saved) => {
            if saved.len() > MAX_STATE {
                return Err("CAPACITY");
            }
            let s: State = serde_json::from_str(saved).map_err(|_| "STATE_INVALID")?;
            if s.version != 1 {
                return Err("STATE_VERSION");
            }
            if s.peers.len() > MAX_PEERS
                || s.sessions.len() > MAX_PEERS
                || s.outbox.len() > MAX_OUTBOX
                || s.history.len() > MAX_HISTORY
                || s.archive.len() > MAX_HISTORY
                || s.peers.values().any(|p| p.observed.len() > 16)
            {
                return Err("STATE_INVALID");
            }
            (s, false)
        }
        None => {
            if !matches!(request, Request::Initialize {}) {
                return Err("NOT_INITIALIZED");
            }
            (State::new(), true)
        }
    };
    let output = if initializing {
        state.bundle()?
    } else {
        state.apply(request)?
    };
    let next = serde_json::to_string(&state).map_err(|_| "STATE_INVALID")?;
    if next.len() > MAX_STATE {
        return Err("CAPACITY");
    }
    Ok((next, output.to_string()))
}
