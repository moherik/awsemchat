import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/features/media/upload.ts').catch(()=>({}));
function fixture(){
 let record=null,binding='fingerprint',lost=true;
 const uploads=[],prepared={descriptor:{version:1,id:'photo',key:'a'.repeat(64),size:1,mimeType:'image/png'},ciphertext:'YWJjZA=='};
 const vault={read:async()=>structuredClone(record),write:async value=>{record=structuredClone(value);},clear:async()=>{record=null;}};
 const cancellations=[],ports={account:()=>({id:'alice',binding}),operation:()=>`operation-${uploads.length+1}`,vault,media:epoch=>({prepare:async()=>prepared,restore:async value=>value,upload:async(value,operation)=>{assert.ok(record,'intent must precede HTTP');assert.equal(record.uploadAttempted,true,'upload attempt must be durably fenced before PUT');assert.ok(operation);uploads.push({epoch,ciphertext:value.ciphertext,id:value.descriptor.id,operation});if(lost){lost=false;throw Error('NETWORK');}return value.descriptor;},cancel:async operation=>{cancellations.push(operation);return{state:'cancelled'};}})};
 assert.equal(typeof module.createCircleMediaUpload,'function','durable media upload coordinator missing');
 return{ports,vault,uploads,cancellations,prepared,controller:module.createCircleMediaUpload(ports,'circle'),replace:()=>{binding='replacement';},saved:()=>record};
}
test('restart after lost upload reply uses original epoch ciphertext and retains completion',async()=>{
 const f=fixture();await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2);
 await assert.rejects(f.controller.upload(),/NETWORK/);
 const restarted=module.createCircleMediaUpload(f.ports,'circle');
 assert.deepEqual(await restarted.upload(),f.prepared.descriptor);
 assert.deepEqual(f.uploads,Array(2).fill({epoch:2,ciphertext:'YWJjZA==',id:'photo',operation:'operation-1'}));
 assert.equal((await restarted.pending()).phase,'uploaded');
 await restarted.upload();assert.equal(f.uploads.length,2);
 await restarted.acknowledge();assert.equal(await restarted.pending(),undefined);
});
test('avatar upload recovery retains its intended profile revision',async()=>{
 const f=fixture();await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2,7);
 const restarted=module.createCircleMediaUpload(f.ports,'circle');assert.equal((await restarted.pending()).profileRevision,7);
});
test('unconfirmed pending uploads cannot be replaced or acknowledged',async()=>{
 const f=fixture();await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2);
 await assert.rejects(f.controller.prepare({bytes:new Uint8Array([2]),mimeType:'image/png'},3),/MEDIA_PENDING/);
 await assert.rejects(f.controller.acknowledge(),/MEDIA_PENDING/);assert.ok(f.saved());
});
test('account transitions and invalid persisted media stop network work',async()=>{
 const f=fixture();await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2);f.replace();
 await assert.rejects(f.controller.upload(),/SESSION_CHANGED/);assert.equal(f.uploads.length,0);
 const g=fixture();await g.vault.write({version:1,binding:'other',circleId:'circle',epoch:2,prepared:g.prepared,phase:'prepared'});
 await assert.rejects(g.controller.upload(),/VAULT_INVALID/);assert.equal(g.uploads.length,0);
});
test('shared vault serializes concurrent prepare attempts',async()=>{
 const f=fixture(),other=module.createCircleMediaUpload(f.ports,'circle');
 const results=await Promise.allSettled([f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2),other.prepare({bytes:new Uint8Array([2]),mimeType:'image/png'},2)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.message,'MEDIA_PENDING');
});
test('release requires server cleanup after an upload attempt',async()=>{
 const f=fixture();await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2,7);
 await assert.rejects(f.controller.upload(),/NETWORK/);
 const saved=await f.controller.pending();
 assert.equal(typeof f.controller.release,'function','exact upload intent release missing');
 await assert.rejects(f.controller.release({...saved,profileRevision:8,profileIntent:{...saved.profileIntent,revision:8}}),/MEDIA_CONFLICT/);
 assert.ok(f.saved());await assert.rejects(f.controller.release(saved),/UPLOAD_CANCELLATION_REQUIRED/);
 await f.controller.cancel();assert.equal(await f.controller.pending(),undefined);
});
test('stale release cannot clear a replacement upload and account changes prevent release',async()=>{
 const f=fixture();await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2,7);const saved=await f.controller.pending();
 assert.equal(typeof f.controller.release,'function','exact upload intent release missing');
 await f.controller.release(saved);await f.controller.prepare({bytes:new Uint8Array([2]),mimeType:'image/png'},3,8);
 await assert.rejects(f.controller.release(saved),/MEDIA_CONFLICT/);assert.equal((await f.controller.pending()).epoch,3);
 f.replace();await assert.rejects(f.controller.release(await f.vault.read()),/SESSION_CHANGED/);assert.ok(f.saved());
});
test('cancellation releases local-only media but fences and deletes any attempted upload',async()=>{
 const f=fixture();await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2);
 const local=await f.controller.cancel();assert.deepEqual(local,{state:'cancelled'});assert.equal(f.cancellations.length,0);assert.equal(await f.controller.pending(),undefined);
 await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2);await assert.rejects(f.controller.upload(),/NETWORK/);
 const result=await module.createCircleMediaUpload(f.ports,'circle').cancel();assert.deepEqual(result,{state:'cancelled'});assert.deepEqual(f.cancellations,['operation-1']);assert.equal(await f.controller.pending(),undefined);
});
test('uncertain cancellation keeps protected media until server confirms cleanup',async()=>{
 const f=fixture();await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2);await assert.rejects(f.controller.upload(),/NETWORK/);
 const media=f.ports.media;f.ports.media=epoch=>({...media(epoch),cancel:async()=>{throw Error('NETWORK');}});
 await assert.rejects(f.controller.cancel(),/NETWORK/);assert.ok(f.saved());
});
test('committed cancellation keeps the exact upload intent for publisher reconciliation',async()=>{
 const f=fixture();f.ports.media=epoch=>({prepare:async()=>f.prepared,restore:async value=>value,upload:async value=>value.descriptor,cancel:async operation=>({state:'committed',eventId:`event-${operation}`})});
 await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2);
 await f.controller.upload();const result=await f.controller.cancel();
 assert.deepEqual(result,{state:'committed',eventId:'event-operation-1'});assert.equal((await f.controller.pending()).uploadAttempted,true);
});
test('sticker preparation owns intent before queued encryption and survives upload restart',async()=>{
 const f=fixture(),intent={action:'add',id:'one',kind:'sticker',label:'Hello',revision:0,operation:'operation'};
 const preparing=f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2,undefined,intent);intent.label='Changed';await preparing;
 const restarted=module.createCircleMediaUpload(f.ports,'circle');assert.equal((await restarted.pending()).collectionIntent.label,'Hello');
 await assert.rejects(restarted.upload(),/NETWORK/);await restarted.upload();assert.equal((await restarted.pending()).collectionIntent.operation,'operation');
});
test('Moment upload intent binds the exact caption and operation across protected retry state',async()=>{
 const f=fixture(),intent={operation:'moment-operation',caption:'Sunday together'};
 await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/jpeg'},2,undefined,undefined,intent);
 const restarted=module.createCircleMediaUpload(f.ports,'circle');
 assert.deepEqual((await restarted.pending()).momentIntent,intent);
});
test('Circle Chat photo intent binds its caption and operation across upload restart',async()=>{
 const f=fixture(),intent={operation:'chat-photo-operation',caption:'Family dinner'};
 await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/jpeg'},3,undefined,undefined,undefined,intent);
 const restarted=module.createCircleMediaUpload(f.ports,'circle');assert.deepEqual((await restarted.pending()).chatImageIntent,intent);
 await assert.rejects(restarted.prepare({bytes:new Uint8Array([2]),mimeType:'image/jpeg'},3,undefined,undefined,undefined,{...intent,caption:'Changed'}),/MEDIA_PENDING/);
});
test('personal sticker intent survives reopening without a collection mutation intent',async()=>{
 const f=fixture(),intent={operation:'sticker-op',item:'sticker-op',label:'Made for you'};
 await f.controller.prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},2,undefined,undefined,undefined,undefined,intent);
 const restarted=module.createCircleMediaUpload(f.ports,'circle');assert.deepEqual((await restarted.pending()).chatStickerIntent,intent);
});
