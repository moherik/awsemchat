use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};
use vodozemac::{
    olm::{Account, OlmMessage, Session, SessionConfig},
    Curve25519PublicKey,
};

const MAX_INPUT: usize = 128 * 1024;
const MAX_PLAINTEXT: usize = 32 * 1024;
const MAX_HANDLES: usize = 128;
static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);
type Result<T> = std::result::Result<T, &'static str>;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    CreateAccount {},
    PublicBundle {
        account: String,
    },
    Outbound {
        account: String,
        identity: String,
        prekey: String,
    },
    Inbound {
        account: String,
        identity: String,
        message: WireMessage,
    },
    Encrypt {
        session: String,
        plaintext: String,
    },
    Decrypt {
        session: String,
        message: WireMessage,
    },
    DisposeAccount {
        account: String,
    },
    DisposeSession {
        session: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireMessage {
    kind: usize,
    body: String,
}
impl WireMessage {
    fn decode(&self) -> Result<OlmMessage> {
        let bytes = STANDARD_NO_PAD
            .decode(&self.body)
            .map_err(|_| "INVALID_INPUT")?;
        OlmMessage::from_parts(self.kind, &bytes).map_err(|_| "INVALID_INPUT")
    }
}

struct OwnedSession {
    account: String,
    session: Session,
}
#[derive(Default)]
pub struct Engine {
    accounts: HashMap<String, Account>,
    sessions: HashMap<String, OwnedSession>,
}
impl Engine {
    fn reserve(&self) -> Result<()> {
        if self.accounts.len() + self.sessions.len() >= MAX_HANDLES {
            Err("CAPACITY")
        } else {
            Ok(())
        }
    }
    fn handle(&mut self) -> Result<String> {
        NEXT_HANDLE
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
            .map(|n| n.to_string())
            .map_err(|_| "CAPACITY")
    }
    pub fn execute(&mut self, input: &str) -> String {
        let result = if input.len() > MAX_INPUT {
            Err("INPUT_TOO_LARGE")
        } else {
            serde_json::from_str(input)
                .map_err(|_| "INVALID_INPUT")
                .and_then(|r| self.apply(r))
        };
        match result {
            Ok(value) => json!({"ok": true, "value": value}).to_string(),
            Err(code) => json!({"ok": false, "code": code}).to_string(),
        }
    }
    fn apply(&mut self, request: Request) -> Result<Value> {
        match request {
            Request::CreateAccount {} => {
                self.reserve()?;
                let id = self.handle()?;
                let mut account = Account::new();
                account.generate_one_time_keys(1);
                self.accounts.insert(id.clone(), account);
                Ok(json!(id))
            }
            Request::PublicBundle { account } => {
                let a = self.accounts.get(&account).ok_or("INVALID_HANDLE")?;
                let prekey = a
                    .one_time_keys()
                    .values()
                    .next()
                    .copied()
                    .ok_or("PREKEY_EXHAUSTED")?;
                Ok(
                    json!({"identity": a.curve25519_key().to_base64(), "signingIdentity": a.ed25519_key().to_base64(), "prekey": prekey.to_base64()}),
                )
            }
            Request::Outbound {
                account,
                identity,
                prekey,
            } => {
                self.reserve()?;
                let peer =
                    Curve25519PublicKey::from_base64(&identity).map_err(|_| "INVALID_INPUT")?;
                let key = Curve25519PublicKey::from_base64(&prekey).map_err(|_| "INVALID_INPUT")?;
                let session = self
                    .accounts
                    .get(&account)
                    .ok_or("INVALID_HANDLE")?
                    .create_outbound_session(SessionConfig::version_1(), peer, key)
                    .map_err(|_| "CRYPTO_REJECTED")?;
                let id = self.handle()?;
                self.sessions
                    .insert(id.clone(), OwnedSession { account, session });
                Ok(json!(id))
            }
            Request::Inbound {
                account,
                identity,
                message,
            } => {
                self.reserve()?;
                let peer =
                    Curve25519PublicKey::from_base64(&identity).map_err(|_| "INVALID_INPUT")?;
                let OlmMessage::PreKey(prekey) = message.decode()? else {
                    return Err("INVALID_INPUT");
                };
                let result = self
                    .accounts
                    .get_mut(&account)
                    .ok_or("INVALID_HANDLE")?
                    .create_inbound_session(SessionConfig::version_1(), peer, &prekey)
                    .map_err(|_| "CRYPTO_REJECTED")?;
                let plaintext =
                    String::from_utf8(result.plaintext).map_err(|_| "INVALID_PLAINTEXT")?;
                let id = self.handle()?;
                self.sessions.insert(
                    id.clone(),
                    OwnedSession {
                        account,
                        session: result.session,
                    },
                );
                Ok(json!({"session": id, "plaintext": plaintext}))
            }
            Request::Encrypt { session, plaintext } => {
                if plaintext.len() > MAX_PLAINTEXT {
                    return Err("INPUT_TOO_LARGE");
                }
                let message = self
                    .sessions
                    .get_mut(&session)
                    .ok_or("INVALID_HANDLE")?
                    .session
                    .encrypt(plaintext)
                    .map_err(|_| "CRYPTO_REJECTED")?;
                let (kind, bytes) = message.to_parts();
                Ok(json!({"kind": kind, "body": STANDARD_NO_PAD.encode(bytes)}))
            }
            Request::Decrypt { session, message } => {
                let plaintext = self
                    .sessions
                    .get_mut(&session)
                    .ok_or("INVALID_HANDLE")?
                    .session
                    .decrypt(&message.decode()?)
                    .map_err(|_| "CRYPTO_REJECTED")?;
                Ok(json!(
                    String::from_utf8(plaintext).map_err(|_| "INVALID_PLAINTEXT")?
                ))
            }
            Request::DisposeAccount { account } => {
                self.accounts.remove(&account).ok_or("INVALID_HANDLE")?;
                self.sessions.retain(|_, s| s.account != account);
                Ok(Value::Null)
            }
            Request::DisposeSession { session } => {
                self.sessions.remove(&session).ok_or("INVALID_HANDLE")?;
                Ok(Value::Null)
            }
        }
    }
}

#[cfg(target_os = "android")]
mod android;

pub mod durable;
