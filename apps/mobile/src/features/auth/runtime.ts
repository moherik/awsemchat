import { createCircleCollectionRefresh } from '../social/circle-collection-refresh';
import { openPersonalStickerStorage } from '../stickers/personal-stickers-storage';
import { createPersonalStickerStore } from '../stickers/personal-stickers';
import { createCollectionSnapshotPublisher } from '../social/collection-snapshot-publisher';
import { nativeSnapshotPublicationVault } from '../social/snapshot-publication-storage';
import { createCircleCollectionMediaEditor } from '../social/circle-collection-media';
import { createCircleMomentPublisher } from '../messages/circle-moment-publisher';
import { createCircleMomentEditor } from '../messages/circle-moment-editor';
import { createCirclePhotoEditor } from '../messages/circle-photo-editor';
import { createCircleStickerMessageSender } from '../messages/circle-sticker-sender';
import { createPrivateMomentPublisher } from '../messages/private-moments';
import { createPrivateMomentEditor } from '../messages/private-moment-editor';
import { createPrivatePhotoEditor } from '../messages/private-photo-editor';
import { nativePrivateMomentVault } from '../messages/private-moment-storage';
import { createCircleCollectionPublisher } from '../social/circle-collection-publisher';
import { loadCircleCollection } from '../social/circle-collection-loader';
import * as Crypto from 'expo-crypto';
import { openAccountCircleMediaUpload } from '../media/account-circle-media';
import { nativeMediaUploadVault } from '../media/upload-storage';
import { createCircleMediaStorage, createPrivateMediaStorage } from '../media/api';
import { createEncryptedMedia, type MediaDescriptor } from '../media/encrypted-media';
import { createCircleAvatarMedia } from '../social/circle-avatar';
import { recoverProfileUpdate } from '../messages/profile-recovery';
import { decodeCircleProfile, type CircleAvatar } from '../social/circle-profile';
import { AuthError, createAuthAPI } from './api';
import { createSessionOwner } from './session-owner';
import { createSessionVault, installationDeviceId } from './session-vault';
import { createLoginFlow } from './login-flow';
import { bindAccountEncryption } from '../../security/bound-encryption';
import { createSocialAPI } from '../social/api';
import { createFriendsFlow } from '../social/friends-flow';
import { createCircleList } from '../social/circle-list';
import { createSavedCircleUpdates } from '../social/saved-circle-updates';
import { createCircleInvitations } from '../social/circle-invitations';
import { openAccountCircleCreation } from '../social/account-circle-creation';
import { nativeCircleCreationVault } from '../social/circle-creation-storage';
import { createCircleDetails } from '../social/circle-details';
import { createCircleMembership } from '../social/circle-membership';
import { nativeMembershipVault } from '../social/membership-vault';
import { createCircleInviteSelection } from '../social/circle-invite-selection';
import { createCircleProfileFanout } from '../social/circle-profile-fanout';
import { createCircleMemberProfileFanout } from '../social/circle-member-profile-fanout';
import { createPrivateProfileFlow } from '../social/private-profile-flow';
import { createNowPlayingSettings } from '../now-playing/settings';
import { nowPlayingBridge } from '../now-playing/bridge.native';
import { nativeNowPlayingStorage } from '../now-playing/storage';
import { createNowPlayingFanout } from '../now-playing/fanout';
import { nativePrivateProfileVault } from '../social/private-profile-storage';
import { createPrivateProfilePhotoStore } from '../social/private-profile-photo-store';
import { nativePrivateProfilePhotoStorage, nativePrivateProfilePublicationStorage } from '../social/private-profile-photo-storage';
import { createPrivateProfilePhotoPublisher } from '../social/private-profile-photo-publisher';
import { selectPrivateProfile } from '../social/private-profile';
import { privateConversationId } from '../messages/chat-destination';
import { createKeyAPI, publishAccountKeys } from '../../security/key-publication';
import { createMessageAPI } from '../messages/api';
import { createReportAPI } from '../reports/api';
import { createAccountInbox } from '../messages/account-inbox';
import { createHistoryPaginator, createInboxSynchronizer } from '../messages/inbox-sync';
import { createRedactionSynchronizer } from '../messages/redaction-sync';
import { createPrivateMessageDeletion } from '../messages/private-message-deletion';
import { createAccountSender } from '../messages/account-sender';
import { sendMessage } from '../messages/send';
import { createOutboxSynchronizer } from '../messages/outbox-sync';
import { createHistoryStore } from '../messages/history-store';
import { createConversationPreferences } from '../messages/conversation-preferences';
import { openConversationPreferenceStorage } from '../messages/conversation-preference-storage';
import { createHistoryBackup } from '../backup/history-backup';
import { createArchiveCodec } from '../backup/archive-codec';
import { createLocalBackup } from '../backup/local-backup';
import { localBackupIO } from '../backup/local-backup-io';
import { createLastLocalBackup } from '../backup/last-local-backup';
import { openLastLocalBackupStorage } from '../backup/last-local-backup-storage';
import { nativeCrypto } from '../../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';
import { createGoogleConnection } from '../backup/google-connection';
import { createGoogleIdentity } from '../backup/google-identity';
import { nativeGoogleAuthorize } from '../backup/native-google-authorizer';
import { createDriveAPI } from '../backup/drive-api';
import { createDriveBackup } from '../backup/drive-backup';
import { createNotificationAPI } from '../notifications/api';
import { nativePendingBackupVault } from '../backup/pending-vault-storage';
import { fetch as expoFetch } from 'expo/fetch';

async function initialize() {
  const origin = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://127.0.0.1:8088' : '');
  const api = createAuthAPI(origin, __DEV__);
  const device = await installationDeviceId();
  const vault = await createSessionVault(new URL(origin).origin);
  const owner = createSessionOwner(api, vault, device);
  const keys = createKeyAPI(origin, () => owner.requireSession(), __DEV__);
  let encryption: Awaited<ReturnType<typeof bindAccountEncryption>> | undefined;
  const flow = createLoginFlow(owner, async () => {
    encryption = await bindAccountEncryption(owner, new URL(origin).origin);
    await publishAccountKeys(() => owner.requireSession(), encryption, keys.publish, Crypto.randomUUID);
  }, Crypto.randomUUID);
  await flow.restore();
  const social = createSocialAPI(origin, () => owner.requireSession(), __DEV__);
  const messages = createMessageAPI(origin, () => owner.requireSession(), __DEV__);
  const notifications = createNotificationAPI(origin, () => owner.requireSession(), expoFetch as typeof fetch);
  const reports = createReportAPI(origin, () => owner.requireSession(), __DEV__);
  const friends = createFriendsFlow(social, owner);
  const circles = createCircleList(cursor => social.circles(cursor));
  const circleInvitations = createCircleInvitations(social);
  owner.subscribe(circles.reset);
  owner.subscribe(circleInvitations.reset);
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') circles.reset(); });
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') circleInvitations.reset(); });
  function currentEncryption() {
    owner.requireSession();
    if (!encryption || flow.getSnapshot().phase !== 'ready') throw new AuthError('UNAVAILABLE');
    return encryption;
  }
  const inbox = createAccountInbox(() => owner.requireSession(), () => flow.getSnapshot().phase === 'ready', () => {
    const adapter = currentEncryption(), binding = owner.requireSession();
    const isCurrent = () => {
      try {
        const value = owner.requireSession();
        return flow.getSnapshot().phase === 'ready' && value.account.id === binding.account.id && value.deviceId === binding.deviceId && value.generation === binding.generation && value.accessToken === binding.accessToken;
      } catch { return false; }
    };
    return createInboxSynchronizer(adapter, messages, createRedactionSynchronizer(adapter, messages, isCurrent));
  });
  function historyPager(conversation: string, audience: string) {
    const adapter = currentEncryption(), binding = owner.requireSession();
    const isCurrent = () => {
      try {
        const value = owner.requireSession();
        return flow.getSnapshot().phase === 'ready' && value.account.id === binding.account.id && value.deviceId === binding.deviceId && value.generation === binding.generation && value.accessToken === binding.accessToken;
      } catch { return false; }
    };
    return createHistoryPaginator(adapter, messages, createRedactionSynchronizer(adapter, messages, isCurrent));
  }
  const history = createHistoryStore(async () => {
    const adapter = currentEncryption();
    const [incoming, outgoing] = await Promise.all([adapter.history(), adapter.outgoingHistory()]);
    currentEncryption();
    return { incoming, outgoing };
  });
  owner.subscribe(history.clear);
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') history.clear(); });
  const savedCircleUpdates = createSavedCircleUpdates({ binding: () => backupBinding().binding, load: () => currentEncryption().outgoingHistory() });
  owner.subscribe(savedCircleUpdates.reset);
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') savedCircleUpdates.reset(); });
  let outbox: { adapter: ReturnType<typeof currentEncryption>; worker: ReturnType<typeof createOutboxSynchronizer> } | undefined;
  const sender = createAccountSender(() => owner.requireSession(), () => flow.getSnapshot().phase === 'ready', draft =>
    sendMessage(currentEncryption(), messages, keys, draft, (operation, peer) =>
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(['awsemchat.allocation.v1', operation, peer]))), async () => {
        const adapter = currentEncryption();
        if (!outbox || outbox.adapter !== adapter) outbox = { adapter, worker: createOutboxSynchronizer(adapter, messages) };
        await outbox.worker.run();
      }, draft => recoverProfileUpdate({ binding: () => backupBinding().binding, native: currentEncryption(), cancel: messages.cancelProfile, cleanupCancelled: async saved => {
        const profile = decodeCircleProfile(saved.plaintext); if (!profile || !saved.circleId || !saved.profileRevision) throw new Error('INVALID_PROFILE');
        if (profile.avatar) await circleAvatarMedia(saved.circleId).cancelled(profile.avatar, saved.profileRevision);
      } }, draft));
  const messageDeletion = createPrivateMessageDeletion({ account: () => { const value = backupBinding(); return { id: value.id, binding: value.binding }; }, native: currentEncryption, api: messages, operation: Crypto.randomUUID,
    route: async (redaction, operation, plaintext, originalRoute) => {
      if (!originalRoute) return 'unavailable';
      const adapter = currentEncryption(), own = await adapter.bundle();
      if (own.identity !== redaction.sender.identity || own.signingIdentity !== redaction.sender.signingIdentity) return 'unavailable';
      const target = originalRoute.target, circleId = originalRoute.circle;
      if ((target === undefined) === (circleId === undefined)) return 'unavailable';
      try {
        const context = await messages.context(circleId ? { circleId } : { targetId: target });
        const expected = [...originalRoute.recipients].sort();
        const actual = context.recipients.map(recipient => recipient.accountId).sort();
        if (context.conversation !== redaction.conversation || context.audience !== redaction.audience || JSON.stringify(actual) !== JSON.stringify(expected)) return 'unavailable';
        await sender.send({ ...(target ? { targetId: target } : { circleId }), ...(context.epoch === undefined ? {} : { expectedEpoch: context.epoch }), operation, contentType: 'redaction-control', plaintext });
        return 'committed';
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && ['DENIED', 'INVALID_INPUT', 'CONTEXT_MISMATCH', 'MESSAGE_REDACTED'].includes(String(error.code))) return 'unavailable';
        throw error;
      }
    } });
  const privateProfileControllers = new Map<string, Promise<ReturnType<typeof createPrivateProfileFlow>>>();
  const nowPlayingControllers = new Map<string, Promise<ReturnType<typeof createNowPlayingSettings>>>();
  const privateProfilePhotoStores = new Map<string, Promise<ReturnType<typeof createPrivateProfilePhotoStore>>>();
  async function syncMessages() {
    try {
      await messageDeletion.retry().catch(() => {});
      const page = await inbox.sync();
      await sender.reconcile();
      return page;
    } finally {
      if (owner.getSnapshot().status === 'ready' && flow.getSnapshot().phase === 'ready') await profileFanout.run().catch(() => {});
      if (owner.getSnapshot().status === 'ready' && flow.getSnapshot().phase === 'ready') await privateProfile().then(controller => controller.sync()).catch(() => {});
      if (owner.getSnapshot().status === 'ready' && flow.getSnapshot().phase === 'ready') await history.refresh().catch(() => {});
    }
  }
  function backupBinding() {
    const session = owner.requireSession();
    currentEncryption();
    return { id: session.account.id, binding: JSON.stringify([session.account.id, session.deviceId, session.generation, session.accessToken]) };
  }
  async function nowPlaying() {
    const session = owner.requireSession(), bound = backupBinding().binding;
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([
      'awsemchat.now-playing.preference.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation,
    ]));
    if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
    let controller = nowPlayingControllers.get(fingerprint);
    if (!controller) {
      controller = Promise.resolve(createNowPlayingSettings({ bridge: nowPlayingBridge, store: nativeNowPlayingStorage(fingerprint) }));
      nowPlayingControllers.set(fingerprint, controller);
    }
    return controller;
  }
  async function privateProfile() {
    const session = owner.requireSession(), bound = backupBinding().binding;
    currentEncryption();
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([
      'awsemchat.private.profile.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation,
    ]));
    if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
    let controller = privateProfileControllers.get(fingerprint);
    if (!controller) {
      controller = (async () => {
        const value = createPrivateProfileFlow({
          binding: () => { try { return backupBinding().binding; } catch { return ''; } },
          vault: nativePrivateProfileVault(fingerprint),
          history: async () => {
            const adapter = currentEncryption(), outgoing = await adapter.outgoingHistory();
            currentEncryption();
            return { outgoing };
          },
          acceptedFriends: (cursor, limit) => social.friends('accepted', cursor, limit),
          shareCircles: profile => circleMemberProfileFanout.run(profile),
          photoStore: await privateProfilePhotoStore(),
          operation: async (revision, requestId) => {
            const current = backupBinding().binding;
            const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([
              'awsemchat.private.profile.operation.v1', session.account.id, session.deviceId, session.generation, revision, requestId,
            ]));
            if (backupBinding().binding !== current || current !== bound) throw new AuthError('SESSION_REVOKED');
            return `profile-${revision}-${digest.slice(0, 39)}`;
          },
          publishPhoto: async input => {
            const current = backupBinding().binding;
            if (current !== bound) throw new AuthError('SESSION_REVOKED');
            const context = await messages.context({ targetId: input.targetId });
            if (backupBinding().binding !== bound || context.audience !== `friend:${input.requestId}`) throw new AuthError('SESSION_REVOKED');
            const media = createEncryptedMedia({ binding: () => backupBinding().binding, objectId: Crypto.randomUUID,
              codec: createArchiveCodec(payload => nativeCrypto().executeArchive(payload)),
              storage: createPrivateMediaStorage(origin, () => owner.requireSession(), { peerId: input.targetId, audience: context.audience }, __DEV__),
            });
            const vault = await nativePrivateProfilePublicationStorage(fingerprint, input.targetId, input.requestId);
            if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
            const publisher = createPrivateProfilePhotoPublisher({ binding: () => { try { return backupBinding().binding; } catch { return ''; } }, context: messages.context, media, vault, send: sender.send }, { peerId: input.targetId, requestId: input.requestId });
            return publisher.publish({ revision: input.revision, name: input.name, status: input.status, photo: input.photo, operation: input.operation });
          },
          send: sender.send,
        });
        await value.load();
        if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
        return value;
      })();
      privateProfileControllers.set(fingerprint, controller);
      controller.catch(() => { if (privateProfileControllers.get(fingerprint) === controller) privateProfileControllers.delete(fingerprint); });
    }
    return controller;
  }
  async function privateProfilePhotoStore() {
    const session = owner.requireSession(), bound = backupBinding().binding;
    currentEncryption();
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([
      'awsemchat.private.profile.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation,
    ]));
    if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
    let store = privateProfilePhotoStores.get(fingerprint);
    if (!store) {
      store = (async () => {
        const storage = await nativePrivateProfilePhotoStorage(fingerprint);
        if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
        return createPrivateProfilePhotoStore({ binding: () => fingerprint, storage });
      })();
      privateProfilePhotoStores.set(fingerprint, store);
      store.catch(() => { if (privateProfilePhotoStores.get(fingerprint) === store) privateProfilePhotoStores.delete(fingerprint); });
    }
    return store;
  }
  async function privateProfileForFriend(accountId: string, requestId: string) {
    const session = owner.requireSession(), bound = backupBinding().binding;
    const contact = friends.getSnapshot().lists.accepted.items.find(item => item.accountId === accountId && item.requestId === requestId && item.status === 'accepted');
    if (!contact) return { state: 'empty' as const };
    const conversation = await privateConversationId(session.account.id, accountId, value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value));
    if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
    const snapshot = history.getSnapshot();
    if (snapshot.phase !== 'ready') return { state: 'empty' as const };
    return selectPrivateProfile(snapshot, conversation, `friend:${requestId}`);
  }
  async function privateProfilePhotoBytes(peerId: string, requestId: string, avatar: MediaDescriptor) {
    const account = backupBinding().binding;
    currentEncryption();
    const contact = friends.getSnapshot().lists.accepted.items.find(item => item.accountId === peerId && item.requestId === requestId && item.status === 'accepted');
    if (!contact) throw new AuthError('UNAVAILABLE');
    const context = await messages.context({ targetId: peerId });
    if (backupBinding().binding !== account) throw new AuthError('SESSION_REVOKED');
    if (!context.conversation.startsWith('private:') || context.audience !== `friend:${requestId}` || context.recipients.length !== 1 || context.recipients[0].accountId !== peerId) throw new AuthError('UNAVAILABLE');
    const media = createEncryptedMedia({ binding: () => backupBinding().binding, objectId: Crypto.randomUUID,
      codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)),
      storage: createPrivateMediaStorage(origin, () => owner.requireSession(), { peerId, audience: context.audience }, __DEV__),
    });
    const bytes = await media.download(avatar);
    currentEncryption();
    if (backupBinding().binding !== account) throw new AuthError('SESSION_REVOKED');
    const latest = await messages.context({ targetId: peerId });
    if (backupBinding().binding !== account || latest.conversation !== context.conversation || latest.audience !== context.audience) throw new AuthError('UNAVAILABLE');
    return bytes;
  }
  const stickerBackup = { exportStickers: async () => [...await (await personalStickers()).list()],
    importStickers: async (values: import('../stickers/personal-stickers.ts').PersonalSticker[]) => (await personalStickers()).restore(values) };
  const preferenceBackup = { export: async () => (await conversationPreferences()).getSnapshot().values,
    import: async (values: import('../messages/conversation-preferences.ts').ConversationPreferences) => (await conversationPreferences()).restore(values) };
  const archive = createHistoryBackup({ account: backupBinding,
    history: { exportHistory: () => currentEncryption().exportHistory(), importHistory: records => currentEncryption().importHistory(records) },
    pendingRedactions: () => currentEncryption().pendingRedactions(),
    stickers: stickerBackup,
    preferences: preferenceBackup,
    redactions: messages,
    codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)),
  });
  const backup = createLocalBackup(archive, localBackupIO, () => backupBinding().binding);
  const fetcher: typeof fetch = (url, init) => expoFetch(String(url), init);
  const google = createGoogleConnection({ authorize: nativeGoogleAuthorize, identity: createGoogleIdentity({ fetcher }),
    binding: () => backupBinding().binding, fingerprint: async subject => {
      const session = owner.requireSession();
      return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([
        'awsemchat.google-backup.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation, subject,
      ]));
    },
  });
  owner.subscribe(google.disconnect);
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') google.disconnect(); });
  const driveAPI = createDriveAPI(google.session, { fetcher });
  const driveArchive = createHistoryBackup({ account: () => {
    const app = backupBinding(), selected = google.session();
    return { id: app.id, binding: JSON.stringify([app.binding, selected.binding, selected.accessToken]) };
  }, history: { exportHistory: () => currentEncryption().exportHistory(), importHistory: records => currentEncryption().importHistory(records) },
    pendingRedactions: () => currentEncryption().pendingRedactions(),
    stickers: stickerBackup,
    redactions: messages,
    codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)),
  });
  function driveBackup() {
    const fingerprint = google.session().binding;
    return createDriveBackup(driveArchive, driveAPI, nativePendingBackupVault(fingerprint), () => {
      backupBinding();
      return google.session().binding;
    });
  }
  const drive = { connection: google, prepare: () => driveBackup().prepare(), upload: () => driveBackup().upload(),
    acknowledge: () => driveBackup().acknowledge(), list: driveAPI.list, async restore(id: string, key: string) {
      const selected = google.session();
      const bytes = await driveAPI.download(id);
      const current = google.session();
      if (current.binding !== selected.binding || current.accessToken !== selected.accessToken) throw new Error('SESSION_REVOKED');
      const result = await driveArchive.restore(bytes, key);
      await history.refresh();
      return result;
    },
  };
  const circleCreation = () => openAccountCircleCreation({
    session: () => owner.requireSession(), ready: () => flow.getSnapshot().phase === 'ready',
    fingerprint: session => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([
      'awsemchat.pending-circle.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation,
    ])), vault: nativeCircleCreationVault, operation: Crypto.randomUUID, api: social, sender,
  });
  const detailControllers = new Map<string, ReturnType<typeof createCircleDetails>>();
  const inviteControllers = new Map<string, ReturnType<typeof createCircleInviteSelection>>();
  owner.subscribe(() => inviteControllers.clear());
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') inviteControllers.clear(); });
  owner.subscribe(() => detailControllers.clear());
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') detailControllers.clear(); });
  const collectionPublishers = new Map<string, ReturnType<typeof createCircleCollectionPublisher>>();
  owner.subscribe(() => collectionPublishers.clear());
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') collectionPublishers.clear(); });
  function circleCollectionPublisher(circleId: string) {
    currentEncryption();
    const existing = collectionPublishers.get(circleId);
    if (existing) return existing;
    const publisher = createCircleCollectionPublisher({
      account: () => backupBinding().binding,
      operation: Crypto.randomUUID,
      context: messages.context,
      send: sender.send,
      native: currentEncryption(),
      cancel: messages.cancelCollection,
      history: async () => {
        const adapter = currentEncryption();
        const [incoming, outgoing] = await Promise.all([adapter.history(), adapter.outgoingHistory()]);
        currentEncryption();
        return { incoming, outgoing };
      },
    }, circleId);
    collectionPublishers.set(circleId, publisher);
    return publisher;
  }
  const snapshotPublishers = new Map<string, ReturnType<typeof createCollectionSnapshotPublisher>>();
  owner.subscribe(() => snapshotPublishers.clear());
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') snapshotPublishers.clear(); });
  async function circleCollectionSnapshots(circleId: string) {
    currentEncryption();
    const existing = snapshotPublishers.get(circleId);
    if (existing) return existing;
    const account = backupBinding().binding;
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([account, circleId]));
    if (backupBinding().binding !== account) throw new AuthError('SESSION_REVOKED');
    const publisher = createCollectionSnapshotPublisher({
      account: () => backupBinding().binding,
      operation: Crypto.randomUUID,
      vault: nativeSnapshotPublicationVault(fingerprint, circleId),
      send: sender.send,
    }, circleId);
    snapshotPublishers.set(circleId, publisher);
    return publisher;
  }
  function circleCollection(circleId: string) {
    return loadCircleCollection({
      account: () => backupBinding().binding,
      context: messages.context,
      manifest: messages.collectionManifest,
      history: async () => {
        const adapter = currentEncryption();
        const [incoming, outgoing] = await Promise.all([adapter.history(), adapter.outgoingHistory()]);
        currentEncryption();
        return { incoming, outgoing };
      },
    }, circleId);
  }
  function circleMomentPublisher(circleId: string) {
    currentEncryption();
    const bound = backupBinding().binding;
    return createCircleMomentPublisher({
      account: () => backupBinding().binding,
      operation: Crypto.randomUUID,
      context: messages.context,
      history: async () => {
        const adapter = currentEncryption();
        const [incoming, outgoing] = await Promise.all([adapter.history(), adapter.outgoingHistory()]);
        currentEncryption();
        return { incoming, outgoing };
      },
      send: draft => {
        if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
        return sender.send(draft);
      },
    }, circleId);
  }
  const privateMomentPublishers = new Map<string, ReturnType<typeof createPrivateMomentPublisher>>();
  owner.subscribe(() => privateMomentPublishers.clear());
  flow.subscribe(() => { if (flow.getSnapshot().phase !== 'ready') privateMomentPublishers.clear(); });
  function privateMomentPublisher(peerId: string) {
    currentEncryption();
    const existing = privateMomentPublishers.get(peerId); if (existing) return existing;
    const bound = backupBinding().binding;
    const publisher = createPrivateMomentPublisher({
      account: () => backupBinding().binding, operation: Crypto.randomUUID, context: messages.context,
      history: async () => { const adapter = currentEncryption(); const [incoming, outgoing] = await Promise.all([adapter.history(), adapter.outgoingHistory()]); currentEncryption(); return { incoming, outgoing }; },
      send: draft => { if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED'); return sender.send(draft); },
    }, peerId);
    privateMomentPublishers.set(peerId, publisher); return publisher;
  }
  async function privateMomentEditor(peerId: string) {
    currentEncryption();
    const account = backupBinding(), context = await messages.context({ targetId: peerId });
    if (!context.conversation.startsWith('private:') || !context.audience.startsWith('friend:')) throw new AuthError('UNAVAILABLE');
    if (backupBinding().binding !== account.binding) throw new AuthError('SESSION_REVOKED');
    const media = createEncryptedMedia({ binding: () => backupBinding().binding, objectId: Crypto.randomUUID,
      codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)),
      storage: createPrivateMediaStorage(origin, () => owner.requireSession(), { peerId, audience: context.audience }, __DEV__),
    });
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(['awsemchat.private-moment.v1', new URL(origin).origin, account.id, owner.requireSession().deviceId, owner.requireSession().generation, peerId]));
    if (backupBinding().binding !== account.binding) throw new AuthError('SESSION_REVOKED');
    return createPrivateMomentEditor({ account: () => backupBinding().binding, operation: Crypto.randomUUID,
      context: messages.context, media, vault: nativePrivateMomentVault(fingerprint, peerId), publisher: privateMomentPublisher(peerId),
    }, peerId);
  }
  async function privatePhotoEditor(peerId: string) {
    currentEncryption();
    const account = backupBinding(), context = await messages.context({ targetId: peerId });
    if (!/^private:[a-f0-9]{64}$/.test(context.conversation) || !context.audience.startsWith('friend:')) throw new AuthError('UNAVAILABLE');
    if (backupBinding().binding !== account.binding) throw new AuthError('SESSION_REVOKED');
    const media = createEncryptedMedia({ binding: () => backupBinding().binding, objectId: Crypto.randomUUID,
      codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)),
      storage: createPrivateMediaStorage(origin, () => owner.requireSession(), { peerId, audience: context.audience }, __DEV__),
    });
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(['awsemchat.private-chat-photo.v1', new URL(origin).origin, account.id, owner.requireSession().deviceId, owner.requireSession().generation, peerId]));
    if (backupBinding().binding !== account.binding) throw new AuthError('SESSION_REVOKED');
    return createPrivatePhotoEditor({ account: () => backupBinding().binding, operation: Crypto.randomUUID,
      context: messages.context, media, vault: nativePrivateMomentVault(fingerprint, peerId, 'chat-photo'), send: sender.send,
    }, peerId);
  }
  function circleDetails(circleId: string) {
    currentEncryption();
    const existing = detailControllers.get(circleId);
    if (existing) return existing;
    const controller = createCircleDetails({
      account: () => { const account = backupBinding(); return { id: account.id, binding: account.binding }; },
      operation: Crypto.randomUUID,
      api: { circle: social.circle, context: messages.context },
      history: async () => {
        const adapter = currentEncryption();
        const [incoming, outgoing] = await Promise.all([adapter.history(), adapter.outgoingHistory()]);
        currentEncryption();
        return { incoming, outgoing };
      },
      send: sender.send,
      recoverProfile: sender.recoverProfile,
      rebindAvatar: (avatar, epoch, revision, operation) => circleAvatarMedia(circleId).rebind(avatar, epoch, revision, operation),
      avatarCommitted: (avatar, revision) => circleAvatarMedia(circleId).committed(avatar, revision),
    }, circleId);
    detailControllers.set(circleId, controller);
    return controller;
  }
  async function circleMembership(circleId: string) {
    const session = owner.requireSession(); currentEncryption();
    const bound = backupBinding();
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(['awsemchat.circle.membership.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation, circleId]));
    if (backupBinding().binding !== bound.binding) throw new AuthError('SESSION_REVOKED');
    return createCircleMembership({ account: () => { const account = backupBinding(); if (account.binding !== bound.binding) throw new AuthError('SESSION_REVOKED'); return { id: account.id, binding: JSON.stringify([new URL(origin).origin, session.account.id, session.deviceId, session.generation]) }; },
      operation: Crypto.randomUUID, vault: nativeMembershipVault(fingerprint), api: social }, circleId);
  }
  function circleInviteSelection(circleId: string) {
    currentEncryption(); const existing = inviteControllers.get(circleId); if (existing) return existing;
    const controller = createCircleInviteSelection({ account: () => { const account = backupBinding(); return { id: account.id, binding: account.binding }; }, api: social }, circleId);
    inviteControllers.set(circleId, controller); return controller;
  }
  const profileFanout = createCircleProfileFanout({ binding: () => backupBinding().binding, page: social.circles,
    share: circleId => circleDetails(circleId).shareCurrentProfile() });
  const circleMemberProfileFanout = createCircleMemberProfileFanout({
    binding: () => backupBinding().binding,
    page: social.circles,
    context: circleId => messages.context({ circleId }),
    outgoing: () => currentEncryption().outgoingHistory(),
    operation: async (revision, circleId, audience) => {
      const session = owner.requireSession(), bound = backupBinding().binding;
      const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([
        'awsemchat.circle-member-profile.operation.v1', session.account.id, session.deviceId, session.generation, circleId, audience, revision,
      ]));
      if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
      return `circle-member-profile-${digest.slice(0, 39)}`;
    },
    send: sender.send,
  });
  const nowPlayingFanout = createNowPlayingFanout({
    binding: () => backupBinding().binding,
    now: () => Date.now(),
    page: (cursor, limit) => social.friends('accepted', cursor, limit),
    context: targetId => messages.context({ targetId }),
    outgoing: () => currentEncryption().outgoingHistory(),
    operation: Crypto.randomUUID,
    send: sender.send,
  });
  async function syncNowPlaying() {
    const controller = await nowPlaying();
    if (controller.getSnapshot().phase !== 'ready') await controller.load();
    else await controller.refreshPermission();
    const state = controller.getSnapshot();
    await nowPlayingFanout.run(state.sharing ? state.track : null);
  }
  const personalStickerStores = new Map<string, Promise<ReturnType<typeof createPersonalStickerStore>>>();
  const conversationPreferenceStores = new Map<string, Promise<ReturnType<typeof createConversationPreferences>>>();
  const lastLocalBackupStores = new Map<string, Promise<ReturnType<typeof createLastLocalBackup>>>();
  function conversationPreferenceBinding() {
    try {
      const session = owner.requireSession();
      return JSON.stringify([session.account.id, session.deviceId, session.generation]);
    } catch { return ''; }
  }
  async function conversationPreferences() {
    const session = owner.requireSession();
    const binding = JSON.stringify([session.account.id, session.deviceId, session.generation]);
    const namespaceHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(['awsemchat.chat-preferences.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation]));
    if (conversationPreferenceBinding() !== binding) throw new AuthError('SESSION_REVOKED');
    const namespace = `chatprefs-${namespaceHash.slice(0, 30)}`;
    let value = conversationPreferenceStores.get(namespace);
    if (!value) {
      value = (async () => {
        const storage = await openConversationPreferenceStorage(namespace);
        if (conversationPreferenceBinding() !== binding) throw new AuthError('SESSION_REVOKED');
        const controller = createConversationPreferences({ binding: conversationPreferenceBinding, storage });
        await controller.load();
      return {
        ...controller,
        async set(conversationId: string, key: 'pinned' | 'muted' | 'pingMuted' | 'archived', enabled: boolean) {
          await controller.set(conversationId, key, enabled);
          if (key === 'muted') {
            const muted = Object.entries(controller.getSnapshot().values).filter(([, value]) => value.muted).map(([id]) => id);
            await notifications.updateMutedConversations(muted);
          }
        },
        async restore(value: unknown) {
          await controller.restore(value);
          const muted = Object.entries(controller.getSnapshot().values).filter(([, entry]) => entry.muted).map(([id]) => id);
          await notifications.updateMutedConversations(muted);
        },
      };
      })();
      conversationPreferenceStores.set(namespace, value);
      value.catch(() => { if (conversationPreferenceStores.get(namespace) === value) conversationPreferenceStores.delete(namespace); });
    }
    return value;
  }
  async function lastLocalBackup() {
    const session = owner.requireSession();
    const binding = conversationPreferenceBinding();
    backupBinding();
    const namespaceHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(['awsemchat.last-local-backup.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation]));
    if (conversationPreferenceBinding() !== binding) throw new AuthError('SESSION_REVOKED');
    const namespace = `backupmeta-${namespaceHash.slice(0, 24)}`;
    let value = lastLocalBackupStores.get(namespace);
    if (!value) {
      value = (async () => {
        const storage = await openLastLocalBackupStorage(namespace);
        if (conversationPreferenceBinding() !== binding) throw new AuthError('SESSION_REVOKED');
        return createLastLocalBackup({ binding: conversationPreferenceBinding, storage });
      })();
      lastLocalBackupStores.set(namespace, value);
      value.catch(() => { if (lastLocalBackupStores.get(namespace) === value) lastLocalBackupStores.delete(namespace); });
    }
    return value;
  }
  async function personalStickers() {
    const session = owner.requireSession(), binding = JSON.stringify([session.account.id, session.deviceId, session.generation]);
    const namespaceHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, binding);
    if (backupBinding().binding !== JSON.stringify([session.account.id, session.deviceId, session.generation, session.accessToken])) throw new AuthError('SESSION_REVOKED');
    const namespace = `stickers-${namespaceHash.slice(0, 32)}`;
    let value = personalStickerStores.get(namespace);
    if (!value) {
      value = (async () => {
        const storage = await openPersonalStickerStorage(namespace);
        const repository = createPersonalStickerStore(storage, () => `local-${Crypto.randomUUID()}`);
        return repository;
      })();
      personalStickerStores.set(namespace, value);
      value.catch(() => { if (personalStickerStores.get(namespace) === value) personalStickerStores.delete(namespace); });
    }
    return value;
  }
  const circleMediaUpload = (circleId: string, purpose: 'avatar-edit' | 'avatar-refresh' | 'collection-edit' | 'collection-refresh' | 'moment-edit' | 'chat-photo-edit' | 'sticker-message-edit' = 'avatar-edit', slot?: string) => openAccountCircleMediaUpload({
    session: () => owner.requireSession(), ready: () => { currentEncryption(); return flow.getSnapshot().phase === 'ready'; },
    fingerprint: (session, id) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(['awsemchat.circle.media-upload.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation, id, ...(purpose === 'avatar-edit' ? [] : [purpose]), ...(slot ? [slot] : [])])),
    vault: nativeMediaUploadVault, objectId: Crypto.randomUUID,
    codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)),
    storage: (id, epoch) => createCircleMediaStorage(origin, () => owner.requireSession(), { circleId: id, epoch }, __DEV__),
  }, circleId);
  async function circleMomentEditor(circleId: string) {
    currentEncryption();
    const bound = backupBinding().binding, publisher = circleMomentPublisher(circleId);
    const upload = await circleMediaUpload(circleId, 'moment-edit');
    if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
    return createCircleMomentEditor({ account: () => backupBinding().binding, operation: Crypto.randomUUID,
      context: messages.context, upload, publisher,
    }, circleId);
  }
  async function circlePhotoEditor(circleId: string) {
    currentEncryption();
    const bound = backupBinding().binding, upload = await circleMediaUpload(circleId, 'chat-photo-edit');
    if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
    return createCirclePhotoEditor({ account: () => backupBinding().binding, operation: Crypto.randomUUID, context: messages.context, upload, send: sender.send }, circleId);
  }
  async function circleStickerSender(circleId: string) {
    currentEncryption();
    const bound = backupBinding().binding, upload = await circleMediaUpload(circleId, 'sticker-message-edit');
    if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
    return createCircleStickerMessageSender({ account: () => backupBinding().binding, operation: Crypto.randomUUID, context: messages.context, upload, send: sender.send }, circleId);
  }
  async function circleCollectionMedia(circleId: string) {
    const bound = backupBinding().binding;
    const upload = await circleMediaUpload(circleId, 'collection-edit');
    if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
    return createCircleCollectionMediaEditor({
      account: () => backupBinding().binding,
      operation: Crypto.randomUUID,
      upload,
      context: messages.context,
      send: sender.send,
      history: async () => {
        const adapter = currentEncryption();
        const [incoming, outgoing] = await Promise.all([adapter.history(), adapter.outgoingHistory()]);
        currentEncryption();
        return { incoming, outgoing };
      },
    }, circleId);
  }
  async function refreshCircleCollection(circleId: string) {
    const bound = backupBinding().binding;
    const publisher = await circleCollectionSnapshots(circleId);
    const refresh = createCircleCollectionRefresh({
      account: () => backupBinding().binding,
      operation: Crypto.randomUUID,
      context: messages.context,
      load: () => circleCollection(circleId),
      download: async item => ({ bytes: await circleAvatarBytes(circleId, item.image), mimeType: item.image.media.mimeType }),
      upload: async itemId => openAccountCircleMediaUpload({
        session: () => owner.requireSession(), ready: () => { currentEncryption(); return flow.getSnapshot().phase === 'ready'; },
        fingerprint: (session, id) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(['awsemchat.circle.media-upload.v1', new URL(origin).origin, session.account.id, session.deviceId, session.generation, id, 'collection-refresh', itemId])),
        vault: nativeMediaUploadVault, objectId: Crypto.randomUUID, codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)),
        storage: (id, epoch) => createCircleMediaStorage(origin, () => owner.requireSession(), { circleId: id, epoch }, __DEV__),
      }, circleId),
      publish: (parts, operations) => publisher.publish(parts, operations),
    }, circleId);
    if (backupBinding().binding !== bound) throw new AuthError('SESSION_REVOKED');
    return refresh;
  }
  function circleAvatarBytes(circleId: string, avatar: CircleAvatar) {
    currentEncryption();
    const bound = backupBinding().binding;
    return createEncryptedMedia({ binding: () => { const current = backupBinding().binding; if (current !== bound) throw new AuthError('SESSION_REVOKED'); return current; }, objectId: Crypto.randomUUID,
      codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)), storage: createCircleMediaStorage(origin, () => owner.requireSession(), { circleId, epoch: avatar.epoch }, __DEV__),
    }).download(avatar.media);
  }
  async function syncNotificationPreferences() {
    const preferences = await conversationPreferences();
    const muted = Object.entries(preferences.getSnapshot().values).filter(([, value]) => value.muted).map(([id]) => id);
    await notifications.updateMutedConversations(muted);
  }
  function circleAvatarMedia(circleId: string) { return createCircleAvatarMedia({ upload: purpose => circleMediaUpload(circleId, purpose), download: avatar => circleAvatarBytes(circleId, avatar) }); }
  return { owner, flow, social, friends, circles, circleInvitations, circleCreation, circleDetails, circleCollection, circleCollectionPublisher, circleCollectionMedia, circleCollectionSnapshots, refreshCircleCollection, circleMomentPublisher, circleMomentEditor, circlePhotoEditor, circleStickerSender, privateMomentPublisher, privateMomentEditor, privatePhotoEditor, circleMembership, circleInviteSelection, circleMediaUpload, circleAvatarBytes, personalStickers, conversationPreferences, lastLocalBackup, notifications, syncNotificationPreferences, privateProfile, privateProfilePhotoStore, privateProfileForFriend, privateProfilePhotoBytes, nowPlaying, syncNowPlaying, savedCircleUpdates, keys, messages, reports, inbox, historyPager, sender, messageDeletion, history, syncMessages, backup, drive, developmentCode: (phone: string) => api.developmentCode(phone), encryption: currentEncryption };
}
export type AuthenticationRuntime = Awaited<ReturnType<typeof initialize>>;
let pending: Promise<AuthenticationRuntime> | undefined;
export function authenticationRuntime(): Promise<AuthenticationRuntime> {
  if (!pending) pending = initialize().catch(error => { pending = undefined; throw error; });
  return pending;
}
