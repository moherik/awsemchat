import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/features/messages/private-moment-editor.ts').catch(() => ({}));
const descriptor={version:1,id:'photo-1',key:'f'.repeat(64),size:8,mimeType:'image/jpeg'}, prepared={descriptor,ciphertext:'YWJjZA=='};
function fixture(){
 let context={conversation:'private:' + 'a'.repeat(64),audience:'friend:req-1',recipients:[{accountId:'bob'}]}, account='owner';const calls=[],saved={value:null};
 const media={prepare:async()=>prepared,restore:async value=>value,upload:async(value,operation)=>{calls.push(['upload',value.ciphertext,operation]);return value.descriptor;},cancel:async operation=>{calls.push(['cancel',operation]);return {state:'cancelled'};}};
 const publisher={post:async(caption,photo,operation)=>{calls.push(['post',caption,photo,operation]);return {id:'event-1',operation,status:'sent'};},pending:async()=>undefined,retry:async()=>{calls.push(['retry']);return {id:'event-1',operation:'op-1',status:'sent'};}};
 assert.equal(typeof module.createPrivateMomentEditor,'function','private photo Moment lifecycle is missing');
 const editor=module.createPrivateMomentEditor({account:()=>account,operation:()=> 'op-1',context:async()=>context,media,vault:{read:async()=>saved.value,write:async value=>{saved.value=value;},clear:async()=>{saved.value=null;}},publisher},'bob');
 return {editor,calls,saved,replace:()=>{account='replacement';},context};
}
test('private photo Moment saves encrypted intent before upload and clears only after send confirmation',async()=>{
 const f=fixture();await f.editor.postPhoto({bytes:new Uint8Array([1,2]),mimeType:'image/jpeg',caption:'A day'});
 assert.deepEqual(f.calls.map(call=>call[0]),['upload','post']);assert.equal(f.calls[2],undefined);assert.equal(f.saved.value,null);
});
test('private photo retry reuses same ciphertext operation and cancellation is exact',async()=>{
 const f=fixture();await f.editor.prepare({bytes:new Uint8Array([1,2]),mimeType:'image/jpeg',caption:'A day'});
 const before=structuredClone(f.saved.value);await f.editor.retry();assert.deepEqual(f.calls.slice(0,2),[['upload','YWJjZA==','op-1'],['post','A day',descriptor,'op-1']]);assert.equal(f.saved.value,null);
 await f.editor.prepare({bytes:new Uint8Array([1,2]),mimeType:'image/jpeg',caption:'A day'});assert.deepEqual(f.saved.value.prepared,before.prepared);f.saved.value={...f.saved.value,uploadAttempted:true};
 await f.editor.discard();assert.equal(f.saved.value,null);assert.ok(f.calls.some(call=>call[0]==='cancel'));
});
