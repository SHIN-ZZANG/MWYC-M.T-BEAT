// 단어 세트 저장소 — JSON 파일 하나(data/sets.json).
// 요청마다 파일을 새로 읽으므로 손으로 고친 내용이 재시작 없이 바로 반영된다.
// 파일 읽기 → 수정 → 쓰기를 모두 동기로 처리해 한 요청이 끝나기 전에 다른 요청이 끼어들지 않는다.
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from './paths.js';
import { HttpError } from './http-util.js';
import { LIMITS, DEFAULTS, IMAGE_NAME, GAME_MUSIC } from './limits.js';
import { log } from './logger.js';

export const DATA_FILE = path.resolve(ROOT_DIR, process.env.DATA_FILE || 'data/sets.json');
const REL = path.relative(ROOT_DIR, DATA_FILE);

// ── 손으로 고친 값 보정 ─────────────────────────────────
// 범위를 벗어난 값은 가장 가까운 허용값으로, 형식이 틀린 값은 기본값으로 바꾼다.
// 값이 아예 없으면(새로 생긴 항목 등) 조용히 기본값을 쓴다.
// 예전 항목(bpm · speedup · music* · cardCount · listenBars)은 읽을 때 버린다 — 빠르기 · 라운드 구조는 고정 곡(limits.js GAME_MUSIC)을 따른다.
// 파일 자체는 고치지 않는다 (다음 저장 때 보정된 값으로 써진다).
const chars = (s) => [...s];
const cut = (s, n) => chars(s).slice(0, n).join('');

function clampInt(v, min, max, def, fix, field) {
  const n = Math.round(Number(v));
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) {
    if (v !== undefined) fix(field, v, def);
    return def;
  }
  const c = Math.min(max, Math.max(min, n));
  if (c !== v) fix(field, v, c);
  return c;
}

function sanitizeWord(w, fix) {
  if (typeof w === 'string') w = { text: w };
  const out = {
    text: String(w?.text ?? '').trim(),
    emoji: String(w?.emoji ?? '').trim(),
    image: String(w?.image ?? '').trim(),
    zoom: Number(w?.zoom ?? 1),
  };
  if (!LIMITS.zooms.includes(out.zoom)) { fix('words.zoom', `${out.text}: ${w?.zoom}`, 1); out.zoom = 1; }
  if (chars(out.text).length > LIMITS.text) { fix('words.text', out.text, cut(out.text, LIMITS.text)); out.text = cut(out.text, LIMITS.text); }
  if (chars(out.emoji).length > LIMITS.emoji) { fix('words.emoji', out.text, '(잘림)'); out.emoji = cut(out.emoji, LIMITS.emoji); }
  if (out.image && !IMAGE_NAME.test(out.image)) { fix('words.image', out.image, '(무시)'); out.image = ''; }
  if (!out.image) out.zoom = 1; // 확대는 사진에만 쓰인다
  return out;
}

// 라운드 구성 — 라운드 수와 길이를 맞춘다 (모자라면 마지막 줄을 되풀이, 넘치면 자른다).
// 예전 형식은 게임에 나오는 모습이 같도록 조용히 바꾼다 (다음 저장 때 새 형식으로 기록된다):
//   구성 없음 → 단어 수 4 → 5 → …, 이름 표시가 켜져 있었으면 사진+단어, 꺼져 있었으면 사진만
//   image(사진) → 섞기 0/0/8 · mix(카드 절반 글자) → 섞기 4/4/0(이름 표시 켜짐) 또는 4/0/4
function sanitizePlan(plan, rounds, wordCount, oldLabel, fix) {
  const cards = GAME_MUSIC.cards;
  const half = Math.ceil(cards / 2);
  const photoOnly = { text: 0, both: 0, image: cards };
  if (plan !== undefined && plan !== null && !Array.isArray(plan)) { fix('plan', plan, '(자동 구성)'); plan = []; }
  if (!plan || !plan.length) {
    const maxK = Math.max(LIMITS.kindsMin, Math.min(LIMITS.kindsMax, wordCount));
    return Array.from({ length: rounds }, (_, i) => (oldLabel
      ? { kinds: Math.min(maxK, half + i), show: 'both' }
      : { kinds: Math.min(maxK, half + i), show: 'mix', mix: { ...photoOnly } }));
  }
  const out = plan.slice(0, rounds).map((p, i) => {
    const kinds = clampInt(p?.kinds, LIMITS.kindsMin, LIMITS.kindsMax, LIMITS.kindsMin, fix, `plan[${i}].kinds`);
    const show = p?.show;
    if (show === 'text' || show === 'both') return { kinds, show };
    if (show === 'image') return { kinds, show: 'mix', mix: { ...photoOnly } };
    if (show === 'mix') {
      if (!p.mix) return { kinds, show, mix: oldLabel ? { text: half, both: cards - half, image: 0 } : { text: half, both: 0, image: cards - half } };
      const mix = Object.fromEntries(LIMITS.mixParts.map((k) => [k, Number(p.mix[k])]));
      const ok = LIMITS.mixParts.every((k) => Number.isInteger(mix[k]) && mix[k] >= 0)
        && LIMITS.mixParts.reduce((a, k) => a + mix[k], 0) === cards;
      if (!ok) { fix(`plan[${i}].mix`, JSON.stringify(p.mix), `0/0/${cards} (사진만)`); return { kinds, show, mix: { ...photoOnly } }; }
      return { kinds, show, mix };
    }
    fix(`plan[${i}].show`, show, 'both');
    return { kinds, show: 'both' };
  });
  if (plan.length !== rounds) fix('plan', `${plan.length}줄`, `${rounds}줄 (라운드 수에 맞춤)`);
  while (out.length < rounds) out.push({ ...out[out.length - 1] });
  return out;
}

function sanitizeSet(s, id, fix) {
  let name = String(s.name ?? '').trim();
  if (!name) { name = `세트 ${id}`; fix('name', s.name, name); }
  if (chars(name).length > LIMITS.name) { name = cut(name, LIMITS.name); fix('name', '(너무 김)', name); }

  // 예전 파일의 showLabel(사진 밑 이름 표시)은 라운드 구성으로 옮겨진다 — 섞기 장수 · 사진+단어
  const oldLabel = s.showLabel ?? true;

  // 예전 파일의 cardMode(세트 단위 이모지/사진)는 읽지 않는다 — 단어마다 사진 > 이모지 > 글자 순으로 정해진다

  const rounds = clampInt(s.rounds, LIMITS.roundsMin, LIMITS.roundsMax, DEFAULTS.rounds, fix, 'rounds');
  let words = (Array.isArray(s.words) ? s.words : []).map((w) => sanitizeWord(w, fix)).filter((w) => w.text);
  if (words.length > LIMITS.wordsMax) { fix('words', `${words.length}개`, `${LIMITS.wordsMax}개`); words = words.slice(0, LIMITS.wordsMax); }
  if (words.length < LIMITS.wordsMin) fix('words', `${words.length}개`, `게임 불가 (최소 ${LIMITS.wordsMin}개)`);
  const plan = sanitizePlan(s.plan, rounds, words.length, !!oldLabel, fix);

  return {
    id,
    name,
    rounds,
    plan,
    words,
  };
}

let lastWarnedRaw = null; // 같은 파일 내용에 대해 경고를 반복하지 않기 위함

function read() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { sets: [] };
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw.replace(/^﻿/, '')); // 메모장이 붙이는 BOM 제거
  } catch (err) {
    throw new HttpError(500, `${REL} 형식이 잘못되었습니다 — ${err.message}`);
  }
  if (!data || !Array.isArray(data.sets)) {
    throw new HttpError(500, `${REL} 에 "sets" 배열이 없습니다.`);
  }

  // 항목마다 보정: id 가 없거나 겹치면 새로 매기고, 값은 허용 범위로
  const warn = raw !== lastWarnedRaw;
  lastWarnedRaw = raw;
  const used = new Set();
  let maxId = Math.max(0, ...data.sets.map((s) => (Number.isInteger(s?.id) ? s.id : 0)));
  data.sets = data.sets.filter((s) => s && typeof s === 'object').map((s, i) => {
    let id = s.id;
    if (!Number.isInteger(id) || id < 1 || used.has(id)) {
      const next = ++maxId;
      if (warn) log.warn(`${REL} 값 보정`, { set: i + 1, field: 'id', from: JSON.stringify(id ?? null), to: next });
      id = next;
    }
    used.add(id);
    const fix = (field, from, to) => {
      if (warn) log.warn(`${REL} 값 보정`, { set: id, field, from: JSON.stringify(from), to: JSON.stringify(to) });
    };
    return sanitizeSet(s, id, fix);
  });
  return data;
}

// 사람이 읽기 좋게: 단어 하나는 한 줄로, 사진이 없으면 image 는 생략, 확대(zoom)는 1 이 아닐 때만
function format(data) {
  const out = {
    sets: data.sets.map((s) => ({
      ...s,
      words: s.words.map((w) => {
        if (!w.image) return { text: w.text, emoji: w.emoji };
        return w.zoom && w.zoom !== 1
          ? { text: w.text, emoji: w.emoji, image: w.image, zoom: w.zoom }
          : { text: w.text, emoji: w.emoji, image: w.image };
      }),
    })),
  };
  return JSON.stringify(out, null, 2)
    .replace(/\{\n\s+("text": [^\n]*)\n((?:\s+"(?:emoji|image|zoom)": [^\n]*\n)*)\s+\}/g,
      (_, first, rest) => `{ ${[first, ...rest.split('\n').map((l) => l.trim()).filter(Boolean)].join(' ')} }`)
    .replace(/\{\n\s+("kinds": [^\n]*)\n\s+("show": [^\n]*)\n(?:\s+"mix": \{\n\s+("text": [^\n]*)\n\s+("both": [^\n]*)\n\s+("image": [^\n]*)\n\s+\}\n)?\s+\}/g,
      (_, k, sh, t, b, im) => (t ? `{ ${k} ${sh} "mix": { ${t} ${b} ${im} } }` : `{ ${k} ${sh} }`))
    + '\n';
}

// 임시 파일에 쓴 뒤 이름 바꾸기 — 쓰다가 꺼져도 원본이 깨지지 않는다
function write(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, format(data), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

const pick = (s) => ({
  name: s.name, rounds: s.rounds, plan: s.plan ?? [], words: s.words,
});

// 처음 세팅용 기본 세트 — git 으로 관리한다. 실제 데이터(data/ 폴더)는 git 에 없고 서버에서 바뀐다.
export const EXAMPLE_FILE = path.join(ROOT_DIR, 'src', 'default-sets.json');

// 시작할 때 파일을 한 번 읽어 형식을 확인한다 (오류면 그대로 던짐).
// 데이터 파일이 없으면 기본 세트(src/default-sets.json)를 복사해 시작한다 — 있으면 절대 건드리지 않는다.
export function checkStore() {
  let seeded = false;
  if (!fs.existsSync(DATA_FILE) && fs.existsSync(EXAMPLE_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.copyFileSync(EXAMPLE_FILE, DATA_FILE, fs.constants.COPYFILE_EXCL);
    seeded = true;
  }
  const exists = fs.existsSync(DATA_FILE);
  return { exists, seeded, count: read().sets.length };
}

export function listSets() {
  return read().sets.map(({ words, ...s }) => ({ ...s, wordCount: words.length }));
}

export function getSet(id) {
  return read().sets.find((s) => s.id === id) ?? null;
}

// 어느 세트에서든 쓰고 있는 사진 파일 이름
export function usedImages() {
  return new Set(read().sets.flatMap((s) => s.words.map((w) => w.image).filter(Boolean)));
}

export function insertSet(s) {
  const data = read();
  const id = Math.max(0, ...data.sets.map((x) => x.id)) + 1;
  data.sets.push({ id, ...pick(s) });
  write(data);
  return id;
}

export function updateSet(id, s) {
  const data = read();
  const i = data.sets.findIndex((x) => x.id === id);
  if (i < 0) return false;
  data.sets[i] = { id, ...pick(s) };
  write(data);
  return true;
}

export function deleteSet(id) {
  const data = read();
  const before = data.sets.length;
  data.sets = data.sets.filter((x) => x.id !== id);
  if (data.sets.length === before) return false;
  write(data);
  return true;
}
