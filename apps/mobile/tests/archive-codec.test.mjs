import test from 'node:test';import assert from 'node:assert/strict';
import * as codec from '../src/features/backup/archive-codec.ts';
test('archive adapter rejects native encryption failure without returning plaintext diagnostics',async()=>{
 const bridge=codec.createArchiveCodec(async()=>JSON.stringify({ok:false,code:'sensitive native diagnostic'}));
 await assert.rejects(bridge.encode('account',[]),{message:'ARCHIVE_REJECTED'});
});
test('archive adapter rejects malformed encrypted output',async()=>{
 const bridge=codec.createArchiveCodec(async()=>JSON.stringify({ok:true,value:{archive:'ciphertext',recoveryKey:'invalid'}}));
 await assert.rejects(bridge.encode('account',[]),{message:'ARCHIVE_REJECTED'});
});
test('archive adapter returns native encrypted bytes and a separate recovery key',async()=>{
 const bridge=codec.createArchiveCodec(async()=>JSON.stringify({ok:true,value:{archive:'YQ==',recoveryKey:'a'.repeat(64)}}));
 assert.deepEqual(await bridge.encode('account',[]),{archive:'YQ==',recoveryKey:'a'.repeat(64)});
});
test('archive adapter rejects a successful response without decoded records',async()=>{
 const bridge=codec.createArchiveCodec(async()=>JSON.stringify({ok:true,value:{}}));
 await assert.rejects(bridge.decode('account','YQ==','a'.repeat(64)),{message:'ARCHIVE_REJECTED'});
});
