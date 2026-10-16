import test from 'node:test';import assert from 'node:assert/strict';import * as sender from '../src/features/messages/send.ts';
const own={identity:'own',signingIdentity:'own-signing'},peer={identity:'peer',signingIdentity:'peer-signing'};
const context={conversation:'room',audience:'friend:one',sender:own,recipients:[{accountId:'bob',generation:1,keys:peer}]};
function fixture({pending=null,session=true}={}){const calls=[];const native={confirmSend:async()=>{},retryDraft:async()=>{if(pending)return pending;throw {code:'UNKNOWN_OPERATION'};},bundle:async()=>own,observePeer:async()=>{},hasSession:async()=>session,outbound:async()=>{calls.push('outbound');},send:async input=>{calls.push(['encrypt',input]);return 'exact-native-outbox';}};const api={context:async()=>context,send:async raw=>{calls.push(['upload',raw]);return {id:'event',operation:'operation',status:'sent'};}};const keys={allocate:async input=>{calls.push(['allocate',input]);return {generation:1,bundle:{...peer}};}};return {native,api,keys,calls};}
const draft={operation:'operation',targetId:'bob',plaintext:'hello'};
test('a media-bearing profile cannot encrypt to a different membership epoch',async()=>{
 const f=fixture();f.api.context=async()=>({...context,conversation:'circle-one',circleId:'circle-one',audience:'circle:3',epoch:3});
 await assert.rejects(sender.sendMessage(f.native,f.api,f.keys,{operation:'operation',circleId:'circle-one',plaintext:'profile',contentType:'circle-profile',profileRevision:2,expectedEpoch:2},async()=> 'allocation'),e=>e.code==='CONTEXT_MISMATCH');assert.deepEqual(f.calls,[]);
});
test('pending native outbox uploads unchanged without allocating or encrypting',async()=>{assert.equal(typeof sender.sendMessage,'function');const f=fixture({pending:'saved-exact-outbox'});await sender.sendMessage(f.native,f.api,f.keys,draft,async()=> 'allocation');assert.deepEqual(f.calls,[['upload','saved-exact-outbox']]);});
test('existing encrypted session sends without consuming another prekey',async()=>{assert.equal(typeof sender.sendMessage,'function');const f=fixture();await sender.sendMessage(f.native,f.api,f.keys,draft,async()=> 'allocation');assert.deepEqual(f.calls,[['encrypt',{operation:'operation',conversation:'room',audience:'friend:one',recipients:['bob'],plaintext:'hello',target:'bob',circle:undefined}],['upload','exact-native-outbox']]);});
test('missing session allocates context-bound keys before native encryption',async()=>{assert.equal(typeof sender.sendMessage,'function');const f=fixture({session:false});await sender.sendMessage(f.native,f.api,f.keys,draft,async()=> 'allocation');assert.equal(f.calls[0][0],'allocate');assert.deepEqual(f.calls[0][1],{operationId:'allocation',targetId:'bob'});assert.equal(f.calls[1],'outbound');assert.equal(f.calls[2][0],'encrypt');});
test('allocation generation mismatch never encrypts or uploads',async()=>{assert.equal(typeof sender.sendMessage,'function');const f=fixture({session:false});f.keys.allocate=async()=>({generation:2,bundle:peer});await assert.rejects(sender.sendMessage(f.native,f.api,f.keys,draft,async()=> 'allocation'),e=>e.code==='CONTEXT_MISMATCH');assert.deepEqual(f.calls,[]);});
test('changed retry draft is rejected before contacting the relay',async()=>{
 const f=fixture({pending:'saved-exact-outbox'});
 f.native.retryDraft=async()=>{throw Object.assign(new Error('OPERATION_CONFLICT'),{code:'OPERATION_CONFLICT'});};
 await assert.rejects(sender.sendMessage(f.native,f.api,f.keys,{...draft,plaintext:'changed'},async()=> 'allocation'),e=>e.code==='OPERATION_CONFLICT');
 assert.deepEqual(f.calls,[]);
});
test('server acknowledgement is committed into native sender history before returning',async()=>{
 const f=fixture();let confirmed;
 f.native.confirmSend=async input=>{confirmed=input;};
 await sender.sendMessage(f.native,f.api,f.keys,draft,async()=> 'allocation');
 assert.deepEqual(confirmed,{operation:'operation',event:'event',status:'sent'});
});
test('profile routing type reaches both exact retry lookup and native encryption',async()=>{
 const f=fixture();let retry;
 f.native.retryDraft=async input=>{retry=input;throw {code:'UNKNOWN_OPERATION'};};
 f.api.context=async()=>({...context,conversation:'circle-one',audience:'circle:1',circleId:'circle-one',epoch:1});
 await sender.sendMessage(f.native,f.api,f.keys,{operation:'operation',circleId:'circle-one',plaintext:'profile',contentType:'circle-profile'},async()=> 'allocation');
 assert.equal(retry.contentType,'circle-profile');assert.equal(f.calls[0][1].contentType,'circle-profile');
});
test('Circle member profile controls require the current Circle epoch before encryption',async()=>{
 const f=fixture();f.api.context=async()=>({...context,conversation:'circle-one',circleId:'circle-one',audience:'circle:2',epoch:2});
 await sender.sendMessage(f.native,f.api,f.keys,{operation:'operation',circleId:'circle-one',expectedEpoch:2,plaintext:'profile',contentType:'circle-member-profile'},async()=> 'allocation');
 assert.equal(f.calls[0][1].contentType,'circle-member-profile');
 const privateSend=fixture();
 await assert.rejects(sender.sendMessage(privateSend.native,privateSend.api,privateSend.keys,{operation:'operation',targetId:'bob',plaintext:'profile',contentType:'circle-member-profile'},async()=> 'allocation'),e=>e.code==='CONTEXT_MISMATCH');
 assert.deepEqual(privateSend.calls,[]);
});
test('Now Playing controls can only be encrypted to one accepted private friend',async()=>{
 const f=fixture();f.api.context=async()=>({...context,conversation:'private:'+'b'.repeat(64),audience:'friend:request-1'});
 await sender.sendMessage(f.native,f.api,f.keys,{operation:'operation',targetId:'bob',plaintext:'track',contentType:'now-playing'},async()=> 'allocation');
 assert.equal(f.calls[0][1].contentType,'now-playing');
 const circle=fixture();circle.api.context=async()=>({...context,conversation:'circle-one',circleId:'circle-one',audience:'circle:2',epoch:2});
 await assert.rejects(sender.sendMessage(circle.native,circle.api,circle.keys,{operation:'operation',circleId:'circle-one',plaintext:'track',contentType:'now-playing'},async()=> 'allocation'),e=>e.code==='CONTEXT_MISMATCH');
 assert.deepEqual(circle.calls,[]);
});
test('revision is passed unchanged into retry and encryption',async()=>{
 const f=fixture();let retry;
 f.native.retryDraft=async input=>{retry=input;throw {code:'UNKNOWN_OPERATION'};};f.api.context=async()=>({...context,conversation:'circle-one',audience:'circle:1',circleId:'circle-one',epoch:1,profileRevision:1});
 await sender.sendMessage(f.native,f.api,f.keys,{operation:'operation',circleId:'circle-one',plaintext:'profile',contentType:'circle-profile',profileRevision:2},async()=> 'allocation');
 assert.equal(retry.profileRevision,2);assert.equal(f.calls[0][1].profileRevision,2);
});
test('collection revision and item mutation reach both immutable retry and native encryption',async()=>{
 const f=fixture();let retry;const collectionChange={action:'add',kind:'emoji',item:'emoji-one'};
 f.native.retryDraft=async input=>{retry=input;throw {code:'UNKNOWN_OPERATION'};};f.api.context=async()=>({...context,conversation:'circle-one',circleId:'circle-one',audience:'circle:1',epoch:1,collectionRevision:0});
 await sender.sendMessage(f.native,f.api,f.keys,{operation:'operation',circleId:'circle-one',plaintext:'collection payload',contentType:'circle-collection',collectionRevision:1,collectionChange},async()=> 'allocation');
 assert.equal(retry.collectionRevision,1);assert.deepEqual(retry.collectionChange,collectionChange);assert.equal(f.calls[0][1].collectionRevision,1);assert.deepEqual(f.calls[0][1].collectionChange,collectionChange);
});
test('changed collection revision blocks fresh encryption before consuming keys',async()=>{
 const f=fixture();f.api.context=async()=>({...context,conversation:'circle-one',circleId:'circle-one',audience:'circle:1',epoch:1,collectionRevision:2});
 await assert.rejects(sender.sendMessage(f.native,f.api,f.keys,{operation:'operation',circleId:'circle-one',plaintext:'collection',contentType:'circle-collection',collectionRevision:1,collectionChange:{action:'add',kind:'sticker',item:'one'}},async()=> 'allocation'),e=>e.code==='CONTEXT_MISMATCH');assert.deepEqual(f.calls,[]);
});
test('snapshot header and current revision reach exact retry and encryption without advancing collection revision',async()=>{
 const f=fixture();let retry;const collectionSnapshot={id:'snapshot',part:0,parts:1,items:[]};f.native.retryDraft=async input=>{retry=input;throw {code:'UNKNOWN_OPERATION'};};f.api.context=async()=>({...context,conversation:'circle-one',circleId:'circle-one',audience:'circle:1',epoch:1,collectionRevision:0});
 await sender.sendMessage(f.native,f.api,f.keys,{operation:'operation',circleId:'circle-one',plaintext:'snapshot',contentType:'circle-collection-snapshot',collectionRevision:0,collectionSnapshot},async()=> 'allocation');assert.deepEqual(retry.collectionSnapshot,collectionSnapshot);assert.deepEqual(f.calls[0][1].collectionSnapshot,collectionSnapshot);
});
