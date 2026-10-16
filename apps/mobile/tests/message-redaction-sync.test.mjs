import test from 'node:test';
import assert from 'node:assert/strict';
import * as sync from '../src/features/messages/redaction-sync.ts';

const entry={eventId:'event-one',conversation:'room-one',audience:'circle:3',operation:'message-one',sender:{identity:'sender',signingIdentity:'signature'}};
test('redaction pages apply before advancing to the next page',async()=>{
 const cursor=null,applied=[],requested=[];let state=cursor;
 const native={redactionCursor:async()=>state,applyRedactions:async(previous,next,items)=>{assert.equal(previous,state);applied.push(items);state=next;}};
 const pages=[{items:[entry],cursor:'cursor-one',more:true},{items:[],cursor:'cursor-one',more:false}];
 const api={redactions:async(value,limit)=>{requested.push([value,limit]);return pages.shift();}};
 const worker=sync.createRedactionSynchronizer(native,api);
 assert.deepEqual(await worker.run(),{more:true});assert.deepEqual(await worker.run(),{more:false});
 assert.deepEqual(requested,[['',50],['cursor-one',50]]);assert.deepEqual(applied,[[entry],[]]);
});
test('failed native redaction commit retains the saved cursor for exact replay',async()=>{
 let nativeCursor=null,calls=0;const native={redactionCursor:async()=>nativeCursor,applyRedactions:async(previous,next)=>{calls++;if(calls===1)throw Error('COMMIT_FAILED');nativeCursor=next;}};
 const api={redactions:async()=>({items:[entry],cursor:'cursor-one',more:false})};const worker=sync.createRedactionSynchronizer(native,api);
 await assert.rejects(worker.run(),{message:'COMMIT_FAILED'});assert.equal(nativeCursor,null);
 await worker.run();assert.equal(nativeCursor,'cursor-one');assert.equal(calls,2);
});
test('session replacement after page fetch suppresses native writes',async()=>{
 let active=true,writes=0;const worker=sync.createRedactionSynchronizer({redactionCursor:async()=>null,applyRedactions:async()=>{writes++;}},
  {redactions:async()=>{active=false;return{items:[entry],cursor:'cursor-one',more:false};}},()=>active);
 await assert.rejects(worker.run(),e=>e.code==='SESSION_REVOKED');assert.equal(writes,0);
});
