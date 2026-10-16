import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/features/social/circle-collection.ts').catch(()=>({}));
const media={version:1,id:'image-one',key:'a'.repeat(64),size:1,mimeType:'image/png'};
const add={version:1,change:{action:'add',kind:'sticker',item:'sticker-one'},label:'Good morning',image:{epoch:1,media}};
const remove={version:1,change:{action:'remove',kind:'sticker',item:'sticker-one'}};
function event(revision,payload=add,fields={}){return {operation:`operation-${revision}`,conversation:'circle',audience:'circle:1',sender:{identity:'author',signingIdentity:'signing'},plaintext:JSON.stringify(payload),contentType:'circle-collection',collectionRevision:revision,collectionChange:payload.change,collectionAccepted:true,archival:false,...fields};}
function select(incoming,outgoing=[],revision=1){assert.equal(typeof module.selectCircleCollection,'function','encrypted collection projection missing');return module.selectCircleCollection({incoming,outgoing},'circle',revision);}
test('strict collection payloads preserve item metadata and private media descriptor',()=>{
 assert.equal(typeof module.encodeCollectionPayload,'function','collection payload codec missing');
 const encoded=module.encodeCollectionPayload(add);assert.deepEqual(JSON.parse(encoded),add);assert.deepEqual(module.decodeCollectionPayload(encoded),add);
 assert.deepEqual(JSON.parse(module.encodeCollectionPayload(remove)),remove);
});
test('malformed labels, names, media and unexpected fields cannot become collection items',()=>{
 assert.equal(typeof module.encodeCollectionPayload,'function','collection payload codec missing');
 for(const invalid of [{...add,label:''},{...add,label:'bad\u0000label'},{...add,change:{...add.change,kind:'emoji'},label:'Not a shortcode'},{...add,image:{epoch:0,media}},{...add,image:{epoch:1,media:{...media,key:'bad'}}},{...remove,image:add.image},{...add,extra:'unknown'}])assert.throws(()=>module.encodeCollectionPayload(invalid),/INVALID_COLLECTION/);
 assert.equal(module.decodeCollectionPayload('bad'),undefined);
});
test('accepted additions and admin removals build an ordered list while queued drafts stay outside it',()=>{
 const result=select([event(1)], [{...event(2,{...add,change:{...add.change,item:'queued'}}),circle:'circle',target:null,status:'queued',event:null}],1);
 assert.equal(result.state,'ready');assert.deepEqual(result.items,[{id:'sticker-one',kind:'sticker',label:'Good morning',image:add.image}]);
 assert.deepEqual(select([event(2,remove),event(1)],[],2),{state:'ready',revision:2,items:[]});
});
test('exact restored history duplicates are idempotent while revision conflicts fail closed',()=>{
 const accepted=event(1);assert.equal(select([accepted,{...accepted,archival:true}]).items.length,1);
 const conflicting=event(1,{...add,label:'Different'});assert.equal(select([accepted,conflicting]).state,'conflict');
});
test('removed identifiers never reappear through later add events or historical replay',()=>{
 assert.equal(select([event(1),event(2,remove),event(3)],[],3).state,'conflict');
 const history=[event(2,remove),{...event(1),archival:true}];assert.deepEqual(select(history,[],2).items,[]);
});
test('missing joined-member history requests a snapshot and stale context never exposes partial items',()=>{
 assert.deepEqual(select([event(2,remove)],[],2),{state:'incomplete',revision:2});
 assert.deepEqual(select([event(1)],[],2),{state:'incomplete',revision:2});
 assert.deepEqual(select([event(1)],[],0),{state:'stale',revision:0});
 assert.deepEqual(select([],[],0),{state:'ready',revision:0,items:[]});
});
test('decrypted mutation metadata and media epoch must match the authenticated routing',()=>{
 assert.equal(select([event(1,add,{collectionChange:{...add.change,item:'different'}})]).state,'invalid');
 assert.equal(select([event(1,add,{audience:'circle:2'})]).state,'invalid');
 assert.equal(select([event(1,add,{collectionAccepted:false})]).state,'incomplete');
});
test('accepted own events join the collection without exposing drafts or other Circle records',()=>{
 const sent={...event(1),status:'sent',event:'accepted-event',circle:'circle',target:null};delete sent.collectionAccepted;delete sent.sender;
 assert.equal(select([event(1,add,{conversation:'other'})],[sent],1).items.length,1);
 const emoji={...add,change:{action:'add',kind:'emoji',item:'emoji-one'},label:'happy_cat'};
 assert.equal(select([event(1,emoji)],[],1).items[0].kind,'emoji');
});
test('distinct custom emoji IDs can share a label without making the whole collection unusable',()=>{
 const first={...add,change:{action:'add',kind:'emoji',item:'emoji-one'},label:'happy_cat'};
 const second={...first,change:{...first.change,item:'emoji-two'}};
 const result=select([event(1,first),event(2,second)],[],2);assert.equal(result.state,'ready');assert.deepEqual(result.items.map(item=>item.id),['emoji-one','emoji-two']);
});
