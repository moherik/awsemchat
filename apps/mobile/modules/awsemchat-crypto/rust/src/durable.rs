//! Native candidate transactions. Callers must seal and commit before releasing `output`.
#[path = "prekeys.rs"]
mod prekeys;
use crate::{Result, WireMessage, MAX_INPUT, MAX_PLAINTEXT};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use prekeys::{Publication, SignedPublicBundle, MAX_PUBLICATIONS, MAX_USED, TARGET_KEYS};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use vodozemac::{
    olm::{Account, AccountPickle, OlmMessage, Session, SessionConfig, SessionPickle},
    Curve25519PublicKey, Ed25519PublicKey,
};

pub const MAX_STATE: usize = 8 * 1024 * 1024;
const MAX_PEERS: usize = 64;
const MAX_OUTBOX: usize = 256;
const MAX_RETIRED_PROFILES: usize = 1024;
const MAX_HISTORY: usize = 512;
const MAX_ARCHIVE: usize = MAX_HISTORY + MAX_OUTBOX;
const MAX_PENDING_REDACTIONS: usize = MAX_ARCHIVE;
const MAX_REDACTED_OPERATIONS: usize = 4096;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Initialize {},
    Bundle {},
    PreparePublication {
        operation: String,
    },
    ConfirmPublication {
        operation: String,
    },
    SignPublication {
        operation: String,
        #[serde(rename = "accountId")]
        account_id: String,
        #[serde(rename = "deviceId")]
        device_id: String,
        generation: u64,
    },
    PrekeyStatus {},
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
    HasSession {
        peer: String,
    },
    Outbound {
        peer: String,
        bundle: SignedPublicBundle,
    },
    Send {
        #[serde(default, rename = "collectionSnapshot")]
        collection_snapshot: Option<CollectionSnapshot>,
        #[serde(default, rename = "collectionRevision")]
        collection_revision: Option<u64>,
        #[serde(default, rename = "collectionChange")]
        collection_change: Option<CollectionChange>,
        #[serde(default, rename = "profileRevision")]
        profile_revision: Option<u64>,
        #[serde(default, rename = "contentType")]
        content_type: Option<ContentType>,
        operation: String,
        conversation: String,
        audience: String,
        recipients: Vec<String>,
        plaintext: String,
        target: Option<String>,
        circle: Option<String>,
    },
    Retry {
        operation: String,
    },
    RetryDraft {
        #[serde(default, rename = "collectionSnapshot")]
        collection_snapshot: Option<CollectionSnapshot>,
        #[serde(default, rename = "collectionRevision")]
        collection_revision: Option<u64>,
        #[serde(default, rename = "collectionChange")]
        collection_change: Option<CollectionChange>,
        #[serde(default, rename = "profileRevision")]
        profile_revision: Option<u64>,
        #[serde(default, rename = "contentType")]
        content_type: Option<ContentType>,
        operation: String,
        target: Option<String>,
        circle: Option<String>,
        plaintext: String,
    },
    Receive {
        #[serde(default, rename = "collectionSnapshot")]
        collection_snapshot: Option<CollectionSnapshot>,
        #[serde(default, rename = "collectionRevision")]
        collection_revision: Option<u64>,
        #[serde(default, rename = "collectionChange")]
        collection_change: Option<CollectionChange>,
        #[serde(default, rename = "profileRevision")]
        profile_revision: Option<u64>,
        #[serde(default, rename = "contentType")]
        content_type: Option<ContentType>,
        peer: String,
        operation: String,
        conversation: String,
        audience: String,
        #[serde(default, rename = "serverEventId")]
        server_event_id: Option<String>,
        message: WireMessage,
    },
    History {},
    OutgoingHistory {},
    ConfirmSend {
        operation: String,
        event: String,
        status: String,
    },
    BeginRedaction { target: RedactionTarget, operation: String },
    PendingRedactions {},
    ConfirmRedaction { target: RedactionTarget, redaction: Redaction },
    CancelRedaction { operation: String },
    ApplyRedactions {
        #[serde(rename = "previousCursor")]
        previous_cursor: Option<String>,
        cursor: String,
        items: Vec<Redaction>,
    },
    RedactionCursor {},
    CompleteRedaction { #[serde(rename = "eventId")] event_id: String },
    RetireProfile { operation: String, envelope: String },
    ProfileRecoveryDraft { operation: String, circle: String, plaintext: String, #[serde(rename = "profileRevision")] profile_revision: u64 },
    RetireCollection { operation: String, envelope: String },
    CollectionRecoveryDraft { operation: String, circle: String, plaintext: String, #[serde(rename = "collectionRevision")] collection_revision: u64, #[serde(rename = "collectionChange")] collection_change: CollectionChange },
    InboxCursor {},
    AdvanceInboxCursor {
        previous: Option<String>,
        next: String,
    },
    CommittedReceive {
        #[serde(default, rename = "collectionSnapshot")]
        collection_snapshot: Option<CollectionSnapshot>,
        #[serde(default, rename = "collectionRevision")]
        collection_revision: Option<u64>,
        #[serde(default, rename = "collectionChange")]
        collection_change: Option<CollectionChange>,
        #[serde(default, rename = "profileRevision")]
        profile_revision: Option<u64>,
        #[serde(default, rename = "contentType")]
        content_type: Option<ContentType>,
        peer: String,
        operation: String,
        conversation: String,
        audience: String,
        #[serde(default, rename = "serverEventId")]
        server_event_id: Option<String>,
        sender: Keys,
        message: WireMessage,
    },
    ExportHistory {},
    ImportHistory {
        records: Vec<History>,
    },
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
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
    #[serde(default, rename = "collectionSnapshot", skip_serializing_if = "Option::is_none")]
    collection_snapshot: Option<CollectionSnapshot>,
    #[serde(default, rename = "collectionRevision", skip_serializing_if = "Option::is_none")]
    collection_revision: Option<u64>,
    #[serde(default, rename = "collectionChange", skip_serializing_if = "Option::is_none")]
    collection_change: Option<CollectionChange>,
    #[serde(default, rename = "profileRevision", skip_serializing_if = "Option::is_none")]
    profile_revision: Option<u64>,
    #[serde(default, rename = "contentType", skip_serializing_if = "Option::is_none")]
    content_type: Option<ContentType>,
    operation: String,
    conversation: String,
    audience: String,
    recipients: Vec<String>,
    plaintext: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    circle: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Outgoing {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sequence: Option<u64>,
    input: SendInput,
    revisions: BTreeMap<String, u32>,
    bytes: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    receipt: Option<SendReceipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    created_at: Option<u64>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SendReceipt {
    event: String,
    delivered: bool,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct History {
    #[serde(default, rename = "collectionAccepted", skip_serializing_if = "Option::is_none")]
    collection_accepted: Option<bool>,
    #[serde(default, rename = "profileAccepted", skip_serializing_if = "Option::is_none")]
    profile_accepted: Option<bool>,
    #[serde(default, rename = "collectionSnapshot", skip_serializing_if = "Option::is_none")]
    collection_snapshot: Option<CollectionSnapshot>,
    #[serde(default, rename = "collectionRevision", skip_serializing_if = "Option::is_none")]
    collection_revision: Option<u64>,
    #[serde(default, rename = "collectionChange", skip_serializing_if = "Option::is_none")]
    collection_change: Option<CollectionChange>,
    #[serde(default, rename = "profileRevision", skip_serializing_if = "Option::is_none")]
    profile_revision: Option<u64>,
    #[serde(default, rename = "contentType", skip_serializing_if = "Option::is_none")]
    content_type: Option<ContentType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    direction: Option<Direction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sequence: Option<u64>,
    #[serde(default, rename = "createdAt", skip_serializing_if = "Option::is_none")]
    created_at: Option<u64>,
    operation: String,
    conversation: String,
    audience: String,
    sender: Keys,
    plaintext: String,
    archival: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    receipt_digest: Option<String>,
    #[serde(default, rename = "serverEventId", skip_serializing_if = "Option::is_none")]
    server_event_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
struct LegacyMessageIdentity {
    conversation: String,
    audience: String,
    operation: String,
    #[serde(rename = "peerKeys")]
    peer_keys: Keys,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
struct RedactionTarget {
    #[serde(default, rename = "eventId", skip_serializing_if = "Option::is_none")]
    event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    legacy: Option<LegacyMessageIdentity>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Redaction {
    #[serde(rename = "eventId")]
    event_id: String,
    conversation: String,
    audience: String,
    operation: String,
    sender: Keys,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct RedactionRoute {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    circle: Option<String>,
    recipients: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct PendingRedaction {
    target: RedactionTarget,
    operation: String,
    #[serde(rename = "messageOperation")]
    message_operation: String,
    confirmed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    redaction: Option<Redaction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    route: Option<RedactionRoute>,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Direction {
    Incoming,
    Outgoing,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum ContentType {
    Text,
    Ping,
    Pong,
    RedactionControl,
    PrivateProfile,
    NowPlaying,
    CircleProfile,
    CircleMemberProfile,
    CircleCollection,
    CircleCollectionSnapshot,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct CollectionChange { action: CollectionAction, kind: CollectionKind, item: String }
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum CollectionAction { Add, Remove }
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum CollectionKind { Sticker, Emoji }
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct SnapshotEntry { id: String, kind: CollectionKind }
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct CollectionSnapshot { id: String, part: u16, parts: u16, items: Vec<SnapshotEntry> }
fn valid_snapshot(value: &CollectionSnapshot) -> bool {
    if id(&value.id).is_err() || value.id == "." || value.id == ".." || value.parts == 0 || value.parts > 256 || value.part >= value.parts || value.items.len() > 50 || (value.items.is_empty() && value.parts != 1) { return false; }
    let mut previous = "";
    for entry in &value.items {
        if id(&entry.id).is_err() || entry.id == "." || entry.id == ".." || entry.id.as_str() <= previous { return false; }
        previous = &entry.id;
    }
    true
}
fn validate_collection(kind: &Option<ContentType>, revision: Option<u64>, change: &Option<CollectionChange>, snapshot: &Option<CollectionSnapshot>) -> Result<()> {
    if *kind == Some(ContentType::CircleCollectionSnapshot) {
        let value = revision.ok_or("INVALID_INPUT")?;
        if value > 9_007_199_254_740_991 || change.is_some() || !snapshot.as_ref().is_some_and(valid_snapshot) { return Err("INVALID_INPUT"); }
        return Ok(());
    }
    if snapshot.is_some() { return Err("INVALID_INPUT"); }
    if *kind == Some(ContentType::CircleCollection) {
        let value = revision.ok_or("INVALID_INPUT")?;
        if value == 0 || value > 9_007_199_254_740_991 { return Err("INVALID_INPUT"); }
        let item = &change.as_ref().ok_or("INVALID_INPUT")?.item;
        id(item)?;
        if item == "." || item == ".." { return Err("INVALID_INPUT"); }
    } else if revision.is_some() || change.is_some() { return Err("INVALID_INPUT"); }
    Ok(())
}
fn validate_profile_revision(kind: &Option<ContentType>, revision: Option<u64>) -> Result<()> {
    if let Some(value) = revision {
        if *kind != Some(ContentType::CircleProfile) || value == 0 || value > 9_007_199_254_740_991 {
            return Err("INVALID_INPUT");
        }
    }
    Ok(())
}
fn valid_private_message_type(kind: &Option<ContentType>, conversation: &str, audience: &str) -> bool {
    !matches!(kind, Some(ContentType::Ping | ContentType::Pong | ContentType::NowPlaying))
        || (conversation.starts_with("private:") && audience.starts_with("friend:"))
}
fn valid_circle_message_type(kind: &Option<ContentType>, conversation: &str, audience: &str) -> bool {
    !matches!(kind, Some(ContentType::CircleMemberProfile))
        || (!conversation.starts_with("private:") && audience.starts_with("circle:"))
}
fn receive_digest(
    peer: &str,
    operation: &str,
    conversation: &str,
    audience: &str,
    server_event_id: Option<&str>,
    sender: &Keys,
    message: &WireMessage,
    content_type: &Option<ContentType>,
    profile_revision: Option<u64>,
    collection_revision: Option<u64>,
    collection_change: &Option<CollectionChange>,
    collection_snapshot: &Option<CollectionSnapshot>,
) -> Result<String> {
    let bytes = serde_json::to_vec(&(
        "awsemchat.committed-receive.v1",
        peer,
        operation,
        conversation,
        audience,
        sender,
        message.kind,
        &message.body,
    ))
    .map_err(|_| "INVALID_INPUT")?;
    let bytes = if profile_revision.is_some() {
        serde_json::to_vec(&("awsemchat.committed-receive.v3", bytes, content_type, profile_revision)).map_err(|_| "INVALID_INPUT")?
    } else if content_type.is_some() {
        serde_json::to_vec(&("awsemchat.committed-receive.v2", bytes, content_type)).map_err(|_| "INVALID_INPUT")?
    } else { bytes };
    let bytes = if collection_revision.is_some() { serde_json::to_vec(&("awsemchat.committed-receive.v4", bytes, collection_revision, collection_change)).map_err(|_| "INVALID_INPUT")? } else { bytes };
    let bytes = if collection_snapshot.is_some() { serde_json::to_vec(&("awsemchat.committed-receive.v5", bytes, collection_snapshot)).map_err(|_| "INVALID_INPUT")? } else { bytes };
    let bytes = if let Some(event_id) = server_event_id { serde_json::to_vec(&("awsemchat.committed-receive.v6", bytes, event_id)).map_err(|_| "INVALID_INPUT")? } else { bytes };
    Ok(STANDARD_NO_PAD.encode(Sha256::digest(bytes)))
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Protected {
    #[serde(default, rename = "collectionSnapshot", skip_serializing_if = "Option::is_none")]
    collection_snapshot: Option<CollectionSnapshot>,
    #[serde(default, rename = "collectionRevision", skip_serializing_if = "Option::is_none")]
    collection_revision: Option<u64>,
    #[serde(default, rename = "collectionChange", skip_serializing_if = "Option::is_none")]
    collection_change: Option<CollectionChange>,
    #[serde(default, rename = "profileRevision", skip_serializing_if = "Option::is_none")]
    profile_revision: Option<u64>,
    #[serde(default, rename = "contentType", skip_serializing_if = "Option::is_none")]
    content_type: Option<ContentType>,
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
    #[serde(default)]
    next_sequence: u64,
    version: u32,
    account: AccountPickle,
    publications: BTreeMap<String, Publication>,
    pending_publication: Option<String>,
    used_prekeys: BTreeSet<String>,
    peers: BTreeMap<String, Pin>,
    sessions: BTreeMap<String, SavedSession>,
    outbox: BTreeMap<String, Outgoing>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    retired_profiles: BTreeMap<String, String>,
    history: Vec<History>,
    archive: Vec<History>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    inbox_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pending_redactions: Vec<PendingRedaction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    redaction_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    redacted_operations: BTreeSet<String>,
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
fn valid_retired_digest(value: &str) -> bool {
    match STANDARD_NO_PAD.decode(value) {
        Ok(bytes) => bytes.len() == 32 && STANDARD_NO_PAD.encode(bytes) == value,
        Err(_) => false,
    }
}

fn validate_redaction_target(target: &RedactionTarget) -> Result<()> {
    match (&target.event_id, &target.legacy) {
        (Some(event_id), None) => id(event_id),
        (None, Some(identity)) => {
            id(&identity.conversation)?;
            id(&identity.audience)?;
            id(&identity.operation)?;
            identity.peer_keys.validate()
        }
        _ => Err("INVALID_INPUT"),
    }
}

fn validate_redaction(redaction: &Redaction) -> Result<()> {
    id(&redaction.event_id)?;
    id(&redaction.conversation)?;
    id(&redaction.audience)?;
    id(&redaction.operation)?;
    redaction.sender.validate()?;
    if let Some(cursor) = &redaction.cursor {
        if cursor.len() > 256 {
            return Err("INVALID_INPUT");
        }
        if !cursor.is_empty() {
            id(cursor)?;
        }
    }
    Ok(())
}

fn descriptor_matches(conversation: &str, audience: &str, operation: &str, sender: &Keys, redaction: &Redaction) -> bool {
    conversation == redaction.conversation && audience == redaction.audience && operation == redaction.operation && sender == &redaction.sender
}

fn target_matches_redaction(target: &RedactionTarget, redaction: &Redaction) -> bool {
    match (&target.event_id, &target.legacy) {
        (Some(event_id), None) => event_id == &redaction.event_id,
        (None, Some(identity)) => descriptor_matches(&identity.conversation, &identity.audience, &identity.operation, &identity.peer_keys, redaction),
        _ => false,
    }
}

fn redaction_matches_history(redaction: &Redaction, history: &History) -> Result<bool> {
    let descriptor = descriptor_matches(&history.conversation, &history.audience, &history.operation, &history.sender, redaction);
    match &history.server_event_id {
        Some(event_id) if event_id == &redaction.event_id => {
            if !descriptor { return Err("REDACTION_CONFLICT"); }
            Ok(true)
        }
        Some(_) => Ok(false),
        None => Ok(descriptor),
    }
}

fn history_identity(history: &History) -> String {
    history.server_event_id.clone().unwrap_or_else(|| format!("legacy:{}:{}:{}:{}:{}", history.conversation, history.audience, history.operation, history.sender.identity, history.sender.signing_identity))
}

fn target_matches_history(target: &RedactionTarget, history: &History) -> bool {
    match (&target.event_id, &target.legacy) {
        (Some(event_id), None) => history.server_event_id.as_ref() == Some(event_id),
        (None, Some(identity)) => history.conversation == identity.conversation && history.audience == identity.audience && history.operation == identity.operation && history.sender == identity.peer_keys,
        _ => false,
    }
}

fn outbox_matches_redaction(operation: &str, outbox: &Outgoing, sender: &Keys, redaction: &Redaction) -> Result<bool> {
    let descriptor = descriptor_matches(&outbox.input.conversation, &outbox.input.audience, &outbox.input.operation, sender, redaction);
    if outbox.receipt.as_ref().is_some_and(|receipt| receipt.event == redaction.event_id) {
        if !descriptor { return Err("REDACTION_CONFLICT"); }
        return Ok(true);
    }
    if outbox.receipt.is_some() || operation != redaction.operation || !descriptor {
        return Ok(false);
    }
    Ok(true)
}

impl State {
    fn new() -> Self {
        let a = Account::new();
        Self {
            next_sequence: 0,
            version: 2,
            account: a.pickle(),
            publications: BTreeMap::new(),
            pending_publication: None,
            used_prekeys: BTreeSet::new(),
            peers: BTreeMap::new(),
            sessions: BTreeMap::new(),
            outbox: BTreeMap::new(),
            retired_profiles: BTreeMap::new(),
            history: vec![],
            archive: vec![],
            inbox_cursor: None,
            pending_redactions: vec![],
            redaction_cursor: None,
            redacted_operations: BTreeSet::new(),
        }
    }
    fn bundle(&self) -> Result<Value> {
        let a = self.account_copy()?;
        Ok(json!(Keys::account(&a)))
    }
    fn sequence(&mut self) -> Result<u64> {
        self.next_sequence = self.next_sequence.checked_add(1).ok_or("CAPACITY")?;
        Ok(self.next_sequence)
    }

    fn operation_redaction_pending(&self, operation: &str) -> bool {
        self.pending_redactions.iter().any(|pending| pending.message_operation == operation && !pending.confirmed)
    }

    fn operation_redacted(&self, operation: &str) -> bool {
        self.redacted_operations.contains(operation)
    }

    fn target_message_operation(&self, target: &RedactionTarget) -> Result<String> {
        validate_redaction_target(target)?;
        let sender = Keys::account(&self.account_copy()?);
        let mut candidates = BTreeMap::<String, (&str, &str, Option<&ContentType>)>::new();
        for history in self.history.iter().chain(self.archive.iter()) {
            if history.direction == Some(Direction::Outgoing) && target_matches_history(target, history) {
                let identity = history_identity(history);
                let detail = (history.operation.as_str(), history.plaintext.as_str(), history.content_type.as_ref());
                if candidates.get(&identity).is_some_and(|saved| saved != &detail) {
                    return Err("REDACTION_CONFLICT");
                }
                candidates.insert(identity, detail);
            }
        }
        for (operation, outbox) in &self.outbox {
            let matches = match (&target.event_id, &target.legacy) {
                (Some(event_id), None) => outbox.receipt.as_ref().is_some_and(|receipt| receipt.event == *event_id),
                (None, Some(identity)) => outbox.input.conversation == identity.conversation && outbox.input.audience == identity.audience && outbox.input.operation == identity.operation && sender == identity.peer_keys,
                _ => false,
            };
            if matches {
                let identity = outbox.receipt.as_ref().map(|receipt| receipt.event.clone()).unwrap_or_else(|| format!("legacy:{}:{}:{}:{}:{}", outbox.input.conversation, outbox.input.audience, outbox.input.operation, sender.identity, sender.signing_identity));
                let detail = (operation.as_str(), outbox.input.plaintext.as_str(), outbox.input.content_type.as_ref());
                if candidates.get(&identity).is_some_and(|saved| saved != &detail) {
                    return Err("REDACTION_CONFLICT");
                }
                candidates.insert(identity, detail);
            }
        }
        if candidates.is_empty() {
            return Err("UNKNOWN_OPERATION");
        }
        let operations = candidates.values().map(|(operation, _, _)| operation).collect::<BTreeSet<_>>();
        if candidates.len() > 1 || operations.len() != 1 {
            return Err("REDACTION_CONFLICT");
        }
        candidates.into_values().next().map(|(operation, _, _)| operation.to_owned()).ok_or("UNKNOWN_OPERATION")
    }

    fn apply_one_redaction(&mut self, redaction: &Redaction, sender_only: bool) -> Result<()> {
        validate_redaction(redaction)?;
        let sender = Keys::account(&self.account_copy()?);
        let mut identities = BTreeSet::new();
        let mut operations = BTreeSet::new();
        for history in self.history.iter().chain(self.archive.iter()) {
            if sender_only && history.direction != Some(Direction::Outgoing) {
                continue;
            }
            if redaction_matches_history(redaction, history)? {
                identities.insert(history_identity(history));
                if history.direction == Some(Direction::Outgoing) {
                    operations.insert(history.operation.clone());
                }
            }
        }
        for (operation, outbox) in &self.outbox {
            if outbox_matches_redaction(operation, outbox, &sender, redaction)? {
                let identity = outbox.receipt.as_ref().map(|receipt| receipt.event.clone()).unwrap_or_else(|| format!("legacy:{}:{}:{}:{}:{}", outbox.input.conversation, outbox.input.audience, outbox.input.operation, sender.identity, sender.signing_identity));
                identities.insert(identity);
                operations.insert(operation.clone());
            }
        }
        if identities.len() > 1 {
            return Err("REDACTION_CONFLICT");
        }
        if self.redacted_operations.len().saturating_add(operations.len()) > MAX_REDACTED_OPERATIONS {
            return Err("CAPACITY");
        }
        self.history.retain(|history| {
            if sender_only && history.direction != Some(Direction::Outgoing) { return true; }
            !redaction_matches_history(redaction, history).unwrap_or(false)
        });
        self.archive.retain(|history| {
            if sender_only && history.direction != Some(Direction::Outgoing) { return true; }
            !redaction_matches_history(redaction, history).unwrap_or(false)
        });
        self.outbox.retain(|operation, outbox| !outbox_matches_redaction(operation, outbox, &sender, redaction).unwrap_or(false));
        self.redacted_operations.extend(operations);
        Ok(())
    }

    fn history_is_pending(&self, history: &History) -> bool {
        self.pending_redactions.iter().any(|pending| !pending.confirmed && target_matches_history(&pending.target, history))
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
        if self.operation_redacted(operation) { return Err("OPERATION_REDACTED"); }
        if self.operation_redaction_pending(operation) { return Err("REDACTION_PENDING"); }
        if self.retired_profiles.contains_key(operation) { return Err("OPERATION_CANCELLED"); }
        let out = self.outbox.get(operation).ok_or("UNKNOWN_OPERATION")?;
        for (peer, revision) in &out.revisions {
            if self.pin(peer)?.revision != *revision {
                return Err("IDENTITY_CHANGED");
            }
        }
        Ok(json!(out.bytes))
    }
    fn apply(&mut self, request: Request, now: u64) -> Result<Value> {
        match request {
            Request::Initialize {} => Err("ALREADY_EXISTS"),
            Request::Bundle {} => self.bundle(),
            Request::PreparePublication { operation } => {
                id(&operation)?;
                if let Some(saved) = self.publications.get(&operation) {
                    return Ok(json!(saved));
                }
                if self.pending_publication.is_some() {
                    return Err("PUBLICATION_PENDING");
                }
                if self.publications.len() >= MAX_PUBLICATIONS {
                    return Err("CAPACITY");
                }
                let mut account = self.account_copy()?;
                let publication = Publication::generate(&mut account, &operation, now)?;
                let output = json!(publication);
                self.account = account.pickle();
                self.pending_publication = Some(operation.clone());
                self.publications.insert(operation, publication);
                Ok(output)
            }
            Request::SignPublication {
                operation,
                account_id,
                device_id,
                generation,
            } => {
                id(&operation)?;
                id(&account_id)?;
                id(&device_id)?;
                if generation == 0 || generation > 9007199254740991 {
                    return Err("INVALID_INPUT");
                }
                let publication = self
                    .publications
                    .get(&operation)
                    .ok_or("UNKNOWN_OPERATION")?;
                let account = self.account_copy()?;
                publication.registration(&account, &account_id, &device_id, generation)
            }
            Request::ConfirmPublication { operation } => {
                id(&operation)?;
                if !self.publications.contains_key(&operation) {
                    return Err("UNKNOWN_OPERATION");
                }
                // An old acknowledgement must never mark a newer batch as published.
                if self.pending_publication.as_ref() == Some(&operation) {
                    let mut account = self.account_copy()?;
                    account.mark_keys_as_published();
                    self.account = account.pickle();
                    self.pending_publication = None;
                }
                Ok(Value::Null)
            }
            Request::PrekeyStatus {} => {
                let account = self.account_copy()?;
                Ok(json!({"stored":account.stored_one_time_key_count(),
                    "unpublished":account.one_time_keys().len(),"pending":self.pending_publication}))
            }
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
            Request::HasSession { peer } => {
                let pin = self.pin(&peer)?;
                Ok(json!(self
                    .sessions
                    .get(&peer)
                    .is_some_and(|s| s.revision == pin.revision)))
            }
            Request::Outbound { peer, bundle } => {
                let pin = self.pin(&peer)?;
                let prekey = bundle.verify(&pin.current, now)?;
                let use_id = bundle.use_id();
                if self.used_prekeys.contains(&use_id) {
                    return Err("PREKEY_REUSED");
                }
                if self.used_prekeys.len() >= MAX_USED {
                    return Err("CAPACITY");
                }
                if self.sessions.contains_key(&peer) {
                    return Err("SESSION_EXISTS");
                }
                let identity = Curve25519PublicKey::from_base64(&pin.current.identity)
                    .map_err(|_| "STATE_INVALID")?;
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
                self.used_prekeys.insert(use_id);
                Ok(Value::Null)
            }
            Request::Send {
                collection_snapshot,
                collection_revision,
                collection_change,
                profile_revision,
                content_type,
                operation,
                conversation,
                audience,
                recipients,
                plaintext,
                target,
                circle,
            } => {
                id(&operation)?;
                id(&conversation)?;
                id(&audience)?;
                text(&plaintext)?;
                validate_profile_revision(&content_type, profile_revision)?;
                validate_collection(&content_type, collection_revision, &collection_change, &collection_snapshot)?;
                if !valid_private_message_type(&content_type, &conversation, &audience) { return Err("INVALID_INPUT"); }
                if !valid_circle_message_type(&content_type, &conversation, &audience) { return Err("INVALID_INPUT"); }
                if matches!(content_type, Some(ContentType::CircleProfile | ContentType::CircleCollection | ContentType::CircleCollectionSnapshot)) && circle.is_none() {
                    return Err("INVALID_INPUT");
                }
                if let Some(value) = &target {
                    id(value)?;
                    if circle.is_some() || recipients.len() != 1 || recipients[0] != *value {
                        return Err("INVALID_INPUT");
                    }
                }
                if let Some(value) = &circle {
                    id(value)?;
                    if *value != conversation {
                        return Err("INVALID_INPUT");
                    }
                }
                if content_type == Some(ContentType::PrivateProfile) && (circle.is_some() || target.is_none() || recipients.len() != 1) {
                    return Err("INVALID_INPUT");
                }
                if content_type == Some(ContentType::CircleMemberProfile) && (circle.is_none() || target.is_some()) {
                    return Err("INVALID_INPUT");
                }
                if content_type == Some(ContentType::NowPlaying) && (circle.is_some() || target.is_none() || recipients.len() != 1) {
                    return Err("INVALID_INPUT");
                }
                if matches!(content_type, Some(ContentType::Ping | ContentType::Pong)) && (circle.is_some() || target.is_none() || recipients.len() != 1) {
                    return Err("INVALID_INPUT");
                }
                if (recipients.is_empty() && !matches!(content_type, Some(ContentType::CircleProfile | ContentType::CircleCollection | ContentType::CircleCollectionSnapshot)))
                    || recipients.len() > 19
                    || recipients.iter().collect::<BTreeSet<_>>().len() != recipients.len()
                {
                    return Err("INVALID_INPUT");
                }
                for p in &recipients {
                    self.pin(p)?;
                }
                let input = SendInput {
                    collection_snapshot: collection_snapshot.clone(),
                    collection_revision,
                    collection_change: collection_change.clone(),
                    profile_revision,
                    content_type: content_type.clone(),
                    target,
                    circle,
                    operation: operation.clone(),
                    conversation: conversation.clone(),
                    audience: audience.clone(),
                    recipients: recipients.clone(),
                    plaintext: plaintext.clone(),
                };
                if self.retired_profiles.contains_key(&operation) { return Err("OPERATION_CANCELLED"); }
                if self.operation_redacted(&operation) { return Err("OPERATION_REDACTED"); }
                if self.operation_redaction_pending(&operation) { return Err("REDACTION_PENDING"); }
                if let Some(old) = self.outbox.get(&operation) {
                    if old.input != input {
                        return Err("OPERATION_CONFLICT");
                    }
                    return self.retry(&operation);
                }
                if self.outbox.len() >= MAX_OUTBOX || self.outbox.len() + self.history.len() + self.archive.len() >= MAX_ARCHIVE {
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
                    collection_snapshot: collection_snapshot.clone(),
                    collection_revision,
                    collection_change: collection_change.clone(),
                    profile_revision,
                    content_type: content_type.clone(),
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
                let mut wire = json!({"version":1,"operation":operation,"conversation":conversation,"audience":audience,"sender":sender,"recipients":envelopes});
                if let Some(kind) = content_type { wire["contentType"] = json!(kind); }
                if let Some(revision) = profile_revision { wire["profileRevision"] = json!(revision); }
                if let Some(revision) = collection_revision { wire["collectionRevision"] = json!(revision); }
                if let Some(change) = collection_change { wire["collectionChange"] = json!(change); }
                if let Some(snapshot) = collection_snapshot { wire["collectionSnapshot"] = json!(snapshot); }
                let bytes = wire.to_string();
                let sequence = self.sequence()?;
                self.outbox.insert(
                    operation,
                    Outgoing {
                        sequence: Some(sequence),
                        receipt: None,
                        created_at: Some(now),
                        input,
                        revisions,
                        bytes: bytes.clone(),
                    },
                );
                Ok(json!(bytes))
            }
            Request::RetryDraft {
                collection_snapshot,
                collection_revision,
                collection_change,
                profile_revision,
                content_type,
                operation,
                target,
                circle,
                plaintext,
            } => {
                id(&operation)?;
                text(&plaintext)?;
                validate_profile_revision(&content_type, profile_revision)?;
                validate_collection(&content_type, collection_revision, &collection_change, &collection_snapshot)?;
                if matches!(content_type, Some(ContentType::Ping | ContentType::Pong)) && (circle.is_some() || target.is_none()) {
                    return Err("INVALID_INPUT");
                }
                if content_type == Some(ContentType::PrivateProfile) && (circle.is_some() || target.is_none()) {
                    return Err("INVALID_INPUT");
                }
                if content_type == Some(ContentType::CircleMemberProfile) && (circle.is_none() || target.is_some()) {
                    return Err("INVALID_INPUT");
                }
                if matches!(content_type, Some(ContentType::CircleCollection | ContentType::CircleCollectionSnapshot)) && circle.is_none() { return Err("INVALID_INPUT"); }
                if target.is_some() == circle.is_some() {
                    return Err("INVALID_INPUT");
                }
                id(target.as_ref().or(circle.as_ref()).ok_or("INVALID_INPUT")?)?;
                if self.retired_profiles.contains_key(&operation) { return Err("OPERATION_CANCELLED"); }
                if self.operation_redacted(&operation) { return Err("OPERATION_REDACTED"); }
                if self.operation_redaction_pending(&operation) { return Err("REDACTION_PENDING"); }
                let saved = self.outbox.get(&operation).ok_or("UNKNOWN_OPERATION")?;
                if !valid_private_message_type(&saved.input.content_type, &saved.input.conversation, &saved.input.audience) { return Err("INVALID_INPUT"); }
                if !valid_circle_message_type(&saved.input.content_type, &saved.input.conversation, &saved.input.audience) { return Err("INVALID_INPUT"); }
                if saved.input.target != target
                    || saved.input.content_type != content_type
                    || saved.input.collection_snapshot != collection_snapshot
                    || saved.input.collection_revision != collection_revision
                    || saved.input.collection_change != collection_change
                    || saved.input.profile_revision != profile_revision
                    || saved.input.circle != circle
                    || saved.input.plaintext != plaintext
                {
                    return Err("OPERATION_CONFLICT");
                }
                self.retry(&operation)
            }
            Request::Retry { operation } => {
                id(&operation)?;
                self.retry(&operation)
            }
            Request::Receive {
                collection_snapshot,
                collection_revision,
                collection_change,
                profile_revision,
                content_type,
                peer,
                operation,
                conversation,
                audience,
                server_event_id,
                message,
            } => {
                id(&operation)?;
                id(&conversation)?;
                id(&audience)?;
                if let Some(event_id) = &server_event_id { id(event_id)?; }
                validate_profile_revision(&content_type, profile_revision)?;
                validate_collection(&content_type, collection_revision, &collection_change, &collection_snapshot)?;
                if content_type == Some(ContentType::PrivateProfile) && (!conversation.starts_with("private:") || !audience.starts_with("friend:")) {
                    return Err("INVALID_INPUT");
                }
                if !valid_private_message_type(&content_type, &conversation, &audience) { return Err("INVALID_INPUT"); }
                if !valid_circle_message_type(&content_type, &conversation, &audience) { return Err("INVALID_INPUT"); }
                let pin = self.pin(&peer)?;
                let sender = pin.current.clone();
                let revision = pin.revision;
                let receipt_digest = receive_digest(
                    &peer,
                    &operation,
                    &conversation,
                    &audience,
                    server_event_id.as_deref(),
                    &sender,
                    &message,
                    &content_type,
                    profile_revision,
                    collection_revision,
                    &collection_change,
                    &collection_snapshot,
                )?;
                if self
                    .history
                    .iter()
                    .any(|h| h.sender.identity == sender.identity && h.operation == operation)
                {
                    return Err("REPLAY");
                }
                if self.history.len() >= MAX_HISTORY || self.outbox.len() + self.history.len() + self.archive.len() >= MAX_ARCHIVE {
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
                    || protected.content_type != content_type
                    || protected.collection_snapshot != collection_snapshot
                    || protected.collection_revision != collection_revision
                    || protected.collection_change != collection_change
                    || protected.profile_revision != profile_revision
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
                    collection_snapshot,
                    collection_accepted: if matches!(content_type, Some(ContentType::CircleCollection | ContentType::CircleCollectionSnapshot)) { Some(true) } else { None },
                    collection_revision,
                    collection_change,
                    profile_accepted: if content_type == Some(ContentType::CircleProfile) { Some(true) } else { None },
                    profile_revision,
                    content_type,
                    direction: Some(Direction::Incoming),
                    sequence: Some(self.sequence()?),
                    created_at: Some(now),
                    operation,
                    conversation,
                    audience,
                    sender,
                    plaintext: protected.plaintext,
                    archival: false,
                    receipt_digest: Some(receipt_digest),
                    server_event_id,
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
            Request::CommittedReceive {
                collection_snapshot,
                collection_revision,
                collection_change,
                profile_revision,
                content_type,
                peer,
                operation,
                conversation,
                audience,
                server_event_id,
                sender,
                message,
            } => {
                id(&peer)?;
                id(&operation)?;
                id(&conversation)?;
                id(&audience)?;
                if let Some(event_id) = &server_event_id { id(event_id)?; }
                sender.validate()?;
                validate_profile_revision(&content_type, profile_revision)?;
                validate_collection(&content_type, collection_revision, &collection_change, &collection_snapshot)?;
                let digest = receive_digest(
                    &peer,
                    &operation,
                    &conversation,
                    &audience,
                    server_event_id.as_deref(),
                    &sender,
                    &message,
                    &content_type,
                    profile_revision,
                    collection_revision,
                    &collection_change,
                    &collection_snapshot,
                )?;
                Ok(json!(self.history.iter().any(
                    |h| !h.archival && h.receipt_digest.as_ref() == Some(&digest)
                )))
            }
            Request::OutgoingHistory {} => Ok(json!(self.outbox.iter().filter(|(operation, out)| !self.operation_redaction_pending(&out.input.operation) && !self.operation_redacted(operation)).map(|(_, out)| {
                json!({"operation":out.input.operation,"conversation":out.input.conversation,"audience":out.input.audience,
                    "contentType":out.input.content_type,
                    "profileRevision":out.input.profile_revision,
                    "collectionRevision":out.input.collection_revision,
                    "collectionChange":out.input.collection_change,
                    "collectionSnapshot":out.input.collection_snapshot,
                    "recipients":out.input.recipients,"plaintext":out.input.plaintext,"target":out.input.target,"circle":out.input.circle,
                    "createdAt":out.created_at,"sequence":out.sequence,"event":out.receipt.as_ref().map(|r| &r.event),"serverEventId":out.receipt.as_ref().map(|r| &r.event),
                    "status": match &out.receipt { None => "queued", Some(r) if r.delivered => "delivered", _ => "sent" }})
            }).collect::<Vec<_>>())),
            Request::ProfileRecoveryDraft { operation, circle, plaintext, profile_revision } => {
                id(&operation)?;
                id(&circle)?;
                text(&plaintext)?;
                if self.retired_profiles.contains_key(&operation) { return Err("OPERATION_CANCELLED"); }
                let saved = self.outbox.get(&operation).ok_or("UNKNOWN_OPERATION")?;
                if saved.input.content_type != Some(ContentType::CircleProfile) || saved.input.target.is_some() { return Err("INVALID_INPUT"); }
                if saved.input.circle.as_ref() != Some(&circle) || saved.input.plaintext != plaintext || saved.input.profile_revision != Some(profile_revision) { return Err("OPERATION_CONFLICT"); }
                Ok(json!(saved.bytes))
            }
            Request::CollectionRecoveryDraft { operation, circle, plaintext, collection_revision, collection_change } => {
                id(&operation)?; id(&circle)?; text(&plaintext)?;
                if self.retired_profiles.contains_key(&operation) { return Err("OPERATION_CANCELLED"); }
                let saved = self.outbox.get(&operation).ok_or("UNKNOWN_OPERATION")?;
                if saved.input.content_type != Some(ContentType::CircleCollection) || saved.input.target.is_some() || saved.input.circle.as_ref() != Some(&circle) || saved.input.plaintext != plaintext || saved.input.collection_revision != Some(collection_revision) || saved.input.collection_change.as_ref() != Some(&collection_change) { return Err("OPERATION_CONFLICT"); }
                Ok(json!(saved.bytes))
            }
            Request::RetireProfile { operation, envelope } => {
                id(&operation)?;
                if envelope.len() > MAX_INPUT { return Err("INPUT_TOO_LARGE"); }
                let digest = STANDARD_NO_PAD.encode(Sha256::digest(envelope.as_bytes()));
                if let Some(saved) = self.retired_profiles.get(&operation) {
                    if saved != &digest { return Err("OPERATION_CONFLICT"); }
                    return Ok(Value::Null);
                }
                let saved = self.outbox.get(&operation).ok_or("UNKNOWN_OPERATION")?;
                if saved.input.content_type != Some(ContentType::CircleProfile) || saved.input.circle.is_none() { return Err("INVALID_INPUT"); }
                if saved.bytes != envelope || saved.receipt.is_some() { return Err("OPERATION_CONFLICT"); }
                if self.retired_profiles.len() >= MAX_RETIRED_PROFILES { return Err("CAPACITY"); }
                self.retired_profiles.insert(operation.clone(), digest);
                self.outbox.remove(&operation);
                Ok(Value::Null)
            }
            Request::RetireCollection { operation, envelope } => {
                id(&operation)?;
                if envelope.len() > MAX_INPUT { return Err("INPUT_TOO_LARGE"); }
                let digest = STANDARD_NO_PAD.encode(Sha256::digest(envelope.as_bytes()));
                if let Some(saved) = self.retired_profiles.get(&operation) {
                    if saved != &digest { return Err("OPERATION_CONFLICT"); }
                    return Ok(Value::Null);
                }
                let saved = self.outbox.get(&operation).ok_or("UNKNOWN_OPERATION")?;
                if saved.input.content_type != Some(ContentType::CircleCollection) || saved.input.circle.is_none() { return Err("INVALID_INPUT"); }
                if saved.bytes != envelope || saved.receipt.is_some() { return Err("OPERATION_CONFLICT"); }
                if self.retired_profiles.len() >= MAX_RETIRED_PROFILES { return Err("CAPACITY"); }
                self.retired_profiles.insert(operation.clone(), digest);
                self.outbox.remove(&operation);
                Ok(Value::Null)
            }
            Request::ConfirmSend { operation, event, status } => {
                id(&operation)?;
                id(&event)?;
                if status != "sent" && status != "delivered" { return Err("INVALID_INPUT"); }
                if self.retired_profiles.contains_key(&operation) { return Err("OPERATION_CANCELLED"); }
                if self.operation_redacted(&operation) { return Err("OPERATION_REDACTED"); }
                let out = self.outbox.get_mut(&operation).ok_or("UNKNOWN_OPERATION")?;
                if let Some(receipt) = &mut out.receipt {
                    if receipt.event != event { return Err("OPERATION_CONFLICT"); }
                    receipt.delivered |= status == "delivered";
                } else {
                    out.receipt = Some(SendReceipt { event, delivered: status == "delivered" });
                }
                Ok(Value::Null)
            }
            Request::BeginRedaction { target, operation } => {
                id(&operation)?;
                validate_redaction_target(&target)?;
                if self.operation_redacted(&operation) || self.pending_redactions.iter().any(|pending| pending.operation == operation && pending.target != target) {
                    return Err("OPERATION_CONFLICT");
                }
                if let Some(pending) = self.pending_redactions.iter().find(|pending| pending.target == target) {
                    if pending.operation != operation { return Err("OPERATION_CONFLICT"); }
                    return Ok(json!(pending));
                }
                if self.pending_redactions.iter().any(|pending| pending.operation == operation) {
                    return Err("OPERATION_CONFLICT");
                }
                if self.pending_redactions.len() >= MAX_PENDING_REDACTIONS { return Err("CAPACITY"); }
                let message_operation = self.target_message_operation(&target)?;
                let route = self.outbox.get(&message_operation).filter(|outbox| outbox.input.target.is_some() != outbox.input.circle.is_some()).map(|outbox| RedactionRoute {
                    target: outbox.input.target.clone(), circle: outbox.input.circle.clone(), recipients: outbox.input.recipients.clone(),
                });
                let pending = PendingRedaction { target, operation, message_operation, confirmed: false, redaction: None, route };
                self.pending_redactions.push(pending.clone());
                Ok(json!(pending))
            }
            Request::PendingRedactions {} => Ok(json!(self.pending_redactions)),
            Request::CancelRedaction { operation } => {
                id(&operation)?;
                let index = self.pending_redactions.iter().position(|pending| pending.operation == operation).ok_or("UNKNOWN_OPERATION")?;
                if self.pending_redactions[index].confirmed { return Err("OPERATION_CONFLICT"); }
                self.pending_redactions.remove(index);
                Ok(Value::Null)
            }
            Request::ConfirmRedaction { target, redaction } => {
                validate_redaction_target(&target)?;
                validate_redaction(&redaction)?;
                if !target_matches_redaction(&target, &redaction) { return Err("REDACTION_CONFLICT"); }
                let index = self.pending_redactions.iter().position(|pending| pending.target == target).ok_or("UNKNOWN_OPERATION")?;
                if self.pending_redactions[index].confirmed {
                    if self.pending_redactions[index].redaction.as_ref() != Some(&redaction) { return Err("REDACTION_CONFLICT"); }
                    return Ok(Value::Null);
                }
                if self.pending_redactions[index].message_operation != redaction.operation { return Err("REDACTION_CONFLICT"); }
                self.apply_one_redaction(&redaction, true)?;
                self.pending_redactions[index].confirmed = true;
                self.pending_redactions[index].redaction = Some(redaction);
                Ok(Value::Null)
            }
            Request::ApplyRedactions { previous_cursor, cursor, items } => {
                if previous_cursor != self.redaction_cursor { return Err("OPERATION_CONFLICT"); }
                if items.len() > 100 { return Err("INVALID_INPUT"); }
                if cursor.len() > 256 || (!cursor.is_empty() && id(&cursor).is_err()) || (cursor.is_empty() && !items.is_empty()) {
                    return Err("INVALID_INPUT");
                }
                let mut seen = BTreeSet::new();
                for redaction in &items {
                    validate_redaction(redaction)?;
                    if !seen.insert(redaction.event_id.clone()) { return Err("INVALID_INPUT"); }
                }
                for redaction in &items { self.apply_one_redaction(redaction, false)?; }
                self.redaction_cursor = if cursor.is_empty() { None } else { Some(cursor) };
                Ok(Value::Null)
            }
            Request::RedactionCursor {} => Ok(json!(self.redaction_cursor)),
            Request::CompleteRedaction { event_id } => {
                id(&event_id)?;
                self.pending_redactions.retain(|pending| {
                    pending.redaction.as_ref().map(|redaction| redaction.event_id.as_str()) != Some(&event_id)
                        && pending.target.event_id.as_deref() != Some(&event_id)
                });
                Ok(Value::Null)
            }
            Request::InboxCursor {} => Ok(json!(self.inbox_cursor)),
            Request::AdvanceInboxCursor { previous, next } => {
                id(&next)?;
                if let Some(value) = &previous {
                    id(value)?;
                }
                if previous != self.inbox_cursor {
                    return Err("OPERATION_CONFLICT");
                }
                self.inbox_cursor = Some(next);
                Ok(Value::Null)
            }
            Request::ExportHistory {} => {
                let sender = Keys::account(&self.account_copy()?);
                let mut records: Vec<History> = self.history.iter().chain(self.archive.iter()).filter(|history| !self.history_is_pending(history) && !(history.direction == Some(Direction::Outgoing) && self.operation_redacted(&history.operation))).cloned().collect();
                records.extend(self.outbox.iter().filter(|(operation, out)| !self.operation_redacted(operation) && !self.operation_redaction_pending(operation) && (!matches!(out.input.content_type, Some(ContentType::CircleProfile | ContentType::CircleCollection | ContentType::CircleCollectionSnapshot)) || out.receipt.is_some())).map(|(_, out)| History {
                    collection_snapshot: out.input.collection_snapshot.clone(),
                    collection_accepted: if matches!(out.input.content_type, Some(ContentType::CircleCollection | ContentType::CircleCollectionSnapshot)) { Some(true) } else { None },
                    collection_revision: out.input.collection_revision,
                    collection_change: out.input.collection_change.clone(),
                    profile_accepted: if out.input.content_type == Some(ContentType::CircleProfile) { Some(true) } else { None },
                    profile_revision: out.input.profile_revision,
                    content_type: out.input.content_type.clone(),
                    operation: out.input.operation.clone(), conversation: out.input.conversation.clone(), audience: out.input.audience.clone(),
                    sender: sender.clone(), plaintext: out.input.plaintext.clone(), archival: true, receipt_digest: None,
                    direction: Some(Direction::Outgoing), sequence: out.sequence, created_at: out.created_at,
                    server_event_id: out.receipt.as_ref().map(|receipt| receipt.event.clone()),
                }));
                Ok(json!(records))
            }
            Request::History {} => Ok(json!(self.history.iter().chain(self.archive.iter()).filter(|history| !self.history_is_pending(history) && !(history.direction == Some(Direction::Outgoing) && self.operation_redacted(&history.operation))).collect::<Vec<_>>())),
            Request::ImportHistory { records } => {
                for mut h in records {
                    id(&h.operation)?;
                    id(&h.conversation)?;
                    id(&h.audience)?;
                    if let Some(event_id) = &h.server_event_id { id(event_id)?; }
                    h.sender.validate()?;
                    text(&h.plaintext)?;
                    validate_profile_revision(&h.content_type, h.profile_revision)?;
                    validate_collection(&h.content_type, h.collection_revision, &h.collection_change, &h.collection_snapshot)?;
                    if !valid_private_message_type(&h.content_type, &h.conversation, &h.audience) { return Err("INVALID_INPUT"); }
                    if !valid_circle_message_type(&h.content_type, &h.conversation, &h.audience) { return Err("INVALID_INPUT"); }
                    if h.collection_accepted.is_some() && !matches!(h.content_type, Some(ContentType::CircleCollection | ContentType::CircleCollectionSnapshot)) { return Err("INVALID_INPUT"); }
                    if h.profile_accepted.is_some() && h.content_type != Some(ContentType::CircleProfile) { return Err("INVALID_INPUT"); }
                    h.archival = true;
                    h.sequence = None;
                    h.receipt_digest = None;
                    if h.direction == Some(Direction::Outgoing) && self.operation_redacted(&h.operation) { continue; }
                    if self.history_is_pending(&h) { continue; }
                    if self.archive.contains(&h) {
                        continue;
                    }
                    if self.archive.len() + self.history.len() + self.outbox.len() >= MAX_ARCHIVE {
                        return Err("CAPACITY");
                    }
                    self.archive.push(h);
                }
                Ok(Value::Null)
            }
        }
    }
}

/// Native-only transaction boundary, never exposed as a JS snapshot API.
pub fn prepare(snapshot: Option<&str>, input: &str) -> Result<(String, String)> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "STATE_UNAVAILABLE")?
        .as_secs();
    prepare_at(snapshot, input, now)
}

// Native-only clock seam: the Expo API cannot supply or override time.
fn prepare_at(snapshot: Option<&str>, input: &str, now: u64) -> Result<(String, String)> {
    if input.len() > MAX_STATE {
        return Err("INPUT_TOO_LARGE");
    }
    let request: Request = serde_json::from_str(input).map_err(|_| "INVALID_INPUT")?;
    if input.len() > MAX_INPUT && !matches!(request, Request::ImportHistory { .. }) {
        return Err("INPUT_TOO_LARGE");
    }
    let (mut state, initializing) = match snapshot {
        Some(saved) => {
            if saved.len() > MAX_STATE {
                return Err("CAPACITY");
            }
            let header: Value = serde_json::from_str(saved).map_err(|_| "STATE_INVALID")?;
            if header.get("version").is_none() {
                return Err("STATE_INVALID");
            }
            if header["version"] != 2 {
                return Err("STATE_VERSION");
            }
            let s: State = serde_json::from_value(header).map_err(|_| "STATE_INVALID")?;
            if s.publications.len() > MAX_PUBLICATIONS
                || s.used_prekeys.len() > MAX_USED
                || s.publications
                    .values()
                    .any(|p| p.bundles.is_empty() || p.bundles.len() > TARGET_KEYS)
                || s.pending_publication
                    .as_ref()
                    .is_some_and(|id| !s.publications.contains_key(id))
                || s.account_copy()?.stored_one_time_key_count() > TARGET_KEYS
                || s.peers.len() > MAX_PEERS
                || s.sessions.len() > MAX_PEERS
                || s.outbox.len() > MAX_OUTBOX
                || s.outbox.values().any(|out| validate_collection(&out.input.content_type, out.input.collection_revision, &out.input.collection_change, &out.input.collection_snapshot).is_err()
                    || (matches!(out.input.content_type, Some(ContentType::CircleCollection | ContentType::CircleCollectionSnapshot)) && (out.input.circle.as_ref() != Some(&out.input.conversation) || out.input.target.is_some())))
                || s.history.iter().chain(s.archive.iter()).any(|h| validate_collection(&h.content_type, h.collection_revision, &h.collection_change, &h.collection_snapshot).is_err()
                    || (h.collection_accepted.is_some() && !matches!(h.content_type, Some(ContentType::CircleCollection | ContentType::CircleCollectionSnapshot)))
                    || h.server_event_id.as_ref().is_some_and(|event_id| id(event_id).is_err()))
                || s.retired_profiles.len() > MAX_RETIRED_PROFILES
                || s.retired_profiles.iter().any(|(operation, digest)| id(operation).is_err() || s.outbox.contains_key(operation) || !valid_retired_digest(digest))
                || s.pending_redactions.len() > MAX_PENDING_REDACTIONS
                || s.pending_redactions.iter().any(|pending| validate_redaction_target(&pending.target).is_err() || id(&pending.operation).is_err() || id(&pending.message_operation).is_err()
                    || pending.confirmed != pending.redaction.is_some() || pending.redaction.as_ref().is_some_and(|redaction| validate_redaction(redaction).is_err() || !target_matches_redaction(&pending.target, redaction))
                    || pending.route.as_ref().is_some_and(|route| route.recipients.is_empty() || route.recipients.len() > 19 || route.recipients.iter().any(|recipient| id(recipient).is_err()) || route.target.as_ref().is_some_and(|value| id(value).is_err()) || route.circle.as_ref().is_some_and(|value| id(value).is_err()) || (route.target.is_some() == route.circle.is_some()) || route.recipients.iter().collect::<BTreeSet<_>>().len() != route.recipients.len()))
                || s.pending_redactions.iter().map(|pending| &pending.operation).collect::<BTreeSet<_>>().len() != s.pending_redactions.len()
                || s.pending_redactions.iter().map(|pending| &pending.target).collect::<BTreeSet<_>>().len() != s.pending_redactions.len()
                || s.redaction_cursor.as_ref().is_some_and(|cursor| cursor.is_empty() || id(cursor).is_err())
                || s.redacted_operations.len() > MAX_REDACTED_OPERATIONS
                || s.redacted_operations.iter().any(|operation| id(operation).is_err() || s.outbox.contains_key(operation))
                || s.history.len() > MAX_HISTORY
                || s.archive.len() > MAX_ARCHIVE
                || s.archive.len() + s.history.len() + s.outbox.len() > MAX_ARCHIVE
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
        state.apply(request, now)?
    };
    let next = serde_json::to_string(&state).map_err(|_| "STATE_INVALID")?;
    if next.len() > MAX_STATE {
        return Err("CAPACITY");
    }
    Ok((next, output.to_string()))
}

#[cfg(test)]
mod signed_transaction_tests {
    use super::*;
    #[test]
    fn circle_member_profile_is_valid_only_for_circle_audiences() {
        let kind = Some(ContentType::CircleMemberProfile);
        assert!(valid_circle_message_type(&kind, "circle-one", "circle:2"));
        assert!(!valid_circle_message_type(&kind, "private:abcd", "circle:2"));
        assert!(!valid_circle_message_type(&kind, "circle-one", "friend:request-one"));
    }

    #[test]
    fn now_playing_is_valid_only_for_private_friend_audiences() {
        let kind = Some(ContentType::NowPlaying);
        assert!(valid_private_message_type(&kind, &format!("private:{}", "a".repeat(64)), "friend:request-one"));
        assert!(!valid_private_message_type(&kind, "circle-one", "circle:2"));
        assert!(!valid_private_message_type(&kind, &format!("private:{}", "a".repeat(64)), "circle:2"));
    }

    #[test]
    fn expired_bundle_and_full_use_ledger_do_not_create_sessions() {
        let (bob, _) = prepare_at(None, r#"{"op":"initialize"}"#, 1000).unwrap();
        let (_, publication) = prepare_at(
            Some(&bob),
            r#"{"op":"preparePublication","operation":"initial"}"#,
            1000,
        )
        .unwrap();
        let publication: Value = serde_json::from_str(&publication).unwrap();
        let bundle = &publication["bundles"][0];
        let (alice, _) = prepare_at(None, r#"{"op":"initialize"}"#, 1000).unwrap();
        let request = json!({"op":"observePeer","peer":"bob","keys":{
            "identity":bundle["identity"],"signingIdentity":bundle["signingIdentity"]}})
        .to_string();
        let (alice, _) = prepare_at(Some(&alice), &request, 1000).unwrap();
        let request = json!({"op":"outbound","peer":"bob","bundle":bundle}).to_string();
        assert_eq!(
            prepare_at(Some(&alice), &request, 605800).err(),
            Some("BUNDLE_EXPIRED")
        );
        let mut full: State = serde_json::from_str(&alice).unwrap();
        full.used_prekeys = (0..MAX_USED).map(|i| format!("retained-{i}")).collect();
        let full = serde_json::to_string(&full).unwrap();
        assert_eq!(
            prepare_at(Some(&full), &request, 1000).err(),
            Some("CAPACITY")
        );
        let (accepted, _) = prepare_at(Some(&alice), &request, 1000).unwrap();
        let accepted: State = serde_json::from_str(&accepted).unwrap();
        assert_eq!(accepted.sessions.len(), 1);
    }
}
