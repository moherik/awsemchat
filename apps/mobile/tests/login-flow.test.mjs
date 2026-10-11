import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthError } from '../src/features/auth/api.ts';
import { createLoginFlow } from '../src/features/auth/login-flow.ts';

// Session persistence and HTTP are exercised separately with real I/O. This seam
// isolates UI transitions and failures that must not trigger another OTP request.
function setup({startFailure,prepareFailure,failAt=1}={}){
 let status='signed-out',operation=0,verificationCount=0,prepareCount=0;
 const attempts=[];
 const owner={getSnapshot:()=>({status}),restore:async()=>{},logout:async()=>{status='signed-out';},start:async(phone,deviceOperation)=>{attempts.push({phone,operation:deviceOperation});if(startFailure&&attempts.length===failAt)throw new AuthError(startFailure);return {challengeId:'challenge-one',expiresAt:'2099-01-01T00:00:00Z'};},verify:async code=>{verificationCount++;if(code!=='123456')throw new AuthError('INVALID_CODE');status='ready';}};
 const prepare=async()=>{prepareCount++;if(prepareFailure&&prepareCount===1)throw new AuthError('UNAVAILABLE');};
 const flow=createLoginFlow(owner,prepare,()=>`operation-${++operation}`);
 return {flow,attempts,get verificationCount(){return verificationCount;},get prepareCount(){return prepareCount;}};
}

test('phone validation prevents a challenge and keeps input step',async()=>{
 const {flow,attempts}=setup();await assert.rejects(flow.submitPhone('081234'),e=>e.code==='INVALID_INPUT');
 assert.equal(attempts.length,0);assert.equal(flow.getSnapshot().phase,'phone');assert.equal(flow.getSnapshot().busy,false);
});

test('ambiguous network retry preserves challenge operation and normalizes phone',async()=>{
 const {flow,attempts}=setup({startFailure:'NETWORK'});
 await assert.rejects(flow.submitPhone('+62 81234567890'),e=>e.code==='NETWORK');
 await flow.submitPhone('+6281234567890');
 assert.deepEqual(attempts,[{phone:'+6281234567890',operation:'operation-1'},{phone:'+6281234567890',operation:'operation-1'}]);
 assert.equal(flow.getSnapshot().phase,'code');
});

test('successful OTP cannot enter application until encryption preparation succeeds',async()=>{
 const state=setup({prepareFailure:true});await state.flow.submitPhone('+6281234567890');
 await assert.rejects(state.flow.verify('123456'),e=>e.code==='UNAVAILABLE');
 assert.equal(state.flow.getSnapshot().phase,'preparing');assert.equal(state.flow.getSnapshot().busy,false);
 await state.flow.retryPreparation();assert.equal(state.flow.getSnapshot().phase,'ready');assert.equal(state.verificationCount,1);assert.equal(state.prepareCount,2);
});

test('incorrect code retains verification step and resend starts a new operation',async()=>{
 const {flow,attempts}=setup();await flow.submitPhone('+6281234567890');
 await assert.rejects(flow.verify('000000'),e=>e.code==='INVALID_CODE');assert.equal(flow.getSnapshot().phase,'code');
 await flow.resend();assert.deepEqual(attempts.map(a=>a.operation),['operation-1','operation-2']);
 flow.changeNumber();assert.equal(flow.getSnapshot().phase,'phone');assert.equal(flow.getSnapshot().phone,'');
});

test('double submit is rejected while one request is in flight',async()=>{
 let finish;
 const owner={start:()=>new Promise(resolve=>{finish=resolve;})};
 const flow=createLoginFlow(owner,async()=>{},()=> 'operation-one');
 const first=flow.submitPhone('+6281234567890');
 await assert.rejects(flow.submitPhone('+6281234567890'),e=>e.code==='BUSY');
 finish({challengeId:'challenge-one',expiresAt:'2099-01-01T00:00:00Z'});await first;assert.equal(flow.getSnapshot().phase,'code');
});

test('interrupted resend retries its operation instead of sending a third SMS',async()=>{
 const {flow,attempts}=setup({startFailure:'NETWORK',failAt:2});await flow.submitPhone('+6281234567890');
 await assert.rejects(flow.resend(),e=>e.code==='NETWORK');await flow.resend();
 assert.deepEqual(attempts.map(a=>a.operation),['operation-1','operation-2','operation-2']);
});

test('logout returns an authenticated flow to empty phone entry',async()=>{
 const {flow}=setup();await flow.submitPhone('+6281234567890');await flow.verify('123456');
 assert.equal(flow.getSnapshot().phase,'ready');
 await flow.logout();assert.equal(flow.getSnapshot().phase,'phone');assert.equal(flow.getSnapshot().phone,'');
});
