import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportAPI, ReportError } from '../src/features/reports/api.ts';

const session = () => ({ accessToken: 'session-token', account: { id: 'reporter' }, deviceId: 'device-a', generation: 2 });

test('report API sends only explicitly selected content under the authenticated session', async () => {
  const prior = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => { captured = { url, init }; return new Response(JSON.stringify({ id: 'report-1', operationId: 'op-1', expiresAt: '2027-01-13T00:00:00Z' }), { status: 200 }); };
  try {
    const api = createReportAPI('https://api.example.test', session);
    const result = await api.submit({ operationId: 'op-1', conversation: `private:${'a'.repeat(64)}`, subjectId: 'friend-1', reason: 'spam', details: '', selected: [{ eventId: 'event-1', text: 'selected excerpt' }] });
    assert.equal(captured.url, 'https://api.example.test/v1/reports');
    assert.equal(captured.init.headers.Authorization, 'Bearer session-token');
    assert.deepEqual(JSON.parse(captured.init.body).selected, [{ eventId: 'event-1', text: 'selected excerpt' }]);
    assert.equal(result.id, 'report-1');
  } finally { globalThis.fetch = prior; }
});

test('report API rejects account changes while the disclosure request is in flight', async () => {
  const priorFetch = globalThis.fetch;
  let current = session();
  globalThis.fetch = async () => { current = { ...current, account: { id: 'replacement' } }; return new Response(JSON.stringify({ id: 'report-1', operationId: 'op-1', expiresAt: '2027-01-13T00:00:00Z' }), { status: 200 }); };
  try {
    const api = createReportAPI('https://api.example.test', () => current);
    await assert.rejects(() => api.submit({ operationId: 'op-1', conversation: `private:${'a'.repeat(64)}`, subjectId: 'friend-1', reason: 'spam', details: '', selected: [] }), error => error instanceof ReportError && error.code === 'SESSION_CHANGED');
  } finally { globalThis.fetch = priorFetch; }
});
