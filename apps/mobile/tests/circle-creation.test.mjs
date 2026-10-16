import test from 'node:test';
import assert from 'node:assert/strict';
import {createCircleCreation} from '../src/features/social/circle-creation.ts';
function fixture(){
 let saved=null,binding='account-device',next=0,failCreate=false,failProfile=false,failInvite=false;
 const created=new Map(),profiles=new Map(),invites=new Set();
 const vault={read:async()=>saved,write:async value=>{saved=structuredClone(value);},clear:async()=>{saved=null;}};
 const ports={vault,binding:()=>binding,operation:()=>`op-${++next}`,api:{createCircle:async operation=>{assert.ok(saved);if(!created.has(operation))created.set(operation,'circle-one');if(failCreate){failCreate=false;throw Error('NETWORK');}return {id:created.get(operation),epoch:1,memberCount:1,closed:false};},circle:async()=>({id:'circle-one',epoch:1,memberCount:1,closed:false,members:[{accountId:'self',pin:'ABCDEFGH',role:'admin',intervalId:'self-interval',joinedEpoch:1}]}),invite:async(circle,peer)=>{invites.add(peer);if(failInvite){failInvite=false;throw Error('NETWORK');}return {id:`invite-${peer}`,circleId:circle,inviteeId:peer,inviterId:'self',status:'pending'};}},sender:{send:async draft=>{profiles.set(draft.operation,structuredClone(draft));if(failProfile){failProfile=false;throw Error('NETWORK');}return {id:'profile-event',operation:draft.operation,status:'sent'};}}};
 return {ports,vault,created,profiles,invites,get saved(){return saved;},failCreate:()=>{failCreate=true;},failProfile:()=>{failProfile=true;},failInvite:()=>{failInvite=true;},change:()=>{binding='different-account';}};
}
const draft={name:'Family',description:'Plans',avatar:null,invitees:['bob','carol']};
test('creation persists its exact operations before contacting the relay',async()=>{
 const f=fixture();f.vault.write=async()=>{throw Error('STORAGE');};const flow=createCircleCreation(f.ports);await assert.rejects(flow.start(draft));assert.equal(f.created.size,0);assert.equal(f.profiles.size,0);
});
test('lost create reply resumes the original Circle without creating another',async()=>{
 const f=fixture();f.failCreate();await assert.rejects(createCircleCreation(f.ports).start(draft));assert.ok(f.saved);
 const result=await createCircleCreation(f.ports).resume();assert.equal(result.circleId,'circle-one');assert.equal(f.created.size,1);assert.equal(f.saved.completed,true);assert.deepEqual([...f.invites],['bob','carol']);await createCircleCreation(f.ports).acknowledge(result.circleId);assert.equal(f.saved,null);
});
test('lost profile reply retries its identical encrypted draft after reopening',async()=>{
 const f=fixture();f.failProfile();await assert.rejects(createCircleCreation(f.ports).start(draft));const original=[...f.profiles.values()][0];await createCircleCreation(f.ports).resume();assert.equal(f.created.size,1);assert.equal(f.profiles.size,1);assert.deepEqual([...f.profiles.values()][0],original);assert.equal(original.contentType,'circle-profile');assert.equal(original.profileRevision,1);
});
test('partial invitation failure keeps creation recoverable without changing its selection',async()=>{
 const f=fixture();f.failInvite();await assert.rejects(createCircleCreation(f.ports).start(draft));await assert.rejects(createCircleCreation(f.ports).start({...draft,name:'Other'}),error=>error.message==='CREATION_PENDING');await createCircleCreation(f.ports).resume();assert.deepEqual([...f.invites],['bob','carol']);assert.equal(f.created.size,1);
});
test('account change during creation cannot publish the old profile or return a new account result',async()=>{
 const f=fixture();const create=f.ports.api.createCircle;f.ports.api.createCircle=async operation=>{const result=await create(operation);f.change();return result;};await assert.rejects(createCircleCreation(f.ports).start(draft),error=>error.message==='SESSION_CHANGED');assert.equal(f.profiles.size,0);assert.ok(f.saved);
});
test('Circle invitation selection rejects duplicates and more than nineteen invitees',async()=>{
 const f=fixture();for(const invitees of [['bob','bob'],Array.from({length:20},(_,i)=>`friend-${i}`)])await assert.rejects(createCircleCreation(f.ports).start({...draft,invitees}),error=>error.message==='INVALID_INPUT');assert.equal(f.saved,null);assert.equal(f.created.size,0);
});
test('expired account binding returns a rejected promise rather than throwing during a UI action',async()=>{
 const f=fixture();f.ports.binding=()=>{throw Error('SESSION_REVOKED');};const flow=createCircleCreation(f.ports);let pending;assert.doesNotThrow(()=>{pending=flow.resume();});await assert.rejects(pending,{message:'SESSION_REVOKED'});
});
test('concurrent creation controllers sharing a vault cannot create two Circles',async()=>{
 const f=fixture();f.failCreate();const a=createCircleCreation(f.ports),b=createCircleCreation(f.ports);const results=await Promise.allSettled([a.start(draft),b.start(draft)]);assert.ok(results.every(item=>item.status==='rejected'));assert.equal(f.created.size,1);assert.ok(f.saved);
});
test('corrupt recovery state cannot create another Circle or silently overwrite the draft',async()=>{
 const f=fixture();f.vault.read=async()=>({version:1,binding:'different-account',payload:'private corrupt state'});const flow=createCircleCreation(f.ports);await assert.rejects(flow.resume(),{message:'VAULT_INVALID'});assert.equal(f.created.size,0);assert.equal(f.profiles.size,0);
});
test('completed creation stays recoverable until the UI acknowledges the result',async()=>{
 const f=fixture();const flow=createCircleCreation(f.ports);await flow.start(draft);assert.ok(f.saved,'completed creation must remain recoverable');assert.equal(f.saved.completed,true);assert.equal(f.saved.circleId,'circle-one');f.ports.api.createCircle=async()=>{throw Error('unexpected new creation');};f.ports.api.circle=async()=>{throw Error('unexpected membership fetch');};assert.deepEqual(await createCircleCreation(f.ports).resume(),{circleId:'circle-one'});await flow.acknowledge('circle-one');assert.equal(f.saved,null);
});
test('explicitly finishing after invitation failure preserves the Circle without retrying invitations',async()=>{
 const f=fixture();f.failInvite();const flow=createCircleCreation(f.ports);
 await assert.rejects(flow.start(draft));const original=structuredClone(f.saved);
 assert.equal(typeof flow.finishWithoutInvitations,'function','explicit invitation recovery is missing');
 assert.deepEqual(await flow.finishWithoutInvitations('circle-one'),{circleId:'circle-one'});
 assert.deepEqual(f.saved,{...original,completed:true});
 await createCircleCreation(f.ports).resume();assert.deepEqual([...f.invites],['bob']);
 assert.equal(f.created.size,1);assert.equal(f.profiles.size,1);
 await flow.acknowledge('circle-one');assert.equal(f.saved,null);
});
test('finishing without invitations cannot bypass a missing accepted profile or a different Circle',async()=>{
 for(const stage of ['create','profile','wrong-circle']){
  const f=fixture();if(stage==='create')f.failCreate();else if(stage==='profile')f.failProfile();else f.failInvite();
  const flow=createCircleCreation(f.ports);await assert.rejects(flow.start(draft));const original=structuredClone(f.saved);
  assert.equal(typeof flow.finishWithoutInvitations,'function','explicit invitation recovery is missing');
  await assert.rejects(flow.finishWithoutInvitations(stage==='wrong-circle'?'circle-other':'circle-one'),{message:'CREATION_PENDING'});
  assert.deepEqual(f.saved,original);
 }
});
test('failed completion persistence retains invitations for normal retry',async()=>{
 const f=fixture();f.failInvite();const flow=createCircleCreation(f.ports);await assert.rejects(flow.start(draft));
 assert.equal(typeof flow.finishWithoutInvitations,'function','explicit invitation recovery is missing');
 const write=f.vault.write;f.vault.write=async()=>{throw Error('STORAGE');};
 await assert.rejects(flow.finishWithoutInvitations('circle-one'),{message:'STORAGE'});assert.equal(f.saved.completed,false);
 f.vault.write=write;await flow.resume();assert.deepEqual([...f.invites],['bob','carol']);
});
test('replaced account cannot finish an old Circle creation',async()=>{
 const f=fixture();f.failInvite();const flow=createCircleCreation(f.ports);await assert.rejects(flow.start(draft));f.change();
 assert.equal(typeof flow.finishWithoutInvitations,'function','explicit invitation recovery is missing');
 await assert.rejects(flow.finishWithoutInvitations('circle-one'),{message:'VAULT_INVALID'});assert.equal(f.saved.completed,false);
});
