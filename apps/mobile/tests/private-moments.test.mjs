import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../src/features/messages/private-moments.ts').catch(() => ({}));
const id = 'moment-1', audience = 'friend:request-7', conversation = 'private:' + 'a'.repeat(64);

test('private Moment codecs enforce exact schemas, audience and safe photo descriptor',()=>{
 assert.equal(typeof api.encodePrivateMoment,'function','private Moment codec is missing');
 const body=api.encodePrivateMoment({id,audience,caption:'Dinner together'});
 assert.deepEqual(api.decodePrivateMoment(body),{version:1,type:'private-moment',id,audience,caption:'Dinner together'});
 assert.throws(()=>api.encodePrivateMoment({id,audience,caption:''}));
 assert.equal(api.decodePrivateMoment(JSON.stringify({version:1,type:'private-moment',id,caption:'x',audience:'friend:other'})).audience,'friend:other');
 assert.equal(api.decodePrivateMoment(JSON.stringify({version:1,type:'private-moment',id,audience,caption:'x',extra:true})),undefined);
});

test('private timeline projects only exact friendship conversation and deduplicates retries',()=>{
 assert.equal(typeof api.selectPrivateMoments,'function','private Moment history projection is missing');
 const record=(operation,plain,overrides={})=>({conversation,audience,operation,plaintext:plain,direction:'incoming',sender:{identity:'peer-key'},sequence:1,...overrides});
 const post=api.encodePrivateMoment({id,audience,caption:'hello'});
 const history={incoming:[record('moment-1',post,{direction:'outgoing'})],outgoing:[{...record('moment-1',post),circle:null,target:'bob',status:'sent'}]};
 assert.equal(api.selectPrivateMoments(history,conversation,audience).length,1);
 assert.equal(api.selectPrivateMoments({...history,incoming:[record('moment-1',api.encodePrivateMoment({id,audience,caption:'conflicting retry'}))]},conversation,audience).length,0);
 assert.equal(api.selectPrivateMoments({...history,incoming:[...history.incoming,record('moment-2',api.encodePrivateMoment({id:'moment-2',audience,caption:'second'}))]},conversation,audience).length,2);
 assert.equal(api.selectPrivateMoments({incoming:[record('moment-2',post,{audience:'friend:old'})],outgoing:[]},conversation,audience).length,0);
});

test('private reactions toggle per sender and reply previews stay tied to exact audience',()=>{
 const post=api.encodePrivateMoment({id,audience,caption:'Dinner'});
 const react=api.encodePrivateMomentReaction({id:'react-1',audience,momentId:id,emoji:'❤️',active:true});
 const reply=api.encodePrivateMomentReply({id:'reply-1',audience,text:'On my way',moment:{id,audience,caption:'Dinner'}});
 const record=(operation,plaintext,direction='incoming',sequence=1)=>({conversation,audience,operation,plaintext,direction,sender:{identity:'peer-key'},sequence});
 const history={incoming:[record('moment-1',post),record('react-1',react),record('reply-1',reply)],outgoing:[]};
 const moment=api.selectPrivateMoments(history,conversation,audience)[0];
 assert.deepEqual(api.selectPrivateMomentReactions(history,conversation,audience,moment),[{emoji:'❤️',count:1,reactedByMe:false}]);
 assert.equal(api.decodePrivateMomentReply(reply).moment.id,id);
 assert.throws(()=>api.encodePrivateMomentReply({id:'reply-2',audience,text:'x',moment:{id,audience:'friend:other',caption:'Dinner'}}));
});

test('only the original author deletion hides a Moment in its exact friendship audience',()=>{
 const post=api.encodePrivateMoment({id,audience,caption:'Dinner'}),deleteBody=api.encodePrivateMomentDeletion({id:'delete-1',audience,momentId:id});
 const base={conversation,audience,operation:id,plaintext:post,direction:'incoming',sender:{identity:'peer-key'},sequence:1};
 const outsiderDelete={conversation,audience,operation:'delete-1',plaintext:deleteBody,direction:'incoming',sender:{identity:'other-key'},sequence:2};
 assert.equal(api.selectPrivateMoments({incoming:[base,outsiderDelete],outgoing:[]},conversation,audience).length,1);
 const authorDelete={...outsiderDelete,sender:{identity:'peer-key'}};
 assert.equal(api.selectPrivateMoments({incoming:[base,authorDelete],outgoing:[]},conversation,audience).length,0);
});

test('publisher sends only through the current accepted private audience and retries exact queued body',async()=>{
 assert.equal(typeof api.createPrivateMomentPublisher,'function','private Moment publisher is missing');
 const sent=[],outgoing=[];let account='account-1',op=0;
 const ports={account:()=>account,operation:()=>`op-${++op}`,context:async({targetId})=>({conversation,audience,sender:{identity:'self',signingIdentity:'self-sign'},recipients:[{accountId:targetId,generation:1,keys:{identity:'peer',signingIdentity:'peer-sign'}}]}),history:async()=>({incoming:[],outgoing:[...outgoing]}),send:async draft=>{sent.push(draft);outgoing.push({conversation,audience,operation:draft.operation,plaintext:draft.plaintext,target:'bob',circle:null,status:'queued',event:null});return {id:'event-1',operation:draft.operation,status:'sent'}}};
 const publisher=api.createPrivateMomentPublisher(ports,'bob');
 await publisher.post('A quiet day');
 const original=sent[0];assert.equal(original.targetId,'bob');assert.equal(api.decodePrivateMoment(original.plaintext).audience,audience);
 await publisher.retry();assert.equal(sent[1].plaintext,original.plaintext);assert.equal(sent[1].operation,original.operation);
 account='account-2';await assert.rejects(publisher.post('stale'));
});

test('promotion accepts only the sender own delivered message from the active private chat',async()=>{
 const sent=[],outgoing=[];let op=0;const ports={account:()=> 'account-1',operation:()=>`op-${++op}`,context:async()=>({conversation,audience,recipients:[{accountId:'bob'}]}),history:async()=>({incoming:[],outgoing:[...outgoing]}),send:async draft=>{sent.push(draft);return {id:'event',operation:draft.operation,status:'sent'};}};
 const publisher=api.createPrivateMomentPublisher(ports,'bob');
 outgoing.push({conversation,audience,target:'bob',circle:null,operation:'chat-1',plaintext:'A calm Sunday',status:'sent',event:'event-1'});
 await publisher.promote('chat-1');assert.equal(api.decodePrivateMoment(sent[0].plaintext).caption,'A calm Sunday');
 outgoing[0]={...outgoing[0],target:'eve'};await assert.rejects(publisher.promote('chat-1'),/MOMENT_SOURCE_INVALID/);
});

test('promotion copies an accepted own private Chat photo descriptor into a Moment', async () => {
 const sent = [], photo = JSON.stringify({ version: 1, type: 'private-photo-message', id: 'photo-op', audience, caption: 'At the lake', media: { version: 1, id: 'photo-asset', key: 'f'.repeat(64), size: 512, mimeType: 'image/jpeg' } });
 const ports = { account: () => 'account-1', operation: () => 'moment-op', context: async () => ({ conversation, audience, recipients: [{ accountId: 'bob' }] }), history: async () => ({ incoming: [], outgoing: [{ conversation, audience, target: 'bob', circle: null, operation: 'photo-op', plaintext: photo, status: 'delivered', event: 'event-1' }] }), send: async draft => { sent.push(draft); return { id: 'moment-event', operation: draft.operation, status: 'sent' }; } };
 const publisher = api.createPrivateMomentPublisher(ports, 'bob'); await publisher.promote('photo-op');
 const promoted = api.decodePrivateMoment(sent[0].plaintext); assert.equal(promoted.caption, 'At the lake'); assert.deepEqual(promoted.media, JSON.parse(photo).media);
});
