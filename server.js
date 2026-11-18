import http from 'node:http';
import { watch } from 'node:fs';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath, readState } from './lib/store.js';
import { runOp } from './lib/ops.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const webRoot = resolve(root, 'web');
const urgencyPath = resolve(root, 'lib/urgency.js');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const clients = new Set();

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        chunks.length = 0;
        rejectBody(new Error('请求体不能超过 1MB'));
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > 1024 * 1024) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { rejectBody(new Error('请求体须为合法 JSON')); }
    });
    request.on('error', () => rejectBody(new Error('读取请求体失败')));
  });
}

async function staticFile(request, response) {
  let pathname;
  try { pathname = decodeURIComponent(request.url.split('?')[0]); }
  catch { response.writeHead(400); response.end('路径无效'); return; }
  const special = pathname === '/lib/urgency.js';
  const path = special ? urgencyPath : resolve(webRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!special && !path.startsWith(webRoot + sep)) { response.writeHead(403); response.end('禁止访问'); return; }
  try {
    // 同时禁止符号链接绕过 web/ 边界。
    const actual = await realpath(path);
    const actualWeb = special ? null : await realpath(webRoot);
    if (!special && !actual.startsWith(actualWeb + sep)) { response.writeHead(403); response.end('禁止访问'); return; }
    const content = await readFile(actual);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
    response.end(content);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) { response.writeHead(404); response.end('文件不存在'); }
    else throw error;
  }
}

await mkdir(dirname(dataPath), { recursive: true });
let lastRev = (await readState()).rev;
let watching = false;
let pending = false;
async function changed() {
  pending = true;
  if (watching) return;
  watching = true;
  try {
    do {
      pending = false;
      const state = await readState();
      if (state.rev !== lastRev) {
        lastRev = state.rev;
        for (const client of clients) client.write(`event: change\ndata: ${JSON.stringify({ rev: state.rev })}\n\n`);
      }
    } while (pending);
  } catch (error) { console.error(`监听数据失败：${error.message}`); }
  finally { watching = false; }
}
const watcher = watch(dirname(dataPath), (_, filename) => {
  if (filename !== null && filename.toString() === basename(dataPath)) void changed();
});
watcher.on('error', error => console.error(`监听数据失败：${error.message}`));

const server = http.createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  try {
    if (request.method === 'GET' && path === '/api/state') json(response, 200, await readState());
    else if (request.method === 'POST' && path === '/api/ops') {
      const body = await readBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.op !== 'string') throw new Error('请求须包含操作名 op 和参数 args');
      json(response, 200, { ok: true, state: await runOp(body.op, body.args) });
    } else if (request.method === 'GET' && path === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      response.flushHeaders();
      response.write(': 已连接\n\n');
      clients.add(response);
      const heartbeat = setInterval(() => response.write(': 保活\n\n'), 25000);
      response.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
    } else if (request.method === 'GET') await staticFile(request, response);
    else { response.writeHead(404); response.end('接口不存在'); }
  } catch (error) {
    if (path === '/api/ops') json(response, 400, { ok: false, error: error.message });
    else json(response, 500, { ok: false, error: `请求失败：${error.message}` });
  }
});

server.on('error', error => { console.error(`服务器启动失败：${error.message}`); watcher.close(); process.exitCode = 1; });
server.listen(Number(process.env.PORT ?? 4321), '127.0.0.1', () => {
  console.log(`线头已启动：http://127.0.0.1:${server.address().port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  watcher.close();
  for (const client of clients) client.end();
  server.close();
});
