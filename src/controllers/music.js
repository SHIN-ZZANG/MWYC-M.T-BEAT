// 게임 배경음악 정보 API — 모든 세트가 같은 곡 · 같은 BPM · 같은 라운드 구조를 쓴다 (limits.js GAME_MUSIC)
import { sendJson } from '../http-util.js';
import { GAME_MUSIC } from '../limits.js';
import { musicExists } from '../media.js';

export function info(req, res) {
  sendJson(res, 200, {
    title: GAME_MUSIC.title,
    bpm: GAME_MUSIC.bpm,
    offset: GAME_MUSIC.offset,
    listenBeats: GAME_MUSIC.listenBeats,
    cards: GAME_MUSIC.cards,
    // 파일이 없으면 url 을 비워 두고, 게임은 같은 BPM 의 기본 비트로 진행한다
    url: musicExists() ? '/media/music/' + encodeURIComponent(GAME_MUSIC.file) : '',
  });
}
