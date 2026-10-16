import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/features/social/circle-list.ts';
const circle = id => ({id,epoch:1,memberCount:2,closed:false,intervalId:`interval-${id}`,role:'member',joinedEpoch:1});
test('Circle pages append once and preserve the cursor for loading more',async()=>{
 const pages=[{items:[circle('a')],nextCursor:'a'},{items:[circle('b')]}];
 const calls=[];const list=model.createCircleList(async cursor=>{calls.push(cursor);return pages.shift();});
 await list.refresh();await list.loadMore();
 assert.deepEqual(list.getSnapshot().items.map(item=>item.id),['a','b']);assert.deepEqual(calls,['','a']);assert.equal(list.getSnapshot().nextCursor,undefined);
});
test('account reset discards an old Circle response',async()=>{
 let resolve;const list=model.createCircleList(()=>new Promise(done=>resolve=done));const pending=list.refresh();list.reset();resolve({items:[circle('old')]});await pending;assert.equal(list.getSnapshot().phase,'idle');assert.deepEqual(list.getSnapshot().items,[]);
});
test('failed pagination retains existing Circles and cursor for retry',async()=>{
 let failure=false;const list=model.createCircleList(async()=>{if(failure)throw new Error('NETWORK');return {items:[circle('a')],nextCursor:'a'};});await list.refresh();failure=true;await assert.rejects(list.loadMore());assert.equal(list.getSnapshot().items[0].id,'a');assert.equal(list.getSnapshot().nextCursor,'a');assert.equal(list.getSnapshot().error,'NETWORK');
});
