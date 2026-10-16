import test from 'node:test';import assert from 'node:assert/strict';import * as chat from '../src/features/messages/chat-destination.ts';
test('route validation rejects repeated parameters and ambiguous destinations without throwing',()=>{
 assert.equal(typeof chat.validChatDestination,'function');
 for(const args of [[['friend'],undefined],['friend','circle'],['..',undefined],[undefined,'bad/id']])assert.equal(chat.validChatDestination(...args),undefined);
 assert.deepEqual(chat.validChatDestination(undefined,'circle'),{circleId:'circle'});
});
test('private and Circle routes produce exclusive authorized message contexts',()=>{assert.deepEqual(chat.chatDestination('friend',undefined),{targetId:'friend'});assert.deepEqual(chat.chatDestination(undefined,'circle'),{circleId:'circle'});});
test('private conversation identity uses the same ordered account pair as the relay',async()=>{
 assert.equal(typeof chat.privateConversationId,'function');
 const seen=[];
 const digest=async value=>{seen.push(JSON.parse(value));return 'a'.repeat(64)};
 assert.equal(await chat.privateConversationId('zebra','alice',digest),`private:${'a'.repeat(64)}`);
 assert.deepEqual(seen,[['awsemchat.private.v1','alice','zebra']]);
 await assert.rejects(chat.privateConversationId('alice','alice',digest),{message:'INVALID_INPUT'});
 await assert.rejects(chat.privateConversationId('alice','bob',async()=> 'bad'),{message:'INVALID_INPUT'});
});
test('ambiguous or malformed conversation routes cannot send',()=>{for(const args of [['friend','circle'],[undefined,undefined],['bad/id',undefined],[undefined,'']])assert.throws(()=>chat.chatDestination(...args),{message:'INVALID_INPUT'});});
test('Circle sender label uses authenticated member PIN and exact current public keys',()=>{const context={recipients:[{accountId:'member',keys:{identity:'key',signingIdentity:'signing'}}]};const members=[{accountId:'member',pin:'ABCDEFGH'}];assert.equal(chat.circleSender({identity:'key',signingIdentity:'signing'},context,members),'ABCDEFGH');assert.equal(chat.circleSender({identity:'key',signingIdentity:'different'},context,members),'Circle member');});
