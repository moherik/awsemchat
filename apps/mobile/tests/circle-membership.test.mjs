import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/features/social/circle-membership.ts').catch(() => ({}));
function fixture() {
 let saved=null,binding='account-one',lose=false,role='admin',count=2,next=0;
 const completed=new Map();let calls=0;
 const ports={account:()=>({id:'alice',binding}),operation:()=>`operation-${++next}`,vault:{read:async()=>saved,write:async value=>{saved=structuredClone(value);},clear:async()=>{saved=null;}},api:{circle:async()=>({id:'circle-one',epoch:2,closed:false,memberCount:count,members:[{accountId:'alice',intervalId:'interval-alice',pin:'ABCDEFGH',role,joinedEpoch:1},...(count===1?[]:[{accountId:'bob',intervalId:'interval-bob',pin:'BCDEFGHJ',role:'member',joinedEpoch:2}])]}),mutateMembership:async(circle,input)=>{calls++;assert.ok(saved);if(!completed.has(input.operationId))completed.set(input.operationId,{circleId:circle,operationId:input.operationId,action:input.action,closed:input.action==='leave'&&count===1});if(lose){lose=false;throw Error('NETWORK');}return completed.get(input.operationId);}}};
 assert.equal(typeof module.createCircleMembership,'function','membership coordinator is missing');
 return {ports,controller:module.createCircleMembership(ports,'circle-one'),completed,get calls(){return calls;},get saved(){return saved;},lose:()=>{lose=true;},replace:()=>{binding='account-two';},set role(value){role=value;},set count(value){count=value;}};
}
test('membership confirmation persists exact actor and target intervals before mutation',async()=>{
 const f=fixture();await f.controller.prepare('remove','bob');assert.equal(f.calls,0);
 assert.deepEqual(f.saved.input,{operationId:'operation-1',action:'remove',actorInterval:'interval-alice',expectedEpoch:2,targetId:'bob',targetInterval:'interval-bob'});
 await f.controller.execute();assert.ok(f.saved.result);assert.equal(f.completed.size,1);await f.controller.acknowledge();assert.equal(f.saved,null);
});
test('lost membership reply reopens and retries the original operation without a new permission snapshot',async()=>{
 const f=fixture();await f.controller.prepare('handoff','bob');f.lose();await assert.rejects(f.controller.execute());const original=structuredClone(f.saved);
 f.ports.api.circle=async()=>{throw Error('no longer admin');};const reopened=module.createCircleMembership(f.ports,'circle-one');await reopened.execute();assert.deepEqual(f.saved.input,original.input);assert.equal(f.completed.size,1);
});
test('last admin must choose a successor before leaving with other members',async()=>{
 const f=fixture();await assert.rejects(f.controller.prepare('leave'),{message:'ADMIN_HANDOFF_REQUIRED'});assert.equal(f.saved,null);
 f.count=1;await f.controller.prepare('leave');assert.equal((await f.controller.execute()).closed,true);
});
test('member role cannot remove or transfer admin and self removal cannot bypass leave',async()=>{
 const f=fixture();f.role='member';for(const action of ['remove','handoff'])await assert.rejects(f.controller.prepare(action,'bob'),{message:'DENIED'});
 f.role='admin';await assert.rejects(f.controller.prepare('remove','alice'),{message:'DENIED'});assert.equal(f.saved,null);
});
test('failed intent persistence performs no remote mutation',async()=>{
 const f=fixture();f.ports.vault.write=async()=>{throw Error('STORAGE');};await assert.rejects(f.controller.prepare('remove','bob'));assert.equal(f.calls,0);
});
test('an unfinished membership action cannot be replaced or silently canceled',async()=>{
 const f=fixture();await f.controller.prepare('remove','bob');await assert.rejects(f.controller.prepare('handoff','bob'),{message:'MEMBERSHIP_PENDING'});await assert.rejects(f.controller.acknowledge(),{message:'MEMBERSHIP_PENDING'});assert.equal(f.calls,0);
});
test('replacement account cannot execute another account saved membership action',async()=>{
 const f=fixture();await f.controller.prepare('remove','bob');f.replace();await assert.rejects(f.controller.execute(),{message:'SESSION_CHANGED'});assert.equal(f.calls,0);
});
test('completed saved result reopens without replaying network effects',async()=>{
 const f=fixture();await f.controller.prepare('remove','bob');const result=await f.controller.execute();f.ports.api.mutateMembership=async()=>{throw Error('duplicate');};assert.deepEqual(await module.createCircleMembership(f.ports,'circle-one').execute(),result);
});
test('confirmation cannot silently switch to a replacement target membership',async()=>{
 const f=fixture();await assert.rejects(f.controller.prepare('remove','bob',{epoch:2,actorInterval:'interval-alice',targetInterval:'older-bob-interval'}),{message:'MEMBERSHIP_CHANGED'});assert.equal(f.saved,null);assert.equal(f.calls,0);
});
test('canceling a saved action records the server outcome before clearing it',async()=>{
 const f=fixture();await f.controller.prepare('remove','bob');f.ports.api.cancelMembership=async(circle,input)=>({circleId:circle,operationId:input.operationId,action:input.action,closed:false,cancelled:true});
 assert.equal(typeof f.controller.cancel,'function','safe saved-action cancellation is missing');assert.equal((await f.controller.cancel()).cancelled,true);assert.equal(f.saved.result.cancelled,true);await f.controller.acknowledge();assert.equal(f.saved,null);assert.equal(f.calls,0);
});
