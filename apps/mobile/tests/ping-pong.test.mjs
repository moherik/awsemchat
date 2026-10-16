import test from 'node:test';
import assert from 'node:assert/strict';
import * as pingPong from '../src/features/messages/ping-pong.ts';

test('PING and PONG payloads are strict, bounded, and bind a PONG to its PING operation', () => {
  const ping = pingPong.encodePing();
  assert.deepEqual(pingPong.decodePing(ping), { version: 1, type: 'awsem-ping' });
  const pong = pingPong.encodePong('ping-operation-1');
  assert.deepEqual(pingPong.decodePong(pong), { version: 1, type: 'awsem-pong', pingOperation: 'ping-operation-1' });
  assert.equal(pingPong.decodePing('{"version":1,"type":"awsem-ping","extra":true}'), undefined);
  assert.equal(pingPong.decodePong('{"version":1,"type":"awsem-pong","pingOperation":"ping-operation-1","extra":true}'), undefined);
  assert.throws(() => pingPong.encodePong(''), { message: 'INVALID_PING' });
});

test('PING alert animation is one-shot and rate-limited per conversation', () => {
  assert.equal(typeof pingPong.createPingAlertGate, 'function');
  const gate = pingPong.createPingAlertGate(5_000);
  assert.equal(gate.shouldAlert('private:one', 1_000), true);
  assert.equal(gate.shouldAlert('private:one', 5_999), false);
  assert.equal(gate.shouldAlert('private:two', 5_999), true);
  assert.equal(gate.shouldAlert('private:one', 6_000), true);
  assert.equal(gate.shouldAlert('private:one', 5_500), false);
});
