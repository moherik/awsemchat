import test from 'node:test';import assert from 'node:assert/strict';import * as view from '../src/features/messages/conversation-view.ts';import { encodeCircleMomentReaction } from '../src/features/messages/circle-moment-reactions.ts';import { encodeCircleMomentReply } from '../src/features/messages/circle-moment-reply.ts';import { encodeCircleMomentDeletion } from '../src/features/messages/circle-moment-deletion.ts';import { encodeCirclePhotoMessage } from '../src/features/messages/circle-photo-message.ts';
test('conversation view excludes other chats and retains incoming and sender delivery state',()=>{
 assert.equal(typeof view.conversationMessages,'function');
 const incoming=[{operation:'received',conversation:'room',plaintext:'hello',sender:{identity:'sender'},archival:false},{operation:'private-other',conversation:'elsewhere',plaintext:'not this chat'}];
 const outgoing=[{operation:'sent',conversation:'room',plaintext:'reply',createdAt:5,status:'delivered',event:'event-one'},{operation:'other',conversation:'elsewhere',plaintext:'other'}];
 const rows=view.conversationMessages({incoming,outgoing},'room');
 assert.deepEqual(rows.map(row=>[row.id,row.operation,row.own,row.text,row.status]),[['incoming:sender:received','received',false,'hello',undefined],['outgoing:sent','sent',true,'reply','delivered']]);
});
test('legacy message timestamps remain unknown instead of displaying invented time',()=>{
 assert.equal(typeof view.conversationMessages,'function');
 const rows=view.conversationMessages({incoming:[],outgoing:[{operation:'old',conversation:'room',plaintext:'old',createdAt:null,status:'queued'}]},'room');
 assert.equal(rows[0].timestamp,undefined);assert.equal(rows[0].status,'queued');
});
test('native local sequence interleaves sent and received messages',()=>{
 const rows=view.conversationMessages({incoming:[{operation:'received',conversation:'room',plaintext:'received second',sender:{identity:'sender'},sequence:2}],outgoing:[{operation:'sent',conversation:'room',plaintext:'sent first',createdAt:1,sequence:1,status:'sent'}]},'room');
 assert.deepEqual(rows.map(row=>row.text),['sent first','received second']);
});
test('conversation title comes from accepted contacts and stays generic for an unknown peer',()=>{
 assert.equal(typeof view.conversationTitle,'function');
 const accepted=[{accountId:'bob',pin:'BCDEFGHJ'}];
 assert.equal(view.conversationTitle(accepted,'bob'),'BCDEFGHJ');assert.equal(view.conversationTitle(accepted,'other'),'Private chat');
});
test('restored sent messages retain outgoing direction without inventing live delivery',()=>{
 const rows=view.conversationMessages({incoming:[{operation:'old-sent',conversation:'room',plaintext:'from backup',sender:{identity:'old-device'},direction:'outgoing',archival:true}],outgoing:[]},'room');
 assert.equal(rows[0].own,true);assert.equal(rows[0].status,undefined);
});
test('Circle profile updates are excluded from chat bubbles while text remains visible',()=>{
 const profile={operation:'profile',conversation:'room',plaintext:'{"name":"Family"}',sender:{identity:'sender',signingIdentity:'signing'},contentType:'circle-profile'};
 const rows=view.conversationMessages({incoming:[profile],outgoing:[{...profile,operation:'own-profile',status:'sent'},{operation:'text',conversation:'room',plaintext:'hello',contentType:'text',status:'sent'}]},'room');
 assert.deepEqual(rows.map(row=>row.text),['hello']);
});
test('collection control events do not become chat bubbles in live or restored history',()=>{
 const control={operation:'collection',conversation:'room',plaintext:'private collection metadata',sender:{identity:'sender'},contentType:'circle-collection'};
 const rows=view.conversationMessages({incoming:[control,{...control,operation:'restored',archival:true}],outgoing:[{...control,operation:'own',status:'queued'}]},'room');assert.deepEqual(rows,[]);
});
test('snapshot records never appear as chat text',()=>{const record={operation:'snapshot',conversation:'room',plaintext:'private collection',contentType:'circle-collection-snapshot',sender:{identity:'sender'}};assert.deepEqual(view.conversationMessages({incoming:[record],outgoing:[{...record,status:'sent'}]},'room'),[]);});
test('encrypted redaction control events never appear as chat rows',()=>{const record={operation:'notice',conversation:'room',plaintext:'private control',contentType:'redaction-control',sender:{identity:'sender'}};assert.deepEqual(view.conversationMessages({incoming:[record],outgoing:[{...record,status:'sent'}]},'room'),[]);});
test('encrypted Circle sticker references are exposed as sticker content, not JSON text',()=>{
 const sticker={version:1,type:'circle-sticker',item:'sticker-1',label:'Weekend joy',image:{epoch:2,media:{version:1,id:'media-1',key:'a'.repeat(64),size:1024,mimeType:'image/png'}}};
 const rows=view.conversationMessages({incoming:[{operation:'sticker',conversation:'room',plaintext:JSON.stringify(sticker),sender:{identity:'sender'}}],outgoing:[]},'room');
 assert.equal(rows[0].text,'Weekend joy');assert.equal(rows[0].sticker.item,'sticker-1');assert.deepEqual(rows[0].sticker.image,sticker.image);
});
test('private sticker messages are scoped to their stored friendship audience and operation',async()=>{
 const { encodePrivateStickerMessage }=await import('../src/features/messages/private-sticker-message.ts');
 const audience='friend:request-7', body=encodePrivateStickerMessage({id:'sticker-op',audience,label:'Hello',media:{version:1,id:'private-sticker-media',key:'b'.repeat(64),size:4,mimeType:'image/png'}});
 const rows=view.conversationMessages({incoming:[{operation:'sticker-op',conversation:'private:stable',audience,plaintext:body,sender:{identity:'friend'}},{operation:'wrong-audience',conversation:'private:stable',audience:'friend:old',plaintext:body,sender:{identity:'friend'}}],outgoing:[]},'private:stable');
 assert.equal(rows.length,1);assert.equal(rows[0].text,'Hello');assert.equal(rows[0].privateSticker.media.id,'private-sticker-media');
});
test('direct Circle Moments stay out of the Chat tab',()=>{
 const moment={version:1,type:'circle-moment',id:'moment-1',caption:'Sunday together'};
 const rows=view.conversationMessages({incoming:[{operation:'moment',conversation:'room',plaintext:JSON.stringify(moment),sender:{identity:'sender',signingIdentity:'signing'},audience:'circle:2'}],outgoing:[]},'room');
 assert.deepEqual(rows,[]);
});
test('Circle Moment reactions stay attached to Moments instead of appearing as chat JSON',()=>{
 const body=encodeCircleMomentReaction({id:'reaction',momentId:'moment',emoji:'❤️',active:true});
 assert.deepEqual(view.conversationMessages({incoming:[{operation:'reaction',conversation:'room',plaintext:body,sender:{identity:'sender'}}],outgoing:[]},'room'),[]);
});
test('Moment replies render as normal Chat text with a typed embedded Moment preview',()=>{
 const reply=encodeCircleMomentReply({id:'reply',text:'See you there',moment:{id:'moment-2',audience:'circle:3',caption:'Beach day'}});
 const rows=view.conversationMessages({incoming:[{operation:'reply',conversation:'room',plaintext:reply,sender:{identity:'sender'}}],outgoing:[]},'room');
 assert.equal(rows[0].text,'See you there');assert.equal(rows[0].momentReply.moment.id,'moment-2');assert.equal(rows[0].momentReply.moment.caption,'Beach day');
});
test('private Moment replies stay in private Chat while private Moment controls are filtered',async()=>{
 const {encodePrivateMomentReply,encodePrivateMoment,encodePrivateMomentReaction}=await import('../src/features/messages/private-moments.ts');
 const audience='friend:request-9',reply=encodePrivateMomentReply({id:'reply-op',audience,text:'See you there',moment:{id:'moment-9',audience,caption:'Coffee'} });
 const rows=view.conversationMessages({incoming:[{operation:'reply-op',conversation:'private:stable',audience,plaintext:reply,sender:{identity:'sender'}},{operation:'moment-9',conversation:'private:stable',audience,plaintext:encodePrivateMoment({id:'moment-9',audience,caption:'Coffee'}),sender:{identity:'sender'}}],outgoing:[{operation:'react-op',conversation:'private:stable',audience,plaintext:encodePrivateMomentReaction({id:'react-op',audience,momentId:'moment-9',emoji:'❤️',active:true}),status:'sent'}]},'private:stable');
 assert.equal(rows.length,1);assert.equal(rows[0].text,'See you there');assert.equal(rows[0].momentReply.moment.id,'moment-9');
});
test('Moment deletion controls do not appear as Chat messages',()=>{
 const body=encodeCircleMomentDeletion({id:'delete-op',momentId:'moment-1'});
 assert.deepEqual(view.conversationMessages({incoming:[{operation:'delete-op',conversation:'room',plaintext:body,sender:{identity:'sender'}}],outgoing:[]},'room'),[]);
});
test('only own messages expose an event-bound Delete for everyone target, including Moment replies',async()=>{
 const {encodePrivateMomentReply}=await import('../src/features/messages/private-moments.ts');
 const reply=encodePrivateMomentReply({id:'reply-op',audience:'friend:req-1',text:'See you there',moment:{id:'moment-1',audience:'friend:req-1',caption:'Coffee'}});
 const rows=view.conversationMessages({incoming:[{operation:'incoming',conversation:'room',audience:'friend:req-1',plaintext:'hello',sender:{identity:'other',signingIdentity:'other-sign'},serverEventId:'other-event'}],outgoing:[{operation:'own',conversation:'room',audience:'friend:req-1',plaintext:'hello',sender:{identity:'self',signingIdentity:'self-sign'},serverEventId:'own-event',status:'sent'},{operation:'reply-op',conversation:'room',audience:'friend:req-1',plaintext:reply,sender:{identity:'self',signingIdentity:'self-sign'},serverEventId:'reply-event',status:'sent'}]},'room');
 assert.equal(rows[0].redactionTarget,undefined);assert.deepEqual(rows[1].redactionTarget,{eventId:'own-event'});assert.equal(rows[2].text,'See you there');assert.deepEqual(rows[2].redactionTarget,{eventId:'reply-event'});
});
test('legacy own message uses the complete descriptor while archived other-authored rows cannot be deleted',()=>{
 const sender={identity:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',signingIdentity:'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'};
 const rows=view.conversationMessages({incoming:[{operation:'old-own',conversation:'room',audience:'friend:original',plaintext:'old mine',sender,direction:'outgoing',archival:true},{operation:'old-other',conversation:'room',audience:'friend:original',plaintext:'old theirs',sender,direction:'incoming',archival:true}],outgoing:[]},'room');
 assert.deepEqual(rows[0].redactionTarget,{legacy:{conversation:'room',audience:'friend:original',operation:'old-own',peerKeys:sender}});assert.equal(rows[1].redactionTarget,undefined);
});
test('Circle photo messages project caption and encrypted image descriptor instead of raw JSON',()=>{
 const image={epoch:3,media:{version:1,id:'photo-1',key:'f'.repeat(64),size:512,mimeType:'image/jpeg'}};
 const body=encodeCirclePhotoMessage({id:'photo-op',caption:'Family dinner',image});
 const [row]=view.conversationMessages({incoming:[{operation:'photo-op',conversation:'room',plaintext:body,sender:{identity:'sender'}}],outgoing:[]},'room');
 assert.equal(row.text,'Family dinner');assert.deepEqual(row.photoMessage.image,image);
});
test('private Chat photos project the encrypted descriptor for the accepted conversation only', async () => {
 const { encodePrivatePhotoMessage } = await import('../src/features/messages/private-photo-message.ts');
 const audience = 'friend:req-2', body = encodePrivatePhotoMessage({ id: 'photo-op', audience, caption: 'At the lake', media: { version: 1, id: 'photo-1', key: 'f'.repeat(64), size: 512, mimeType: 'image/jpeg' } });
 const rows = view.conversationMessages({ incoming: [{ operation: 'photo-op', conversation: 'private:' + 'b'.repeat(64), audience, plaintext: body, sender: { identity: 'friend' } }], outgoing: [] }, 'private:' + 'b'.repeat(64));
 assert.equal(rows[0].text, 'At the lake'); assert.equal(rows[0].privatePhotoMessage.audience, audience); assert.equal(rows[0].privatePhotoMessage.media.id, 'photo-1');
 assert.deepEqual(view.conversationMessages({ incoming: [{ operation: 'different-op', conversation: 'private:' + 'b'.repeat(64), audience, plaintext: body, sender: { identity: 'friend' } }], outgoing: [] }, 'private:' + 'b'.repeat(64)), []);
});

test('private PING and explicit PONG project as typed chat actions without exposing JSON', async () => {
 const { encodePing, encodePong } = await import('../src/features/messages/ping-pong.ts');
 const rows = view.conversationMessages({ incoming: [{ operation: 'ping-1', conversation: 'private:' + 'b'.repeat(64), plaintext: encodePing(), contentType: 'ping', sender: { identity: 'friend' } }], outgoing: [{ operation: 'pong-1', conversation: 'private:' + 'b'.repeat(64), plaintext: encodePong('ping-1'), contentType: 'pong', status: 'sent' }] }, 'private:' + 'b'.repeat(64));
 assert.equal(rows[0].text, 'PING!'); assert.equal(rows[0].ping, true); assert.equal(rows[0].respondedByMe, true);
 assert.equal(rows[1].text, 'PONG!'); assert.equal(rows[1].pong.pingOperation, 'ping-1');
});

test('Circle conversation projections never turn typed PING/PONG events into Circle controls', async () => {
 const { encodePing, encodePong } = await import('../src/features/messages/ping-pong.ts');
 const rows = view.conversationMessages({ incoming: [{ operation: 'ping-1', conversation: 'circle:1', plaintext: encodePing(), contentType: 'ping', sender: { identity: 'member' } }, { operation: 'pong-1', conversation: 'circle:1', plaintext: encodePong('ping-1'), contentType: 'pong', sender: { identity: 'member' } }], outgoing: [] }, 'circle:1');
 assert.deepEqual(rows, []);
});
