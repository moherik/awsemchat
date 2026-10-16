import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeCircleProfile,decodeCircleProfile,selectCircleProfile} from '../src/features/social/circle-profile.ts';
const profile=(name)=>({version:1,name,description:'Family plans',avatar:null});
const incoming=(revision,name,extra={})=>({operation:`profile-${revision}`,conversation:'circle',audience:'circle:1',plaintext:JSON.stringify(profile(name)),contentType:'circle-profile',profileRevision:revision,profileAccepted:true,sender:{identity:'sender',signingIdentity:'signing'},archival:false,...extra});
const avatar={epoch:2,media:{version:1,id:'photo',key:'a'.repeat(64),size:1024,mimeType:'image/png'}};
test('encrypted Circle profiles preserve bounded avatar descriptors and their original epoch',()=>{
 const value={name:'Family',description:'Plans',avatar};assert.deepEqual(decodeCircleProfile(encodeCircleProfile(value)),{version:1,...value});
 for(const invalid of [{...avatar,epoch:0},{...avatar,media:{...avatar.media,key:'bad'}},{...avatar,media:{...avatar.media,size:2*1024*1024+1}},{...avatar,media:{...avatar.media,url:'https://example.com'}}])assert.equal(decodeCircleProfile(JSON.stringify({version:1,...value,avatar:invalid})),undefined);
});
test('different avatar descriptors at the same revision conflict even with identical names',()=>{
 const a=incoming(2,'Family',{plaintext:JSON.stringify({...profile('Family'),avatar})}),b={...a,plaintext:JSON.stringify({...profile('Family'),avatar:{...avatar,media:{...avatar.media,id:'other-photo'}}})};
 assert.deepEqual(selectCircleProfile({incoming:[a,b],outgoing:[]},'circle'),{state:'conflict',revision:2});
});
test('profile encoding trims the name and preserves description without introducing plaintext server fields',()=>{
 const wire=encodeCircleProfile({name:'  Family  ',description:'Sunday\nDinner',avatar:null});assert.deepEqual(decodeCircleProfile(wire),{version:1,name:'Family',description:'Sunday\nDinner',avatar:null});
});
test('profile schema rejects missing names oversized unicode and unsupported avatars',()=>{
 for(const value of [{name:' ',description:'',avatar:null},{name:'😀'.repeat(81),description:'',avatar:null},{name:'Family',description:'a'.repeat(281),avatar:null},{name:'Family',description:'',avatar:{url:'https://example.com/photo'}}])assert.throws(()=>encodeCircleProfile(value),{message:'INVALID_PROFILE'});
 assert.equal(decodeCircleProfile('{"version":2,"name":"Family","description":"","avatar":null}'),undefined);
 assert.equal(decodeCircleProfile('{"version":1,"name":"Family","description":"","avatar":null,"phone":"private"}'),undefined);
});
test('profile selection follows authenticated revisions rather than arrival sequence',()=>{
 const result=selectCircleProfile({incoming:[incoming(2,'New',{sequence:1}),incoming(1,'Old',{sequence:2})],outgoing:[]},'circle');assert.deepEqual(result,{state:'ready',revision:2,profile:profile('New')});
});
test('queued sender profiles and unmarked restored profiles cannot overwrite accepted metadata',()=>{
 const restored=incoming(4,'Unproven',{archival:true,profileAccepted:undefined,direction:'outgoing'});
 const queued={...incoming(5,'Unsent'),status:'queued',event:null};
 assert.deepEqual(selectCircleProfile({incoming:[incoming(2,'Accepted'),restored],outgoing:[queued]},'circle'),{state:'ready',revision:2,profile:profile('Accepted')});
});
test('confirmed sender profiles and marked restored profiles remain eligible',()=>{
 const confirmed={...incoming(2,'Own'),status:'sent',event:'event-two'};
 assert.equal(selectCircleProfile({incoming:[],outgoing:[confirmed]},'circle').revision,2);
 assert.equal(selectCircleProfile({incoming:[incoming(3,'Restored',{archival:true,direction:'outgoing'})],outgoing:[]},'circle').revision,3);
});
test('conflicting latest revisions fail closed instead of picking a random name',()=>{
 assert.deepEqual(selectCircleProfile({incoming:[incoming(2,'A'),incoming(2,'B')],outgoing:[]},'circle'),{state:'conflict',revision:2});
});
test('malformed newest profile does not silently fall back to an old profile',()=>{
 assert.deepEqual(selectCircleProfile({incoming:[incoming(1,'Old'),incoming(2,'New',{plaintext:'bad json'})],outgoing:[]},'circle'),{state:'invalid',revision:2});
 assert.deepEqual(selectCircleProfile({incoming:[incoming(1,'Other',{conversation:'other'})],outgoing:[]},'circle'),{state:'empty'});
});
