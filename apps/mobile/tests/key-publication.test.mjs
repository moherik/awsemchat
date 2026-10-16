import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import * as keys from '../src/security/key-publication.ts';
const session={accessToken:'A'.repeat(43),account:{id:'alice',pin:'ABCDEFGH'},deviceId:'phone-one',generation:1,expiresAt:'2099-01-01T00:00:00Z'};
const registration={bundles:[{publication:'saved-one'}],proof:'public-proof'};
async function server(t,respond){const received=[];const s=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({path:req.url,body:JSON.parse(body),authorization:req.headers.authorization});await respond(res);});await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections();}));return {url:`http://127.0.0.1:${s.address().port}`,received};}
test('key client requires empty 204 acknowledgement and sends only the native registration',async t=>{
 const {url,received}=await server(t,res=>{res.writeHead(204);res.end();});
 const api=keys.createKeyAPI(url,()=>session,true);
 await api.publish(registration);
 assert.deepEqual(received,[{path:'/v1/keys/publications',body:registration,authorization:`Bearer ${session.accessToken}`}]);
});
test('key client rejects ambiguous acknowledgements and responses after session replacement',async t=>{
 let current=session;
 const {url}=await server(t,res=>{res.writeHead(200);res.end('{}');});
 await assert.rejects(keys.createKeyAPI(url,()=>session,true).publish(registration),e=>e.code==='INVALID_RESPONSE');
 const other=await server(t,res=>{current={...session,generation:2};res.writeHead(204);res.end();});
 await assert.rejects(keys.createKeyAPI(other.url,()=>current,true).publish(registration),e=>e.code==='SESSION_CHANGED');
});
test('failed upload preserves pending batch and retry confirms only after server acknowledgement',async()=>{
 let confirmed=false,attempts=0;
 const crypto={prekeyStatus:async()=>({stored:20,unpublished:20,pending:'saved-one'}),preparePublication:async op=>{assert.equal(op,'saved-one');return {bundles:registration.bundles};},signPublication:async op=>{assert.equal(op,'saved-one');return registration;},confirmPublication:async op=>{assert.equal(op,'saved-one');confirmed=true;}};
 const upload=async value=>{assert.deepEqual(value,registration);assert.equal(confirmed,false);if(++attempts===1)throw new Error('connection lost');};
 await assert.rejects(keys.publishAccountKeys(()=>session,crypto,upload,()=>{assert.fail('must reuse native pending operation');}),/connection lost/);
 assert.equal(confirmed,false);
 await keys.publishAccountKeys(()=>session,crypto,upload,()=>{assert.fail('must reuse native pending operation');});
 assert.equal(confirmed,true);
});
test('session replacement during upload prevents native acknowledgement',async()=>{
 let current=session;
 const crypto={prekeyStatus:async()=>({stored:0,unpublished:0,pending:null}),preparePublication:async()=>({bundles:registration.bundles}),signPublication:async()=>registration,confirmPublication:async()=>assert.fail('stale session confirmed keys')};
 await assert.rejects(keys.publishAccountKeys(()=>current,crypto,async()=>{current={...session,generation:2};},()=> 'saved-one'),e=>e.code==='SESSION_REVOKED');
});
test('a full acknowledged pool does not create an empty publication on login restore',async()=>{
 const crypto={prekeyStatus:async()=>({stored:20,unpublished:0,pending:null}),preparePublication:async()=>assert.fail('full acknowledged pool must not create another batch')};
 await keys.publishAccountKeys(()=>session,crypto,async()=>assert.fail('no upload needed'),()=>assert.fail('no operation needed'));
});
const bundle={version:1,context:'awsemchat.olm.signed-prekey',publication:'batch-one',keyId:'a2V5LWlkLTE',identity:'a'.repeat(43),signingIdentity:'b'.repeat(43),prekey:'c'.repeat(43),issuedAt:1000,expiresAt:605800,signature:'d'.repeat(86)};
test('allocation client sends immutable routing context and returns sanitized bundle',async t=>{
 const {url,received}=await server(t,res=>{res.writeHead(200);res.end(JSON.stringify({generation:2,bundle:{...bundle,phone:'private'}}));});
 const api=keys.createKeyAPI(url,()=>session,true);
 assert.equal(typeof api.allocate,'function');
 assert.deepEqual(await api.allocate({operationId:'allocate-one',targetId:'bob',circleId:'circle-one',epoch:3}),{generation:2,bundle});
 assert.deepEqual(received[0].body,{operationId:'allocate-one',targetId:'bob',circleId:'circle-one',epoch:3});
 assert.equal(received[0].path,'/v1/keys/allocations');
});
test('allocation client rejects invalid key shapes and unsafe generations',async t=>{
 for(const value of [{generation:0,bundle},{generation:1,bundle:{...bundle,version:2}},{generation:1,bundle:{...bundle,prekey:'bad'}},{generation:1,bundle:{...bundle,expiresAt:1000}},{generation:1,bundle:{...bundle,signature:'invalid'}}]){
  const {url}=await server(t,res=>{res.writeHead(200);res.end(JSON.stringify(value));});
  const api=keys.createKeyAPI(url,()=>session,true);assert.equal(typeof api.allocate,'function');
  await assert.rejects(api.allocate({operationId:'one',targetId:'bob'}),e=>e.code==='INVALID_RESPONSE');
 }
});
