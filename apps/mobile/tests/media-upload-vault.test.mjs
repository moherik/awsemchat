import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const module=await import('../src/features/media/upload-vault.ts').catch(()=>({}));
const binding='a'.repeat(64),job={version:1,binding,circleId:'circle',epoch:2,phase:'prepared',operationID:'avatar-operation',uploadAttempted:false,prepared:{descriptor:{version:1,id:'photo',key:'b'.repeat(64),size:1,mimeType:'image/png'},ciphertext:'YWJjZA=='}};
function fixture(){
 let metadata=null,next=0,lose=false;const files=new Map();
 const ports={readMetadata:async()=>metadata,writeMetadata:async value=>{metadata=value;if(lose){lose=false;throw Error('LOST_REPLY');}},clearMetadata:async()=>{metadata=null;},writeFile:async(name,value)=>{files.set(name,value);},readFile:async name=>{if(!files.has(name))throw Error('MISSING');return files.get(name);},removeFile:async name=>{files.delete(name);},name:()=>`file-${++next}.bin`,digest:async value=>createHash('sha256').update(value).digest('hex')};
 assert.equal(typeof module.createMediaUploadVault,'function','protected media upload vault missing');
 return{ports,files,vault:module.createMediaUploadVault(ports,binding),metadata:()=>metadata,lose:()=>{lose=true;}};
}
test('ciphertext lives in a file with a small protected pointer and survives reconstruction',async()=>{
 const f=fixture();await f.vault.write(job);
 assert.equal([...f.files.values()][0],job.prepared.ciphertext);assert.equal(f.metadata().includes(job.prepared.ciphertext),false);assert.ok(f.metadata().length<2048);
 const reopened=module.createMediaUploadVault(f.ports,binding);assert.deepEqual(await reopened.read(),job);
 await reopened.write({...job,phase:'uploaded',uploadAttempted:true});assert.equal(f.files.size,1);await reopened.clear();assert.equal(f.files.size,0);assert.equal(f.metadata(),null);
});
test('protected avatar pointers retain the intended revision and reject revision replacement',async()=>{
 const f=fixture(),profileIntent={operation:'avatar-operation',revision:7};await f.vault.write({...job,profileRevision:7,profileIntent});assert.equal((await f.vault.read()).profileIntent.revision,7);
 await assert.rejects(f.vault.write({...job,profileRevision:8,profileIntent:{operation:'avatar-operation',revision:8}}),/OPERATION_CONFLICT/);
});
test('a committed pointer with a lost reply retains its file for exact recovery',async()=>{
 const f=fixture();f.lose();await assert.rejects(f.vault.write(job),/LOST_REPLY/);assert.equal(f.files.size,1);
 assert.deepEqual(await module.createMediaUploadVault(f.ports,binding).read(),job);
 await f.vault.write(job);assert.equal(f.files.size,1);
});
test('conflicting media and completion downgrade are rejected without deleting pending data',async()=>{
 const f=fixture();await f.vault.write(job);
 await assert.rejects(f.vault.write({...job,epoch:3}),/OPERATION_CONFLICT/);
 await assert.rejects(f.vault.write({...job,prepared:{...job.prepared,ciphertext:'ZWZnaA=='}}),/OPERATION_CONFLICT/);
 await f.vault.write({...job,phase:'uploaded',uploadAttempted:true});await assert.rejects(f.vault.write(job),/OPERATION_CONFLICT/);assert.equal(f.files.size,1);
});
test('tampered ciphertext and account binding fail closed',async()=>{
 const f=fixture();await f.vault.write(job);f.files.set([...f.files.keys()][0],'ZWZnaA==');
 await assert.rejects(f.vault.read(),/VAULT_INVALID/);await assert.rejects(f.vault.clear(),/VAULT_INVALID/);assert.ok(f.metadata());
 const g=fixture();await g.vault.write(job);await assert.rejects(module.createMediaUploadVault(g.ports,'c'.repeat(64)).read(),/VAULT_INVALID/);
});
test('protected sticker upload intent survives reopening and rejects relabeling or new operation',async()=>{
 const f=fixture(),intent={action:'add',id:'sticker-one',kind:'sticker',label:'Hello',revision:0,operation:'collection-operation'},saved={...job,collectionIntent:intent};
 await f.vault.write(saved);assert.deepEqual(await module.createMediaUploadVault(f.ports,binding).read(),{...saved,operationID:'collection-operation'});
 for(const changed of [{label:'Changed'},{operation:'other'},{revision:1}])await assert.rejects(f.vault.write({...saved,collectionIntent:{...intent,...changed}}),/OPERATION_CONFLICT|VAULT_INVALID/);
 await f.vault.write({...saved,phase:'uploaded',uploadAttempted:true});assert.deepEqual((await f.vault.read()).collectionIntent,intent);
});
test('invalid collection intent and mixed avatar ownership cannot enter protected storage',async()=>{
 const f=fixture(),intent={action:'add',id:'one',kind:'emoji',label:'hello',revision:0,operation:'operation'};
 for(const changed of [{label:'Not an emoji name'},{revision:-1},{operation:'../bad'},{kind:'photo'},{extra:'private'}])await assert.rejects(f.vault.write({...job,collectionIntent:{...intent,...changed}}),/VAULT_INVALID/);
 await assert.rejects(f.vault.write({...job,profileRevision:1,collectionIntent:intent}),/VAULT_INVALID/);
});

test('snapshot refresh intent has its own action and cannot be replayed as a sticker add',async()=>{const f=fixture(),intent={action:'snapshot-refresh',id:'one',kind:'sticker',label:'Hello',revision:4,operation:'snapshot-operation'};await f.vault.write({...job,collectionIntent:intent});assert.deepEqual((await f.vault.read()).collectionIntent,intent);await assert.rejects(f.vault.write({...job,collectionIntent:{...intent,action:'add'}}),/OPERATION_CONFLICT/);});

test('Moment caption and stable operation remain bound to protected encrypted media after reopening',async()=>{
 const f=fixture(),intent={operation:'moment-operation',caption:'Sunday together'};
 await f.vault.write({...job,momentIntent:intent});
 const reopened=module.createMediaUploadVault(f.ports,'a'.repeat(64));
 assert.deepEqual((await reopened.read()).momentIntent,intent);
 await assert.rejects(reopened.write({...job,momentIntent:{...intent,caption:'Changed'}}),/OPERATION_CONFLICT/);
});
test('Chat photo intent remains sealed with the ciphertext file and conflicts on replacement',async()=>{
 const f=fixture(),intent={operation:'chat-photo-operation',caption:'Family dinner'};
 await f.vault.write({...job,chatImageIntent:intent});
 const reopened=module.createMediaUploadVault(f.ports,'a'.repeat(64));
 assert.deepEqual((await reopened.read()).chatImageIntent,intent);
 await assert.rejects(reopened.write({...job,chatImageIntent:{...intent,caption:'Changed'}}),/OPERATION_CONFLICT/);
});
