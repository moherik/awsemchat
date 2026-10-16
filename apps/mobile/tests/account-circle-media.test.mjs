import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/features/media/account-circle-media.ts').catch(()=>({}));
function fixture(){
 let session={account:{id:'alice'},deviceId:'phone',generation:1,accessToken:'token'},ready=true;
 const ports={session:()=>session,ready:()=>ready,fingerprint:async()=> 'a'.repeat(64),vault:()=>({read:async()=>null,write:async()=>{},clear:async()=>{}}),codec:{},objectId:()=> 'photo',storage:()=>({})};
 assert.equal(typeof module.openAccountCircleMediaUpload,'function','account-bound media recovery supplier missing');
 return{ports,replace:()=>{session={...session,accessToken:'replacement'};},unready:()=>{ready=false;}};
}
test('account changes during fingerprint creation prevent opening a media vault',async()=>{
 const f=fixture();f.ports.fingerprint=async()=>{f.replace();return 'a'.repeat(64);};
 await assert.rejects(module.openAccountCircleMediaUpload(f.ports,'circle'),/SESSION_CHANGED/);
});
test('opened media recovery retires on token replacement or loss of encryption readiness',async()=>{
 for(const retire of ['replace','unready']){const f=fixture(),controller=await module.openAccountCircleMediaUpload(f.ports,'circle');f[retire]();await assert.rejects(controller.pending(),/SESSION_CHANGED/);}
});
