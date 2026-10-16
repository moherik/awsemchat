import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../src/features/social/circle-profile-fanout.ts').catch(()=>({}));
test('profile maintenance scans bounded pages and only invokes current admin Circles',async()=>{
 assert.equal(typeof module.createCircleProfileFanout,'function','profile maintenance is missing');const pages=[],shared=[];
 const flow=module.createCircleProfileFanout({binding:()=> 'account-one',page:async(cursor,limit)=>{pages.push([cursor,limit]);return cursor?{items:[{id:'last',role:'admin'}]}:{items:[{id:'first',role:'admin'},{id:'member-only',role:'member'}],nextCursor:'member-only'};},share:async id=>{shared.push(id);}});
 await flow.run();await flow.run();assert.deepEqual(pages,[['',5],['member-only',5]]);assert.deepEqual(shared,['first','last']);
});
test('account replacement while scanning cannot publish an old Circle profile',async()=>{
 assert.equal(typeof module.createCircleProfileFanout,'function','profile maintenance is missing');let binding='one',shared=0;
 const flow=module.createCircleProfileFanout({binding:()=>binding,page:async()=>{binding='two';return{items:[{id:'first',role:'admin'}]};},share:async()=>{shared++;}});await assert.rejects(flow.run(),{message:'SESSION_CHANGED'});assert.equal(shared,0);
});
test('a failed Circle profile does not starve other Circles or concurrent inbox maintenance',async()=>{
 assert.equal(typeof module.createCircleProfileFanout,'function','profile maintenance is missing');const shared=[];
 const flow=module.createCircleProfileFanout({binding:()=> 'one',page:async()=>({items:[{id:'blocked',role:'admin'},{id:'healthy',role:'admin'}]}),share:async id=>{shared.push(id);if(id==='blocked')throw Error('PROFILE_PENDING');}});
 await Promise.all([flow.run(),flow.run()]);assert.deepEqual(shared,['blocked','healthy']);
});
