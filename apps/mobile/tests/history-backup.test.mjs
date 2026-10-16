import test from 'node:test';
import assert from 'node:assert/strict';
import * as backup from '../src/features/backup/history-backup.ts';
const record = { direction:'outgoing', operation:'one', conversation:'room', audience:'epoch-1', sender:{identity:'public',signingIdentity:'signing'}, plaintext:'private message', archival:true };
function fixture() {
 let binding='account-device-generation'; let imported=[]; let saved=[]; let encoded;
 const codec={ encode:async(account,records)=>{encoded={account,records}; return {archive:'encrypted-file',recoveryKey:'secret'};}, decode:async()=>({records:encoded.records}) };
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding}),history:{exportHistory:async()=>[record],importHistory:async(records)=>{imported=records;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec});
 return {service,codec,saved,get imported(){return imported;},get encoded(){return encoded;},change:()=>{binding='replacement';},sink:async(bytes)=>{saved.push(bytes);}};
}
test('backup saves only encrypted bytes and keeps its recovery key separate',async()=>{
 const f=fixture();const result=await f.service.create(f.sink);
 assert.deepEqual(f.saved,['encrypted-file']);assert.equal(result.recoveryKey,'secret');
 assert.equal(f.encoded.account,'account');assert.equal(JSON.parse(f.encoded.records[0].payload).plaintext,'private message');
});
test('restore authenticates the archive before importing the complete history',async()=>{
 const f=fixture();await f.service.create(f.sink);await f.service.restore('encrypted-file','secret');
 assert.deepEqual(f.imported,[record]);
});
test('failed archive authentication leaves existing history untouched',async()=>{
 const f=fixture();f.codec.decode=async()=>{throw Error('authentication failed');};
 await assert.rejects(f.service.restore('bad','wrong'));assert.deepEqual(f.imported,[]);
});
test('account replacement during encryption prevents writing the backup',async()=>{
 const f=fixture();const encode=f.codec.encode;f.codec.encode=async(...args)=>{const sealed=await encode(...args);f.change();return sealed;};
 await assert.rejects(f.service.create(f.sink),{message:'SESSION_REVOKED'});assert.deepEqual(f.saved,[]);
});
test('account replacement during decode prevents importing plaintext',async()=>{
 const f=fixture();await f.service.create(f.sink);const decode=f.codec.decode;f.codec.decode=async()=>{const decoded=await decode();f.change();return decoded;};
 await assert.rejects(f.service.restore('encrypted-file','secret'),{message:'SESSION_REVOKED'});assert.deepEqual(f.imported,[]);
});
test('foreign backup record wrappers are rejected before importing any record',async()=>{
 const f=fixture();await f.service.create(f.sink);f.encoded.records.push({...f.encoded.records[0],originalAudience:['other-account']});
 await assert.rejects(f.service.restore('encrypted-file','secret'),{message:'INVALID_BACKUP'});assert.deepEqual(f.imported,[]);
});
test('history exceeding the native archive record limit fails without saving a partial backup',async()=>{
 let saved=false;let encoded=false;
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>Array.from({length:769},(_,n)=>({...record,operation:`message-${n}`})),importHistory:async()=>{}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async()=>{encoded=true;return {archive:'file',recoveryKey:'key'};},decode:async()=>({records:[]})}});
 await assert.rejects(service.create(async()=>{saved=true;}),{message:'CAPACITY'});
 assert.equal(saved,false);assert.equal(encoded,false);
});

test('complete native history is encrypted without truncating to the former record cap',async()=>{
 let count=0;let stored='';
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>Array.from({length:768},(_,n)=>({...record,operation:`message-${n}`})),importHistory:async()=>{}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{count=records.length;return {archive:'full-file',recoveryKey:'key'};},decode:async()=>({records:[]})}});
 await service.create(async(bytes)=>{stored=bytes;});
 assert.equal(count,768);assert.equal(stored,'full-file');
});
test('typed profile history keeps its content type through encrypted backup restoration',async()=>{
 let wrapped,imported;
 const typed={...record,contentType:'circle-profile'};
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[typed],importHistory:async value=>{imported=value;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return {archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});await service.restore('file','key');assert.deepEqual(imported,[typed]);
});
test('revision is preserved through backup and restore',async()=>{
 let wrapped,imported;const typed={...record,contentType:'circle-profile',profileRevision:2};
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[typed],importHistory:async value=>{imported=value;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return {archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});await service.restore('file','key');assert.deepEqual(imported,[typed]);
});
test('server event id survives encrypted history backup and restore',async()=>{
 let wrapped,imported;const typed={...record,serverEventId:'relay-event-123'};
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[typed],importHistory:async value=>{imported=value;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return {archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});await service.restore('file','key');assert.deepEqual(imported,[typed]);
});
test('new backup omits messages with a deletion waiting for server confirmation',async()=>{
 const publicKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';let wrapped;
 const pending=[
  {target:{eventId:'event-pending'},operation:'delete-event',messageOperation:'event-pending',confirmed:false},
  {target:{legacy:{conversation:'room',audience:'epoch-1',operation:'legacy-pending',peerKeys:{identity:publicKey,signingIdentity:publicKey}}},operation:'delete-legacy',messageOperation:'legacy-pending',confirmed:false},
 ];
 const messages=[{...record,operation:'modern-pending',serverEventId:'event-pending'},record,{...record,operation:'legacy-pending',sender:{identity:publicKey,signingIdentity:publicKey}}];
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>messages,importHistory:async()=>{}},pendingRedactions:async()=>pending,
  redactions:{redactions:async(cursor='')=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});
 assert.deepEqual(wrapped.map(item=>JSON.parse(item.payload).operation),['one']);
});
test('accepted profile marker survives backup restoration',async()=>{
 let wrapped,imported;const typed={...record,contentType:'circle-profile',profileRevision:2,profileAccepted:true};
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[typed],importHistory:async value=>{imported=value;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return {archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});await service.restore('file','key');assert.deepEqual(imported,[typed]);
});
test('accepted collection history keeps revision, item mutation and acceptance through backup restoration',async()=>{
 let wrapped,imported;const typed={...record,contentType:'circle-collection',collectionRevision:2,collectionChange:{action:'remove',kind:'emoji',item:'emoji-one'},collectionAccepted:true};
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[typed],importHistory:async value=>{imported=value;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return {archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});await service.restore('file','key');assert.deepEqual(imported,[typed]);
});
test('collection metadata on text and malformed restored mutations fail before native import',async()=>{
 for(const fields of [{contentType:'text',collectionRevision:1},{contentType:'circle-collection',collectionRevision:0,collectionChange:{action:'add',kind:'sticker',item:'one'}},{contentType:'circle-collection',collectionRevision:1,collectionChange:{action:'add',kind:'sticker',item:'one',key:'private'}}]){
  const f=fixture();await f.service.create(f.sink);f.encoded.records[0].payload=JSON.stringify({...record,...fields});
  await assert.rejects(f.service.restore('encrypted-file','secret'),/INVALID_BACKUP/);assert.deepEqual(f.imported,[]);
 }
});
test('snapshot headers survive accepted history backup and restoration',async()=>{
 let wrapped,imported;const typed={...record,contentType:'circle-collection-snapshot',collectionRevision:0,collectionSnapshot:{id:'snapshot',part:0,parts:1,items:[]},collectionAccepted:true};const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[typed],importHistory:async value=>{imported=value;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return {archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});await service.create(async()=>{});await service.restore('file','key');assert.deepEqual(imported,[typed]);
});

test('personal sticker artwork is included in the encrypted archive and restored separately from message history', async () => {
 const sticker={id:'local-one',artwork:{image:'data:image/png;base64,YWJjZA==',title:'Hello',text:'',textColor:'#FFFFFF',textSize:26,textY:72,background:null,pack:'Saved stickers'}};
 let wrapped, importedMessages, importedStickers;
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[record],importHistory:async value=>{importedMessages=value;}},stickers:{exportStickers:async()=>[sticker],importStickers:async values=>{importedStickers=values;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});
 assert.ok(wrapped.some(item=>item.conversationId==='awsemchat.personal-stickers.v1'));
 await service.restore('file','key');
 assert.deepEqual(importedMessages,[record]);
 assert.deepEqual(importedStickers,[sticker]);
});

test('malformed sticker archive is rejected before either library is imported', async () => {
 let wrapped, messageImport=0, stickerImport=0;
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[],importHistory:async()=>{messageImport++;}},stickers:{exportStickers:async()=>[],importStickers:async()=>{stickerImport++;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});
 wrapped.push({eventId:'sticker-0-0',conversationId:'awsemchat.personal-stickers.v1',originalAudience:['account'],membershipInterval:'personal-library',receivedAt:0,payload:'not json'});
 await assert.rejects(service.restore('file','key'),{message:'INVALID_BACKUP'});
 assert.equal(messageImport,0);assert.equal(stickerImport,0);
});

test('large sticker artwork is chunked below the native frame limit and reassembled exactly', async () => {
 const sticker={id:'local-large',artwork:{image:`data:image/png;base64,${'A'.repeat(700_000)}`,title:'Large sticker',text:'',textColor:'#FFFFFF',textSize:26,textY:72,background:null,pack:'Saved stickers'}};
 let wrapped, restored;
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[],importHistory:async()=>{}},stickers:{exportStickers:async()=>[sticker],importStickers:async values=>{restored=values;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});
 const chunks=wrapped.filter(item=>item.conversationId==='awsemchat.personal-stickers.v1');
 assert.ok(chunks.length>1);assert.ok(chunks.every(item=>Buffer.byteLength(item.payload)<=256*1024));
 await service.restore('file','key');assert.deepEqual(restored,[sticker]);
});

test('chat preferences are stored inside the encrypted backup and restored separately from message history', async () => {
 let wrapped, imported, preferences;
 const values={ 'private:friend-one':{pinned:true}, 'circle:home':{muted:true,archived:true} };
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[record],importHistory:async value=>{imported=value;}},preferences:{export:async()=>values,import:async value=>{preferences=value;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor='')=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});
 assert.ok(wrapped.some(item=>item.conversationId==='awsemchat.chat-preferences.v1'));
 await service.restore('file','key');
 assert.deepEqual(imported,[record]);
 assert.deepEqual(preferences,values);
});

test('malformed archived chat preferences are rejected before history import', async () => {
 let wrapped, imports=0;
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[],importHistory:async()=>{imports++;}},preferences:{export:async()=>({}),import:async()=>{}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor='')=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});
 wrapped.find(item=>item.conversationId==='awsemchat.chat-preferences.v1').payload=JSON.stringify({version:1,values:{'private:bad id':{pinned:true}}});
 await assert.rejects(service.restore('file','key'),{message:'INVALID_BACKUP'});
 assert.equal(imports,0);
});

test('foreign-account sticker wrappers are rejected before importing messages or stickers', async () => {
 let wrapped, messageImport=0, stickerImport=0;
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[],importHistory:async()=>{messageImport++;}},stickers:{exportStickers:async()=>[],importStickers:async()=>{stickerImport++;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});
 wrapped.push({eventId:'sticker-0-0',conversationId:'awsemchat.personal-stickers.v1',originalAudience:['other-account'],membershipInterval:'personal-library',receivedAt:0,payload:JSON.stringify({kind:'personal-sticker.v1',stickerIndex:0,part:0,parts:1,data:'data:image/png;base64,YQ==',sticker:{id:'x',artwork:{image:'',title:'x',text:'',textColor:'#FFFFFF',textSize:24,textY:72,background:null,pack:'Saved'}}})});
 await assert.rejects(service.restore('file','key'),{message:'INVALID_BACKUP'});assert.equal(messageImport,0);assert.equal(stickerImport,0);
});

test('account replacement during history import prevents sticker restore into the replacement account', async () => {
 const sticker={id:'local-one',artwork:{image:'data:image/png;base64,YQ==',title:'Hello',text:'',textColor:'#FFFFFF',textSize:26,textY:72,background:null,pack:'Saved stickers'}};
 let wrapped, importedStickers=0, binding='device';
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding}),history:{exportHistory:async()=>[],importHistory:async()=>{binding='replacement';}},stickers:{exportStickers:async()=>[sticker],importStickers:async()=>{importedStickers++;}},pendingRedactions:async()=>[],redactions:{redactions:async(cursor="")=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});
 await assert.rejects(service.restore('file','key'),{message:'SESSION_REVOKED'});
 assert.equal(importedStickers,0);
});

test('restore checks every redaction page and filters deleted modern event IDs before importing',async()=>{
 const publicKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';let imported,requests=0;
 const first={...record,sender:{identity:publicKey,signingIdentity:publicKey},serverEventId:'event-deleted'},second={...record,operation:'other',sender:{identity:publicKey,signingIdentity:publicKey},serverEventId:'event-kept'};let wrapped;
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[first,second],importHistory:async values=>{imported=values;}},
  pendingRedactions:async()=>[],
  redactions:{redactions:async(cursor)=>{requests++;return cursor?{items:[],cursor:'cursor-one',more:false}:{items:[{eventId:'event-deleted',conversation:'room',audience:'epoch-1',operation:'one',sender:{identity:publicKey,signingIdentity:publicKey},cursor:''}],cursor:'cursor-one',more:true};}},
  codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});await service.restore('file','key');assert.equal(requests,2);assert.deepEqual(imported,[second]);
});
test('restore filters legacy history with the complete sender and audience descriptor',async()=>{
 const publicKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';let imported;const legacy={...record,sender:{identity:publicKey,signingIdentity:publicKey}};let wrapped;
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[legacy],importHistory:async values=>{imported=values;}},
  pendingRedactions:async()=>[],
  redactions:{redactions:async()=>({items:[{eventId:'event-old',conversation:'room',audience:'epoch-1',operation:'one',sender:legacy.sender,cursor:''}],cursor:'cursor-one',more:false})},
  codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});await service.restore('file','key');assert.deepEqual(imported,[]);
});
test('malformed or ambiguous redaction data aborts before either history or sticker import',async()=>{
 for(const redaction of [
  {eventId:'bad',conversation:'room',audience:'epoch-1',operation:'one',sender:{identity:'bad',signingIdentity:'bad'},cursor:''},
 ]){
  let wrapped,messages=0,stickers=0;const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[record],importHistory:async()=>{messages++;}},stickers:{exportStickers:async()=>[],importStickers:async()=>{stickers++;}},pendingRedactions:async()=>[],
   redactions:{redactions:async()=>({items:[redaction],cursor:'cursor-one',more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
  await service.create(async()=>{});await assert.rejects(service.restore('file','key'),{message:'INVALID_REDACTION_LEDGER'});assert.equal(messages,0);assert.equal(stickers,0);
 }
});
test('multiple legacy records matching one descriptor abort restore as ambiguous',async()=>{
 const publicKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';let wrapped,messages=0;const legacy={...record,sender:{identity:publicKey,signingIdentity:publicKey}};
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[legacy],importHistory:async()=>{messages++;}},
  pendingRedactions:async()=>[],
  redactions:{redactions:async()=>({items:[{eventId:'event-old',conversation:'room',audience:'epoch-1',operation:'one',sender:legacy.sender,cursor:''}],cursor:'cursor-one',more:false})},
  codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});const duplicate={...wrapped[0],eventId:'entry-1',payload:JSON.stringify({...legacy,plaintext:'conflicting archive content'})};wrapped.push(duplicate);
 await assert.rejects(service.restore('file','key'),{message:'AMBIGUOUS_REDACTION'});assert.equal(messages,0);
});
test('offline redaction check aborts restore without importing history or stickers',async()=>{
 let wrapped,messages=0,stickers=0;const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[record],importHistory:async()=>{messages++;}},stickers:{exportStickers:async()=>[],importStickers:async()=>{stickers++;}},pendingRedactions:async()=>[],
  redactions:{redactions:async()=>{throw Error('NETWORK');}},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});await assert.rejects(service.restore('file','key'),{message:'NETWORK'});assert.equal(messages,0);assert.equal(stickers,0);
});
test('account replacement during redaction lookup aborts before importing history or stickers',async()=>{
 let wrapped,binding='device',messages=0,stickers=0;const service=backup.createHistoryBackup({account:()=>({id:'account',binding}),history:{exportHistory:async()=>[record],importHistory:async()=>{messages++;}},stickers:{exportStickers:async()=>[],importStickers:async()=>{stickers++;}},pendingRedactions:async()=>[],
  redactions:{redactions:async()=>{binding='replacement';return{items:[],cursor:'',more:false};}},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});await assert.rejects(service.restore('file','key'),{message:'SESSION_REVOKED'});assert.equal(messages,0);assert.equal(stickers,0);
});
test('restore retry converges history and stickers when sticker import fails after message import',async()=>{
 const sticker={id:'local-one',artwork:{image:'data:image/png;base64,YQ==',title:'Hello',text:'',textColor:'#FFFFFF',textSize:26,textY:72,background:null,pack:'Saved stickers'}};
 let wrapped,messageImports=0,stickerImports=0;
 const service=backup.createHistoryBackup({account:()=>({id:'account',binding:'device'}),history:{exportHistory:async()=>[record],importHistory:async()=>{messageImports++;}},stickers:{exportStickers:async()=>[sticker],importStickers:async()=>{stickerImports++;if(stickerImports===1)throw Error('STICKER_STORE_FAILED');}},pendingRedactions:async()=>[],
  redactions:{redactions:async(cursor='')=>({items:[],cursor,more:false})},codec:{encode:async(_,records)=>{wrapped=records;return{archive:'file',recoveryKey:'key'};},decode:async()=>({records:wrapped})}});
 await service.create(async()=>{});
 await assert.rejects(service.restore('file','key'),{message:'STICKER_STORE_FAILED'});
 assert.equal(messageImports,1);assert.equal(stickerImports,1);
 assert.deepEqual(await service.restore('file','key'),{records:1,stickers:1});
 assert.equal(messageImports,2);assert.equal(stickerImports,2);
});
