import test from 'node:test';
import assert from 'node:assert/strict';
import * as accountInbox from '../src/features/messages/account-inbox.ts';
const original={account:{id:'alice'},deviceId:'device-one',generation:1,accessToken:'synthetic-token'};
test('account inbox requires prepared encryption and rebinds on account generation change',async()=>{
 assert.equal(typeof accountInbox.createAccountInbox,'function');
 let session=original,ready=false,created=0;
 const inbox=accountInbox.createAccountInbox(()=>session,()=>ready,()=>{created++;return {run:async()=>({more:false})};});
 await assert.rejects(inbox.sync(),e=>e.code==='UNAVAILABLE');assert.equal(created,0);
 ready=true;await inbox.sync();await inbox.sync();assert.equal(created,1);
 session={...original,generation:2};await inbox.sync();assert.equal(created,2);
});
test('logout while synchronization runs suppresses stale account result',async()=>{
 assert.equal(typeof accountInbox.createAccountInbox,'function');
 let session=original;
 const inbox=accountInbox.createAccountInbox(()=>{if(!session)throw Object.assign(new Error('SESSION_REVOKED'),{code:'SESSION_REVOKED'});return session;},()=>true,()=>({run:async()=>{session=null;return {more:false};}}));
 await assert.rejects(inbox.sync(),e=>e.code==='SESSION_REVOKED');
});
test('replacement phone during synchronization rejects old generation result',async()=>{
 assert.equal(typeof accountInbox.createAccountInbox,'function');
 let session=original;
 const inbox=accountInbox.createAccountInbox(()=>session,()=>true,()=>({run:async()=>{session={...original,generation:2};return {more:false};}}));
 await assert.rejects(inbox.sync(),e=>e.code==='SESSION_REVOKED');
});
