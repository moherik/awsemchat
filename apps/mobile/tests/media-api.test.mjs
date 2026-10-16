import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

async function fixture(t,handler) {
 const server=http.createServer(handler); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 return `http://127.0.0.1:${server.address().port}`;
}
const session={accessToken:'synthetic-token',account:{id:'alice',pin:'ABCDEFGH'},deviceId:'phone',generation:1,expiresAt:'2099-01-01T00:00:00Z'};
async function factory(){return (await import('../src/features/media/api.ts')).createCircleMediaStorage;}
async function privateFactory(){return (await import('../src/features/media/api.ts')).createPrivateMediaStorage;}

test('Circle media HTTP sends only immutable ciphertext and preserves exact retry',async t=>{
 const calls=[];
 const origin=await fixture(t,async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  calls.push({method:req.method,path:req.url,body,auth:req.headers.authorization,type:req.headers['content-type']});
  if(req.method==='PUT'){res.writeHead(204);res.end();}else{res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('YWJjZA==');}
 });
 const create=await factory(),storage=create(origin,()=>session,{circleId:'circle-one',epoch:2},true);
 await storage.put('photo-one','YWJjZA==','message-one');await storage.put('photo-one','YWJjZA==','message-one');
 assert.equal(await storage.get('photo-one'),'YWJjZA==');
 assert.deepEqual(calls.slice(0,2),Array(2).fill({method:'PUT',path:'/v1/media/circles/circle-one/objects/photo-one?epoch=2&operation=message-one',body:'YWJjZA==',auth:'Bearer synthetic-token',type:'application/octet-stream'}));
 assert.equal(calls[2].path,'/v1/media/circles/circle-one/objects/photo-one');
});

test('media cancellation returns committed or cancelled and preserves owner binding',async t=>{
 const calls=[];let state='cancelled';
 const origin=await fixture(t,async(req,res)=>{
  for await(const _chunk of req){}
  calls.push({method:req.method,path:req.url,auth:req.headers.authorization});
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(state==='cancelled'?{state}:{state,eventId:'event-7'}));
 });
 const create=await factory(),storage=create(origin,()=>session,{circleId:'circle-one',epoch:2},true);
 assert.equal(typeof storage.cancel,'function','operation cancellation API missing');
 assert.deepEqual(await storage.cancel('message-one'),{state:'cancelled'});
 state='committed';
 assert.deepEqual(await storage.cancel('message-one'),{state:'committed',eventId:'event-7'});
 assert.deepEqual(calls,[
  {method:'POST',path:'/v1/media/circles/circle-one/operations/message-one/cancel',auth:'Bearer synthetic-token'},
  {method:'POST',path:'/v1/media/circles/circle-one/operations/message-one/cancel',auth:'Bearer synthetic-token'},
 ]);
});

test('media transport rejects unsafe origin and paths before networking',async()=>{
 const create=await factory();
 for(const origin of ['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com?key=secret'])assert.throws(()=>create(origin,()=>session,{circleId:'circle',epoch:1},true),/CONFIGURATION/);
 const storage=create('https://example.com',()=>session,{circleId:'circle',epoch:1});
 await assert.rejects(storage.put('../escape','YWJjZA==','message-one'),/INVALID_INPUT/);
 await assert.rejects(storage.put('photo','not-ciphertext','message-one'),/INVALID_INPUT/);
 await assert.rejects(storage.put('photo','YWJjZA=='),/INVALID_INPUT/);
 await assert.rejects(storage.get('../escape'),/INVALID_INPUT/);
});

test('media transport suppresses results after account change and retires its owner',async t=>{
 let current=session;
 const origin=await fixture(t,(_,res)=>{current={...session,generation:2};res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('YWJjZA==');});
 const create=await factory(),storage=create(origin,()=>current,{circleId:'circle',epoch:1},true);
 await assert.rejects(storage.get('photo'),/SESSION_CHANGED/);
 await assert.rejects(storage.put('photo','YWJjZA==','message-one'),/SESSION_CHANGED/);
});

test('media transport maps provider errors and rejects malformed success',async t=>{
 let mode='conflict';
 const origin=await fixture(t,(_,res)=>{
  if(mode==='conflict'){res.writeHead(409,{'Content-Type':'application/json'});res.end('{"code":"OBJECT_CONFLICT"}');}
  else if(mode==='put'){res.writeHead(200);res.end('unexpected');}
  else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>oops</html>');}
 });
 const create=await factory(),storage=create(origin,()=>session,{circleId:'circle',epoch:1},true);
 await assert.rejects(storage.put('photo','YWJjZA==','message-one'),/OBJECT_CONFLICT/);
 mode='put';await assert.rejects(storage.put('photo','YWJjZA==','message-one'),/INVALID_RESPONSE/);
 mode='get';await assert.rejects(storage.get('photo'),/INVALID_RESPONSE/);
});

test('private media transport is bound to the accepted friend audience and operation',async t=>{
 const calls=[];
 const origin=await fixture(t,async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  calls.push({method:req.method,path:req.url,body,auth:req.headers.authorization});
  if(req.method==='PUT'){res.writeHead(204);res.end();}
  else if(req.method==='POST'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"state":"cancelled"}');}
  else{res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('YWJjZA==');}
 });
 const create=await privateFactory();assert.equal(typeof create,'function','private friendship media adapter is missing');
 const storage=create(origin,()=>session,{peerId:'bob',audience:'friend:request-7'},true);
 await storage.put('photo-1','YWJjZA==','moment-op');
 assert.equal(await storage.get('photo-1'),'YWJjZA==');
 assert.deepEqual(await storage.cancel('moment-op'),{state:'cancelled'});
 assert.deepEqual(calls.map(({method,path,body,auth})=>({method,path,body,auth})),[
  {method:'PUT',path:'/v1/media/private/bob/objects/photo-1?audience=friend%3Arequest-7&operation=moment-op',body:'YWJjZA==',auth:'Bearer synthetic-token'},
  {method:'GET',path:'/v1/media/private/bob/objects/photo-1?audience=friend%3Arequest-7',body:'',auth:'Bearer synthetic-token'},
  {method:'POST',path:'/v1/media/private/bob/operations/moment-op/cancel?audience=friend%3Arequest-7',body:'',auth:'Bearer synthetic-token'},
 ]);
});
