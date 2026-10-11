import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthAPI, AuthError } from '../src/features/auth/api.ts';
import { createSessionOwner } from '../src/features/auth/session-owner.ts';

const token='A'.repeat(43);
const session={accessToken:token,account:{id:'account-one',pin:'ABCDEFGH'},deviceId:'device-one',generation:1,expiresAt:'2099-01-01T00:00:00Z'};
async function setup(t,{saved=session,network='ready',writeFails=false,clearFails=false}={}) {
 const directory=await mkdtemp(join(tmpdir(),'awsem-auth-test-'));const path=join(directory,'session.json');
 t.after(()=>rm(directory,{recursive:true,force:true}));
 if(saved!==null)await writeFile(path,typeof saved==='string'?saved:JSON.stringify(saved));
 const vault={read:()=>readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;}),write:async value=>{if(writeFails)throw new Error('synthetic secure write failure');await writeFile(path,value);},clear:async()=>{if(clearFails)throw new Error('synthetic secure delete failure');await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});}};
 const requests=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  requests.push({path:req.url,body:body?JSON.parse(body):null,authorization:req.headers.authorization});
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/session'){
   if(network==='offline'){req.socket.destroy();return;}
   if(network==='revoked'){res.writeHead(401);res.end('{"code":"SESSION_REVOKED"}');return;}
   res.end(JSON.stringify({accountId:network==='mismatch'?'another-account':session.account.id,deviceId:session.deviceId,generation:session.generation,expiresAt:session.expiresAt}));return;
  }
  if(req.url.endsWith('challenges')){res.writeHead(202);res.end(JSON.stringify({challengeId:'challenge-one',expiresAt:session.expiresAt}));return;}
  if(req.url.endsWith('verify')){res.end(JSON.stringify(session));return;}
  if(req.url.endsWith('logout')){if(network==='offline'){req.socket.destroy();return;}res.writeHead(204);res.end();return;}
  res.writeHead(404);res.end('{}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const api=createAuthAPI(`http://127.0.0.1:${server.address().port}`,true);
 return {vault,api,owner:createSessionOwner(api,vault,'device-one'),requests};
}

test('restart revalidates persisted session and exposes no bearer token in UI snapshot',async t=>{
 const {owner}=await setup(t);await owner.restore();
 assert.deepEqual(owner.getSnapshot(),{status:'ready',account:{id:'account-one',pin:'ABCDEFGH'},generation:1});
 assert.equal(owner.requireSession().accessToken,token);
 assert.ok(!JSON.stringify(owner.getSnapshot()).includes(token));
});

test('revocation and changed identity clear persisted authentication',async t=>{
 for(const network of ['revoked','mismatch']){
  const {owner,vault}=await setup(t,{network});await owner.restore();
  assert.equal(owner.getSnapshot().status,'signed-out');assert.equal(await vault.read(),null);
  assert.throws(()=>owner.requireSession(),e=>e.code==='SESSION_REVOKED');
 }
});

test('offline restore retains saved history identity but cannot authorize server actions',async t=>{
 const {owner,vault}=await setup(t,{network:'offline'});await owner.restore();
 assert.equal(owner.getSnapshot().status,'offline');assert.ok(await vault.read());
 assert.throws(()=>owner.requireSession(),e=>e.code==='NETWORK');
});

test('corrupt expired and wrong-device saved sessions never reach authenticated state',async t=>{
 for(const saved of ['{broken', {...session,expiresAt:'2000-01-01T00:00:00Z'}, {...session,deviceId:'another-device'}]){
  const {owner,vault,requests}=await setup(t,{saved});await owner.restore();
  assert.equal(owner.getSnapshot().status,'signed-out');assert.equal(await vault.read(),null);assert.equal(requests.length,0);
 }
});

test('verification persists before permitting access and restart recovers it',async t=>{
 const {owner,vault,api}=await setup(t,{saved:null});
 await owner.start('+6281234567890','operation-one');await owner.verify('123456');
 assert.equal(owner.getSnapshot().status,'ready');assert.deepEqual(JSON.parse(await vault.read()),session);
 const restarted=createSessionOwner(api,vault,'device-one');await restarted.restore();assert.equal(restarted.getSnapshot().status,'ready');
});

test('failed secure write refuses login and revokes newly acquired token',async t=>{
 const {owner,vault,requests}=await setup(t,{saved:null,writeFails:true});
 await owner.start('+6281234567890','operation-one');
 await assert.rejects(owner.verify('123456'),e=>e instanceof AuthError&&e.code==='STORAGE');
 assert.equal(owner.getSnapshot().status,'locked');assert.equal(await vault.read(),null);
 assert.ok(requests.some(r=>r.path==='/v1/auth/logout'&&r.authorization===`Bearer ${token}`));
});

test('failed secure deletion cannot leave a revoked session usable in memory',async t=>{
 const {owner}=await setup(t,{network:'revoked',clearFails:true});
 await assert.rejects(owner.restore(),e=>e.code==='STORAGE');
 assert.equal(owner.getSnapshot().status,'locked');assert.throws(()=>owner.requireSession(),e=>e.code==='SESSION_REVOKED');
});

test('online logout revokes token then clears durable authentication',async t=>{
 const {owner,vault,requests}=await setup(t);await owner.restore();await owner.logout();
 assert.equal(owner.getSnapshot().status,'signed-out');assert.equal(await vault.read(),null);
 assert.equal(requests.at(-1).path,'/v1/auth/logout');
});
