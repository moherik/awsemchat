import test from 'node:test';
import assert from 'node:assert/strict';
import * as receiver from '../src/features/messages/receive.ts';
const own={identity:'recipient-key',signingIdentity:'recipient-signing'};
const delivery={id:'event-one',operation:'operation-one',conversation:'room-one',audience:'friend:interval-one',senderId:'alice',senderGeneration:1,sender:{identity:'sender-key',signingIdentity:'sender-signing'},recipientKeys:own,message:{kind:0,body:'opaque'}};
function fixture({committed=false,error=null}={}) {
 let saved=committed, decrypts=0,acks=0;
 const native={bundle:async()=>own,committedReceive:async()=>saved,observePeer:async()=>{},receive:async()=>{decrypts++;if(error)throw Object.assign(new Error(error),{code:error});saved=true;return {plaintext:'synthetic'};}};
 const api={acknowledge:async id=>{assert.equal(id,delivery.id);acks++;}};
 return {native,api,counts:()=>({decrypts,acks})};
}
test('native receive commits before delivery acknowledgement',async()=>{
 assert.equal(typeof receiver.receiveDelivery,'function');
 const f=fixture();await receiver.receiveDelivery(f.native,f.api,delivery);
 assert.deepEqual(f.counts(),{decrypts:1,acks:1});
});
test('server event id is bound into receive commit proof before acknowledgment',async()=>{
 const inputs=[];let saved=false;
 const native={bundle:async()=>own,committedReceive:async input=>{inputs.push(input);return saved;},observePeer:async()=>{},receive:async input=>{inputs.push(input);saved=true;}};
 let acknowledged=false;
 await receiver.receiveDelivery(native,{acknowledge:async()=>{acknowledged=true;}},delivery);
 assert.ok(inputs.every(input=>input.serverEventId===delivery.id));
 assert.equal(acknowledged,true);
});
test('exact committed retry acknowledges without decrypting again',async()=>{
 assert.equal(typeof receiver.receiveDelivery,'function');
 const f=fixture({committed:true});await receiver.receiveDelivery(f.native,f.api,delivery);
 assert.deepEqual(f.counts(),{decrypts:0,acks:1});
});
test('replay without exact committed evidence never acknowledges',async()=>{
 assert.equal(typeof receiver.receiveDelivery,'function');
 const f=fixture({error:'REPLAY'});
 await assert.rejects(receiver.receiveDelivery(f.native,f.api,delivery),e=>e.code==='REPLAY');
 assert.deepEqual(f.counts(),{decrypts:1,acks:0});
});
test('wrong recipient keys never decrypt or acknowledge',async()=>{
 assert.equal(typeof receiver.receiveDelivery,'function');
 const f=fixture({committed:true});
 await assert.rejects(receiver.receiveDelivery(f.native,f.api,{...delivery,recipientKeys:{...own,identity:'other'}}),e=>e.code==='RECIPIENT_MISMATCH');
 assert.deepEqual(f.counts(),{decrypts:0,acks:0});
});
test('profile type is passed to native decryption and committed proof before acknowledgment',async()=>{
 const inputs=[];let saved=false,acknowledged=false;
 const native={bundle:async()=>own,observePeer:async()=>{},committedReceive:async input=>{inputs.push(input);return saved;},receive:async input=>{inputs.push(input);saved=true;}};
 await receiver.receiveDelivery(native,{acknowledge:async()=>{acknowledged=true;}},{...delivery,contentType:'circle-profile'});
 assert.equal(acknowledged,true);assert.equal(inputs.length,3);assert.ok(inputs.every(input=>input.contentType==='circle-profile'));
});
test('profile revision reaches both decrypt and commit proof',async()=>{
 const inputs=[];let saved=false;
 const native={bundle:async()=>own,observePeer:async()=>{},committedReceive:async input=>{inputs.push(input);return saved;},receive:async input=>{inputs.push(input);saved=true;}};
 await receiver.receiveDelivery(native,{acknowledge:async()=>{}},{...delivery,contentType:'circle-profile',profileRevision:2});assert.ok(inputs.every(input=>input.profileRevision===2));
});
test('collection metadata reaches decryption and both committed proof checks unchanged',async()=>{
 const inputs=[];let saved=false;const collectionChange={action:'remove',kind:'sticker',item:'sticker-one'};
 const native={bundle:async()=>own,observePeer:async()=>{},committedReceive:async input=>{inputs.push(input);return saved;},receive:async input=>{inputs.push(input);saved=true;}};
 await receiver.receiveDelivery(native,{acknowledge:async()=>{}},{...delivery,contentType:'circle-collection',collectionRevision:2,collectionChange});
 assert.equal(inputs.length,3);assert.ok(inputs.every(input=>input.collectionRevision===2));assert.ok(inputs.every(input=>JSON.stringify(input.collectionChange)===JSON.stringify(collectionChange)));
});
test('snapshot headers reach decrypt and committed proof before acknowledgment',async()=>{
 const inputs=[];let saved=false;const header={id:'snapshot',part:0,parts:1,items:[]};const native={bundle:async()=>own,observePeer:async()=>{},committedReceive:async input=>{inputs.push(input);return saved;},receive:async input=>{inputs.push(input);saved=true;}};
 await receiver.receiveDelivery(native,{acknowledge:async()=>{}},{...delivery,contentType:'circle-collection-snapshot',collectionRevision:0,collectionSnapshot:header});assert.equal(inputs.length,3);assert.ok(inputs.every(value=>JSON.stringify(value.collectionSnapshot)===JSON.stringify(header)));
});
test('history replay commits ciphertext without acknowledging delivery again',async()=>{
 const f=fixture();
 await receiver.receiveDelivery(f.native,f.api,delivery,{acknowledge:false});
 assert.deepEqual(f.counts(),{decrypts:1,acks:0});
});
