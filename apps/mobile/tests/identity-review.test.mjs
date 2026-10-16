import test from 'node:test';import assert from 'node:assert/strict';import * as review from '../src/features/messages/identity-review.ts';
test('identity review acknowledges exactly the pending keys and preserves optional verification',async()=>{
 assert.equal(typeof review.createIdentityReview,'function');const pending={identity:'new',signingIdentity:'new-signing'};let accepted;
 const native={peer:async()=>({pending,verified:false,historyExhausted:false}),acknowledgePeer:async(peer,keys)=>{accepted={peer,keys};return {pending:null,verified:false,historyExhausted:false};}};
 const flow=review.createIdentityReview(native,'bob');await flow.refresh();assert.equal(flow.getSnapshot().phase,'changed');await flow.accept();assert.deepEqual(accepted,{peer:'bob',keys:pending});assert.equal(flow.getSnapshot().phase,'unverified');
});
test('acknowledgement rejects keys that changed after the user reviewed the screen',async()=>{
 assert.equal(typeof review.createIdentityReview,'function');let pending={identity:'first',signingIdentity:'first-signing'},accepted;
 const native={peer:async()=>({pending,verified:false,historyExhausted:false}),acknowledgePeer:async(_,keys)=>{accepted=keys;return {pending:null,verified:false,historyExhausted:false};}};
 const flow=review.createIdentityReview(native,'bob');await flow.refresh();pending={identity:'second',signingIdentity:'second-signing'};await assert.rejects(flow.accept(),e=>e.code==='OPERATION_CONFLICT');assert.equal(accepted,undefined);assert.deepEqual(flow.getSnapshot().pending,pending);await flow.accept();assert.deepEqual(accepted,pending);
});
test('exhausted identity history cannot be acknowledged',async()=>{
 assert.equal(typeof review.createIdentityReview,'function');let calls=0;const native={peer:async()=>({pending:{identity:'new'},verified:false,historyExhausted:true}),acknowledgePeer:async()=>calls++};const flow=review.createIdentityReview(native,'bob');await flow.refresh();assert.equal(flow.getSnapshot().phase,'locked');await assert.rejects(flow.accept(),e=>e.code==='IDENTITY_CHANGED');assert.equal(calls,0);
});
test('manual verification records exactly the reviewed current identity',async()=>{
 const current={identity:'current',signingIdentity:'current-signing'};let verified;
 const native={peer:async()=>({current,pending:null,verified:false,historyExhausted:false}),verifyPeer:async(peer,keys)=>{verified={peer,keys};return {current,pending:null,verified:true,historyExhausted:false};}};
 const flow=review.createIdentityReview(native,'bob');await flow.refresh();assert.equal(typeof flow.verify,'function');await flow.verify();assert.deepEqual(verified,{peer:'bob',keys:current});assert.equal(flow.getSnapshot().phase,'verified');
});
test('manual verification rejects an identity changed since it was displayed',async()=>{
 let current={identity:'first',signingIdentity:'first-signing'},calls=0;
 const native={peer:async()=>({current,pending:null,verified:false,historyExhausted:false}),verifyPeer:async()=>{calls++;}};
 const flow=review.createIdentityReview(native,'bob');await flow.refresh();current={identity:'second',signingIdentity:'second-signing'};await assert.rejects(flow.verify(),e=>e.code==='OPERATION_CONFLICT');assert.equal(calls,0);
});
