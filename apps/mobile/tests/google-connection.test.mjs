import test from 'node:test';import assert from 'node:assert/strict';import * as google from '../src/features/backup/google-connection.ts';
const scope='https://www.googleapis.com/auth/drive.appdata';
function fixture(){let owner='app-session';let resolve;
 const ports={authorize:async()=>({accessToken:'google-token',grantedScopes:[scope,'openid']}),identity:async()=>({subject:'google-subject'}),binding:()=>owner,fingerprint:async subject=>`fingerprint-${subject}`};
 const flow=google.createGoogleConnection(ports);return {flow,ports,change:()=>{owner='other-session';},gate:()=>{const promise=new Promise(r=>resolve=r);return {promise,release:()=>resolve()};}};
}
test('Google connection exposes only consented account data to snapshots and binds its token',async()=>{
 const f=fixture();await f.flow.connect();assert.equal(f.flow.getSnapshot().status,'connected');assert.equal(JSON.stringify(f.flow.getSnapshot()).includes('google-token'),false);assert.equal(f.flow.session().accessToken,'google-token');assert.equal(f.flow.session().binding,'fingerprint-google-subject');
});
test('cancelled Google permission request leaves a prior connection unchanged',async()=>{
 const f=fixture();await f.flow.connect();f.ports.authorize=async()=>null;await f.flow.connect();assert.equal(f.flow.session().accessToken,'google-token');
});
test('missing Drive permission rejects connection before identity lookup',async()=>{
 const f=fixture();let queried=false;f.ports.authorize=async()=>({accessToken:'token',grantedScopes:['openid']});f.ports.identity=async()=>{queried=true;return {subject:'subject'};};await assert.rejects(f.flow.connect(),{message:'DRIVE_AUTH_REQUIRED'});assert.equal(queried,false);assert.equal(f.flow.getSnapshot().status,'disconnected');
});
test('account change while Google authorization is pending discards the result',async()=>{
 const f=fixture();f.ports.authorize=async()=>{f.change();return {accessToken:'token',grantedScopes:[scope,'openid']};};await assert.rejects(f.flow.connect(),{message:'SESSION_REVOKED'});assert.throws(()=>f.flow.session(),{message:'DRIVE_AUTH_REQUIRED'});
});
test('disconnect invalidates an in-flight identity response',async()=>{
 const f=fixture();const gate=f.gate();f.ports.identity=async()=>{await gate.promise;return {subject:'subject'};};const pending=f.flow.connect();await new Promise(r=>setImmediate(r));f.flow.disconnect();gate.release();await assert.rejects(pending,{message:'SESSION_REVOKED'});assert.equal(f.flow.getSnapshot().status,'disconnected');
});
test('Google token cannot be reused after the AwsemChat session changes',async()=>{
 const f=fixture();await f.flow.connect();f.change();assert.throws(()=>f.flow.session(),{message:'SESSION_REVOKED'});assert.equal(f.flow.getSnapshot().status,'disconnected');
});
test('failed reconnect clears an obsolete token instead of leaving it usable',async()=>{
 const f=fixture();await f.flow.connect();f.ports.authorize=async()=>{throw Error('provider secret');};await assert.rejects(f.flow.connect(),{message:'UNAVAILABLE'});assert.throws(()=>f.flow.session(),{message:'DRIVE_AUTH_REQUIRED'});
});
test('lost app session clears connected Google state even when the session accessor throws',async()=>{
 const f=fixture();await f.flow.connect();f.ports.binding=()=>{throw Error('SESSION_REVOKED');};assert.throws(()=>f.flow.session(),{message:'SESSION_REVOKED'});assert.equal(f.flow.getSnapshot().status,'disconnected');
});
