import test from 'node:test';import assert from 'node:assert/strict';import * as composer from '../src/features/messages/composer.ts';
test('composer clears a successfully sent draft and prevents empty sends',async()=>{
 assert.equal(typeof composer.createComposer,'function');const sent=[];const flow=composer.createComposer(async input=>sent.push(input),async()=>false,()=> 'operation-one');
 await assert.rejects(flow.submit(),e=>e.code==='INVALID_INPUT');flow.setText('hello');await flow.submit();assert.deepEqual(sent,[{operation:'operation-one',plaintext:'hello'}]);assert.equal(flow.getSnapshot().text,'');
});
test('failed precommit send retains draft and retries the same operation',async()=>{
 assert.equal(typeof composer.createComposer,'function');let calls=0,ids=0;const sent=[];const flow=composer.createComposer(async input=>{sent.push(input);if(++calls===1)throw new Error('network');},async()=>false,()=> `operation-${++ids}`);
 flow.setText('hello');await assert.rejects(flow.submit(),/network/);assert.equal(flow.getSnapshot().text,'hello');await flow.submit();assert.equal(ids,1);assert.equal(sent[0].operation,sent[1].operation);
});
test('failed upload of a durably queued draft clears composer to avoid a second message',async()=>{
 assert.equal(typeof composer.createComposer,'function');const flow=composer.createComposer(async()=>{throw new Error('network');},async()=>true,()=> 'operation-one');flow.setText('hello');await assert.rejects(flow.submit(),/network/);assert.equal(flow.getSnapshot().text,'');
});
test('unknown native commit keeps the original draft locked until safe retry',async()=>{
 let sends=0,ids=0;const flow=composer.createComposer(async()=>{if(++sends===1)throw new Error('commit unknown');},async()=>{throw new Error('storage unavailable');},()=> `operation-${++ids}`);
 flow.setText('original');await assert.rejects(flow.submit(),/commit unknown/);flow.setText('changed');assert.equal(flow.getSnapshot().text,'original');assert.equal(flow.getSnapshot().uncertain,true);
 await flow.submit();assert.equal(ids,1);assert.equal(flow.getSnapshot().uncertain,false);
});
