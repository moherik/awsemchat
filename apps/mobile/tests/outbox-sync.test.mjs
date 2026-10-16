import test from 'node:test';import assert from 'node:assert/strict';import * as outbox from '../src/features/messages/outbox-sync.ts';
test('pending sends reuse exact ciphertext and persist server acknowledgement',async()=>{
 assert.equal(typeof outbox.createOutboxSynchronizer,'function');let confirmation,uploaded;
 const native={outgoingHistory:async()=>[{operation:'one',status:'queued',event:null}],retry:async()=> 'exact-saved-ciphertext',confirmSend:async value=>{confirmation=value;}};
 const api={send:async raw=>{uploaded=raw;return {id:'event-one',operation:'one',status:'sent'};},status:async()=>{assert.fail('queued entry must upload');}};
 await outbox.createOutboxSynchronizer(native,api).run();assert.equal(uploaded,'exact-saved-ciphertext');assert.deepEqual(confirmation,{operation:'one',event:'event-one',status:'sent'});
});
test('sent entries refresh delivery while delivered entries remain idle',async()=>{
 assert.equal(typeof outbox.createOutboxSynchronizer,'function');const confirmed=[];
 const native={outgoingHistory:async()=>[{operation:'one',status:'sent',event:'event-one'},{operation:'two',status:'delivered',event:'event-two'}],retry:async()=>{assert.fail('sent ciphertext must not be uploaded again');},confirmSend:async value=>confirmed.push(value)};
 const api={send:async()=>assert.fail('no queued entry'),status:async id=>({id,operation:'one',status:'delivered'})};
 await outbox.createOutboxSynchronizer(native,api).run();assert.deepEqual(confirmed,[{operation:'one',event:'event-one',status:'delivered'}]);
});
test('mismatched server operation never updates native delivery',async()=>{
 assert.equal(typeof outbox.createOutboxSynchronizer,'function');let commits=0;
 const native={outgoingHistory:async()=>[{operation:'one',status:'sent',event:'event-one'}],confirmSend:async()=>{commits++;}};
 const api={status:async()=>({id:'event-one',operation:'other',status:'delivered'})};
 await assert.rejects(outbox.createOutboxSynchronizer(native,api).run(),e=>e.code==='INVALID_RESPONSE');assert.equal(commits,0);
});
test('redacted operations are absent from sender retry reconciliation',async()=>{
 let sends=0;const native={outgoingHistory:async()=>[],retry:async()=>{assert.fail('redacted text must never be retried');},confirmSend:async()=>{}};
 const api={send:async()=>{sends++;},status:async()=>{sends++;}};
 await outbox.createOutboxSynchronizer(native,api).run();assert.equal(sends,0);
});
test('bounded receipt refresh rotates past permanently unacknowledged entries',async()=>{
 assert.equal(typeof outbox.createOutboxSynchronizer,'function');const visited=[];
 const records=Array.from({length:30},(_,i)=>({operation:`operation-${i}`,event:`event-${i}`,status:'sent'}));
 const native={outgoingHistory:async()=>records,confirmSend:async()=>{}};
 const api={status:async id=>{visited.push(id);return {id,operation:records.find(r=>r.event===id).operation,status:'sent'};}};
 const sync=outbox.createOutboxSynchronizer(native,api);await sync.run();assert.equal(visited.length,10);await sync.run();await sync.run();assert.equal(new Set(visited).size,30);
});
