import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../src/features/social/circle-collection-loader.ts').catch(()=>({}));
const context={circleId:'circle',epoch:2,collectionRevision:0,conversation:'circle',audience:'circle:2'};
const record={conversation:'circle',audience:'circle:2',contentType:'circle-collection-snapshot',collectionRevision:0,collectionAccepted:true,collectionSnapshot:{id:'snapshot',part:0,parts:1,items:[]},sender:{identity:'publisher'},plaintext:JSON.stringify({version:1,snapshot:'snapshot',circleId:'circle',epoch:2,revision:0,part:0,parts:1,items:[]})};
function fixture(overrides={}){let account='one';const calls=[];const ports={account:()=>account,context:async()=>context,manifest:async input=>{calls.push(input);return{circleId:'circle',epoch:2,revision:0,items:[],more:false};},history:async()=>({incoming:[record],outgoing:[]}),...overrides};return{ports,calls,change:()=>account='two'};}
async function load(f){assert.equal(typeof module.loadCircleCollection,'function','current-context collection loader missing');return module.loadCircleCollection(f.ports,'circle');}
test('current context manifest and accepted history produce a complete empty collection',async()=>{const f=fixture();assert.deepEqual(await load(f),{state:'ready',revision:0,items:[]});assert.equal(f.calls[0].epoch,2);});
test('account or context transitions during loading cannot expose collection contents',async()=>{const f=fixture();f.ports.history=async()=>{f.change();return{incoming:[record],outgoing:[]};};await assert.rejects(load(f),/SESSION_CHANGED/);let calls=0;const g=fixture({context:async()=>++calls===1?context:{...context,epoch:3}});await assert.rejects(load(g),/CONTEXT_MISMATCH/);});
test('manifest pagination requires matching bindings ordered entries and advancing cursors',async()=>{const f=fixture({manifest:async()=>({circleId:'circle',epoch:2,revision:0,items:[{id:'one',kind:'sticker'}],cursor:'one',more:true})});await assert.rejects(load(f),/INVALID_MANIFEST/);const g=fixture({manifest:async()=>({circleId:'another',epoch:2,revision:0,items:[],more:false})});await assert.rejects(load(g),/INVALID_MANIFEST/);});
test('all manifest pages are collected before exposing any snapshot and the cursor advances',async()=>{
 const requested=[];const f=fixture({context:async()=>({...context,collectionRevision:1}),manifest:async input=>{requested.push(input.cursor);return{circleId:'circle',epoch:2,revision:1,items:[{id:input.cursor?'two':'one',kind:'sticker'}],...(input.cursor?{more:false}:{more:true,cursor:'one'})};},history:async()=>({incoming:[],outgoing:[]})});
 assert.deepEqual(await load(f),{state:'incomplete',revision:1});assert.deepEqual(requested,[undefined,'one']);
});
test('complete accepted collection history can supply a current manifest when no snapshot exists',async()=>{
 const item={id:'one',kind:'sticker',label:'Hello',image:{epoch:2,media:{version:1,id:'photo',key:'a'.repeat(64),size:1,mimeType:'image/png'}}};
 const change={action:'add',kind:'sticker',item:'one'},plaintext=JSON.stringify({version:1,change,label:'Hello',image:item.image});
 const accepted={conversation:'circle',audience:'circle:2',operation:'operation',contentType:'circle-collection',collectionAccepted:true,collectionRevision:1,collectionChange:change,plaintext,sender:{identity:'publisher'}};
 const f=fixture({context:async()=>({...context,collectionRevision:1}),manifest:async()=>({circleId:'circle',epoch:2,revision:1,items:[{id:'one',kind:'sticker'}],more:false}),history:async()=>({incoming:[accepted],outgoing:[]})});
 const loaded=await load(f);assert.equal(loaded.state,'ready');assert.deepEqual(loaded.items,[item]);
});
