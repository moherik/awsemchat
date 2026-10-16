import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createSocialAPI,SocialError} from '../src/features/social/api.ts';
const session={accessToken:'A'.repeat(43),account:{id:'alice',pin:'ABCDEFGH'},deviceId:'device-alice',generation:1,expiresAt:'2099-01-01T00:00:00Z'};
const circle={id:'circle-one',epoch:2,memberCount:2,closed:false};
const summary={...circle,intervalId:'interval-alice',role:'admin',joinedEpoch:1};
async function fixture(t,respond,getSession=()=>session){const requests=[];const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({path:req.url,method:req.method,body:body?JSON.parse(body):null,authorization:req.headers.authorization});await respond(req,res);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));return {api:createSocialAPI(`http://127.0.0.1:${server.address().port}`,getSession,true),requests};}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
test('Circle client validates paginated metadata and sends current session',async t=>{
 const {api,requests}=await fixture(t,(req,res)=>json(res,{items:[{...summary,phone:'private'}],nextCursor:'circle-one'}));
 assert.deepEqual(await api.circles('previous',1),{items:[summary],nextCursor:'circle-one'});
 assert.equal(requests[0].path,'/v1/circles?cursor=previous&limit=1');assert.equal(requests[0].authorization,`Bearer ${session.accessToken}`);
});
test('Circle client reads details and invitation inbox with sanitized DTOs',async t=>{
 const member={intervalId:'interval-alice',accountId:'alice',pin:'ABCDEFGH',role:'admin',joinedEpoch:1};const invite={id:'invite-one',circleId:'circle-one',inviterId:'alice',inviteeId:'bob',status:'pending'};
 const {api}=await fixture(t,(req,res)=>json(res,req.url.startsWith('/v1/circles/invitations')?{items:[invite]}:{...circle,memberCount:1,members:[{...member,phone:'private'}]}));
 assert.deepEqual(await api.circle('circle-one'),{...circle,memberCount:1,members:[member]});assert.deepEqual(await api.invitations(),{items:[invite]});
});
test('Circle client rejects invalid payloads and unsafe origins',async t=>{
 for(const payload of [{items:[{...summary,memberCount:21}]},{items:[{...summary,joinedEpoch:3}]},{items:[summary,summary]},{items:[summary],nextCursor:'wrong'}]){const {api}=await fixture(t,(_,res)=>json(res,payload));await assert.rejects(api.circles(),e=>e instanceof SocialError&&e.code==='INVALID_RESPONSE');}
 for(const origin of ['http://example.com','https://user:password@example.com','https://example.com/path','https://example.com?token=secret'])assert.throws(()=>createSocialAPI(origin,()=>session),e=>e.code==='CONFIGURATION');
});
test('Circle client discards a response after account session changes',async t=>{
 let current=session;const {api}=await fixture(t,(_,res)=>{current={...session,generation:2};json(res,{items:[summary]});},()=>current);
 await assert.rejects(api.circles(),e=>e instanceof SocialError&&e.code==='SESSION_CHANGED');
});
test('Circle client preserves only safe backend error codes',async t=>{
 const {api}=await fixture(t,(_,res)=>json(res,{code:'SESSION_REVOKED',message:'private'},401));await assert.rejects(api.circles(),e=>e.code==='SESSION_REVOKED'&&!e.message.includes('private'));
});

test('friend client validates paginated contacts and exact request consent/block bodies',async t=>{
 const contact={accountId:'bob',pin:'BCDEFGHJ',requestId:'request-one',status:'accepted'};
 const request={id:'request-one',requestedBy:'alice',targetId:'bob',status:'pending'};
 const {api,requests}=await fixture(t,(req,res)=>{if(req.method==='GET')json(res,{items:[{...contact,phone:'private'}],nextCursor:'bob'});else if(req.url==='/v1/friends/requests')json(res,request);else{res.writeHead(204);res.end();}});
 assert.deepEqual(await api.friends('accepted','previous',1),{items:[contact],nextCursor:'bob'});assert.deepEqual(await api.requestFriend('BCDEFGHJ'),request);
 await api.respondFriend('request-one',false);await api.blockAccount('bob',false);
 assert.deepEqual(requests.map(r=>[r.method,r.path,r.body]),[['GET','/v1/friends?cursor=previous&limit=1&kind=accepted',null],['POST','/v1/friends/requests',{pin:'BCDEFGHJ'}],['POST','/v1/friends/requests/request-one/response',{accept:false}],['PUT','/v1/friends/blocks/bob',{blocked:false}]]);
});
test('Circle mutations send only routing IDs and parse acceptance intervals',async t=>{
 const invite={id:'invite-one',circleId:'circle-one',inviterId:'alice',inviteeId:'bob',status:'pending'};
 const {api,requests}=await fixture(t,(req,res)=>{if(req.url==='/v1/circles')json(res,circle);else if(req.url.endsWith('/invitations'))json(res,invite);else if(req.url.endsWith('/response'))json(res,{...invite,status:'accepted',intervalId:'interval-bob'});else{res.writeHead(204);res.end();}});
 assert.deepEqual(await api.createCircle('create-one'),circle);assert.deepEqual(await api.invite('circle-one','bob'),invite);
 assert.deepEqual(await api.respondInvitation('invite-one',true),{...invite,status:'accepted',intervalId:'interval-bob'});
 await api.handoff('circle-one','bob');await api.removeMember('circle-one','bob');await api.leave('circle-one');
 assert.deepEqual(requests.map(r=>[r.method,r.path,r.body]),[['POST','/v1/circles',{operationId:'create-one'}],['POST','/v1/circles/circle-one/invitations',{accountId:'bob'}],['POST','/v1/circles/invitations/invite-one/response',{accept:true}],['POST','/v1/circles/circle-one/handoff',{accountId:'bob'}],['POST','/v1/circles/circle-one/members/bob/remove',{}],['POST','/v1/circles/circle-one/leave',{}]]);
});
test('mutations preserve failed requests and reject malformed successful acknowledgements',async t=>{
 let fail=true;const {api,requests}=await fixture(t,(_,res)=>{if(fail){fail=false;json(res,{code:'UNAVAILABLE'},503);}else json(res,circle);});
 await assert.rejects(api.createCircle('same-operation'),e=>e.code==='UNAVAILABLE');assert.deepEqual(await api.createCircle('same-operation'),circle);assert.deepEqual(requests.map(r=>r.body),[{operationId:'same-operation'},{operationId:'same-operation'}]);
 await assert.rejects(api.leave('circle-one'),e=>e.code==='INVALID_RESPONSE');
});
test('membership operations preserve exact interval guards and verify the returned operation',async t=>{
 const input={operationId:'leave-one',action:'leave',actorInterval:'interval-alice',expectedEpoch:2};
 const result={operationId:'leave-one',circleId:'circle-one',action:'leave',closed:false};
 const {api,requests}=await fixture(t,(_,res)=>json(res,result));
 assert.equal(typeof api.mutateMembership,'function','guarded membership API is missing');
 assert.deepEqual(await api.mutateMembership('circle-one',input),result);
 assert.deepEqual(requests[0].body,input);assert.equal(requests[0].path,'/v1/circles/circle-one/membership-operations');
 const mismatch=await fixture(t,(_,res)=>json(res,{...result,operationId:'different'}));
 await assert.rejects(mismatch.api.mutateMembership('circle-one',input),e=>e.code==='INVALID_RESPONSE');
});
test('membership client rejects missing guards and preserves stale-membership errors',async t=>{
 const {api,requests}=await fixture(t,(_,res)=>json(res,{code:'MEMBERSHIP_CHANGED'},409));
 assert.equal(typeof api.mutateMembership,'function','guarded membership API is missing');
 await assert.rejects(api.mutateMembership('circle-one',{operationId:'remove-one',action:'remove',actorInterval:'interval-alice',expectedEpoch:2,targetId:'bob'}),e=>e.code==='INVALID_INPUT');
 assert.equal(requests.length,0);
 await assert.rejects(api.mutateMembership('circle-one',{operationId:'leave-one',action:'leave',actorInterval:'interval-alice',expectedEpoch:2}),e=>e.code==='MEMBERSHIP_CHANGED');
});
test('membership cancellation parses a fence or the original committed result',async t=>{
 const input={operationId:'cancel-one',action:'leave',actorInterval:'interval-alice',expectedEpoch:2};
 const {api,requests}=await fixture(t,(_,res)=>json(res,{operationId:'cancel-one',circleId:'circle-one',action:'leave',closed:false,cancelled:true}));
 assert.equal(typeof api.cancelMembership,'function','membership cancellation API is missing');assert.equal((await api.cancelMembership('circle-one',input)).cancelled,true);assert.equal(requests[0].path,'/v1/circles/circle-one/membership-operations/cancel');assert.deepEqual(requests[0].body,input);
});
