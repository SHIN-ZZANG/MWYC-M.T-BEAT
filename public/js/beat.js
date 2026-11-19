// 비트 합성 + 오디오 시계 기준 스케줄러.
// 화면 강조는 setInterval 이 아니라 AudioContext.currentTime 에 맞춰 움직인다 (박자 밀림 방지).
(function () {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let volume = 0.8;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (!master) {
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── 악기 ─────────────────────────────
  function kick(t, level = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.4);
  }

  function noise(t, dur, freq, level, type = 'highpass') {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  function snare(t) {
    noise(t, 0.18, 1400, 0.55);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.12);
  }

  const hat = (t, level = 0.22) => noise(t, 0.05, 7500, level);
  const crash = (t) => noise(t, 1.4, 4500, 0.4);

  function blip(t, freq, level = 0.08) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.1);
  }

  // 박자 하나의 소리. part: listen(듣기, count 가 있으면 4·3·2·1) / say(말하기) / end(마무리)
  // drums=false(배경음악 사용)이면 드럼 없이 4·3·2·1 의 "삑" 만 낸다
  function playBeat(b, drums = true) {
    const half = b.spb / 2;
    if (!drums) {
      if (b.count) blip(b.t, b.count === 1 ? 1320 : 880);
      return;
    }
    if (b.part === 'say' || b.part === 'listen') { // 듣기 구간도 말하기와 같은 패턴
      kick(b.t, 1);
      if (b.n % 2 === 1) snare(b.t);
      hat(b.t + half);
      if (b.n % 4 === 3) hat(b.t + half * 1.5, 0.15);
      // 듣기 마지막 마디의 4·3·2·1 — 마지막 1 은 높은 음
      if (b.count) blip(b.t, b.count === 1 ? 1320 : 880);
    } else if (b.part === 'end') {
      kick(b.t, 1);
      crash(b.t);
    }
  }

  // ── 스케줄러 ──────────────────────────
  // beats: [{t, spb, part, n}], events: [{t, kind, ...}] — t 는 오디오 시계 기준 초
  // music: { buffer, at, offset, until } — at(오디오 시계)에 곡의 offset(초) 지점부터 재생, until 에서 페이드아웃
  function run({ beats, events, onEvent, music = null }) {
    if (music) {
      const stopMusic = playBuffer(music.buffer, music.at, music.offset);
      stopMusic.fadeAt(music.until, 1.5);
    }
    let bi = 0;
    let ei = 0;
    let stopped = false;
    const LOOKAHEAD = 0.15;
    const FRAME = 1 / 60;

    const timer = setInterval(() => {
      while (bi < beats.length && beats[bi].t < ctx.currentTime + LOOKAHEAD) {
        playBeat(beats[bi++], !music);
      }
    }, 25);

    function frame() {
      if (stopped) return;
      // 소리는 출력 지연만큼 늦게 들리므로 화면도 그만큼 늦춘다.
      // 바꾼 화면은 다음 프레임에야 그려지므로 한 프레임(FRAME) 먼저 처리해 그 지연을 상쇄한다.
      const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) + FRAME;
      while (ei < events.length && events[ei].t <= now) onEvent(events[ei++]);
      if (ei < events.length) requestAnimationFrame(frame);
      else clearInterval(timer);
    }
    requestAnimationFrame(frame);

    return function stop() {
      stopped = true;
      clearInterval(timer);
      stopAll(); // 이미 예약된 소리(음악 포함)를 끊는다
    };
  }

  // ── 배경음악 ──────────────────────────
  const musicCache = new Map(); // url → Promise<AudioBuffer>

  function loadMusic(url) {
    ensure();
    if (!musicCache.has(url)) {
      const p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`음악 파일을 불러오지 못했습니다 (${r.status}).`);
          return r.arrayBuffer();
        })
        .then((buf) => ctx.decodeAudioData(buf))
        .catch((err) => {
          musicCache.delete(url); // 실패하면 다음에 다시 시도
          throw err instanceof DOMException ? new Error('이 음악 파일을 재생할 수 없습니다. 다른 형식(MP3 등)으로 올려 주세요.') : err;
        });
      musicCache.set(url, p);
    }
    return musicCache.get(url);
  }

  // when(오디오 시계)에 버퍼의 offset(초) 지점부터 재생. 돌려준 함수로 멈추고, .fadeAt 로 페이드아웃 예약
  function playBuffer(buffer, when, offset = 0) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    src.connect(g).connect(master);
    src.start(when, Math.max(0, offset));
    const stop = () => { try { src.stop(); } catch { /* 이미 멈춤 */ } };
    stop.fadeAt = (t, dur) => {
      g.gain.setValueAtTime(1, t);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      src.stop(t + dur + 0.05);
    };
    return stop;
  }

  // 예약된 소리를 모두 끊는다 (마스터 출력을 갈아끼움)
  function stopAll() {
    if (master) {
      master.disconnect();
      master = null;
    }
  }

  window.Beat = {
    ensure,
    now: () => ctx.currentTime,
    run,
    loadMusic,
    playBuffer: (...a) => { ensure(); return playBuffer(...a); },
    blip: (t, freq, level) => { ensure(); blip(t, freq, level); },
    stopAll,
    setVolume(v) {
      volume = v;
      if (master) master.gain.value = v;
    },
  };
})();
