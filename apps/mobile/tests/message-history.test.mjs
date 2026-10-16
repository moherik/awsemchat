import test from 'node:test';import assert from 'node:assert/strict';import * as history from '../src/features/messages/history-store.ts';
test('chat history publishes native incoming and outgoing records to subscribers',async()=>{
 assert.equal(typeof history.createHistoryStore,'function');let updates=0;
 const store=history.createHistoryStore(async()=>({incoming:[{plaintext:'received'}],outgoing:[{plaintext:'sent',status:'delivered'}]}));store.subscribe(()=>updates++);
 await store.refresh();assert.equal(store.getSnapshot().phase,'ready');assert.equal(store.getSnapshot().incoming[0].plaintext,'received');assert.equal(store.getSnapshot().outgoing[0].status,'delivered');assert.equal(updates,2);
});
test('logout clearing prevents an in-flight history load from publishing old plaintext',async()=>{
 assert.equal(typeof history.createHistoryStore,'function');let release;const gate=new Promise(resolve=>release=resolve);
 const store=history.createHistoryStore(async()=>{await gate;return {incoming:[{plaintext:'old account'}],outgoing:[]};});const pending=store.refresh();store.clear();release();await pending;assert.equal(store.getSnapshot().phase,'idle');assert.deepEqual(store.getSnapshot().incoming,[]);
});
