import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import * as google from '../src/features/backup/google-identity.ts';
async function fixture(t,respond){const requests=[];const server=createServer((req,res)=>{requests.push({path:req.url,authorization:req.headers.authorization});respond(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));const origin=`http://127.0.0.1:${server.address().port}`;return {origin,requests,identity:google.createGoogleIdentity({developmentOrigin:origin})};}
test('Google identity uses discovered subject endpoint and never authenticates discovery with a token',async t=>{
 let origin;const f=await fixture(t,(req,res)=>res.end(JSON.stringify(req.url.endsWith('openid-configuration')?{issuer:'https://accounts.google.com',userinfo_endpoint:`${origin}/userinfo`}:{sub:'stable-subject',email:'private@example.com'})));origin=f.origin;
 assert.deepEqual(await f.identity('google-token'),{subject:'stable-subject'});assert.equal(f.requests[0].authorization,undefined);assert.equal(f.requests[1].authorization,'Bearer google-token');
});
test('foreign discovered identity endpoint cannot receive the Google token',async t=>{
 const f=await fixture(t,(_,res)=>res.end(JSON.stringify({issuer:'https://accounts.google.com',userinfo_endpoint:'https://attacker.example/userinfo'})));await assert.rejects(f.identity('token'),{message:'INVALID_RESPONSE'});assert.equal(f.requests.length,1);
});
test('missing subject or failed authorization cannot identify a connected Google account',async t=>{
 for(const fail of [false,true]){let origin;const f=await fixture(t,(req,res)=>{if(req.url.endsWith('openid-configuration'))res.end(JSON.stringify({issuer:'https://accounts.google.com',userinfo_endpoint:`${origin}/userinfo`}));else{if(fail)res.statusCode=401;res.end(JSON.stringify({email:'not-an-identifier'}));}});origin=f.origin;await assert.rejects(f.identity('token'),{message:fail?'DRIVE_AUTH_REQUIRED':'INVALID_RESPONSE'});}
});
test('identity redirects are not followed with a bearer token',async t=>{
 const receiver=await fixture(t,(_,res)=>res.end('{}'));let origin;const f=await fixture(t,(req,res)=>{if(req.url.endsWith('openid-configuration'))res.end(JSON.stringify({issuer:'https://accounts.google.com',userinfo_endpoint:`${origin}/userinfo`}));else{res.statusCode=302;res.setHeader('Location',`${receiver.origin}/userinfo`);res.end();}});origin=f.origin;await assert.rejects(f.identity('token'));assert.equal(receiver.requests.length,0);
});
