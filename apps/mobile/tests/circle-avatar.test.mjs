import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/features/social/circle-avatar.ts').catch(()=>({}));
const descriptor={version:1,id:'new-avatar',key:'a'.repeat(64),size:1,mimeType:'image/png'},old={epoch:1,media:{...descriptor,id:'old-avatar'}};
function fixture(){
 let pending=null,accepted=null;const calls=[];
 const upload={pending:async()=>pending,prepare:async(input,epoch,revision)=>{calls.push(['prepare',epoch,revision]);pending={epoch,profileRevision:revision,prepared:{descriptor},phase:'prepared'};},upload:async()=>{pending.phase='uploaded';calls.push('upload');return descriptor;},acknowledge:async()=>{calls.push('ack');pending=null;},cancel:async()=>{calls.push('cancel');pending=null;return{state:'cancelled'};}};
 assert.equal(typeof module.createCircleAvatarMedia,'function','Circle avatar media coordinator missing');
 const ports={upload:async purpose=>{calls.push(['open',purpose]);return upload;},download:async()=>new Uint8Array([1])};
 return{ports,calls,upload,service:module.createCircleAvatarMedia(ports),set pending(value){pending=value;},get pending(){return pending;}};
}
test('membership refresh creates a fresh object for the new epoch and retains intent until profile acceptance',async()=>{
 const f=fixture();assert.deepEqual(await f.service.rebind(old,2,7),{epoch:2,media:descriptor});assert.equal(f.pending.phase,'uploaded');assert.equal(f.calls.includes('ack'),false);
 await f.service.committed({epoch:2,media:descriptor},8);assert.equal(f.pending,null);
});
test('a changed revision cannot silently reuse an unrelated pending avatar copy',async()=>{
 const f=fixture();await f.service.rebind(old,2,7);await assert.rejects(f.service.rebind(old,2,8),/PROFILE_STALE/);assert.equal(f.calls.filter(v=>v==='upload').length,1);
});
test('accepted profile cleanup cannot clear a different pending avatar',async()=>{
 const f=fixture();await f.service.rebind(old,2,7);await f.service.committed(old,8);assert.ok(f.pending);assert.equal(f.calls.includes('ack'),false);
});
test('an older accepted revision cannot acknowledge a newer intended avatar update',async()=>{
 const f=fixture();const fresh=await f.service.rebind(old,2,7);await f.service.committed(fresh,7);assert.ok(f.pending);assert.equal(f.calls.includes('ack'),false);
});
test('cancelled profile releases only uploads matching its original avatar and base revision',async()=>{
 const f=fixture();const fresh=await f.service.rebind(old,2,7);
 f.upload.cancel=async()=>{f.calls.push('cancel');f.pending=null;return{state:'cancelled'};};
 assert.equal(typeof f.service.cancelled,'function','cancelled avatar recovery missing');
 await f.service.cancelled(fresh,9);assert.ok(f.pending);
 await f.service.cancelled(old,8);assert.ok(f.pending);
 await f.service.cancelled(fresh,8);assert.equal(f.pending,null);assert.equal(f.calls.filter(v=>v==='cancel').length,1);
});
