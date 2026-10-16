import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import * as pending from '../src/features/backup/pending-backup-vault.ts';
const job={version:1,binding:'account-device-google',archive:'YQ==',recoveryKey:'a'.repeat(64),records:2,id:null,uploadURI:null,phase:'prepared'};
function fixture(){let metadata=null;const files=new Map();let n=0;
 const ports={readMetadata:async()=>metadata,writeMetadata:async value=>{metadata=value;},clearMetadata:async()=>{metadata=null;},writeFile:async(name,bytes)=>{files.set(name,bytes);},readFile:async name=>{if(!files.has(name))throw Error('missing');return files.get(name);},removeFile:async name=>{files.delete(name);},digest:async value=>createHash('sha256').update(value).digest('hex'),name:()=>`backup-${++n}.bin`};
 return {ports,files,get metadata(){return metadata;},vault:()=>pending.createPendingBackupVault(ports,job.binding)};
}
test('pending vault reopens encrypted bytes and separate protected recovery metadata',async()=>{
 const f=fixture();await f.vault().write(job);assert.deepEqual(await f.vault().read(),job);assert.equal(f.metadata.includes('YQ=='),false);assert.equal([...f.files.values()][0],'YQ==');assert.equal([...f.files.values()].some(v=>v.includes(job.recoveryKey)),false);
});
test('interrupted metadata update preserves the original recoverable archive',async()=>{
 const f=fixture();await f.vault().write(job);f.ports.writeMetadata=async()=>{throw Error('STORAGE');};await assert.rejects(f.vault().write({...job,id:'drive-id'}));assert.deepEqual(await f.vault().read(),job);
});
test('metadata commit followed by lost response never deletes the referenced ciphertext',async()=>{
 const f=fixture();const write=f.ports.writeMetadata;f.ports.writeMetadata=async raw=>{await write(raw);throw Error('COMMIT_UNKNOWN');};await assert.rejects(f.vault().write(job));assert.deepEqual(await f.vault().read(),job);
});
test('tampered ciphertext is rejected without resetting the protected job',async()=>{
 const f=fixture();await f.vault().write(job);const name=[...f.files.keys()][0];f.files.set(name,'Yg==');await assert.rejects(f.vault().read(),{message:'VAULT_INVALID'});assert.notEqual(f.metadata,null);
});
test('another account cannot load or overwrite the original pending key',async()=>{
 const f=fixture();await f.vault().write(job);const other=pending.createPendingBackupVault(f.ports,'other-account');await assert.rejects(other.read(),{message:'SESSION_REVOKED'});await assert.rejects(other.write({...job,binding:'other-account'}),{message:'SESSION_REVOKED'});assert.deepEqual(await f.vault().read(),job);
});
test('acknowledged clear removes protected metadata and only its owned ciphertext file',async()=>{
 const f=fixture();await f.vault().write(job);f.files.set('unrelated','preserve');await f.vault().clear();assert.equal(f.metadata,null);assert.deepEqual([...f.files.keys()],['unrelated']);
});
test('pending archive and recovery key cannot be silently replaced during upload',async()=>{
 const f=fixture();await f.vault().write({...job,id:'original-id'});
 for(const change of [{archive:'Yg=='},{recoveryKey:'b'.repeat(64)},{id:'different-id'}]) await assert.rejects(f.vault().write({...job,id:'original-id',...change}),{message:'OPERATION_CONFLICT'});
 assert.deepEqual(await f.vault().read(),{...job,id:'original-id'});
});
test('ciphertext changed after loading cannot be published as uploaded',async()=>{
 const f=fixture();await f.vault().write({...job,id:'original-id'});f.files.set([...f.files.keys()][0],'Yg==');await assert.rejects(f.vault().write({...job,id:'original-id',phase:'uploaded'}),{message:'VAULT_INVALID'});
});
