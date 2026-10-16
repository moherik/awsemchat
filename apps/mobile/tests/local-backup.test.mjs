import test from 'node:test';import assert from 'node:assert/strict';
import * as local from '../src/features/backup/local-backup.ts';
function fixture(){
 let current='session';let written=[];let removed=false;let imported=[];let generated=0;
 const file={uri:'content://owned-file',write:async bytes=>{written.push(bytes);},remove:async()=>{removed=true;}};
 const io={destination:async()=>file,source:async()=>({size:20,read:async()=> 'encrypted-archive'})};
 const history={create:async save=>{generated++;await save('encrypted-archive');return {records:2,recoveryKey:'separate-key'};},restore:async(...args)=>{imported=args;return {records:2};}};
 const service=local.createLocalBackup(history,io,()=>current);
 return {service,io,file,history,written,get removed(){return removed;},get imported(){return imported;},get generated(){return generated;},change:()=>{current='other-session';}};
}
test('cancelled export creates no archive and exposes no recovery key',async()=>{
 const f=fixture();f.io.destination=async()=>null;assert.deepEqual(await f.service.create(),{cancelled:true});assert.equal(f.generated,0);assert.deepEqual(f.written,[]);
});
test('successful local backup writes ciphertext and returns a separate recovery key',async()=>{
 const f=fixture();const result=await f.service.create();assert.deepEqual(f.written,['encrypted-archive']);assert.equal(result.recoveryKey,'separate-key');assert.equal(result.records,2);assert.equal(result.uri,'content://owned-file');
});
test('failed local write removes only the newly owned partial file',async()=>{
 const f=fixture();f.file.write=async()=>{throw Error('disk full');};await assert.rejects(f.service.create());assert.equal(f.removed,true);
});
test('session changed during folder selection cannot export another account',async()=>{
 const f=fixture();f.io.destination=async()=>{f.change();return f.file;};await assert.rejects(f.service.create(),{message:'SESSION_REVOKED'});assert.equal(f.generated,0);assert.equal(f.removed,true);
});
test('oversized imported file is rejected before it is read or restored',async()=>{
 const f=fixture();let read=false;f.io.source=async()=>({size:25*1024*1024,read:async()=>{read=true;return 'file';}});await assert.rejects(f.service.restore('key'),{message:'CAPACITY'});assert.equal(read,false);assert.deepEqual(f.imported,[]);
});
test('local restore reads ciphertext and passes the separately supplied key',async()=>{
 const f=fixture();assert.deepEqual(await f.service.restore('key'),{cancelled:false,records:2});assert.deepEqual(f.imported,['encrypted-archive','key']);
});
test('cancelled restore leaves history unchanged',async()=>{
 const f=fixture();f.io.source=async()=>null;assert.deepEqual(await f.service.restore('key'),{cancelled:true});assert.deepEqual(f.imported,[]);
});
test('session change during file reading prevents plaintext import',async()=>{
 const f=fixture();f.io.source=async()=>({size:20,read:async()=>{f.change();return 'archive';}});await assert.rejects(f.service.restore('key'),{message:'SESSION_REVOKED'});assert.deepEqual(f.imported,[]);
});
