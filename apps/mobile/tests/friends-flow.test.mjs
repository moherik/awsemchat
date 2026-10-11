import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createFriendsFlow} from '../src/features/social/friends-flow.ts';
import {createSocialAPI} from '../src/features/social/api.ts';
import {createAuthAPI} from '../src/features/auth/api.ts';
import {createSessionOwner} from '../src/features/auth/session-owner.ts';
const session={accessToken:'A'.repeat(43),account:{id:'alice',pin:'ABCDEFGH'},deviceId:'device-alice',generation:1,expiresAt:'2099-01-01T00:00:00Z'};
const bob={accountId:'bob',pin:'BCDEFGHJ',requestId:'request-bob',status:'accepted'},carol={accountId:'carol',pin:'CDEFGHJK',requestId:'request-carol',status:'accepted'};
async function fixture(t,respond){
 const requests=[];const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const input=raw?JSON.parse(raw):null;requests.push({path:req.url,body:input});
 if(req.url==='/v1/session'){json(res,{accountId:'alice',deviceId:session.deviceId,generation:1,expiresAt:session.expiresAt});return;}
 if(req.url==='/v1/auth/logout'){res.writeHead(204);res.end();return;}
 await respond(req,res,input);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const origin=`http://127.0.0.1:${server.address().port}`;let saved=JSON.stringify(session);
 const owner=createSessionOwner(createAuthAPI(origin,true),{async read(){return saved;},async write(value){saved=value;},async clear(){saved=null;}},session.deviceId);await owner.restore();
 const flow=createFriendsFlow(createSocialAPI(origin,()=>owner.requireSession(),true),owner,1);t.after(()=>flow.dispose());return {flow,owner,requests};
}
function json(res,body,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}
test('friend flow distinguishes loading from empty and paginates without duplicates',async t=>{
 const {flow}=await fixture(t,(req,res)=>json(res,req.url.includes('cursor=bob')?{items:[carol]}:{items:[bob],nextCursor:'bob'}));
 assert.equal(flow.getSnapshot().lists.accepted.phase,'idle');const pending=flow.refresh();pending.catch(()=>{});assert.equal(flow.getSnapshot().lists.accepted.phase,'loading');await pending;
 assert.deepEqual(flow.getSnapshot().lists.accepted.items,[bob]);assert.equal(flow.getSnapshot().lists.accepted.phase,'ready');await flow.loadMore();assert.deepEqual(flow.getSnapshot().lists.accepted.items,[bob,carol]);assert.equal(flow.getSnapshot().lists.accepted.nextCursor,undefined);
});
test('refresh failure keeps prior contacts and exposes a retryable error',async t=>{
 let fail=false;const {flow}=await fixture(t,(_,res)=>fail?json(res,{code:'UNAVAILABLE'},503):json(res,{items:[bob]}));await flow.refresh();fail=true;
 await assert.rejects(flow.refresh(),e=>e.code==='UNAVAILABLE');assert.deepEqual(flow.getSnapshot().lists.accepted.items,[bob]);assert.equal(flow.getSnapshot().lists.accepted.error,'UNAVAILABLE');
 fail=false;await flow.refresh();assert.equal(flow.getSnapshot().lists.accepted.error,undefined);
});
test('failed PIN submission retains draft and successful retry clears it',async t=>{
 let fail=true;const {flow,requests}=await fixture(t,(req,res)=>{if(req.method==='GET'){json(res,{items:[]});return;}if(fail){fail=false;json(res,{code:'UNAVAILABLE'},503);}else json(res,{id:'request-one',requestedBy:'alice',targetId:'bob',status:'pending'});});
 flow.setPIN('bcdefghj');await assert.rejects(flow.request(),e=>e.code==='UNAVAILABLE');assert.equal(flow.getSnapshot().pinDraft,'BCDEFGHJ');await flow.request();assert.equal(flow.getSnapshot().pinDraft,'');assert.equal(flow.getSnapshot().busy,false);assert.deepEqual(requests.filter(r=>r.path==='/v1/friends/requests').map(r=>r.body),[{pin:'BCDEFGHJ'},{pin:'BCDEFGHJ'}]);
});
test('logout clears cached contacts and ignores an already running read',async t=>{
 let release;const {flow,owner}=await fixture(t,async(_,res)=>{await new Promise(resolve=>release=resolve);json(res,{items:[bob]});});flow.setPIN('BCDEFGHJ');const pending=flow.refresh();const failed=pending.then(()=>null,e=>e);while(!release){const error=await Promise.race([failed,new Promise(resolve=>setImmediate(()=>resolve(null)))]);if(error)throw error;}await owner.logout();assert.equal(flow.getSnapshot().pinDraft,'');assert.deepEqual(flow.getSnapshot().lists.accepted.items,[]);release();await assert.rejects(pending);assert.deepEqual(flow.getSnapshot().lists.accepted.items,[]);assert.equal(flow.getSnapshot().lists.accepted.phase,'idle');
});
test('friend acceptance refreshes incoming and accepted lists after acknowledgement',async t=>{
 let accepted=false;const {flow}=await fixture(t,(req,res)=>{if(req.method==='POST'){accepted=true;res.writeHead(204);res.end();return;}const kind=new URL(req.url,'http://localhost').searchParams.get('kind');json(res,{items:kind==='incoming'&&!accepted?[{...bob,status:'pending'}]:kind==='accepted'&&accepted?[bob]:[]});});
 await flow.refresh('incoming');assert.equal(flow.getSnapshot().lists.incoming.items.length,1);await flow.respond('request-bob',true);assert.deepEqual(flow.getSnapshot().lists.incoming.items,[]);assert.deepEqual(flow.getSnapshot().lists.accepted.items,[bob]);assert.equal(flow.getSnapshot().busy,false);
});
test('blocking clears contact immediately even if subsequent refresh fails',async t=>{
 let blocked=false;const {flow}=await fixture(t,(req,res)=>{if(req.method==='PUT'){blocked=true;res.writeHead(204);res.end();return;}if(blocked){json(res,{code:'UNAVAILABLE'},503);return;}json(res,{items:[bob]});});await flow.refresh();await flow.block('bob',true);
 assert.deepEqual(flow.getSnapshot().lists.accepted.items,[]);assert.equal(flow.getSnapshot().lists.accepted.error,'UNAVAILABLE');assert.equal(flow.getSnapshot().error,undefined);assert.equal(flow.getSnapshot().busy,false);
});
test('a second PIN submission is denied while one is pending and snapshots are immutable',async t=>{
 let release;const {flow}=await fixture(t,async(req,res)=>{if(req.method==='GET'){json(res,{items:[]});return;}await new Promise(resolve=>release=resolve);json(res,{id:'request-one',requestedBy:'alice',targetId:'bob',status:'pending'});});
 flow.setPIN('BCDEFGHJ');const pending=flow.request();const failed=pending.then(()=>null,e=>e);while(!release){const error=await Promise.race([failed,new Promise(resolve=>setImmediate(()=>resolve(null)))]);if(error)throw error;}
 await assert.rejects(flow.request(),e=>e.code==='BUSY');assert.throws(()=>{flow.getSnapshot().pinDraft='CHANGED';},TypeError);flow.setPIN('CDEFGHJK');release();await pending;assert.equal(flow.getSnapshot().pinDraft,'CDEFGHJK');
});
