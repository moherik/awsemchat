import test from 'node:test';
import assert from 'node:assert/strict';
import * as sync from '../src/features/messages/inbox-sync.ts';
const keys={identity:'local-key',signingIdentity:'local-signing'};
const item=(id)=>({id,operation:id,conversation:'room',audience:'friend:one',senderId:'alice',senderGeneration:1,sender:keys,recipientKeys:keys,message:{kind:0,body:'opaque'}});
function fixture() {
 let cursor=null,failAck=true;const saved=new Set(),acknowledged=[];
 const native={bundle:async()=>keys,inboxCursor:async()=>cursor,advanceInboxCursor:async(previous,next)=>{assert.equal(previous,cursor);cursor=next;},committedReceive:async input=>saved.has(input.operation),observePeer:async()=>{},receive:async input=>{saved.add(input.operation);}};
 const api={inbox:async position=>position?{items:[],more:false}:{items:[item('one'),item('two')],cursor:'two',more:false},acknowledge:async id=>{if(id==='two'&&failAck)throw new Error('network');acknowledged.push(id);}};
 return {native,api,saved,acknowledged,cursor:()=>cursor,recover:()=>{failAck=false;}};
}
test('inbox cursor stays behind failed receipt then recovers committed messages',async()=>{
 assert.equal(typeof sync.createInboxSynchronizer,'function');
 const f=fixture(),worker=sync.createInboxSynchronizer(f.native,f.api);
 await assert.rejects(worker.run(),/network/);assert.equal(f.cursor(),null);assert.equal(f.saved.size,2);
 f.recover();await worker.run();assert.equal(f.cursor(),'two');assert.equal(f.saved.size,2);assert.deepEqual(f.acknowledged,['one','one','two']);
});
test('simultaneous inbox runs share one fetch and commit cursor once',async()=>{
 assert.equal(typeof sync.createInboxSynchronizer,'function');
 const f=fixture();f.recover();let release;const gate=new Promise(resolve=>release=resolve);let fetches=0;
 const api={...f.api,inbox:async cursor=>{fetches++;await gate;return f.api.inbox(cursor);}};
 const worker=sync.createInboxSynchronizer(f.native,api),first=worker.run(),second=worker.run();release();await Promise.all([first,second]);
 assert.equal(fetches,1);assert.equal(f.cursor(),'two');assert.deepEqual(f.acknowledged,['one','two']);
});
test('scanned denied entries can advance an empty page without inventing receipts',async()=>{
 assert.equal(typeof sync.createInboxSynchronizer,'function');
 const f=fixture();const api={...f.api,inbox:async()=>({items:[],cursor:'denied-event',more:false})};
 await sync.createInboxSynchronizer(f.native,api).run();assert.equal(f.cursor(),'denied-event');assert.deepEqual(f.acknowledged,[]);
});
test('redactions run before inbox decryption and again before the caller refreshes history',async()=>{
 const events=[];let received=false;const native={bundle:async()=>keys,inboxCursor:async()=>null,advanceInboxCursor:async()=>events.push('advance'),committedReceive:async()=>received,observePeer:async()=>{},receive:async()=>{events.push('receive');received=true;}};
 const api={inbox:async()=>{events.push('inbox');return{items:[item('one')],cursor:'one',more:false};},acknowledge:async()=>events.push('ack')};let pass=0;
 const redactions={run:async()=>{events.push(`redactions-${++pass}`);return{more:false};}};
 await sync.createInboxSynchronizer(native,api,redactions).run();
 assert.deepEqual(events,['redactions-1','inbox','receive','ack','advance','redactions-2']);
});
test('history pagination applies redactions before and after read-only receive and advances across empty pages',async()=>{
 let received=false;const events=[];let calls=0;
 const native={bundle:async()=>keys,committedReceive:async()=>received,observePeer:async()=>{},receive:async()=>{events.push('receive');received=true;}};
 const api={history:async(conversation,audience,cursor,limit)=>{events.push(`history:${cursor}:${limit}`);calls++;return calls===1?{items:[item('one')],cursor:'cursor-one',more:true}:{items:[],cursor:'cursor-two',more:false};},acknowledge:async()=>events.push('ack')};
 const redactions={run:async()=>{events.push('redactions');return{more:false};}};
 assert.equal(typeof sync.createHistoryPaginator,'function');
 const pages=sync.createHistoryPaginator(native,api,redactions);
 assert.deepEqual(await pages.load('room','friend:one'),{more:true,cursor:'cursor-one'});
 assert.deepEqual(await pages.load('room','friend:one'),{more:false});
 assert.deepEqual(events,['redactions','history::25','receive','redactions','redactions','history:cursor-one:25','redactions']);
});
