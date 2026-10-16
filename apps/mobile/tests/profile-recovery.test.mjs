import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../src/features/messages/profile-recovery.ts').catch(()=>({}));
const draft={operation:'profile-one',circleId:'circle',plaintext:'private draft',contentType:'circle-profile',profileRevision:2};
function fixture(){let binding='owner',queued=true,receipt=null,retired=false;const raw='{"operation":"profile-one","contentType":"circle-profile","opaque":"ciphertext"}';
 const ports={binding:()=>binding,native:{profileRecoveryDraft:async()=>{if(retired)throw Object.assign(Error('OPERATION_CANCELLED'),{code:'OPERATION_CANCELLED'});return raw;},confirmSend:async value=>{receipt=value;queued=false;},retireProfile:async value=>{assert.deepEqual(value,{operation:draft.operation,envelope:raw});retired=true;queued=false;}},cancel:async()=>({state:'cancelled',operation:draft.operation})};
 assert.equal(typeof module.recoverProfileUpdate,'function','profile recovery coordinator missing');return{ports,get queued(){return queued;},get receipt(){return receipt;},get retired(){return retired;},replace:()=>{binding='replacement';}};
}
test('confirmed cancellation retires only the original pending profile',async()=>{const f=fixture();assert.equal(await module.recoverProfileUpdate(f.ports,draft),'cancelled');assert.equal(f.retired,true);assert.equal(f.queued,false);assert.equal(f.receipt,null);assert.equal(await module.recoverProfileUpdate(f.ports,draft),'cancelled');});
test('committed outcome confirms the original event and never retires it',async()=>{const f=fixture();f.ports.cancel=async()=>({state:'committed',operation:draft.operation,event:{id:'event-one',operation:draft.operation,status:'sent'}});assert.equal(await module.recoverProfileUpdate(f.ports,draft),'committed');assert.deepEqual(f.receipt,{operation:draft.operation,event:'event-one',status:'sent'});assert.equal(f.retired,false);});
test('lost cancellation replies keep native data for exact retry',async()=>{const f=fixture();f.ports.cancel=async()=>{throw Error('NETWORK');};await assert.rejects(module.recoverProfileUpdate(f.ports,draft),/NETWORK/);assert.equal(f.queued,true);assert.equal(f.retired,false);});
test('account transitions or mismatched outcomes cannot alter native pending state',async()=>{for(const mutate of [f=>{f.replace();return{state:'cancelled',operation:draft.operation};},()=>({state:'cancelled',operation:'other'})]){const f=fixture();f.ports.cancel=async()=>mutate(f);await assert.rejects(module.recoverProfileUpdate(f.ports,draft));assert.equal(f.queued,true);assert.equal(f.retired,false);}});
test('ordinary chat drafts cannot enter profile retirement',async()=>{const f=fixture();await assert.rejects(module.recoverProfileUpdate(f.ports,{...draft,contentType:'text'}),/INVALID_INPUT/);assert.equal(f.queued,true);});
test('cleanup failure keeps the native draft as durable restart recovery until exact cleanup succeeds',async()=>{
 const f=fixture();let attempts=0;
 f.ports.cleanupCancelled=async value=>{assert.deepEqual(value,draft);assert.equal(f.queued,true);attempts++;if(attempts===1)throw Error('STORAGE_UNAVAILABLE');};
 await assert.rejects(module.recoverProfileUpdate(f.ports,draft),/STORAGE_UNAVAILABLE/);assert.equal(f.retired,false);assert.equal(f.queued,true);
 assert.equal(await module.recoverProfileUpdate(f.ports,draft),'cancelled');assert.equal(attempts,2);assert.equal(f.retired,true);
});
test('a committed profile never releases its avatar recovery upload',async()=>{
 const f=fixture();let cleanups=0;f.ports.cleanupCancelled=async()=>{cleanups++;};
 f.ports.cancel=async()=>({state:'committed',operation:draft.operation,event:{id:'accepted',operation:draft.operation,status:'sent'}});
 await module.recoverProfileUpdate(f.ports,draft);assert.equal(cleanups,0);assert.equal(f.retired,false);
});
test('account changes during cleanup cannot retire the original native draft',async()=>{
 const f=fixture();f.ports.cleanupCancelled=async()=>{f.replace();};
 await assert.rejects(module.recoverProfileUpdate(f.ports,draft),/SESSION_CHANGED/);assert.equal(f.retired,false);
});
test('recreated upload and profile coordinators recover a lost local-clear reply without republishing',async()=>{
 const {createCircleMediaUpload}=await import('../src/features/media/upload.ts');
 const {createCircleAvatarMedia}=await import('../src/features/social/circle-avatar.ts');
 const f=fixture();let record=null,lost=true,network=0;
 const descriptor={version:1,id:'avatar',key:'a'.repeat(64),size:1,mimeType:'image/png'},avatar={epoch:1,media:descriptor};
 const vault={read:async()=>structuredClone(record),write:async value=>{record=structuredClone(value);},clear:async()=>{record=null;if(lost){lost=false;throw Error('LOST_CLEAR_REPLY');}}};
 const uploadPorts={account:()=>({id:'owner',binding:'bound'}),operation:()=> 'avatar-operation',vault,media:()=>({prepare:async()=>({descriptor,ciphertext:'YWJjZA=='}),restore:async value=>value,upload:async()=>{throw Error('must not upload');},cancel:async()=>({state:'cancelled'})})};
 await createCircleMediaUpload(uploadPorts,'circle').prepare({bytes:new Uint8Array([1]),mimeType:'image/png'},1,1);
 const saved={...draft,plaintext:JSON.stringify({version:1,name:'Family',description:'',avatar})};
 f.ports.cancel=async()=>{network++;return {state:'cancelled',operation:draft.operation};};
 function restartedPorts(){const media=createCircleAvatarMedia({upload:async()=>createCircleMediaUpload(uploadPorts,'circle'),download:async()=>{throw Error('must not download');}});return {...f.ports,cleanupCancelled:async()=>media.cancelled(avatar,2)};}
 await assert.rejects(module.recoverProfileUpdate(restartedPorts(),saved),/LOST_CLEAR_REPLY/);assert.equal(record,null);assert.equal(f.queued,true);
 assert.equal(await module.recoverProfileUpdate(restartedPorts(),saved),'cancelled');assert.equal(f.retired,true);assert.equal(network,2);assert.equal(record,null);
});
