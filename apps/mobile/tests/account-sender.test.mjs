import test from 'node:test';import assert from 'node:assert/strict';import * as sender from '../src/features/messages/account-sender.ts';
const binding={account:{id:'alice'},deviceId:'device',generation:1,accessToken:'synthetic'};
test('profile recovery shares the send and reconciliation queue',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),order=[];
 const owner=sender.createAccountSender(()=>binding,()=>true,async()=>{order.push('send');await gate;return{id:'event'};},async()=>{order.push('reconcile');},async()=>{order.push('recover');return'cancelled';});
 assert.equal(typeof owner.recoverProfile,'function','serialized profile recovery missing');
 const send=owner.send({operation:'one',plaintext:'first'}),recover=owner.recoverProfile({operation:'profile',circleId:'circle',plaintext:'profile',contentType:'circle-profile',profileRevision:1}),reconcile=owner.reconcile();
 await Promise.resolve();assert.deepEqual(order,['send']);release();await Promise.all([send,recover,reconcile]);assert.deepEqual(order,['send','recover','reconcile']);
});
test('account sender serializes sends and retains the caller draft before waiting',async()=>{
 assert.equal(typeof sender.createAccountSender,'function');let release;const gate=new Promise(resolve=>release=resolve);const received=[];
 const owner=sender.createAccountSender(()=>binding,()=>true,async draft=>{received.push({...draft});if(received.length===1)await gate;return {id:draft.operation};});
 const first=owner.send({operation:'one',plaintext:'first',targetId:'bob'}),draft={operation:'two',plaintext:'second',targetId:'bob'},second=owner.send(draft);draft.plaintext='mutated';
 await Promise.resolve();assert.equal(received.length,1);release();await Promise.all([first,second]);assert.deepEqual(received.map(d=>d.plaintext),['first','second']);
});
test('queued sends cannot migrate into a replacement account generation',async()=>{
 assert.equal(typeof sender.createAccountSender,'function');let active=binding,release;const gate=new Promise(resolve=>release=resolve);let calls=0;
 const owner=sender.createAccountSender(()=>active,()=>true,async()=>{calls++;await gate;return {id:'event'};});
 const first=owner.send({operation:'one',plaintext:'first'}),second=owner.send({operation:'two',plaintext:'second'});
 await Promise.resolve();active={...binding,generation:2};release();await assert.rejects(first,e=>e.code==='SESSION_REVOKED');await assert.rejects(second,e=>e.code==='SESSION_REVOKED');assert.equal(calls,1);
});
test('failed sends do not poison later queued operations',async()=>{
 assert.equal(typeof sender.createAccountSender,'function');let calls=0;
 const owner=sender.createAccountSender(()=>binding,()=>true,async()=>{if(++calls===1)throw new Error('network');return {id:'event'};});
 await assert.rejects(owner.send({operation:'one',plaintext:'first'}),/network/);assert.deepEqual(await owner.send({operation:'two',plaintext:'second'}),{id:'event'});
});
test('outbox reconciliation shares the send queue',async()=>{
 assert.equal(typeof sender.createAccountSender,'function');let release;const gate=new Promise(resolve=>release=resolve);const order=[];
 const owner=sender.createAccountSender(()=>binding,()=>true,async()=>{order.push('send');await gate;return {id:'event'};},async()=>{order.push('reconcile');});
 assert.equal(typeof owner.reconcile,'function');
 const send=owner.send({operation:'one',plaintext:'first'}),reconcile=owner.reconcile();await Promise.resolve();assert.deepEqual(order,['send']);release();await Promise.all([send,reconcile]);assert.deepEqual(order,['send','reconcile']);
});
test('queued collection mutation owns its item metadata before another send releases the queue',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),received=[];
 const owner=sender.createAccountSender(()=>binding,()=>true,async draft=>{received.push(draft);if(received.length===1)await gate;return{id:draft.operation};});
 const first=owner.send({operation:'one',plaintext:'first'}),change={action:'add',kind:'sticker',item:'original'},second=owner.send({operation:'two',plaintext:'collection',contentType:'circle-collection',collectionChange:change,collectionRevision:1,circleId:'circle'});
 change.item='mutated';await Promise.resolve();release();await Promise.all([first,second]);assert.equal(received[1].collectionChange.item,'original');
});
test('queued snapshot owns its nested topology before another send releases the queue',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),received=[];
 const owner=sender.createAccountSender(()=>binding,()=>true,async draft=>{received.push(draft);if(received.length===1)await gate;return{id:draft.operation};});
 const first=owner.send({operation:'one',plaintext:'first'}),header={id:'snapshot',part:0,parts:1,items:[{id:'original',kind:'sticker'}]},second=owner.send({operation:'two',plaintext:'snapshot',contentType:'circle-collection-snapshot',collectionSnapshot:header,collectionRevision:1,circleId:'circle'});
 header.items[0].id='mutated';header.items.push({id:'other',kind:'emoji'});header.parts=2;
 await Promise.resolve();release();await Promise.all([first,second]);assert.deepEqual(received[1].collectionSnapshot,{id:'snapshot',part:0,parts:1,items:[{id:'original',kind:'sticker'}]});
});
