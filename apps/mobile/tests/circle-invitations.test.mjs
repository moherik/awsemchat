import test from 'node:test';
import assert from 'node:assert/strict';
import {createCircleInvitations} from '../src/features/social/circle-invitations.ts';
const invite=(id,circleId='circle')=>({id,circleId,inviterId:'alice',inviteeId:'bob',status:'pending'});
const api=(changes={})=>({invitations:async()=>({items:[invite('one')]}),respondInvitation:async(id,accept)=>({...invite(id),status:accept?'accepted':'declined',...(accept?{intervalId:'joined'}:{})}),...changes});
test('accepted invitation leaves the inbox and exposes the joined Circle for navigation',async()=>{
 const flow=createCircleInvitations(api());await flow.refresh();const result=await flow.respond('one',true);assert.deepEqual(result,{circleId:'circle',intervalId:'joined'});assert.deepEqual(flow.getSnapshot().items,[]);
});
test('declining an invitation removes it without opening a Circle',async()=>{
 const flow=createCircleInvitations(api());await flow.refresh();assert.equal(await flow.respond('one',false),undefined);assert.deepEqual(flow.getSnapshot().items,[]);
});
test('a failed response keeps its invitation so the same request can be retried',async()=>{
 let failed=true;const flow=createCircleInvitations(api({respondInvitation:async(id,accept)=>{if(failed)throw Object.assign(new Error('NETWORK'),{code:'NETWORK'});return {...invite(id),status:'accepted',intervalId:'joined'};}}));await flow.refresh();await assert.rejects(flow.respond('one',true));assert.equal(flow.getSnapshot().items[0].id,'one');failed=false;assert.equal((await flow.respond('one',true)).circleId,'circle');
});
test('account reset prevents an old acceptance from opening another account’s Circle',async()=>{
 let finish;const flow=createCircleInvitations(api({respondInvitation:()=>new Promise(resolve=>finish=resolve)}));await flow.refresh();const pending=flow.respond('one',true);flow.reset();finish({...invite('one'),status:'accepted',intervalId:'joined'});await assert.rejects(pending,error=>error.code==='SESSION_CHANGED');assert.deepEqual(flow.getSnapshot().items,[]);
});
test('invitation pagination remains reachable and deduplicates repeated rows',async()=>{
 const flow=createCircleInvitations(api({invitations:async(cursor)=>cursor?{items:[invite('one'),invite('two')]}:{items:[invite('one')],nextCursor:'one'}}));await flow.refresh();await flow.loadMore();assert.deepEqual(flow.getSnapshot().items.map(item=>item.id),['one','two']);assert.equal(flow.getSnapshot().nextCursor,undefined);
});
test('account reset during acceptance publication cannot return a joined Circle',async()=>{
 const flow=createCircleInvitations(api());await flow.refresh();
 flow.subscribe(()=>{const state=flow.getSnapshot();if(state.phase==='ready'&&state.busy&&state.items.length===0)flow.reset();});
 await assert.rejects(flow.respond('one',true),error=>error.code==='SESSION_CHANGED');assert.equal(flow.getSnapshot().phase,'idle');
});
