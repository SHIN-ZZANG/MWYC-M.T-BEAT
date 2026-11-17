// /api/* 라우팅
import * as sets from '../controllers/sets.js';
import * as images from '../controllers/images.js';
import * as music from '../controllers/music.js';
import { HttpError } from '../http-util.js';

const ROUTES = [
  ['POST', /^\/api\/images$/, images.upload],
  ['GET', /^\/api\/music$/, music.info],
  ['GET', /^\/api\/sets$/, sets.list],
  ['POST', /^\/api\/sets$/, sets.create],
  ['GET', /^\/api\/sets\/(?<id>[^/]+)$/, sets.get],
  ['PUT', /^\/api\/sets\/(?<id>[^/]+)$/, sets.update],
  ['DELETE', /^\/api\/sets\/(?<id>[^/]+)$/, sets.remove],
];

// 처리한 route 이름을 돌려준다 (오류 로그 맥락용)
export async function handleApi(req, res, pathname, ctx) {
  let pathMatched = false;
  for (const [method, re, handler] of ROUTES) {
    const m = pathname.match(re);
    if (!m) continue;
    pathMatched = true;
    if (method !== req.method) continue;
    ctx.route = `${method} ${re.source}`;
    await handler(req, res, m.groups ?? {}, ctx);
    return;
  }
  if (pathMatched) throw new HttpError(405, '허용되지 않는 메서드입니다.');
  throw new HttpError(404, 'API 를 찾을 수 없습니다.');
}
