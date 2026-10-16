import { runSignedPrekeyHarness } from './signed-prekey-harness';
import { runKeyServiceHarness } from './key-service-harness';
import { runCircleCreationHarness } from './circle-creation-harness';
import { createHistoryBackup } from '../features/backup/history-backup';
import { createArchiveCodec } from '../features/backup/archive-codec';
import { createLocalBackup } from '../features/backup/local-backup';
import { encryptedBackupFile } from '../features/backup/local-backup-io.native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { nativePendingBackupVault } from '../features/backup/pending-vault-storage';
import { nativeCircleCreationVault } from '../features/social/circle-creation-storage';
import { createDriveBackup } from '../features/backup/drive-backup';
import { createDriveAPI } from '../features/backup/drive-api';
import { fetch as expoFetch } from 'expo/fetch';
import { requireNativeModule } from 'expo';
import { nativeGoogleAuthorize } from '../features/backup/native-google-authorizer';
import { nativeCrypto } from '../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';
import { durableEncryption, DurableEncryptionError, type DurableEnvelope, type PeerKeys } from './durable-encryption';
const names = ['probe-durable-a', 'probe-durable-b', 'probe-durable-c', 'probe-durable-fault'];
const input = { operation: 'one', conversation: 'private-room', audience: 'room-revision-1', recipients: ['bob'], plaintext: 'synthetic durable event' };
const redactions = { redactions: async (cursor = '') => ({ items: [], cursor, more: false }) };
const pendingRedactions = async () => [];
function assert(value: boolean): asserts value { if (!value) throw new Error('ASSERTION'); }
function keys(bundle: PeerKeys): PeerKeys { return { identity: bundle.identity, signingIdentity: bundle.signingIdentity }; }
async function rejected(operation: () => Promise<unknown>, code: string) {
  try { await operation(); } catch (e) { if (e instanceof DurableEncryptionError && e.code === code) return; throw new Error('WRONG_REJECTION'); }
  throw new Error('ACCEPTED_INVALID');
}
async function control(namespace: string, action: string, input = '') {
  const response = JSON.parse(await nativeCrypto().durableProbe(namespace, action, input));
  if (response.ok !== true) throw new DurableEncryptionError(response.code); return response.value;
}
export async function runDurableCryptoHarness(phase: string) {
  if (!__DEV__) throw new Error('UNAVAILABLE');
  if (phase.startsWith('circleCreationLive')) return runCircleCreationHarness(phase);
  if (phase === 'circleCreationSeed' || phase === 'circleCreationResume') {
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, 'awsemchat.synthetic.circle-creation');
    const vault = nativeCircleCreationVault(fingerprint);
    if (phase === 'circleCreationSeed') {
      await vault.clear();
      await vault.write({ version: 1, binding: fingerprint, createOperation: 'synthetic-create', profileOperation: 'synthetic-profile',
        payload: JSON.stringify({ version: 1, name: 'Synthetic family', description: 'Private restart test', avatar: null }),
        invitees: ['synthetic-friend'], circleId: 'synthetic-circle', profileSent: false, completed: false });
      return ['NATIVE_CIRCLE_CREATION_SEED'];
    }
    const saved = await vault.read() as { circleId?: string; payload?: string; createOperation?: string; profileSent?: boolean } | null;
    assert(saved?.circleId === 'synthetic-circle' && saved.createOperation === 'synthetic-create' && saved.profileSent === false);
    assert(saved.payload?.includes('Synthetic family') === true);
    const directory = new Directory(Paths.document, 'circle-creation');
    const files = directory.list().filter(value => value instanceof File && value.name.startsWith(fingerprint));
    assert(files.length > 0);
    for (const file of files) {
      assert(file instanceof File && !(await file.text()).includes('Synthetic family'));
    }
    await vault.clear();
    assert(await vault.read() === null);
    return ['NATIVE_CIRCLE_CREATION_PROCESS_RESTART', 'ORIGINAL_CREATION_DRAFT_RETAINED', 'CREATION_ACKNOWLEDGEMENT_CLEANUP'];
  }
  if (phase === 'googleBridge') {
    const bridge = requireNativeModule<{ authorize(): Promise<unknown> }>('AwsemchatGoogleDrive');
    assert(typeof bridge.authorize === 'function');
    if (process.env.EXPO_PUBLIC_GOOGLE_DRIVE_ENABLED !== 'true') {
      try { await nativeGoogleAuthorize(); throw new Error('CONSENT_GATE_BYPASSED'); }
      catch (error) { assert(error instanceof Error && error.message === 'NOT_CONFIGURED'); }
    }
    return ['GOOGLE_NATIVE_BRIDGE_REGISTERED', 'GOOGLE_CONSENT_NOT_INVOKED'];
  }
  if (phase === 'driveResumeTransport') {
    const origin = 'http://127.0.0.1:8087';
    const api = createDriveAPI(() => ({ accessToken: 'synthetic-google-token', binding: 'synthetic-only' }),
      { origin, development: true, fetcher: (url, init) => expoFetch(String(url), init) });
    const uri = (id: string) => `${origin}/upload/drive/v3/files?upload_id=${id}`;
    const partial = await api.uploadStatus('file-one', uri('partial'), 4);
    assert(partial.phase === 'incomplete' && partial.offset === 2);
    assert((await api.upload('file-one', uri('partial'), 'YQ==', 2)).id === 'file-one');
    assert((await api.uploadStatus('file-one', uri('complete'), 4)).phase === 'complete');
    assert((await api.uploadStatus('file-one', uri('expired'), 4)).phase === 'expired');
    try { await api.uploadStatus('file-one', uri('redirect'), 4); throw new Error('ACCEPTED_REDIRECT'); }
    catch (error) { assert(error instanceof Error && error.message === 'UNAVAILABLE'); }
    return ['NATIVE_EXPO_FETCH_HTTP308_STATUS', 'NATIVE_REMAINING_CIPHERTEXT_RANGE', 'NATIVE_UPLOAD_COMPLETE_EXPIRED', 'NATIVE_REDIRECT_REJECTED'];
  }
  if (phase === 'pendingBackupSeed' || phase === 'pendingBackupResume') {
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, 'awsemchat.synthetic.pending-backup');
    const vault = nativePendingBackupVault(fingerprint);
    if (phase === 'pendingBackupSeed') {
      await vault.clear();
      await vault.write({ version: 1, binding: fingerprint, archive: 'YQ==', recoveryKey: 'a'.repeat(64), records: 1,
        id: 'synthetic-drive-id', uploadURI: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic', phase: 'prepared' });
      return ['NATIVE_PENDING_BACKUP_SEED'];
    }
    const saved = await vault.read();
    assert(saved?.id === 'synthetic-drive-id' && saved.archive === 'YQ==' && saved.recoveryKey === 'a'.repeat(64));
    const coordinator = createDriveBackup({ create: async () => { throw new Error('REENCRYPTED_PENDING'); } }, {
      generateId: async () => { throw new Error('REGENERATED_FILE_ID'); },
      beginUpload: async () => { throw new Error('RESTARTED_UPLOAD'); },
      uploadStatus: async () => ({ phase: 'incomplete', offset: 0 }),
      upload: async (id, uri, archive) => {
        assert(id === saved.id && uri === saved.uploadURI && archive === saved.archive);
        return { id, name: 'synthetic', size: 4, modifiedAt: '2026-10-12T00:00:00Z' };
      }, download: async () => 'YQ==',
    }, vault, () => fingerprint);
    const complete = await coordinator.upload();
    assert(complete.recoveryKey === saved.recoveryKey && (await vault.read())?.phase === 'uploaded');
    await coordinator.acknowledge();
    assert(await vault.read() === null);
    return ['NATIVE_PENDING_BACKUP_PROCESS_RESTART', 'ORIGINAL_FILE_BYTES_KEY_RETAINED', 'KEY_ACKNOWLEDGEMENT_CLEANUP'];
  }
  if (phase === 'keyService') return runKeyServiceHarness();
  if (phase.startsWith('prekey')) return runSignedPrekeyHarness(phase);
  const [a, b, c] = names.map(durableEncryption);
  if (phase === 'pinResume') {
    assert((await a.peer('capacity-peer')).historyExhausted);
    await rejected(() => a.retry('capacity-operation'), 'IDENTITY_CHANGED');
    await rejected(() => a.send({ ...input, operation: 'capacity-new', recipients: ['capacity-peer'] }), 'IDENTITY_CHANGED');
    return ['PIN_CAPACITY_QUARANTINE_PROCESS_RESTART'];
  }
  if (phase === 'recoverBefore') {
    await rejected(() => a.retry('one'), 'UNKNOWN_OPERATION');
    const bytes = await a.send(input); const wire: DurableEnvelope = JSON.parse(bytes);
    assert((await b.receive({ peer: 'alice', operation: 'one', conversation: input.conversation,
      audience: input.audience, message: wire.recipients[0].message })).plaintext === input.plaintext);
    return ['PROCESS_DEATH_BEFORE_COMMIT_ROLLBACK', 'RECOVERED_SEND_RECEIVE'];
  }
  if (phase === 'recoverAfter') {
    const bytes = await a.retry('two'); assert(await a.retry('two') === bytes);
    const wire: DurableEnvelope = JSON.parse(bytes);
    assert((await b.receive({ peer: 'alice', operation: 'two', conversation: input.conversation,
      audience: input.audience, message: wire.recipients[0].message })).plaintext === input.plaintext);
    assert(await control(names[0], 'compareCheckpoint', await a.retry('one')) === true);
    return ['PROCESS_DEATH_AFTER_COMMIT_RECOVERY', 'COMMITTED_RATCHET_CIPHERTEXT', 'PRIOR_CIPHERTEXT_UNCHANGED'];
  }
  if (phase === 'resume') {
    const bytes = await a.retry('one');
    assert(await control(names[0], 'compareCheckpoint', bytes) === true);
    const wire: DurableEnvelope = JSON.parse(bytes);
    assert((await a.bundle()).identity === wire.sender.identity);
    assert((await b.history()).length === 1);
    await rejected(() => b.receive({ peer: 'alice', operation: 'one', conversation: 'private-room', audience: input.audience, message: wire.recipients[0].message }), 'REPLAY');
    assert(await a.send(input) === bytes);
    return ['PROCESS_RESTART_EXACT_RETRY', 'PROCESS_RESTART_IDENTITY', 'PROCESS_RESTART_REPLAY_HISTORY'];
  }
  for (const name of names) await control(name, 'reset');
  const ab = await a.initialize(); const bb = await b.initialize(); const cb = await c.initialize();
  if (phase === 'profileType') {
    const solo = { operation: 'solo-profile', conversation: 'synthetic-solo-circle', circle: 'synthetic-solo-circle', audience: 'circle:1', recipients: [], contentType: 'circle-profile' as const, profileRevision: 1, plaintext: 'synthetic creator profile' };
    const bytes = await a.send(solo);
    assert(JSON.parse(bytes).recipients.length === 0 && !bytes.includes(solo.plaintext));
    assert(await a.retryDraft({ operation: solo.operation, circle: solo.circle, plaintext: solo.plaintext, contentType: solo.contentType, profileRevision: solo.profileRevision }) === bytes);
    assert((await a.exportHistory()).length === 0);
    await a.confirmSend({ operation: solo.operation, event: 'synthetic-accepted-profile', status: 'sent' });
    assert((await a.exportHistory())[0].contentType === 'circle-profile');
    assert((await a.exportHistory())[0].profileAccepted === true);
    await rejected(() => a.send({ ...solo, operation: 'empty-chat', contentType: 'text' }), 'INVALID_INPUT');
  }
  if (phase === 'archiveCapacity') {
    const account = () => ({ id: 'synthetic-backup-account', binding: 'synthetic-device-generation' });
    const codec = createArchiveCodec((request) => nativeCrypto().executeArchive(request));
    const records = Array.from({ length: 768 }, (_, index) => ({
      operation: `synthetic-${index}`, conversation: 'synthetic-history', audience: 'original-audience',
      sender: ab, plaintext: index === 0 ? '\u0000'.repeat(32768) : 'synthetic '.repeat(100),
      direction: index % 2 ? 'incoming' as const : 'outgoing' as const, archival: true,
    }));
    const backup = createHistoryBackup({ account, codec, redactions, pendingRedactions, history: { exportHistory: async () => records, importHistory: async () => {} } });
    const restore = createHistoryBackup({ account, codec, redactions, pendingRedactions, history: c });
    let archive = '';
    const saved = await backup.create(async (bytes) => { archive = bytes; });
    try {
      await restore.restore(archive.slice(0, -4), saved.recoveryKey);
      throw new Error('ACCEPTED_INCOMPLETE_ARCHIVE');
    } catch (error) { assert(error instanceof Error && error.message === 'ARCHIVE_REJECTED'); }
    assert((await c.history()).length === 0);
    await restore.restore(archive, saved.recoveryKey);
    await restore.restore(archive, saved.recoveryKey);
    const restored = await c.history();
    assert(restored.length === 768 && restored[0].plaintext === records[0].plaintext);
    assert(restored.every((record) => record.archival) && (await c.outgoingHistory()).length === 0);
    return ['COMPLETE_768_RECORD_NATIVE_ARCHIVE', 'ESCAPED_MAXIMUM_MESSAGE', 'TRUNCATION_PRESERVES_HISTORY', 'FULL_CAPACITY_REPEAT_RESTORE'];
  }
  await a.observePeer('bob', keys(bb)); await b.observePeer('alice', keys(ab));
  const bp = await b.preparePublication('initial'); await b.confirmPublication('initial');
  const cp = await c.preparePublication('initial'); await c.confirmPublication('initial');
  await a.outbound('bob', bp.bundles[0]);
  if (phase === 'profileType') {
    const profile = { ...input, conversation: 'synthetic-circle', circle: 'synthetic-circle', contentType: 'circle-profile' as const, profileRevision: 2 };
    const bytes = await a.send(profile);
    const wire: DurableEnvelope = JSON.parse(bytes);
    assert(wire.contentType === 'circle-profile' && await a.send(profile) === bytes);
    const incoming = { peer: 'alice', operation: profile.operation, conversation: profile.conversation, audience: profile.audience, message: wire.recipients[0].message, contentType: profile.contentType, profileRevision: profile.profileRevision };
    assert(wire.profileRevision === 2);
    await rejected(() => b.receive({ ...incoming, profileRevision: 3 }), 'CONTEXT_MISMATCH');
    await rejected(() => b.receive({ ...incoming, contentType: 'text', profileRevision: undefined }), 'CONTEXT_MISMATCH');
    assert((await b.receive(incoming)).contentType === 'circle-profile');
    assert(await b.committedReceive({ ...incoming, sender: keys(ab) }));
    assert(!await b.committedReceive({ ...incoming, sender: keys(ab), profileRevision: 3 }));
    await rejected(() => a.retryDraft({ operation: profile.operation, circle: profile.circle, plaintext: profile.plaintext, contentType: 'circle-profile', profileRevision: 3 }), 'OPERATION_CONFLICT');
    const codec = createArchiveCodec(request => nativeCrypto().executeArchive(request));
    const account = () => ({ id: 'synthetic-profile-backup', binding: 'synthetic-generation' });
    let archive = '';
    const saved = await createHistoryBackup({ account, history: b, codec, redactions, pendingRedactions }).create(async bytes => { archive = bytes; });
    await createHistoryBackup({ account, history: c, codec, redactions, pendingRedactions }).restore(archive, saved.recoveryKey);
    assert((await c.history())[0].contentType === 'circle-profile');
    assert((await c.history())[0].profileRevision === 2);
    assert((await c.history())[0].profileAccepted === true);
    return ['CREATOR_ONLY_PROFILE_NATIVE_HISTORY', 'UNACCEPTED_PROFILE_EXCLUDED_FROM_BACKUP', 'ACCEPTED_PROFILE_MARKER_RESTORED', 'EMPTY_CHAT_AUDIENCE_REJECTED', 'PROFILE_TYPE_CIPHERTEXT_BINDING', 'PROFILE_REVISION_CIPHERTEXT_BINDING', 'PROFILE_TYPE_EXACT_RETRY', 'PROFILE_TYPE_RECEIPT_PROOF', 'PROFILE_TYPE_NATIVE_ARCHIVE'];
  }
  if (phase === 'crashBefore') {
    await control(names[0], 'killBeforeCommit'); await a.send(input); throw new Error('PROCESS_NOT_KILLED');
  }
  if (phase === 'crashAfter') {
    await control(names[0], 'checkpoint', await a.send(input));
    await control(names[0], 'killAfterCommit'); await a.send({ ...input, operation: 'two' }); throw new Error('PROCESS_NOT_KILLED');
  }
  await control(names[0], 'rollback');
  await rejected(() => a.send(input), 'COMMIT_FAILED');
  await rejected(() => a.retry('one'), 'UNKNOWN_OPERATION');
  await control(names[0], 'afterCommit');
  await rejected(() => a.send(input), 'COMMIT_UNKNOWN');
  const bytes = await a.retry('one'); assert(await a.send(input) === bytes);
  const wire: DurableEnvelope = JSON.parse(bytes);
  const incoming = { peer: 'alice', operation: 'one', conversation: 'private-room', audience: input.audience, message: wire.recipients[0].message };
  await control(names[1], 'rollback'); await rejected(() => b.receive(incoming), 'COMMIT_FAILED');
  assert((await b.history()).length === 0);
  assert((await b.receive(incoming)).plaintext === input.plaintext);
  await rejected(() => b.receive(incoming), 'REPLAY');
  assert((await b.history()).length === 1);
  const reply: DurableEnvelope = JSON.parse(await b.send({ ...input, operation: 'reply', recipients: ['alice'] }));
  assert((await a.receive({ peer: 'bob', operation: 'reply', conversation: input.conversation,
    audience: input.audience, message: reply.recipients[0].message })).plaintext === input.plaintext);
  assert(await a.retry('one') === bytes);
  await rejected(() => a.send({ ...input, audience: 'changed' }), 'OPERATION_CONFLICT');
  const codec = createArchiveCodec((request) => nativeCrypto().executeArchive(request));
  const account = () => ({ id: 'synthetic-backup-account', binding: 'synthetic-device-generation' });
  const backup = createHistoryBackup({ account, history: b, codec, redactions, pendingRedactions });
  const restore = createHistoryBackup({ account, history: c, codec, redactions, pendingRedactions });
  let encryptedArchive = '';
  const saved = await backup.create(async (bytes) => { encryptedArchive = bytes; });
  assert(!encryptedArchive.includes(input.plaintext) && saved.records === 2);
  try {
    await restore.restore(encryptedArchive, '0'.repeat(64));
    throw new Error('ACCEPTED_INVALID_BACKUP');
  } catch (error) {
    assert(error instanceof Error && error.message === 'ARCHIVE_REJECTED');
  }
  assert((await c.history()).length === 0);
  await restore.restore(encryptedArchive, saved.recoveryKey);
  await restore.restore(encryptedArchive, saved.recoveryKey);
  const file = new File(Paths.cache, `synthetic-backup-${Date.now()}.awsembackup`);
  const owned = encryptedBackupFile(file.uri);
  const io = { destination: async () => owned, source: async () => ({ size: file.size, read: () => file.text() }) };
  try {
    const local = await createLocalBackup(backup, io, () => account().binding).create();
    assert(!local.cancelled);
    assert(!(await file.text()).includes(input.plaintext));
    await createLocalBackup(restore, io, () => account().binding).restore(local.recoveryKey);
  } finally { await owned.remove(); }
  const restored = await c.history();
  assert(restored.length === 2 && restored.every((record) => record.archival));
  assert(restored.some((record) => record.direction === 'outgoing'));
  assert((await c.outgoingHistory()).length === 0 && (await c.bundle()).identity === cb.identity);
  await rejected(() => c.retry('one'), 'UNKNOWN_OPERATION');
  await control(names[0], 'checkpoint', bytes);
  if (phase === 'seed') return ['RESTART_SEED_COMMITTED'];
  await a.verifyPeer('bob', keys(bb));
  assert((await a.observePeer('bob', keys(cb))).verified === false);
  await rejected(() => a.retry('one'), 'IDENTITY_CHANGED');
  await rejected(() => a.send({ ...input, operation: 'two' }), 'IDENTITY_CHANGED');
  await a.acknowledgePeer('bob', keys(cb)); await rejected(() => a.retry('one'), 'IDENTITY_CHANGED');
  await a.outbound('bob', cp.bundles[0]);
  await a.send({ ...input, operation: 'two' });
  await a.observePeer('bob', keys(bb)); await a.acknowledgePeer('bob', keys(bb));
  await rejected(() => a.retry('one'), 'IDENTITY_CHANGED');
  await a.observePeer('capacity-peer', keys(bb));
  for (let i = 0; i < 15; i++) {
    const changed = keys(i % 2 === 0 ? cb : bb);
    await a.observePeer('capacity-peer', changed); await a.acknowledgePeer('capacity-peer', changed);
  }
  await a.outbound('capacity-peer', cp.bundles[1]);
  await a.send({ ...input, operation: 'capacity-operation', recipients: ['capacity-peer'] });
  await a.verifyPeer('capacity-peer', keys(cb));
  const exhausted = await a.observePeer('capacity-peer', keys(bb));
  assert(exhausted.historyExhausted && !exhausted.verified && exhausted.observed.length === 16);
  await rejected(() => a.retry('capacity-operation'), 'IDENTITY_CHANGED');
  await rejected(() => a.send({ ...input, operation: 'capacity-new', recipients: ['capacity-peer'] }), 'IDENTITY_CHANGED');
  await rejected(() => a.acknowledgePeer('capacity-peer', keys(bb)), 'IDENTITY_CHANGED');
  assert((await a.observePeer('capacity-peer', keys(cb))).historyExhausted);
  for (const action of ['corrupt', 'wrongKey', 'deleteKey', 'deleteRow', 'wrongVersion']) {
    const name = names[3]; await control(name, 'reset');
    const fault = durableEncryption(name); await fault.initialize();
    await control(name, action);
    await rejected(() => fault.bundle(), action === 'wrongVersion' ? 'STATE_VERSION' : 'STATE_UNAVAILABLE');
    await rejected(() => fault.initialize(), 'ALREADY_EXISTS');
  }
  return ['ROLLBACK_OUTBOX', 'COMMIT_LOST_REPLY', 'EXACT_RETRY_REOPEN', 'ATOMIC_RECEIVE_REPLAY_HISTORY',
    'DURABLE_BIDIRECTIONAL', 'IMMUTABLE_AUDIENCE', 'HISTORY_ONLY_RESTORE', 'SENT_RECEIVED_HISTORY_ARCHIVE', 'PIN_CHANGE_QUARANTINE', 'IDENTITY_ROUND_TRIP', 'PIN_CAPACITY_QUARANTINE', 'CORRUPT_SEAL', 'WRONG_KEY', 'KEY_LOSS', 'MISSING_ROW', 'FORMAT_VERSION'];
}
