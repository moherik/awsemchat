import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import * as messages from '../src/features/messages/api.ts';
const session={accessToken:'A'.repeat(43),account:{id:'alice',pin:'ABCDEFGH'},deviceId:'device-alice',generation:1,expiresAt:'2099-01-01T00:00:00Z'};
const key=Buffer.alloc(32,1).toString('base64').replace(/=+$/,'');
const keys={identity:key,signingIdentity:key};
const context={conversation:'circle-one',audience:'circle:2',circleId:'circle-one',epoch:2,sender:keys,recipients:[{accountId:'bob',generation:1,intervalId:'interval-bob',keys}]};
test('profile cancellation distinguishes exact committed events from durable cancellation fences',async t=>{
 const raw=JSON.stringify({operation:'profile-one',contentType:'circle-profile'});
 for(const result of [{state:'cancelled',operation:'profile-one'},{state:'committed',operation:'profile-one',event:{id:'event-one',operation:'profile-one',status:'sent'}}]){
  const {api,requests}=await fixture(t,(_,res)=>res.end(JSON.stringify(result)));
  assert.equal(typeof api.cancelProfile,'function','profile cancellation client missing');assert.deepEqual(await api.cancelProfile(raw),result);assert.deepEqual(requests[0].body,{envelope:raw});assert.equal(requests[0].path,'/v1/messages/profiles/cancel');
 }
 const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify({state:'cancelled',operation:'other'})));
 await assert.rejects(api.cancelProfile(raw),e=>e.code==='INVALID_RESPONSE');
 await assert.rejects(api.cancelProfile('{"operation":"chat-one","contentType":"text"}'),e=>e.code==='INVALID_INPUT');
});
test('collection cancellation validates the saved event proof and uses the collection route',async t=>{
 const raw=JSON.stringify({operation:'collection-one',contentType:'circle-collection'}),result={state:'cancelled',operation:'collection-one'};
 const {api,requests}=await fixture(t,(_,res)=>res.end(JSON.stringify(result)));
 assert.equal(typeof api.cancelCollection,'function','collection cancellation client missing');
 assert.deepEqual(await api.cancelCollection(raw),result);assert.deepEqual(requests[0].body,{envelope:raw});assert.equal(requests[0].path,'/v1/messages/collections/cancel');
 await assert.rejects(api.cancelCollection('{"operation":"ordinary","contentType":"text"}'),e=>e.code==='INVALID_INPUT');
 const malformed=await fixture(t,(_,res)=>res.end(JSON.stringify({state:'committed',operation:'collection-one',event:{id:'event-one',operation:'other',status:'sent'}})));
 await assert.rejects(malformed.api.cancelCollection(raw),e=>e.code==='INVALID_RESPONSE');
});
async function fixture(t,respond,current=()=>session){const requests=[];const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;requests.push({path:req.url,method:req.method,body,authorization:req.headers.authorization});res.setHeader('Content-Type','application/json');await respond(req,res,body);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));return {api:messages.createMessageAPI(`http://127.0.0.1:${server.address().port}`,current,true),requests};}
test('message client returns authorized context and sends exact native outbox bytes',async t=>{
 const {api,requests}=await fixture(t,(req,res)=>res.end(JSON.stringify(req.url.endsWith('/context')?{...context,phone:'private'}:{id:'event-one',operation:'operation-one',status:'sent'})));
 assert.deepEqual(await api.context({circleId:'circle-one'}),context);
 const outbox='{"operation":"operation-one","synthetic":"opaque"}';
 assert.deepEqual(await api.send(outbox),{id:'event-one',operation:'operation-one',status:'sent'});
 assert.deepEqual(requests.map(r=>[r.path,r.body]),[['/v1/messages/context',{circleId:'circle-one'}],['/v1/messages',{envelope:outbox}]]);
 assert.equal(requests[0].authorization,`Bearer ${session.accessToken}`);
});
test('message client rejects mismatched context and fake delivery acknowledgement',async t=>{
 for(const value of [{...context,circleId:'other'},{...context,epoch:3},{...context,recipients:[context.recipients[0],context.recipients[0]]},{...context,sender:{...keys,identity:'bad'}}]){
  const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify(value)));
  await assert.rejects(api.context({circleId:'circle-one'}),e=>e.code==='INVALID_RESPONSE');
 }
 for(const value of [{id:'event-one',operation:'operation-other',status:'sent'},{id:'event-one',operation:'operation-one',status:'delivered'}]){
  const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify(value)));
  await assert.rejects(api.send('{"operation":"operation-one"}'),e=>e.code==='INVALID_RESPONSE');
 }
});
test('message client suppresses acknowledgements after session change',async t=>{
 let current=session;const {api}=await fixture(t,(_,res)=>{current={...session,generation:2};res.end(JSON.stringify({id:'event-one',operation:'operation-one',status:'sent'}));},()=>current);
 await assert.rejects(api.send('{"operation":"operation-one"}'),e=>e.code==='SESSION_CHANGED');
});
const delivery={id:'event-one',operation:'operation-one',conversation:'circle-one',audience:'circle:2',senderId:'bob',senderGeneration:1,sender:keys,recipientKeys:keys,message:{kind:0,body:'c3ludGhldGljIG9wYXF1ZSBjaXBoZXJ0ZXh0'}};
test('inbox client performs read-only pagination and sanitizes recipient payload',async t=>{
 const {api,requests}=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[{...delivery,phone:'private'}],cursor:'event-one',more:false})));
 assert.equal(typeof api.inbox,'function');
 assert.deepEqual(await api.inbox('previous',1),{items:[delivery],cursor:'event-one',more:false});
 assert.equal(requests[0].path,'/v1/messages/inbox?cursor=previous&limit=1');assert.equal(requests[0].method,'GET');assert.equal(requests[0].body,null);
});
test('inbox client rejects duplicate events malformed ciphertext and stalled cursors',async t=>{
 for(const value of [{items:[delivery,delivery],cursor:'event-one',more:false},{items:[{...delivery,message:{kind:2,body:'Zg'}}],cursor:'event-one',more:false},{items:[{...delivery,message:{kind:0,body:'Zh'}}],cursor:'event-one',more:false},{items:[],cursor:'previous',more:true}]){
  const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify(value)));assert.equal(typeof api.inbox,'function');
  await assert.rejects(api.inbox('previous',25),e=>e.code==='INVALID_RESPONSE');
 }
});
test('redaction client strictly parses author confirmation and account feed pages',async t=>{
 const redaction={eventId:'event-one',conversation:'circle-one',audience:'circle:2',operation:'operation-one',sender:keys,cursor:'account:1'};
 const {api,requests}=await fixture(t,(req,res)=>res.end(JSON.stringify(req.url.includes('redactions?')?{items:[{...redaction,cursor:''}],cursor:'page:1',more:true}:redaction)));
 assert.deepEqual(await api.redact({eventId:'event-one'}),redaction);
 assert.deepEqual(await api.redactions('',25),{items:[{...redaction,cursor:''}],cursor:'page:1',more:true});
 assert.deepEqual(requests.map(item=>[item.method,item.path,item.body]),[['POST','/v1/messages/redactions',{eventId:'event-one'}],['GET','/v1/messages/redactions?limit=25',null]]);
});
test('redaction client rejects malformed descriptors and stalled pages',async t=>{
 for (const value of [{items:[{eventId:'event-one'}],cursor:'page:1',more:true},{items:[],cursor:'',more:true},{items:[],cursor:'page:1',more:false,extra:true}]) {
  const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify(value)));
  await assert.rejects(api.redactions('',25),e=>e.code==='INVALID_RESPONSE');
 }
});
test('delivery acknowledgement sends only event ID and rejects invented server payload',async t=>{
 const {api,requests}=await fixture(t,(_,res)=>res.end('null'));
 assert.equal(typeof api.acknowledge,'function');
 assert.equal(await api.acknowledge('event-one'),undefined);
 assert.deepEqual(requests[0].body,{eventId:'event-one'});
 assert.equal(requests[0].path,'/v1/messages/acknowledgements');
 const invalid=await fixture(t,(_,res)=>res.end('{"read":true}'));
 await assert.rejects(invalid.api.acknowledge('event-one'),e=>e.code==='INVALID_RESPONSE');
});
test('sender status client validates event identity and delivery-only states',async t=>{
 const {api,requests}=await fixture(t,(_,res)=>res.end('{"id":"event-one","operation":"operation-one","status":"delivered"}'));
 assert.equal(typeof api.status,'function');
 assert.deepEqual(await api.status('event-one'),{id:'event-one',operation:'operation-one',status:'delivered'});
 assert.equal(requests[0].path,'/v1/messages/status');assert.deepEqual(requests[0].body,{eventId:'event-one'});
 for(const value of [{id:'other',operation:'operation-one',status:'sent'},{id:'event-one',operation:'operation-one',status:'read'}]) {
  const invalid=await fixture(t,(_,res)=>res.end(JSON.stringify(value)));
  await assert.rejects(invalid.api.status('event-one'),e=>e.code==='INVALID_RESPONSE');
 }
});
test('inbox preserves the authenticated profile type and rejects unknown content types',async t=>{
 const typed={...delivery,contentType:'circle-profile'};
 const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[typed],cursor:'event-one',more:false})));
 assert.equal((await api.inbox()).items[0].contentType,'circle-profile');
 const friendProfile={...delivery,conversation:'private:'+'b'.repeat(64),audience:'friend:request-9',contentType:'private-profile'};
 const privateInbox=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[friendProfile],cursor:'event-one',more:false})));
 assert.equal((await privateInbox.api.inbox()).items[0].contentType,'private-profile');
 for(const value of [{...friendProfile,conversation:'circle-one',audience:'circle:2'},{...friendProfile,audience:'circle:2'},{...friendProfile,profileRevision:1}]){
  const invalidProfile=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[value],cursor:'event-one',more:false})));
  await assert.rejects(invalidProfile.api.inbox(),error=>error.code==='INVALID_RESPONSE');
 }
 const invalid=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[{...typed,contentType:'unknown'}],cursor:'event-one',more:false})));
 await assert.rejects(invalid.api.inbox(),error=>error.code==='INVALID_RESPONSE');
});
test('inbox accepts Circle member profiles only on Circle audiences',async t=>{
 const typed={...delivery,contentType:'circle-member-profile'};
 const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[typed],cursor:'event-one',more:false})));
 assert.equal((await api.inbox()).items[0].contentType,'circle-member-profile');
 for (const value of [{...typed,conversation:'private:'+'b'.repeat(64)},{...typed,audience:'friend:request-9'}]) {
  const invalid=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[value],cursor:'event-one',more:false})));
  await assert.rejects(invalid.api.inbox(),error=>error.code==='INVALID_RESPONSE');
 }
});
test('inbox accepts Now Playing controls only on accepted-friend private audiences',async t=>{
 const typed={...delivery,conversation:'private:'+'b'.repeat(64),audience:'friend:request-1',contentType:'now-playing'};
 const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[typed],cursor:'event-one',more:false})));
 assert.equal((await api.inbox()).items[0].contentType,'now-playing');
 for(const value of [{...typed,conversation:'circle-one',audience:'circle:2'},{...typed,audience:'circle:2'}]) {
  const invalid=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[value],cursor:'event-one',more:false})));
  await assert.rejects(invalid.api.inbox(),error=>error.code==='INVALID_RESPONSE');
 }
});
test('profile revision survives inbox and context parsing and invalid revisions fail closed',async t=>{
 const typed={...delivery,contentType:'circle-profile',profileRevision:2};
 const {api}=await fixture(t,(req,res)=>res.end(JSON.stringify(req.url.includes('/context')?{...context,profileRevision:2}:{items:[typed],cursor:'event-one',more:false})));
 assert.equal((await api.inbox()).items[0].profileRevision,2);assert.equal((await api.context({circleId:'circle-one'})).profileRevision,2);
 for(const revision of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){const invalid=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[{...typed,profileRevision:revision}],cursor:'event-one',more:false})));await assert.rejects(invalid.api.inbox(),error=>error.code==='INVALID_RESPONSE');}
});
test('collection context and typed deliveries retain strict revision and mutation metadata',async t=>{
 const collectionChange={action:'add',kind:'sticker',item:'item-one'},typed={...delivery,contentType:'circle-collection',collectionRevision:1,collectionChange};
 const {api}=await fixture(t,(req,res)=>res.end(JSON.stringify(req.url.endsWith('/context')?{...context,collectionRevision:0}:{items:[typed],cursor:delivery.id,more:false})));
 assert.deepEqual(await api.context({circleId:'circle-one'}),{...context,collectionRevision:0});assert.deepEqual((await api.inbox()).items,[typed]);
});
test('collection inbox rejects incomplete, private, malformed and unrelated metadata',async t=>{
 const change={action:'add',kind:'emoji',item:'item-one'};
 for(const fields of [{contentType:'circle-collection',collectionRevision:0,collectionChange:change},{contentType:'circle-collection',collectionRevision:1},{contentType:'text',collectionRevision:1,collectionChange:change},{contentType:'circle-collection',collectionRevision:1,collectionChange:{...change,key:'private'}},{contentType:'circle-collection',collectionRevision:1,collectionChange:change,conversation:'private:'+ 'a'.repeat(64),audience:'friend:one'}]){
  const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[{...delivery,...fields}],cursor:delivery.id,more:false})));
  await assert.rejects(api.inbox(),e=>e.code==='INVALID_RESPONSE');
 }
});
test('collection manifest client binds a bounded page to its original Circle epoch and revision',async t=>{
 const input={circleId:'circle-one',epoch:2,revision:3,limit:1},page={circleId:'circle-one',epoch:2,revision:3,items:[{id:'item-one',kind:'sticker'}],cursor:'item-one',more:true};
 const {api,requests}=await fixture(t,(_,res)=>{input.epoch=9;res.end(JSON.stringify(page));});
 assert.equal(typeof api.collectionManifest,'function','current collection manifest client missing');
 assert.deepEqual(await api.collectionManifest(input),page);assert.deepEqual(requests[0].body,{circleId:'circle-one',epoch:2,revision:3,cursor:'',limit:1});assert.equal(requests[0].path,'/v1/messages/collections/manifest');
});
test('collection manifest client rejects mixed snapshots, repeated IDs and stalled cursors',async t=>{
 const input={circleId:'circle-one',epoch:2,revision:3,limit:2},page={circleId:'circle-one',epoch:2,revision:3,items:[{id:'item-one',kind:'sticker'}],more:false};
 for(const change of [{epoch:3},{revision:4},{items:[page.items[0],page.items[0]]},{more:true,cursor:'wrong'},{items:[{id:'item-one',kind:'sticker',key:'private'}]}]){
  const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify({...page,...change})));
  assert.equal(typeof api.collectionManifest,'function','manifest validation missing');await assert.rejects(api.collectionManifest(input),e=>e.code==='INVALID_RESPONSE');
 }
});
test('snapshot delivery preserves an empty revision-zero header and rejects unrelated header fields',async t=>{
 const header={id:'snapshot',part:0,parts:1,items:[]},typed={...delivery,contentType:'circle-collection-snapshot',collectionRevision:0,collectionSnapshot:header};
 const {api}=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[typed],cursor:delivery.id,more:false})));assert.deepEqual((await api.inbox()).items,[typed]);
 for(const value of [{...typed,collectionSnapshot:{...header,part:1}},{...typed,collectionSnapshot:{...header,key:'private'}},{...delivery,collectionSnapshot:header}]){const f=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[value],cursor:delivery.id,more:false})));await assert.rejects(f.api.inbox(),e=>e.code==='INVALID_RESPONSE');}
});
test('history client scopes read-only pages and rejects invalid bounds',async t=>{
 const {api,requests}=await fixture(t,(_,res)=>res.end(JSON.stringify({items:[delivery],cursor:'event-one',more:true})));
 assert.equal(typeof api.history,'function');
 const page=await api.history('circle-one','circle:2','',12);
 assert.deepEqual(page,{items:[delivery],cursor:'event-one',more:true});
 assert.equal(requests[0].method,'GET');
 assert.equal(requests[0].path,'/v1/messages/history?conversation=circle-one&audience=circle%3A2&cursor=&limit=12');
 await assert.rejects(api.history('circle-one','circle:2','',0),e=>e.code==='INVALID_INPUT');
 await assert.rejects(api.history('circle-one','circle:2','bad cursor',12),e=>e.code==='INVALID_INPUT');
});
