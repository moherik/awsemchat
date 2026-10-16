import test from 'node:test';
import assert from 'node:assert/strict';
import * as deletion from '../src/features/messages/private-message-deletion.ts';
import * as payload from '../src/features/messages/redaction-control.ts';

const publicKey='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const redaction={eventId:'event-one',conversation:'circle-one',audience:'circle:2',operation:'operation-one',sender:{identity:publicKey,signingIdentity:publicKey}};
function fixture({apiError,routeResult='committed'}={}) {
 const calls=[],pending=[];let rows=['message'],account='account:device:1',routeValue=routeResult;
 const native={beginRedaction:async(target,operation)=>{calls.push(['begin',target,operation]);pending.push({target,operation,messageOperation:'operation-one',confirmed:false,route:{circle:'circle-one',recipients:['bob']}});return pending[0];},pendingRedactions:async()=>pending,
  confirmRedaction:async(target,value)=>{calls.push(['confirm',target,value]);pending[0]={...pending[0],confirmed:true,redaction:value};rows=[];},cancelRedaction:async target=>{calls.push(['cancel',target]);pending.length=0;rows=['message'];},
  completeRedaction:async id=>{calls.push(['complete',id]);pending.length=0;},history:async()=>rows};
 const api={redact:async target=>{calls.push(['redact',target]);if(apiError)throw Object.assign(new Error(apiError),{code:apiError});return redaction;}};
 const route=async(value,operation,plaintext,originalRoute)=>{calls.push(['route',value,operation,originalRoute,plaintext]);if(typeof routeValue==='function')return routeValue();return routeValue;};
 return {native,api,route,calls,pending,rows:()=>rows,account:()=>({id:'account',binding:account}),replaceAccount:()=>{account='replacement';},setRouteResult:value=>{routeValue=value;}};
}
test('deletion confirms with server before local purge and posts one hidden control notice',async()=>{
 const f=fixture(),service=deletion.createPrivateMessageDeletion({account:f.account,native:f.native,api:f.api,route:f.route,operation:()=> 'notice-one'});
 await service.delete({eventId:'event-one'});
 assert.deepEqual(f.calls.map(call=>call[0]),['begin','redact','confirm','route','complete']);assert.deepEqual(f.rows(),[]);
 assert.equal(f.calls[3][2],'notice-one');
 assert.deepEqual(f.calls[3][3],{circle:'circle-one',recipients:['bob']});
});
test('deletion resolves the native encryption adapter only when a signed-in action runs',async()=>{
 const f=fixture();let nativeResolutions=0;
 const service=deletion.createPrivateMessageDeletion({account:f.account,native:()=>{nativeResolutions++;return f.native;},api:f.api,route:f.route,operation:()=> 'notice-one'});
 assert.equal(nativeResolutions,0,'signed-out runtime construction must not require an account session');
 await service.delete({eventId:'event-one'});
 assert.equal(nativeResolutions,1,'a deletion action captures one session-bound native adapter');
});
test('unknown API result preserves the same pending target for retry',async()=>{
 const f=fixture({apiError:'NETWORK'});const service=deletion.createPrivateMessageDeletion({account:f.account,native:f.native,api:f.api,route:f.route,operation:()=> 'notice-one'});
 await assert.rejects(service.delete({eventId:'event-one'}),e=>e.code==='DELETION_PENDING');assert.equal(f.pending[0].operation,'notice-one');
});
test('definitive API denial cancels local pending projection and restores message',async()=>{
 const f=fixture({apiError:'DENIED'});const service=deletion.createPrivateMessageDeletion({account:f.account,native:f.native,api:f.api,route:f.route,operation:()=> 'notice-one'});
 await assert.rejects(service.delete({eventId:'event-one'}),e=>e.code==='DENIED');assert.deepEqual(f.rows(),['message']);assert.ok(f.calls.some(call=>call[0]==='cancel'));
});
test('confirmed Circle retry keeps the persisted operation and never recalculates recipients',async()=>{
 let commits=0,first=true;const f=fixture({routeResult:()=>{if(first){first=false;commits++;throw Object.assign(new Error('NETWORK'),{code:'NETWORK'});}return 'committed';}});const service=deletion.createPrivateMessageDeletion({account:f.account,native:f.native,api:f.api,route:f.route,operation:()=> 'notice-one'});
 await assert.rejects(service.delete({eventId:'event-one'}),e=>e.code==='DELETION_PENDING');
 await service.retry();
 assert.deepEqual(f.calls.filter(call=>call[0].startsWith('route')).map(call=>call[2]),['notice-one','notice-one']);
 assert.equal(f.calls.filter(call=>call[0]==='redact').length,1,'confirmed server deletion is not resubmitted after restart');
 assert.equal(commits,1,'replaying a lost notice response does not create a second event');
 const routeCalls=f.calls.filter(call=>call[0]==='route');assert.equal(routeCalls[0][4],routeCalls[1][4],'notice retries reuse the exact encrypted control payload');
});
test('account replacement after server confirmation prevents writes into the replacement account',async()=>{
 const f=fixture({routeResult:()=>{f.replaceAccount();return 'committed';}});const service=deletion.createPrivateMessageDeletion({account:f.account,native:f.native,api:f.api,route:f.route,operation:()=> 'notice-one'});
 await assert.rejects(service.delete({eventId:'event-one'}),e=>e.code==='SESSION_REVOKED');
 assert.equal(f.calls.some(call=>call[0]==='complete'),false);
});
test('redaction control payload is strict and round trips the original Circle audience',()=>{
 const encoded=payload.encodeRedactionControl(redaction);assert.deepEqual(payload.decodeRedactionControl(encoded),redaction);
 assert.throws(()=>payload.decodeRedactionControl(encoded,{conversation:'circle-one',audience:'circle:3'}),{message:'INVALID_CONTROL'});
 assert.throws(()=>payload.decodeRedactionControl(JSON.stringify({...redaction,extra:'not allowed'})),{message:'INVALID_CONTROL'});
});
