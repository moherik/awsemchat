import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { accountNamespace, guardAccountOperation } from '../src/security/account-encryption.ts';
const binding={account:{id:'account-one',pin:'ABCDEFGH'},deviceId:'device-one',generation:1};
const current={...binding,accessToken:'A'.repeat(43),expiresAt:'2099-01-01T00:00:00Z'};
const digest=async value=>createHash('sha256').update(value).digest('hex');

test('native encryption namespace is stable but distinct for backend account device and replacement generation',async()=>{
 const original=await accountNamespace('https://api.example.com',binding,digest);
 assert.match(original,/^acct-[0-9a-f]{32}$/);
 assert.equal(await accountNamespace('https://api.example.com',binding,digest),original);
 const variants=[await accountNamespace('https://another.example.com',binding,digest),await accountNamespace('https://api.example.com',{...binding,account:{...binding.account,id:'account-two'}},digest),await accountNamespace('https://api.example.com',{...binding,deviceId:'device-two'},digest),await accountNamespace('https://api.example.com',{...binding,generation:2},digest)];
 assert.equal(new Set([original,...variants]).size,5);
});

test('retained encryption adapter cannot act for another account or replacement phone generation',async()=>{
 assert.equal(await guardAccountOperation(()=>current,binding,async()=> 'permitted'),'permitted');
 for(const changed of [{...current,generation:2},{...current,deviceId:'device-two'},{...current,account:{...current.account,id:'account-two'}}]){
  await assert.rejects(guardAccountOperation(()=>changed,binding,async()=>{throw new Error('stale crypto executed');}),e=>e.code==='SESSION_REVOKED');
 }
});

test('logout during native work suppresses the result from a retained adapter',async()=>{
 let value=current;
 await assert.rejects(guardAccountOperation(()=>value,binding,async()=>{value={...current,generation:2};return 'obsolete ciphertext';}),e=>e.code==='SESSION_REVOKED');
});
