// 단어 세트 API 처리
import * as db from '../store.js';
import { HttpError, sendJson, readJson } from '../http-util.js';
import { log } from '../logger.js';
import { LIMITS } from '../limits.js';
import { imageExists, cleanupImages } from '../media.js';

// 세트 저장 · 삭제 뒤 어느 세트에서도 쓰지 않는 사진 정리
function cleanup(reqId) {
  cleanupImages(db.usedImages(), reqId);
}

function int(v, label, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label}은(는) ${min}~${max} 사이 정수여야 합니다.`);
  }
  return n;
}

// 입력 검증 + 정리. 문제가 있으면 400.
function normalize(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, '요청 본문이 비어 있습니다.');

  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, '세트 이름을 입력하세요.');
  if ([...name].length > LIMITS.name) throw new HttpError(400, `세트 이름은 ${LIMITS.name}자 이하로 입력하세요.`);

  if (!Array.isArray(body.words)) throw new HttpError(400, '단어 목록이 없습니다.');
  const words = body.words
    .map((w) => ({
      text: String(w?.text ?? '').trim(),
      emoji: String(w?.emoji ?? '').trim(),
      image: String(w?.image ?? '').trim(),
      zoom: Number(w?.zoom ?? 1),
    }))
    .filter((w) => w.text || w.emoji || w.image);

  words.forEach((w, i) => {
    if (!w.text) throw new HttpError(400, `${i + 1}번째 단어가 비어 있습니다.`);
    if ([...w.text].length > LIMITS.text) throw new HttpError(400, `"${w.text}" — 단어는 ${LIMITS.text}자 이하로 입력하세요.`);
    if ([...w.emoji].length > LIMITS.emoji) throw new HttpError(400, `"${w.text}" 의 이모지가 너무 깁니다.`);
    if (w.image && !imageExists(w.image)) throw new HttpError(400, `"${w.text}" 의 사진 파일을 찾을 수 없습니다. 사진을 다시 올려 주세요.`);
    if (!LIMITS.zooms.includes(w.zoom)) throw new HttpError(400, `"${w.text}" 의 사진 확대 배율이 잘못되었습니다.`);
    if (!w.image) w.zoom = 1; // 확대는 사진에만 쓰인다
  });

  if (words.length < LIMITS.wordsMin) throw new HttpError(400, `단어를 ${LIMITS.wordsMin}개 이상 넣으세요.`);
  if (words.length > LIMITS.wordsMax) throw new HttpError(400, `단어는 ${LIMITS.wordsMax}개까지 넣을 수 있습니다.`);

  const rounds = int(body.rounds, '라운드 수', LIMITS.roundsMin, LIMITS.roundsMax);
  const plan = normalizePlan(body.plan, rounds, words.length);

  return {
    name,
    rounds,
    plan,
    showLabel: !!body.showLabel,
    words,
  };
}

// 라운드 구성: 라운드 수만큼 줄이 있어야 한다 (라운드마다 단어 수 · 카드 표시)
function normalizePlan(plan, rounds, wordCount) {
  if (!Array.isArray(plan)) throw new HttpError(400, '라운드 구성 형식이 잘못되었습니다.');
  if (plan.length !== rounds) throw new HttpError(400, `라운드 구성이 ${plan.length}줄입니다. 라운드 수(${rounds})와 같아야 합니다.`);
  return plan.map((p, i) => {
    const kinds = int(p?.kinds, `${i + 1}라운드 단어 수`, LIMITS.kindsMin, LIMITS.kindsMax);
    if (kinds > wordCount) throw new HttpError(400, `${i + 1}라운드 단어 수(${kinds})가 넣은 단어 수(${wordCount})보다 많습니다.`);
    if (!LIMITS.shows.includes(p?.show)) throw new HttpError(400, `${i + 1}라운드 카드 표시는 단어 · 섞기 · 사진 중 하나여야 합니다.`);
    return { kinds, show: p.show };
  });
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, '잘못된 세트 ID 입니다.');
  return id;
}

export function list(req, res) {
  sendJson(res, 200, db.listSets());
}

export function get(req, res, { id }) {
  const set = db.getSet(parseId(id));
  if (!set) throw new HttpError(404, '세트를 찾을 수 없습니다.');
  sendJson(res, 200, set);
}

export async function create(req, res, _params, ctx) {
  const data = normalize(await readJson(req));
  const id = db.insertSet(data);
  log.info('단어 세트 생성', { reqId: ctx.reqId, id, words: data.words.length });
  cleanup(ctx.reqId);
  sendJson(res, 201, db.getSet(id));
}

export async function update(req, res, { id }, ctx) {
  const setId = parseId(id);
  const data = normalize(await readJson(req));
  if (!db.updateSet(setId, data)) throw new HttpError(404, '세트를 찾을 수 없습니다.');
  log.info('단어 세트 수정', { reqId: ctx.reqId, id: setId, words: data.words.length });
  cleanup(ctx.reqId);
  sendJson(res, 200, db.getSet(setId));
}

export function remove(req, res, { id }, ctx) {
  const setId = parseId(id);
  if (!db.deleteSet(setId)) throw new HttpError(404, '세트를 찾을 수 없습니다.');
  log.info('단어 세트 삭제', { reqId: ctx.reqId, id: setId });
  cleanup(ctx.reqId);
  res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
}
