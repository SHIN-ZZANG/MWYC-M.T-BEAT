// 단어 세트 값의 허용 범위. 저장 검증(controllers/sets.js)과 파일 읽기 보정(store.js)이 함께 쓴다.
export const LIMITS = {
  name: 40,
  roundsMin: 1, roundsMax: 20, // 20라운드 × 16박 = 320박 — 곡(344박) 안에 다 들어간다
  cardModes: ['emoji', 'photo'],
  wordsMin: 2, wordsMax: 50,
  text: 20, emoji: 16,
};

export const DEFAULTS = {
  rounds: 5, showLabel: true, cardMode: 'emoji',
};

// 올린 파일 이름 규칙 (서버가 만든 이름만 허용 — 경로 조작 차단)
export const IMAGE_NAME = /^[a-f0-9]{16}\.(jpg|png|webp)$/;
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

// 게임 배경음악 — 모든 세트가 이 곡 하나를 쓰고, 빠르기 · 라운드 구조도 이 곡에 맞춰 고정된다.
// 곡은 "음악만 8박 → 단어 8개를 8박에 말하기" 16박 묶음을 21번 되풀이한다.
// 게임 라운드도 똑같이 "듣기 8박(마지막 4박에 4·3·2·1) → 카드 8장" 으로 맞춰, 곡의 단어 자리와 카드가 겹치게 한다.
// 파일은 data/music/ 에 두고 git 에는 올리지 않는다 (.gitignore). 파일이 없으면 같은 BPM 의 기본 비트로 진행한다.
export const GAME_MUSIC = {
  file: 'say-the-word-on-beat.wav', // หมูหมากาไก่ Say The Word On Beat — รอบกองเฟรนด์ (모노 44.1kHz WAV)
  title: 'Say The Word On Beat',
  bpm: 183,        // 곡 전체 스네어 · 보컬 단어 간격(0.328초)으로 잰 값
  offset: 0,       // 곡 시작 → 첫 16박 묶음의 첫 박 (초). 첫 단어는 8번째 박(2.62초)
  listenBeats: 8,  // 라운드마다 듣기 박 수 (곡의 "음악만" 구간)
  cards: 8,        // 라운드마다 카드 수 = 말하기 박 수 (곡의 "단어" 구간)
};
