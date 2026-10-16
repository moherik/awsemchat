import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/features/social/collection-snapshot.ts').catch(()=>({}));
const binding={snapshot:'snapshot-one',circleId:'circle',epoch:2,revision:7};
function item(id='one'){return {id,kind:'sticker',label:'A little joy',image:{epoch:2,media:{version:1,id:`media-${id}`,key:'a'.repeat(64),size:1,mimeType:'image/png'}}};}
function prepare(items){assert.equal(typeof module.prepareCollectionSnapshot,'function','bounded fresh collection snapshot preparation missing');return module.prepareCollectionSnapshot(binding,items,items.map(({id,kind})=>({id,kind})));}
function assemble(parts,manifest){assert.equal(typeof module.assembleCollectionSnapshot,'function','complete collection snapshot assembly missing');return module.assembleCollectionSnapshot(binding,parts,manifest);}
test('a fresh snapshot round trip preserves only current items and is independent of prejoin history',()=>{
 const current=[item('two'),item('one')],parts=prepare(current);
 assert.equal(parts.length,1);assert.deepEqual(parts[0],{version:1,...binding,part:0,parts:1,items:[item('one'),item('two')]});
 assert.deepEqual(assemble(parts,[{id:'one',kind:'sticker'},{id:'two',kind:'sticker'}]),{state:'ready',revision:7,items:[item('one'),item('two')]});
});
test('precomputed conservative part layout remains stable after media descriptors change',()=>{
 const current=Array.from({length:90},(_,n)=>item(`item-${String(n).padStart(3,'0')}`)),topology=current.map(({id,kind})=>({id,kind}));
 const layout=module.planCollectionSnapshotLayout(binding,current,topology);
 const resized=current.map((entry,n)=>({...entry,image:{epoch:2,media:{version:1,id:`fresh-${n}-${'z'.repeat(24)}`,key:'c'.repeat(64),size:2_000_000,mimeType:'image/webp'}}}));
 const parts=module.prepareCollectionSnapshot(binding,resized,topology,layout);
 assert.deepEqual(parts.map(part=>part.items.length),layout);assert.equal(parts.flatMap(part=>part.items).length,current.length);
});
test('all Unicode payload parts fit native-safe byte bounds and missing parts never expose a partial picker',()=>{
 const current=Array.from({length:150},(_,n)=>({...item(`item-${String(n).padStart(3,'0')}`),label:'🌻'.repeat(80)})),parts=prepare(current);
 assert.ok(parts.length>1);assert.ok(parts.every(part=>Buffer.byteLength(JSON.stringify(part),'utf8')<=16384));
 const manifest=current.map(({id,kind})=>({id,kind}));assert.deepEqual(assemble(parts.slice(1),manifest),{state:'incomplete',revision:7});
 assert.equal(assemble([...parts].reverse(),manifest).items.length,150);
});
test('old-epoch images, missing current entries and extra historical items cannot become snapshots',()=>{
 assert.equal(typeof module.prepareCollectionSnapshot,'function','snapshot freshness validation missing');
 assert.throws(()=>module.prepareCollectionSnapshot(binding,[{...item(),image:{...item().image,epoch:1}}],[{id:'one',kind:'sticker'}]),/INVALID_SNAPSHOT/);
 assert.throws(()=>module.prepareCollectionSnapshot(binding,[],[{id:'one',kind:'sticker'}]),/INVALID_SNAPSHOT/);
 assert.throws(()=>module.prepareCollectionSnapshot(binding,[item(),item('old')],[{id:'one',kind:'sticker'}]),/INVALID_SNAPSHOT/);
});
test('duplicate parts are idempotent but mixed snapshot, epoch, revision and replaced content fail closed',()=>{
 const parts=prepare([item()]),manifest=[{id:'one',kind:'sticker'}];assert.equal(assemble([parts[0],parts[0]],manifest).items.length,1);
 for(const field of ['snapshot','epoch','revision'])assert.equal(assemble([{...parts[0],[field]:field==='snapshot'?'other':99}],manifest).state,'invalid');
 const changed={...parts[0],items:[{...item(),label:'Different'}]};assert.equal(assemble([parts[0],changed],manifest).state,'conflict');
});
test('empty current collections remain explicit complete snapshots and huge declared counts stay incomplete',()=>{
 const parts=prepare([]);assert.deepEqual(assemble(parts,[]),{state:'ready',revision:7,items:[]});
 const nonempty=prepare([item()]);assert.deepEqual(assemble([{...nonempty[0],parts:Number.MAX_SAFE_INTEGER}],[{id:'one',kind:'sticker'}]),{state:'incomplete',revision:7});
});
test('snapshot preparation respects the relay entry limit and refuses more than its bounded part budget',()=>{
 const current=Array.from({length:150},(_,n)=>item(`tiny-${String(n).padStart(3,'0')}`)),parts=prepare(current);assert.ok(parts.every(part=>part.items.length<=50));
 const oversized=Array.from({length:12801},(_,n)=>item(`entry-${String(n).padStart(5,'0')}`));assert.throws(()=>prepare(oversized),/CAPACITY/);
});
function accepted(part){return {conversation:'circle',audience:'circle:2',operation:'operation',contentType:'circle-collection-snapshot',collectionAccepted:true,collectionRevision:7,collectionSnapshot:{id:part.snapshot,part:part.part,parts:part.parts,items:part.items.map(({id,kind})=>({id,kind}))},plaintext:JSON.stringify(part),sender:{identity:'publisher'}};}
function select(records){assert.equal(typeof module.selectAcceptedCollectionSnapshot,'function','authenticated history snapshot selection missing');return module.selectAcceptedCollectionSnapshot({incoming:records,outgoing:[]},binding,[{id:'one',kind:'sticker'}]);}
test('only accepted current snapshot records assemble, with archival duplicates idempotent',()=>{
 const record=accepted(prepare([item()])[0]);assert.equal(select([record,{...record}]).state,'ready');
 assert.equal(select([{...record,collectionAccepted:false}]).state,'incomplete');
 assert.equal(select([{...record,audience:'circle:1'}]).state,'incomplete');
});
test('snapshot plaintext must exactly match the authenticated header and sender cannot change across parts',()=>{
 const record=accepted(prepare([item()])[0]);
 for(const header of [{...record.collectionSnapshot,part:1,parts:2},{...record.collectionSnapshot,items:[{id:'other',kind:'sticker'}]}])assert.equal(select([{...record,collectionSnapshot:header}]).state,'invalid');
 assert.equal(select([record,{...record,sender:{identity:'another'}}]).state,'conflict');
 assert.equal(select([{...record,plaintext:record.plaintext+' '.repeat(17000)}]).state,'invalid');
});
test('sender history requires a committed event and the exact Circle route',()=>{
 const record=accepted(prepare([item()])[0]);delete record.sender;delete record.collectionAccepted;
 const outgoing={...record,status:'sent',event:'event',circle:'circle',target:null};
 const pick=value=>module.selectAcceptedCollectionSnapshot({incoming:[],outgoing:[value]},binding,[{id:'one',kind:'sticker'}]);
 assert.equal(pick(outgoing).state,'ready');
 for(const changed of [{status:'queued'},{event:null},{circle:'another'},{target:'private-peer'}])assert.equal(pick({...outgoing,...changed}).state,'incomplete');
 assert.equal(pick({...outgoing,collectionSnapshot:{...outgoing.collectionSnapshot,id:'other-snapshot'}}).state,'incomplete');
});
