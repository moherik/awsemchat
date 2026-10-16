import test from 'node:test';import assert from 'node:assert/strict';
import * as drive from '../src/features/backup/drive-backup.ts';
function fixture(){
 let binding='account-device-google';let stored=null;let uploads=0;let generated=0;let encrypted=0;let remote=null;
 const vault={read:async()=>stored&&structuredClone(stored),write:async job=>{stored=structuredClone(job);},clear:async()=>{stored=null;}};
 const history={create:async save=>{encrypted++;await save('YQ==');return {recoveryKey:'a'.repeat(64),records:2};}};
 const api={uploadStatus:async()=>({phase:"incomplete",offset:0}),generateId:async()=>{generated++;return 'stable-id';},beginUpload:async()=> 'https://www.googleapis.com/upload/drive/v3/files?upload_id=one',upload:async(id,uri,bytes)=>{uploads++;assert.equal(stored.archive,bytes);assert.equal(stored.id,id);assert.equal(stored.uploadURI,uri);remote=bytes;return {id};},download:async()=>remote};
 const service=()=>drive.createDriveBackup(history,api,vault,()=>binding);
 return {service,vault,api,get stored(){return stored;},get uploads(){return uploads;},get generated(){return generated;},get encrypted(){return encrypted;},change:()=>{binding='different';},commit:()=>{remote='YQ==';}};
}
test('Drive backup persists archive and recovery key before sending bytes',async()=>{
 const f=fixture();await f.service().prepare();assert.equal(f.uploads,0);assert.equal(f.stored.recoveryKey,'a'.repeat(64));await f.service().upload();assert.equal(f.stored.phase,'uploaded');assert.equal(f.generated,1);assert.equal(f.uploads,1);
});
test('restarted upload retries original file ID bytes and key without re-encryption',async()=>{
 const f=fixture();await f.service().prepare();const upload=f.api.upload;f.api.upload=async()=>{throw Error('UNAVAILABLE');};await assert.rejects(f.service().upload());
 f.api.upload=upload;await f.service().upload();assert.equal(f.generated,1);assert.equal(f.encrypted,1);assert.equal(f.stored.recoveryKey,'a'.repeat(64));
});
test('pending archive is retained if its ID cannot be durably saved',async()=>{
 const f=fixture();await f.service().prepare();f.vault.write=async()=>{throw Error('STORAGE');};await assert.rejects(f.service().upload());assert.equal(f.uploads,0);assert.equal(f.stored.id,null);
});
test('lost remote commit followed by conflict verifies the exact original bytes',async()=>{
 const f=fixture();await f.service().prepare();f.api.beginUpload=async()=>{f.commit();throw Error('DRIVE_CONFLICT');};const result=await f.service().upload();assert.equal(result.recoveryKey,'a'.repeat(64));assert.equal(f.stored.phase,'uploaded');
});
test('conflict with different bytes cannot be marked complete or discard the key',async()=>{
 const f=fixture();await f.service().prepare();f.api.beginUpload=async()=>{throw Error('DRIVE_CONFLICT');};f.api.download=async()=> 'different';await assert.rejects(f.service().upload(),{message:'BACKUP_CONFLICT'});assert.equal(f.stored.phase,'prepared');assert.equal(f.stored.recoveryKey,'a'.repeat(64));
});
test('account change during ID allocation stops upload and preserves pending backup',async()=>{
 const f=fixture();await f.service().prepare();f.api.generateId=async()=>{f.change();return 'id';};await assert.rejects(f.service().upload(),{message:'SESSION_REVOKED'});assert.equal(f.uploads,0);assert.equal(f.stored.id,null);
});
test('uploaded backup remains recoverable until the user acknowledges saving the key',async()=>{
 const f=fixture();await f.service().prepare();await f.service().upload();const resumed=await f.service().prepare();assert.equal(resumed.recoveryKey,'a'.repeat(64));assert.equal(f.encrypted,1);await f.service().acknowledge();assert.equal(f.stored,null);
});
test('unfinished upload cannot be acknowledged and forgotten',async()=>{
 const f=fixture();await f.service().prepare();await assert.rejects(f.service().acknowledge(),{message:'BACKUP_PENDING'});assert.notEqual(f.stored,null);
});

test('restarted backup uses the confirmed offset and retains original ciphertext',async()=>{
 const f=fixture();await f.service().prepare();f.api.upload=async()=>{throw Error('UNAVAILABLE');};await assert.rejects(f.service().upload());
 f.api.uploadStatus=async()=>({phase:'incomplete',offset:2});let sent;
 f.api.upload=async(id,uri,bytes,offset)=>{sent={id,bytes,offset};return {id};};await f.service().upload();assert.deepEqual(sent,{id:'stable-id',bytes:'YQ==',offset:2});
});
test('completed status avoids retransmitting a committed backup after a lost response',async()=>{
 const f=fixture();await f.service().prepare();f.api.upload=async()=>{throw Error('UNAVAILABLE');};await assert.rejects(f.service().upload());
 f.api.uploadStatus=async()=>({phase:'complete'});f.api.upload=async()=>{throw Error('RETRANSMITTED');};await f.service().upload();assert.equal(f.stored.phase,'uploaded');
});
test('expired upload session is replaced while preserving assigned ID and key',async()=>{
 const f=fixture();await f.service().prepare();const upload=f.api.upload;f.api.upload=async()=>{throw Error('UNAVAILABLE');};await assert.rejects(f.service().upload());
 f.api.uploadStatus=async()=>({phase:'expired'});f.api.beginUpload=async(id)=>{assert.equal(id,'stable-id');assert.equal(f.stored.uploadURI,null);return 'https://www.googleapis.com/upload/drive/v3/files?upload_id=new';};f.api.upload=upload;
 await f.service().upload();assert.equal(f.generated,1);assert.equal(f.stored.recoveryKey,'a'.repeat(64));assert.match(f.stored.uploadURI,/upload_id=new/);
});
