import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

// These OS-boundary doubles test scoping and failure handling, not native encryption.
const entries=new Map();let failWrite=false;
const key=(name,options)=>`${options?.keychainService}:${name}`;
globalThis.__authVaultBoundary={
 secure:{WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,getItemAsync:async(name,options)=>entries.get(key(name,options))??null,setItemAsync:async(name,value,options)=>{if(failWrite)throw new Error('synthetic write failure');entries.set(key(name,options),value);},deleteItemAsync:async(name,options)=>{entries.delete(key(name,options));}},
 crypto:{CryptoDigestAlgorithm:{SHA256:'SHA-256'},digestStringAsync:async(_,value)=>createHash('sha256').update(value).digest('hex'),randomUUID},
};
const hooks=registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('session-vault.native.ts')&&['expo-secure-store','expo-crypto'].includes(specifier))return {url:`auth-boundary:${specifier}`,shortCircuit:true};
 return next(specifier,context);
},load(url,context,next){
 if(url==='auth-boundary:expo-secure-store')return {format:'module',source:'export const {WHEN_UNLOCKED_THIS_DEVICE_ONLY,getItemAsync,setItemAsync,deleteItemAsync}=globalThis.__authVaultBoundary.secure;',shortCircuit:true};
 if(url==='auth-boundary:expo-crypto')return {format:'module',source:'export const {CryptoDigestAlgorithm,digestStringAsync,randomUUID}=globalThis.__authVaultBoundary.crypto;',shortCircuit:true};
 return next(url,context);
}});
const {createSessionVault,installationDeviceId}=await import('../src/features/auth/session-vault.native.ts');hooks.deregister();

test('native session vault scopes credentials to backend origin and clears them independently',async()=>{
 const first=await createSessionVault('https://api.example.com');const second=await createSessionVault('https://other.example.com');
 await first.write('synthetic-session');assert.equal(await first.read(),'synthetic-session');assert.equal(await second.read(),null);
 const reopened=await createSessionVault('https://api.example.com');assert.equal(await reopened.read(),'synthetic-session');
 await first.clear();assert.equal(await reopened.read(),null);
});

test('installation identity survives repeated initialization and a failed write never yields a usable device id',async()=>{
 failWrite=true;await assert.rejects(installationDeviceId(),e=>e.code==='STORAGE');failWrite=false;
 const first=await installationDeviceId();assert.match(first,/^[0-9a-f-]{36}$/);assert.equal(await installationDeviceId(),first);
});
