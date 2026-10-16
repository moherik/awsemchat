import { createServer } from 'node:http';
const file = { id: 'file-one', name: 'AwsemChat.awsembackup', size: '4', modifiedTime: '2026-10-12T00:00:00Z', spaces: ['appDataFolder'], appProperties: { backupFormat: 'awsemchat.history.v1' } };
createServer(async (request, response) => {
  if (request.headers.authorization !== 'Bearer synthetic-google-token') { response.writeHead(401); response.end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1:8087');
  let body = ''; for await (const chunk of request) body += chunk;
  if (url.pathname !== '/upload/drive/v3/files' || request.method !== 'PUT') { response.writeHead(404); response.end(); return; }
  const id = url.searchParams.get('upload_id');
  if (id === 'expired') { response.writeHead(404); response.end(); return; }
  if (id === 'redirect') { response.writeHead(308, { Location: 'https://invalid.example/upload', Range: 'bytes=0-1' }); response.end(); return; }
  if (id === 'partial' && request.headers['content-range'] === 'bytes */4' && body === '') {
    response.writeHead(308, { Range: 'bytes=0-1' }); response.end(); return;
  }
  if ((id === 'partial' && request.headers['content-range'] === 'bytes 2-3/4' && body === '==') ||
    (id === 'complete' && request.headers['content-range'] === 'bytes */4' && body === '')) {
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(file)); return;
  }
  response.writeHead(400); response.end();
}).listen(8087, '127.0.0.1', () => process.stdout.write('Synthetic Drive transport fixture ready on8087\n'));
