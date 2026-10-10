import assert from 'node:assert/strict';
import test from 'node:test';
import { makeStickerMessage, copySticker } from '../src/features/stickers/model.ts';

test('a sent sticker keeps its composition when its library item is edited', () => {
  const source = { image: 'sample.png', title: 'Hello', text: 'Hey!', textColor: '#fff', textSize: 24, textY: 70, background: null, pack: 'Made by you' };
  const message = makeStickerMessage(source);
  source.text = 'Changed';
  source.textSize = 40;
  assert.equal(message.stickerArtwork.text, 'Hey!');
  assert.equal(message.stickerArtwork.textSize, 24);
});

test('saving a Circle sticker makes an independent personal composition', () => {
  const source = { image: 'sample.png', title: 'Hello', text: '', textColor: '#fff', textSize: 24, textY: 70, background: null, pack: 'Circle' };
  const copy = copySticker(source, 'Saved stickers');
  copy.title = 'My hello';
  assert.equal(source.title, 'Hello');
  assert.equal(copy.pack, 'Saved stickers');
});

test('text layers are independent in sent stickers and saved copies', () => {
  const source = { image: 'sample.png', title: 'Hello', text: '', textColor: '#fff', textSize: 24, textY: 70, background: null, pack: 'Circle', textBoxes: [{ id: 'one', text: 'First', x: .1, y: .2, color: '#fff', size: 24 }] };
  const sent = makeStickerMessage(source);
  const saved = copySticker(source, 'Personal');
  source.textBoxes[0].text = 'Edited';
  assert.equal(sent.stickerArtwork.textBoxes[0].text, 'First');
  assert.equal(saved.textBoxes[0].text, 'First');
});
