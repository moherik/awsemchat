import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/features/social/circle-details.ts').catch(() => ({}));
const payload = name => JSON.stringify({ version: 1, name, description: 'Our plans', avatar: null });
const avatar={epoch:1,media:{version:1,id:'avatar-one',key:'a'.repeat(64),size:100,mimeType:'image/png'}};
function fixture() {
  let binding = 'account-one', revision = 1, role = 'admin', next = 0, loseReply = false;
  const incoming = [{ operation: 'initial', conversation: 'circle-one', audience: 'circle:1', plaintext: payload('Family'), contentType: 'circle-profile', profileRevision: 1, profileAccepted: true, archival: false }];
  const outgoing = [], accepted = new Map();
  const ports = {
    account: () => ({ binding, id: 'self' }), operation: () => `edit-${++next}`,
    api: { circle: async () => ({ id: 'circle-one', epoch: 1, closed: false, memberCount: 1, members: [{ accountId: 'self', intervalId: 'interval-one', pin: 'ABCDEFGH', joinedEpoch: 1, role }] }),
      context: async () => ({ conversation: 'circle-one', circleId: 'circle-one', epoch: 1, profileRevision: revision }) },
    history: async () => structuredClone({ incoming, outgoing }),
    send: async draft => {
      let record = outgoing.find(item => item.operation === draft.operation);
      if (record) assert.deepEqual(draft, { circleId: record.circle, operation: record.operation, plaintext: record.plaintext, contentType: record.contentType, profileRevision: record.profileRevision });
      else { record = { ...draft, conversation: draft.circleId, circle: draft.circleId, target: null, status: 'queued', event: null, recipients: [], audience: 'circle:1' }; outgoing.push(record); }
      if (!accepted.has(draft.operation)) { assert.equal(draft.profileRevision, revision + 1); revision++; accepted.set(draft.operation, `event-${revision}`); }
      if (loseReply) { loseReply = false; throw Error('NETWORK'); }
      record.status = 'sent'; record.event = accepted.get(draft.operation);
      return { id: record.event, operation: draft.operation, status: 'sent' };
    },
  };
  assert.equal(typeof module.createCircleDetails, 'function', 'Circle details controller is missing');
  return { ports, outgoing, accepted, incoming, controller: module.createCircleDetails(ports, 'circle-one'), lose: () => { loseReply = true; }, replace: () => { binding = 'account-two'; }, set role(value) { role = value; }, set revision(value) { revision = value; } };
}
test('Circle details read accepted metadata and membership before permitting edits', async () => {
  const f = fixture(); await f.controller.refresh();
  const state = f.controller.getSnapshot(); assert.equal(state.profile.profile.name, 'Family'); assert.equal(state.canEdit, true); assert.equal(state.details.members.length, 1);
});
test('explicit profile recovery removes only the authoritative cancelled pending update',async()=>{
 const f=fixture();f.lose();await assert.rejects(f.controller.update(1,{name:'Home',description:'Our plans',avatar:null}));
 f.ports.recoverProfile=async draft=>{assert.equal(draft.operation,f.outgoing[0].operation);f.outgoing.splice(0,1);return'cancelled';};
 assert.equal(typeof f.controller.recover,'function','explicit profile recovery missing');assert.equal(await f.controller.recover(),'cancelled');assert.equal(f.controller.getSnapshot().pending,undefined);assert.equal(f.controller.getSnapshot().profile.profile.name,'Family');assert.equal(f.controller.getSnapshot().canEdit,false);
});
test('avatar edits bind the profile publication to the uploaded epoch and acknowledge only acceptance',async()=>{
 const f=fixture();let committed;
 f.ports.avatarCommitted=async value=>{committed=value;};
 const send=f.ports.send;f.ports.send=async draft=>{assert.equal(draft.expectedEpoch,1);const {expectedEpoch,...legacy}=draft;return send(legacy);};
 await f.controller.update(1,{name:'Family',description:'Our plans',avatar});assert.deepEqual(committed,avatar);
 await assert.rejects(f.controller.update(2,{name:'Family',description:'Our plans',avatar:{...avatar,epoch:2}}),/AVATAR_EPOCH_CHANGED/);
});
test('lost avatar profile replies retry the original avatar epoch before acknowledging media',async()=>{
 const f=fixture();f.lose();const epochs=[];let committed=0;
 const send=f.ports.send;f.ports.send=async draft=>{epochs.push(draft.expectedEpoch);const {expectedEpoch,...legacy}=draft;return send(legacy);};
 f.ports.avatarCommitted=async()=>{committed++;};
 await assert.rejects(f.controller.update(1,{name:'Family',description:'Our plans',avatar}),/NETWORK/);assert.equal(committed,0);
 await f.controller.retry();assert.deepEqual(epochs,[1,1]);assert.equal(committed,1);
});
test('joined-member profile maintenance publishes a fresh avatar copy instead of the old grant',async()=>{
 const f=fixture();f.incoming[0].plaintext=JSON.stringify({version:1,name:'Family',description:'Our plans',avatar});
 const details=f.ports.api.circle,context=f.ports.api.context;f.ports.api.circle=async()=>({...await details(),epoch:2});f.ports.api.context=async()=>({...await context(),epoch:2});
 const fresh={epoch:2,media:{...avatar.media,id:'avatar-two',key:'b'.repeat(64)}};let committed;
 f.ports.rebindAvatar=async(old,epoch,revision)=>{assert.deepEqual(old,avatar);assert.equal(epoch,2);assert.equal(revision,1);return fresh;};
 f.ports.avatarCommitted=async value=>{committed=value;};
 const send=f.ports.send;f.ports.send=async draft=>{assert.equal(draft.expectedEpoch,2);const {expectedEpoch,...legacy}=draft;return send(legacy);};
 await f.controller.shareCurrentProfile();assert.deepEqual(JSON.parse(f.outgoing[0].plaintext).avatar,fresh);assert.deepEqual(committed,fresh);
});
test('name changes after membership changes preserve the avatar through a fresh authorized copy',async()=>{
 const f=fixture();f.incoming[0].plaintext=JSON.stringify({version:1,name:'Family',description:'Our plans',avatar});
 const details=f.ports.api.circle,context=f.ports.api.context;f.ports.api.circle=async()=>({...await details(),epoch:2});f.ports.api.context=async()=>({...await context(),epoch:2});
 const fresh={epoch:2,media:{...avatar.media,id:'fresh-photo'}};f.ports.rebindAvatar=async()=>fresh;
 const send=f.ports.send;f.ports.send=async draft=>{assert.equal(draft.expectedEpoch,2);const {expectedEpoch,...legacy}=draft;return send(legacy);};
 await f.controller.update(1,{name:'Home',description:'Our plans',avatar});assert.deepEqual(JSON.parse(f.outgoing[0].plaintext).avatar,fresh);assert.equal(f.controller.getSnapshot().profile.profile.name,'Home');
});
test('editing publishes the next authenticated revision and projects its accepted content', async () => {
  const f = fixture(); await f.controller.refresh(); await f.controller.update(1, { name: 'Home', description: 'Our plans', avatar: null });
  assert.equal(f.outgoing[0].profileRevision, 2); assert.equal(f.outgoing[0].contentType, 'circle-profile');
  assert.equal(f.controller.getSnapshot().profile.profile.name, 'Home'); assert.equal(f.controller.getSnapshot().profile.revision, 2);
});
test('lost edit response reopens and retries the exact native outbox operation', async () => {
  const f = fixture(); await f.controller.refresh(); f.lose(); await assert.rejects(f.controller.update(1, { name: 'Home', description: 'Our plans', avatar: null }));
  assert.equal(f.controller.getSnapshot().pending.profile.name, 'Home');
  const reopened = module.createCircleDetails(f.ports, 'circle-one'); await reopened.refresh(); await reopened.retry();
  assert.equal(f.outgoing.length, 1); assert.equal(f.accepted.size, 1); assert.equal(reopened.getSnapshot().pending, undefined); assert.equal(reopened.getSnapshot().profile.revision, 2);
});
test('a new edit cannot replace an uncertain saved profile', async () => {
  const f = fixture(); await f.controller.refresh(); f.lose(); await assert.rejects(f.controller.update(1, { name: 'Home', description: 'Our plans', avatar: null }));
  await assert.rejects(f.controller.update(1, { name: 'Different', description: '', avatar: null }), { message: 'PROFILE_PENDING' }); assert.equal(f.outgoing.length, 1);
});
test('ordinary members cannot publish profile edits', async () => {
  const f = fixture(); f.role = 'member'; await f.controller.refresh(); assert.equal(f.controller.getSnapshot().canEdit, false);
  await assert.rejects(f.controller.update(1, { name: 'Home', description: '', avatar: null }), { message: 'DENIED' }); assert.equal(f.outgoing.length, 0);
});
test('a remotely newer revision prevents overwriting an unseen profile', async () => {
  const f = fixture(); await f.controller.refresh(); f.revision = 2;
  await assert.rejects(f.controller.update(1, { name: 'Home', description: '', avatar: null }), { message: 'PROFILE_STALE' }); assert.equal(f.outgoing.length, 0); assert.equal(f.controller.getSnapshot().canEdit, false);
});
test('malformed or conflicting pending updates fail closed', async () => {
  for (const records of [[{ plaintext: 'bad' }], [{}, { operation: 'another' }]]) {
    const f = fixture(); f.outgoing.push(...records.map(record => ({ operation: 'edit-saved', conversation: 'circle-one', circle: 'circle-one', target: null, status: 'queued', event: null, contentType: 'circle-profile', profileRevision: 2, plaintext: payload('Home'), ...record })));
    await assert.rejects(f.controller.refresh(), { message: 'PROFILE_PENDING_INVALID' }); assert.equal(f.controller.getSnapshot().canEdit, false); assert.equal(f.accepted.size, 0);
  }
});
test('account change during refresh suppresses private details', async () => {
  const f = fixture(); const load = f.ports.history; f.ports.history = async () => { const result = await load(); f.replace(); return result; };
  await assert.rejects(f.controller.refresh(), { message: 'SESSION_CHANGED' }); assert.equal(f.controller.getSnapshot().details, undefined);
});
test('simultaneous edit actions cannot publish competing revisions', async () => {
  const f = fixture(); await f.controller.refresh(); const outcomes = await Promise.allSettled([f.controller.update(1, { name: 'Home', description: '', avatar: null }), f.controller.update(1, { name: 'Other', description: '', avatar: null })]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1); assert.equal(f.outgoing.length, 1);
});
test('failed recovery reads cannot keep a previously editable profile enabled', async () => {
  const f = fixture(); await f.controller.refresh(); f.ports.history = async () => { throw Error('STATE_UNAVAILABLE'); };
  await assert.rejects(f.controller.refresh()); assert.equal(f.controller.getSnapshot().canEdit, false);
  await assert.rejects(f.controller.update(1, { name: 'Home', description: '', avatar: null })); assert.equal(f.outgoing.length, 0);
});
test('account replacement during publication clears the old details and suppresses success', async () => {
  const f = fixture(); await f.controller.refresh(); const send = f.ports.send;
  f.ports.send = async draft => { const result = await send(draft); f.replace(); return result; };
  await assert.rejects(f.controller.update(1, { name: 'Home', description: '', avatar: null }), { message: 'SESSION_CHANGED' });
  assert.equal(f.controller.getSnapshot().details, undefined); assert.equal(f.controller.getSnapshot().profile, undefined);
});
test('joined-member profile refresh publishes current metadata in the current epoch without old chat',async()=>{
 const f=fixture();f.ports.api.circle=async()=>({id:'circle-one',epoch:2,memberCount:1,closed:false,members:[{accountId:'self',intervalId:'interval-one',role:'admin',pin:'ABCDEFGH',joinedEpoch:1}]});f.ports.api.context=async()=>({conversation:'circle-one',circleId:'circle-one',epoch:2,profileRevision:f.outgoing.length?2:1});
 assert.equal(typeof f.controller.shareCurrentProfile,'function','join-time profile refresh is missing');
 await f.controller.shareCurrentProfile();assert.equal(f.outgoing.length,1);assert.equal(f.outgoing[0].plaintext,payload('Family'));assert.equal(f.outgoing[0].profileRevision,2);
});
test('current-epoch metadata does not produce repeated profile broadcasts',async()=>{
 const f=fixture();assert.equal(typeof f.controller.shareCurrentProfile,'function','join-time profile refresh is missing');await f.controller.shareCurrentProfile();assert.equal(f.outgoing.length,0);
});
test('member controls remain available when peer keys prevent loading an encryption context',async()=>{
 const f=fixture();f.ports.api.context=async()=>{throw Error('KEYS_UNAVAILABLE');};await assert.rejects(f.controller.refresh());assert.ok(f.controller.getSnapshot().details,'authorized membership details should survive unavailable peer keys');assert.equal(f.controller.getSnapshot().details.memberCount,1);assert.equal(f.controller.getSnapshot().canEdit,false);
});
