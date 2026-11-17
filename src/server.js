import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { log } from './logger.js';
import { PUBLIC_DIR } from './paths.js';
import { checkStore, DATA_FILE } from './store.js';
import { IMAGE_DIR, MUSIC_DIR, imagePath, musicPath, musicExists } from './media.js';
import { GAME_MUSIC } from './limits.js';
import { handleApi } from './routes/api.js';
import { HttpError, sendJson } from './http-util.js';

// ── 프로세스 전체 오류 처리 ─────────────────────────────
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { stack: err?.stack ?? err });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', { stack: reason?.stack ?? reason });
  process.exit(1);
});

// ── 포트 결정: CLI --port > PORT > 3000 ─────────────────
function resolvePort() {
  const args = process.argv.slice(2);
  const i = args.findIndex((a) => a === '--port' || a.startsWith('--port='));
  let raw;
  let source;
  if (i >= 0) {
    raw = args[i].includes('=') ? args[i].slice('--port='.length) : args[i + 1];
    source = 'CLI 인자(--port)';
  } else if (process.env.PORT !== undefined && process.env.PORT !== '') {
    raw = process.env.PORT;
    source = '환경변수(PORT)';
  } else {
    return { port: 3000, source: '기본값' };
  }
  const n = Number(raw);
  if (!/^\d+$/.test(String(raw ?? '')) || n < 1 || n > 65535) {
    log.error(`잘못된 포트 값 "${raw ?? ''}" — 1~65535 사이 정수를 지정하세요. 서버를 시작하지 않습니다.`, { source });
    process.exit(1);
  }
  return { port: n, source };
}

const { port: PORT, source: portSource } = resolvePort();
const HOST = process.env.HOST || '0.0.0.0';

// ── 정적 파일 ───────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
};

function serveStatic(req, res, pathname, ctx) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  const safePath = path.join(PUBLIC_DIR, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!safePath.startsWith(PUBLIC_DIR + path.sep) || rel.includes('\0')) {
    log.warn('경로 탈출 시도 차단', { reqId: ctx.reqId, path: pathname });
    res.writeHead(403).end('Forbidden');
    return;
  }

  sendFile(req, res, safePath, pathname, ctx, 'no-cache', true);
}

// 파일 하나를 응답으로 보낸다
function sendFile(req, res, filePath, pathname, ctx, cacheControl, allowDir = false) {
  fs.stat(filePath, (err, st) => {
    if (allowDir && !err && st.isDirectory()) {
      res.writeHead(301, { Location: pathname + '/' }).end();
      return;
    }
    if (err || !st.isFile()) {
      log.warn('파일 없음', { reqId: ctx.reqId, path: pathname });
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath)
      .on('error', (e) => {
        log.error('파일 읽기 실패', { reqId: ctx.reqId, path: pathname, stack: e.stack });
        res.destroy(e);
      })
      .pipe(res);
  });
}

// 파일: /media/<사진> · /media/music/<고정 곡>. 이름 규칙에 맞는 것만 data/ 아래에서 찾는다.
function serveMedia(req, res, pathname, ctx) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }
  const rest = pathname.slice('/media/'.length);
  const music = rest.startsWith('music/');
  const filePath = music ? musicPath(rest.slice('music/'.length)) : imagePath(rest);
  if (!filePath) {
    log.warn('잘못된 미디어 경로 차단', { reqId: ctx.reqId, path: pathname });
    res.writeHead(403).end('Forbidden');
    return;
  }
  // 사진은 올릴 때마다 이름이 새로 정해지므로 오래 캐시해도 된다.
  // 곡은 이름이 고정이라 파일을 바꿔 끼울 수 있으므로 매번 확인한다.
  sendFile(req, res, filePath, pathname, ctx, music ? 'no-cache' : 'public, max-age=31536000, immutable');
}

// ── 서버 ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const reqId = randomUUID().slice(0, 8);
  const start = Date.now();
  const ctx = { reqId, route: null };
  res.setHeader('X-Request-Id', reqId);

  const url = new URL(req.url, 'http://localhost');

  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level](`${req.method} ${url.pathname} ${res.statusCode} ${ms}ms`, { reqId });
    log.debug('요청 상세', {
      reqId,
      query: url.search || '-',
      bodyBytes: req.headers['content-length'] ?? 0,
      ip: req.socket.remoteAddress,
      ua: JSON.stringify(req.headers['user-agent'] ?? ''),
    });
  });

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname, ctx);
    } else if (url.pathname.startsWith('/media/')) {
      serveMedia(req, res, url.pathname, ctx);
    } else {
      serveStatic(req, res, url.pathname, ctx);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status >= 500) log.error(err.message, { reqId, route: ctx.route ?? url.pathname });
      if (!res.headersSent) sendJson(res, err.status, { error: err.message, reqId });
      return;
    }
    log.error('요청 처리 실패', { reqId, route: ctx.route ?? url.pathname, stack: err.stack });
    if (!res.headersSent) sendJson(res, 500, { error: '서버 오류가 발생했습니다.', reqId });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`포트 ${PORT} 가 이미 사용 중입니다. 다른 프로세스를 종료하거나 --port / PORT 로 다른 포트를 지정하세요.`);
  } else if (err.code === 'EACCES') {
    log.error(`포트 ${PORT} 에 바인딩할 권한이 없습니다. 1024 이상 포트를 쓰거나 권한을 확인하세요.`);
  } else {
    log.error('서버 시작 실패', { stack: err.stack });
  }
  process.exit(1);
});

// 데이터 파일 형식 확인 — 깨져 있으면 원인을 남기고 시작하지 않는다
try {
  const { exists, count } = checkStore();
  if (exists) log.info('데이터 파일 확인', { sets: count });
  else log.warn('데이터 파일이 없습니다. 첫 저장 때 새로 만듭니다', { file: DATA_FILE });
} catch (err) {
  log.error(`데이터 파일을 읽을 수 없습니다: ${err.message}`, { file: DATA_FILE });
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  log.info(`listening on http://${HOST}:${PORT}`, { source: portSource });
  // 0.0.0.0 은 브라우저 주소로 열리지 않으므로 실제로 열 수 있는 주소를 따로 알려 준다
  if (HOST === '0.0.0.0' || HOST === '::') {
    const lan = Object.values(os.networkInterfaces()).flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${PORT}`);
    log.info(`열기: http://localhost:${PORT}` + (lan.length ? `  (같은 네트워크: ${lan.join(', ')})` : ''));
  } else if (HOST === '127.0.0.1' || HOST === 'localhost') {
    log.info(`열기: http://localhost:${PORT}  (이 PC 에서만 접속 가능 — HOST=${HOST})`);
  } else {
    log.info(`열기: http://${HOST}:${PORT}`);
  }
  log.info('실행 환경', {
    host: HOST,
    NODE_ENV: process.env.NODE_ENV ?? '(없음)',
    node: process.version,
    LOG_LEVEL: log.level,
  });
  log.info('경로', { public: PUBLIC_DIR, data: DATA_FILE, images: IMAGE_DIR, music: MUSIC_DIR });
  if (musicExists()) {
    log.info('배경음악', { file: GAME_MUSIC.file, bpm: GAME_MUSIC.bpm, offset: GAME_MUSIC.offset, round: `듣기 ${GAME_MUSIC.listenBeats}박 + 카드 ${GAME_MUSIC.cards}장` });
  } else {
    log.warn(`배경음악 파일 없음 — 기본 비트(${GAME_MUSIC.bpm} BPM)로 진행합니다. ${MUSIC_DIR} 에 ${GAME_MUSIC.file} 를 넣으세요.`);
  }
});

function shutdown(sig) {
  log.info(`${sig} 수신 — 종료합니다`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
