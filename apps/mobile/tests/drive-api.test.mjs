import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import * as drive from '../src/features/backup/drive-api.ts';
import {createDriveBackup} from '../src/features/backup/drive-backup.ts';
const session={accessToken:'synthetic-google-token',binding:'google-account:awsem-account:generation'};
const file={id:'file-one',name:'AwsemChat.awsembackup',size:'4',modifiedTime:'2026-10-12T00:00:00Z',spaces:['appDataFolder'],appProperties:{backupFormat:'awsemchat.history.v1'}};
async function fixture(t,respond,current=()=>session){
 const requests=[];const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({path:req.url,method:req.method,body,authorization:req.headers.authorization,range:req.headers["content-range"]});await respond(req,res,body);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const origin=`http://127.0.0.1:${server.address().port}`;return {api:drive.createDriveAPI(current,{origin,development:true}),requests,origin};
}
test('Drive upload puts ciphertext in appdata with no recovery key in metadata',async t=>{
 let origin;const f=await fixture(t,(req,res)=>{
  if(req.method==='POST'){res.setHeader('Location',`${origin}/upload/drive/v3/files?upload_id=synthetic`);res.end();}
  else res.end(JSON.stringify(file));
 });origin=f.origin;
 const uri=await f.api.beginUpload('file-one',4);assert.equal((await f.api.upload('file-one',uri,'YQ==')).id,'file-one');
 const metadata=JSON.parse(f.requests[0].body);assert.equal(metadata.id,'file-one');assert.deepEqual(metadata.parents,['appDataFolder']);assert.deepEqual(metadata.appProperties,{backupFormat:'awsemchat.history.v1'});
 assert.equal(f.requests[1].body,'YQ==');assert.equal(f.requests[1].authorization,`Bearer ${session.accessToken}`);
 assert.equal(JSON.stringify(f.requests).includes('recoveryKey'),false);
});
test('foreign resumable URL is rejected without forwarding credentials',async t=>{
 const f=await fixture(t,(_,res)=>{res.setHeader('Location','https://attacker.example/upload');res.end();});
 await assert.rejects(f.api.beginUpload('file-one',4),{message:'INVALID_RESPONSE'});assert.equal(f.requests.length,1);
});
test('Drive listing filters appdata backups and preserves pagination',async t=>{
 const f=await fixture(t,(_,res)=>res.end(JSON.stringify({files:[file],nextPageToken:'next-page'})));
 const page=await f.api.list('previous-page');assert.equal(page.items[0].id,'file-one');assert.equal(page.cursor,'next-page');
 const url=new URL(f.requests[0].path,'https://fixture');assert.equal(url.searchParams.get('spaces'),'appDataFolder');assert.equal(url.searchParams.get('pageToken'),'previous-page');assert.match(url.searchParams.get('q'),/backupFormat/);
});
test('Drive download verifies backup metadata before fetching ciphertext',async t=>{
 const f=await fixture(t,(req,res)=>res.end(req.url.includes('alt=media')?'YQ==':JSON.stringify(file)));
 assert.equal(await f.api.download('file-one'),'YQ==');assert.equal(f.requests.length,2);
});
test('non-backup or oversized metadata denies download before fetching contents',async t=>{
 for(const value of [{...file,spaces:['drive']},{...file,size:String(25*1024*1024)},{...file,appProperties:{}}]){
  const f=await fixture(t,(_,res)=>res.end(JSON.stringify(value)));await assert.rejects(f.api.download('file-one'));assert.equal(f.requests.length,1);
 }
});
test('Google account change suppresses downloaded data',async t=>{
 let current=session;const f=await fixture(t,(_,res)=>{current={...session,binding:'other-account'};res.end(JSON.stringify({files:[file]}));},()=>current);
 await assert.rejects(f.api.list(),{message:'SESSION_REVOKED'});
});
test('Drive authorization errors are sanitized',async t=>{
 const f=await fixture(t,(_,res)=>{res.statusCode=401;res.end('provider diagnostic with token');});await assert.rejects(f.api.list(),{message:'DRIVE_AUTH_REQUIRED'});
});
test('Drive file IDs are generated for exact retry without new duplicate files',async t=>{
 const f=await fixture(t,(_,res)=>res.end(JSON.stringify({ids:['file-generated']})));assert.equal(await f.api.generateId(),'file-generated');assert.match(f.requests[0].path,/generateIds/);
});
test('Drive redirects are rejected without sending credentials to a second server',async t=>{
 const receiver=await fixture(t,(_,res)=>res.end(JSON.stringify({files:[]})));
 const sender=await fixture(t,(_,res)=>{res.statusCode=302;res.setHeader('Location',`${receiver.origin}/drive/v3/files`);res.end();});
 await assert.rejects(sender.api.list(),{message:'UNAVAILABLE'});assert.equal(receiver.requests.length,0);
});
test('Drive listing rejects duplicate file identities and stalled pagination',async t=>{
 for(const value of [{files:[file,file]},{files:[file],nextPageToken:'same-page'}]){
  const f=await fixture(t,(_,res)=>res.end(JSON.stringify(value)));await assert.rejects(f.api.list('same-page'),{message:'INVALID_RESPONSE'});
 }
});
test('Drive download rejects bytes that do not match declared file metadata size',async t=>{
 const f=await fixture(t,(req,res)=>res.end(req.url.includes('alt=media')?'YWI=':JSON.stringify({...file,size:'8'})));
 await assert.rejects(f.api.download('file-one'),{message:'INVALID_RESPONSE'});
});
test('Drive upload status reads the server confirmed offset before resuming',async t=>{
 const f=await fixture(t,(_,res)=>{res.statusCode=308;res.setHeader('Range','bytes=0-1');res.end();});
 assert.deepEqual(await f.api.uploadStatus('file-one',`${f.origin}/upload/drive/v3/files?upload_id=one`,4),{phase:'incomplete',offset:2});assert.equal(f.requests[0].body,'');
});
test('Drive resume sends only remaining ciphertext with its absolute byte range',async t=>{
 const f=await fixture(t,(_,res)=>res.end(JSON.stringify(file)));await f.api.upload('file-one',`${f.origin}/upload/drive/v3/files?upload_id=one`,'YQ==',2);assert.equal(f.requests[0].body,'==');assert.equal(f.requests[0].range,'bytes 2-3/4');
});
test('Drive status recognizes completion and expired upload sessions',async t=>{
 const done=await fixture(t,(_,res)=>res.end(JSON.stringify(file)));assert.equal((await done.api.uploadStatus('file-one',`${done.origin}/upload/drive/v3/files?upload_id=one`,4)).phase,'complete');
 const expired=await fixture(t,(_,res)=>{res.statusCode=404;res.end();});assert.deepEqual(await expired.api.uploadStatus('file-one',`${expired.origin}/upload/drive/v3/files?upload_id=one`,4),{phase:'expired'});
});
test('Drive status rejects malformed or impossible received ranges',async t=>{
 for(const range of ['bytes=1-2','bytes=0-9','bytes=0-3','garbage']){
  const f=await fixture(t,(_,res)=>{res.statusCode=308;res.setHeader('Range',range);res.end();});await assert.rejects(f.api.uploadStatus('file-one',`${f.origin}/upload/drive/v3/files?upload_id=one`,4),{message:'INVALID_RESPONSE'});
 }
});

test('real HTTP retry resumes a partially received encrypted archive without a new file or key',async t=>{
 let origin;let first=true;let received='';
 const f=await fixture(t,(req,res,body)=>{
  if(req.url.includes('generateIds')) return res.end(JSON.stringify({ids:['file-one']}));
  if(req.method==='POST'){res.setHeader('Location',`${origin}/upload/drive/v3/files?upload_id=one`);return res.end();}
  if(req.headers['content-range']==='bytes */4'){res.statusCode=308;res.setHeader('Range','bytes=0-1');return res.end();}
  if(first){first=false;received=body.slice(0,2);req.socket.destroy();return;}
  assert.equal(req.headers['content-range'],'bytes 2-3/4');received+=body;res.end(JSON.stringify(file));
 });origin=f.origin;
 let job=null;let encrypted=0;
 const vault={read:async()=>job&&structuredClone(job),write:async value=>{job=structuredClone(value);},clear:async()=>{job=null;}};
 const history={create:async save=>{encrypted++;await save('YQ==');return {records:1,recoveryKey:'a'.repeat(64)};}};
 const run=()=>createDriveBackup(history,f.api,vault,()=>session.binding);
 await run().prepare();await assert.rejects(run().upload(),{message:'UNAVAILABLE'});await run().upload();
 assert.equal(received,'YQ==');assert.equal(job.phase,'uploaded');assert.equal(job.recoveryKey,'a'.repeat(64));assert.equal(encrypted,1);assert.equal(f.requests.filter(r=>r.path.includes('generateIds')).length,1);
});
test('HTTP308 with a redirect location never forwards credentials',async t=>{
 const receiver=await fixture(t,(_,res)=>res.end(JSON.stringify(file)));
 const sender=await fixture(t,(_,res)=>{res.statusCode=308;res.setHeader('Range','bytes=0-1');res.setHeader('Location',`${receiver.origin}/upload/drive/v3/files?upload_id=one`);res.end();});
 await assert.rejects(sender.api.uploadStatus('file-one',`${sender.origin}/upload/drive/v3/files?upload_id=one`,4),{message:'UNAVAILABLE'});assert.equal(receiver.requests.length,0);
});
test('native transport marking a manual HTTP308 as redirected still permits upload status',async t=>{
 const f=await fixture(t,(_,res)=>{res.statusCode=308;res.setHeader('Range','bytes=0-1');res.end();});
 const nativeLike=drive.createDriveAPI(()=>session,{origin:f.origin,development:true,fetcher:async(...args)=>{const response=await fetch(...args);Object.defineProperty(response,'redirected',{value:response.status===308});return response;}});
 assert.deepEqual(await nativeLike.uploadStatus('file-one',`${f.origin}/upload/drive/v3/files?upload_id=one`,4),{phase:'incomplete',offset:2});
});
