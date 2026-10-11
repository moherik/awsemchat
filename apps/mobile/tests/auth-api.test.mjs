import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAuthAPI, AuthError } from '../src/features/auth/api.ts';

const token='A'.repeat(43);
const session={accessToken:token,account:{id:'account-one',pin:'ABCDEFGH'},deviceId:'device-one',generation:1,expiresAt:'2099-01-01T00:00:00Z'};
async function fixture(t, respond) {
 const requests=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  requests.push({path:req.url,method:req.method,body:body?JSON.parse(body):null,authorization:req.headers.authorization});
  respond(req,res,requests.at(-1));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return {api:createAuthAPI(`http://127.0.0.1:${server.address().port}`,true),requests};
}
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}

test('auth client sends exact operation and device binding and parses session',async t=>{
 const {api,requests}=await fixture(t,(req,res)=>json(res,req.url.endsWith('challenges')?202:200,req.url.endsWith('challenges')?{challengeId:'challenge-one',expiresAt:'2099-01-01T00:00:00Z'}:session));
 assert.equal((await api.start('+6281234567890','device-one','operation-one')).challengeId,'challenge-one');
 assert.deepEqual(await api.verify('challenge-one','123456','device-one'),session);
 assert.deepEqual(requests.map(r=>r.body),[{phone:'+6281234567890',deviceId:'device-one',operationId:'operation-one'},{challengeId:'challenge-one',code:'123456',deviceId:'device-one'}]);
});

test('auth client uses bearer token and logout handles empty response',async t=>{
 const {api,requests}=await fixture(t,(req,res)=>{if(req.url.endsWith('logout')){res.writeHead(204);res.end();}else json(res,200,{accountId:'account-one',deviceId:'device-one',generation:1,expiresAt:'2099-01-01T00:00:00Z'});});
 assert.equal((await api.session(token)).accountId,'account-one');
 await api.logout(token);
 assert.deepEqual(requests.map(r=>[r.path,r.method,r.authorization]),[['/v1/session','GET',`Bearer ${token}`],['/v1/auth/logout','POST',`Bearer ${token}`]]);
});

test('auth client rejects unsafe API locations before sending private data',()=>{
 for(const [url,development] of [['http://api.example.com',false],['http://api.example.com',true],['https://user:password@api.example.com',false],['https://api.example.com?token=secret',false],['ftp://127.0.0.1',true]]){
  assert.throws(()=>createAuthAPI(url,development),e=>e instanceof AuthError&&e.code==='CONFIGURATION');
 }
});

test('auth client maps known errors without exposing provider response and does not retry verification',async t=>{
 const {api,requests}=await fixture(t,(_,res)=>json(res,401,{code:'INVALID_CODE',detail:'private provider details'}));
 await assert.rejects(api.verify('challenge-one','123456','device-one'),e=>e instanceof AuthError&&e.code==='INVALID_CODE'&&!e.message.includes('private'));
 assert.equal(requests.length,1);
});

test('auth client rejects malformed successful session data',async t=>{
 const {api}=await fixture(t,(_,res)=>json(res,200,{...session,generation:0,phone:'+6281234567890'}));
 await assert.rejects(api.verify('challenge-one','123456','device-one'),e=>e instanceof AuthError&&e.code==='INVALID_RESPONSE');
});

test('revoked-session response is preserved for the local session owner',async t=>{
 const {api}=await fixture(t,(_,res)=>json(res,401,{code:'SESSION_REVOKED'}));
 await assert.rejects(api.session(token),e=>e instanceof AuthError&&e.code==='SESSION_REVOKED');
});

test('session for a different device cannot complete verification',async t=>{
 const {api}=await fixture(t,(_,res)=>json(res,200,{...session,deviceId:'another-device'}));
 await assert.rejects(api.verify('challenge-one','123456','device-one'),e=>e instanceof AuthError&&e.code==='INVALID_RESPONSE');
});

test('transport interruption becomes a safe network error',async t=>{
 const {api}=await fixture(t,(req)=>req.socket.destroy());
 await assert.rejects(api.start('+6281234567890','device-one','operation-one'),e=>e instanceof AuthError&&e.code==='NETWORK');
});
