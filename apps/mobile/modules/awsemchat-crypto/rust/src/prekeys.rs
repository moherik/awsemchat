use super::{id, Keys, Result};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use vodozemac::{olm::Account, Curve25519PublicKey, Ed25519PublicKey, Ed25519Signature};

const CONTEXT: &str = "awsemchat.olm.signed-prekey";
const LIFETIME: u64 = 604800;
pub(super) const TARGET_KEYS: usize = 20;
pub(super) const MAX_PUBLICATIONS: usize = 64;
pub(super) const MAX_USED: usize = 512;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SignedPublicBundle {
    version: u32,
    context: String,
    publication: String,
    key_id: String,
    pub identity: String,
    pub signing_identity: String,
    pub prekey: String,
    issued_at: u64,
    expires_at: u64,
    signature: String,
}
fn decode(value: &str, size: usize) -> Result<Vec<u8>> {
    let bytes = STANDARD_NO_PAD.decode(value).map_err(|_| "INVALID_INPUT")?;
    if bytes.len() != size || STANDARD_NO_PAD.encode(&bytes) != value {
        return Err("INVALID_INPUT");
    }
    Ok(bytes)
}
impl SignedPublicBundle {
    fn bytes(&self) -> Result<Vec<u8>> {
        if self.version != 1 || self.context != CONTEXT {
            return Err("BUNDLE_VERSION");
        }
        id(&self.publication)?;
        let mut bytes = CONTEXT.as_bytes().to_vec();
        bytes.push(0);
        bytes.extend(self.version.to_be_bytes());
        bytes.extend(decode(&self.identity, 32)?);
        bytes.extend(decode(&self.signing_identity, 32)?);
        bytes.extend(decode(&self.key_id, 8)?);
        bytes.extend(decode(&self.prekey, 32)?);
        bytes.extend(self.issued_at.to_be_bytes());
        bytes.extend(self.expires_at.to_be_bytes());
        bytes.extend((self.publication.len() as u16).to_be_bytes());
        bytes.extend(self.publication.as_bytes());
        Ok(bytes)
    }
    pub fn verify(&self, pinned: &Keys, now: u64) -> Result<Curve25519PublicKey> {
        let bytes = self.bytes()?;
        if self.identity != pinned.identity || self.signing_identity != pinned.signing_identity {
            return Err("IDENTITY_CHANGED");
        }
        decode(&self.signature, 64)?;
        let signature =
            Ed25519Signature::from_base64(&self.signature).map_err(|_| "INVALID_INPUT")?;
        let signing =
            Ed25519PublicKey::from_base64(&pinned.signing_identity).map_err(|_| "INVALID_INPUT")?;
        signing
            .verify(&bytes, &signature)
            .map_err(|_| "SIGNATURE_REJECTED")?;
        if self.issued_at.checked_add(LIFETIME) != Some(self.expires_at)
            || now < self.issued_at
            || now >= self.expires_at
        {
            return Err("BUNDLE_EXPIRED");
        }
        Curve25519PublicKey::from_base64(&self.prekey).map_err(|_| "INVALID_INPUT")
    }
    pub fn use_id(&self) -> String {
        format!("{}:{}", self.identity, self.prekey)
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Publication {
    pub bundles: Vec<SignedPublicBundle>,
}
impl Publication {
    pub(super) fn registration(
        &self,
        account: &Account,
        account_id: &str,
        device_id: &str,
        generation: u64,
    ) -> Result<serde_json::Value> {
        if self.bundles.is_empty() || self.bundles.len() > TARGET_KEYS {
            return Err("STATE_INVALID");
        }
        let own = Keys::account(account);
        let mut wire = b"awsemchat.olm.account-publication\0".to_vec();
        wire.extend(1u32.to_be_bytes());
        for value in [account_id, device_id] {
            wire.extend((value.len() as u16).to_be_bytes());
            wire.extend(value.as_bytes());
        }
        wire.extend(generation.to_be_bytes());
        wire.extend((self.bundles.len() as u16).to_be_bytes());
        for bundle in &self.bundles {
            if bundle.identity != own.identity || bundle.signing_identity != own.signing_identity {
                return Err("STATE_INVALID");
            }
            let bytes = bundle.bytes()?;
            let signature =
                Ed25519Signature::from_base64(&bundle.signature).map_err(|_| "STATE_INVALID")?;
            account
                .ed25519_key()
                .verify(&bytes, &signature)
                .map_err(|_| "STATE_INVALID")?;
            wire.extend((bytes.len() as u32).to_be_bytes());
            wire.extend(bytes);
            wire.extend(decode(&bundle.signature, 64)?);
        }
        Ok(serde_json::json!({"bundles": self.bundles, "proof": account.sign(wire).to_base64()}))
    }
    pub fn generate(account: &mut Account, operation: &str, now: u64) -> Result<Self> {
        let count = TARGET_KEYS
            .checked_sub(account.stored_one_time_key_count())
            .ok_or("STATE_INVALID")?;
        if count == 0 {
            return Err("PREKEY_CAPACITY");
        }
        if !account.one_time_keys().is_empty() {
            return Err("STATE_INVALID");
        }
        let generated = account.generate_one_time_keys(count);
        if !generated.removed.is_empty() {
            return Err("STATE_INVALID");
        }
        let mut keys: Vec<_> = account.one_time_keys().into_iter().collect();
        keys.sort_by_key(|(id, _)| id.to_base64());
        let bundles = keys
            .into_iter()
            .map(|(key_id, prekey)| {
                let mut bundle = SignedPublicBundle {
                    version: 1,
                    context: CONTEXT.into(),
                    publication: operation.into(),
                    key_id: key_id.to_base64(),
                    identity: account.curve25519_key().to_base64(),
                    signing_identity: account.ed25519_key().to_base64(),
                    prekey: prekey.to_base64(),
                    issued_at: now,
                    expires_at: now.checked_add(LIFETIME).ok_or("INVALID_INPUT")?,
                    signature: String::new(),
                };
                bundle.signature = account.sign(bundle.bytes()?).to_base64();
                Ok(bundle)
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self { bundles })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_contract_and_native_expiry_boundaries() {
        let mut account = Account::new();
        let publication = Publication::generate(&mut account, "fixture", 1000).unwrap();
        let bundle = &publication.bundles[0];
        let keys = Keys::account(&account);
        // Independent construction fixes the public wire contract, not JSON serialization order.
        let mut expected = b"awsemchat.olm.signed-prekey\0\0\0\0\x01".to_vec();
        expected.extend(account.curve25519_key().as_bytes());
        expected.extend(account.ed25519_key().as_bytes());
        expected.extend(STANDARD_NO_PAD.decode(&bundle.key_id).unwrap());
        expected.extend(STANDARD_NO_PAD.decode(&bundle.prekey).unwrap());
        expected.extend(1000u64.to_be_bytes());
        expected.extend(605800u64.to_be_bytes());
        expected.extend(b"\0\x07fixture");
        let signature = Ed25519Signature::from_base64(&bundle.signature).unwrap();
        account.ed25519_key().verify(&expected, &signature).unwrap();
        assert!(bundle.verify(&keys, 1000).is_ok());
        assert!(bundle.verify(&keys, 605799).is_ok());
        assert_eq!(bundle.verify(&keys, 999).err(), Some("BUNDLE_EXPIRED"));
        assert_eq!(bundle.verify(&keys, 605800).err(), Some("BUNDLE_EXPIRED"));
        let mut altered = bundle.clone();
        altered.expires_at += 1;
        assert_eq!(
            altered.verify(&keys, 1000).err(),
            Some("SIGNATURE_REJECTED")
        );
        altered.signature = account.sign(altered.bytes().unwrap()).to_base64();
        assert_eq!(altered.verify(&keys, 1000).err(), Some("BUNDLE_EXPIRED"));
    }
}
