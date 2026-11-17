// 파일 저장 · 경로 · 정리.
//   사진  → data/images/  → /media/<파일>         (관리자 화면에서 올림)
//   음악  → data/music/   → /media/music/<파일>   (게임 전체가 쓰는 고정 곡 하나, limits.js 의 GAME_MUSIC)
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { DATA_FILE } from './store.js';
import { IMAGE_NAME, GAME_MUSIC } from './limits.js';
import { log } from './logger.js';

const DATA_DIR = path.dirname(DATA_FILE);

// 파일 앞부분(매직 바이트)으로 실제 형식을 확인한다 — Content-Type 만 믿지 않는다
const ascii = (buf, a, b) => (buf.length >= b ? buf.toString('ascii', a, b) : '');

function detectImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  return null;
}

export const IMAGE_DIR = path.join(DATA_DIR, 'images');
export const MUSIC_DIR = path.join(DATA_DIR, 'music');

// 사진을 저장하고 새 파일 이름을 돌려준다. 형식을 알 수 없으면 null.
export function saveImage(buf) {
  const ext = detectImage(buf);
  if (!ext) return null;
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const name = `${randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, name), buf);
  return name;
}

// 이름 규칙을 통과한 것만 경로로 바꿔 준다 (경로 탈출 차단)
export function imagePath(name) {
  return IMAGE_NAME.test(name) ? path.join(IMAGE_DIR, name) : null;
}

export function imageExists(name) {
  const p = imagePath(name);
  return !!p && fs.existsSync(p);
}

// 고정 곡 파일 경로. 정해진 이름 하나만 허용한다.
export function musicPath(name) {
  return name === GAME_MUSIC.file ? path.join(MUSIC_DIR, name) : null;
}

export function musicExists() {
  return fs.existsSync(path.join(MUSIC_DIR, GAME_MUSIC.file));
}

// 어느 세트에서도 쓰지 않는 사진을 지운다.
// 방금 올리고 아직 저장하지 않은 파일은 지우지 않게 최근 30분 안에 만든 파일은 남긴다.
const GRACE_MS = 30 * 60 * 1000;

export function cleanupImages(used, reqId) {
  let names;
  try {
    names = fs.readdirSync(IMAGE_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const now = Date.now();
  for (const name of names) {
    if (!IMAGE_NAME.test(name) || used.has(name)) continue;
    const p = path.join(IMAGE_DIR, name);
    try {
      if (now - fs.statSync(p).mtimeMs < GRACE_MS) continue;
      fs.unlinkSync(p);
      log.info('쓰지 않는 사진 삭제', { reqId, file: name });
    } catch (err) {
      log.warn('사진 삭제 실패', { reqId, file: name, err: err.message });
    }
  }
}
