(function () {
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem('bwg.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('bwg.' + k, v); } catch { /* 저장 불가 무시 */ } },
  };

  const el = {
    setSelect: $('#setSelect'), stage: $('#stage'), grid: $('#grid'),
    roundLabel: $('#roundLabel'),
    idle: $('#idleOverlay'), idleInfo: $('#idleSetInfo'),
    end: $('#endOverlay'), endInfo: $('#endInfo'),
    start: $('#startBtn'), again: $('#againBtn'), stop: $('#stopBtn'),
    volume: $('#volume'), fullscreen: $('#fullscreenBtn'),
  };

  let current = null; // 선택된 세트 (단어 포함)
  let stopFn = null;
  let cards = [];

  // ── 화면 비율 ──────────────────────────
  function setOrient(o) {
    el.stage.classList.toggle('landscape', o === 'landscape');
    el.stage.classList.toggle('portrait', o === 'portrait');
    document.querySelectorAll('[data-orient]').forEach((b) => b.classList.toggle('on', b.dataset.orient === o));
    store.set('orient', o);
    if (current) layoutGrid(music.cards);
  }
  document.querySelectorAll('[data-orient]').forEach((b) => b.addEventListener('click', () => setOrient(b.dataset.orient)));

  function layoutGrid(n) {
    const portrait = el.stage.classList.contains('portrait');
    const cols = portrait ? 2 : { 4: 4, 6: 3, 8: 4 }[n];
    el.grid.style.setProperty('--cols', cols);
    el.grid.style.setProperty('--rows', Math.ceil(n / cols));
  }

  // ── 음량 ───────────────────────────────
  const savedVol = store.get('volume');
  if (savedVol !== null) el.volume.value = savedVol;
  Beat.setVolume(el.volume.value / 100);
  el.volume.addEventListener('input', () => {
    Beat.setVolume(el.volume.value / 100);
    store.set('volume', el.volume.value);
  });

  // ── 세트 불러오기 ──────────────────────
  async function loadSets() {
    const sets = await api('/api/sets');
    el.setSelect.replaceChildren(...sets.map((s) => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = `${s.name} (${s.wordCount}개)`;
      return o;
    }));
    if (!sets.length) {
      el.idleInfo.textContent = '단어 세트가 없습니다. 설정에서 먼저 만들어 주세요.';
      el.start.disabled = true;
      return;
    }
    const last = store.get('setId');
    if (last && sets.some((s) => String(s.id) === last)) el.setSelect.value = last;
    await selectSet(el.setSelect.value);
  }

  async function selectSet(id) {
    current = await api(`/api/sets/${encodeURIComponent(id)}`);
    store.set('setId', String(id));
    el.idleInfo.textContent =
      `「${current.name}」 · 단어 ${current.words.length}개 · ${current.rounds}라운드` +
      (photoOn() ? ' · 사진 카드 포함' : '');
    el.start.disabled = current.words.length < 2;
    if (el.start.disabled) el.idleInfo.textContent = `「${current.name}」 세트는 단어가 2개 이상 있어야 시작할 수 있습니다. 설정에서 단어를 추가해 주세요.`;
    layoutGrid(music.cards);
    renderPreview();
  }

  el.setSelect.addEventListener('change', () => {
    selectSet(el.setSelect.value).catch((e) => dlg.alert(errMsg(e), '세트 불러오기 실패'));
  });

  // 배경음악은 모든 세트가 같은 곡 하나 (서버 /api/music). 빠르기 · 라운드 구조(듣기 8박 + 카드 8장)도 곡에 맞춰 고정.
  // 곡 파일이 없으면 같은 BPM 의 기본 비트로 진행한다. 아래는 서버 응답을 받기 전 · 실패했을 때의 기본값.
  let music = { title: '', bpm: 183, offset: 0, listenBeats: 8, cards: 8, url: '' };
  const musicOn = () => !!music.url;

  // ── 사진 ───────────────────────────────
  // 단어마다 사진 > 이모지 > 글자 순으로 카드 그림이 정해진다
  const photoOn = () => current.words.some((w) => w.image);
  const mediaUrl = (file) => '/media/' + encodeURIComponent(file);
  const failedImages = new Set(); // 불러오기 실패한 사진은 이모지로 대신 보여 준다

  // 시작 전에 사진을 모두 미리 불러와 빠른 박자에서도 늦게 뜨지 않게 한다
  async function preloadImages() {
    if (!photoOn()) return;
    const files = [...new Set(current.words.map((w) => w.image).filter(Boolean))];
    await Promise.all(files.map(async (f) => {
      const img = new Image();
      img.src = mediaUrl(f);
      try { await img.decode(); } catch { failedImages.add(f); }
    }));
  }

  // ── 카드 ───────────────────────────────
  function cardFace(c, w) {
    if (w.image && !failedImages.has(w.image)) {
      const img = document.createElement('img');
      img.className = 'card-photo';
      img.alt = w.text;
      img.src = mediaUrl(w.image);
      if (w.zoom > 1) img.style.transform = `scale(${w.zoom})`; // 누끼처럼 얼굴이 작은 사진은 가운데 기준으로 키운다
      img.addEventListener('error', () => {
        failedImages.add(w.image);
        c.classList.remove('photo');
        img.replaceWith(emojiEl(c, w));
      });
      c.classList.add('photo');
      return img;
    }
    return emojiEl(c, w);
  }

  // 글자 카드 — 단어를 크게
  function textEl(c, w) {
    const e = document.createElement('div');
    e.className = 'card-emoji';
    e.textContent = w.text;
    c.classList.add('text-only');
    return e;
  }

  function emojiEl(c, w) {
    const e = document.createElement('div');
    e.className = 'card-emoji';
    e.textContent = w.emoji || w.text; // 이모지가 없으면 단어를 크게
    if (!w.emoji) c.classList.add('text-only');
    return e;
  }

  // seq: [{ w: 단어, face: 'text' | 'both' | 'image' }]
  //   text = 글자만 크게 · both = 그림(사진 > 이모지 > 글자) + 밑에 이름 · image = 그림만 (얼굴만 보고 말하기)
  function renderCards(seq) {
    cards = seq.map(({ w, face: kind }, i) => {
      const c = document.createElement('div');
      c.className = 'card';
      if (kind === 'image') c.classList.add('no-label');
      c.style.setProperty('--i', i);
      const face = kind === 'text' ? textEl(c, w) : cardFace(c, w);
      const t = document.createElement('div');
      t.className = 'card-text';
      t.textContent = w.text;
      c.append(face, t);
      return c;
    });
    el.grid.replaceChildren(...cards);
  }

  // 시작 전 대기 화면 — 이름을 미리 보여 주면 스포가 되므로 물음표 카드만
  function renderPreview() {
    const blank = { text: '', emoji: '❔', image: '' };
    renderCards(Array.from({ length: music.cards }, () => ({ w: blank, face: 'image' })));
    cards.forEach((c) => c.classList.add('dim'));
    el.roundLabel.textContent = '';
  }

  // ── 라운드 구성 ────────────────────────
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 라운드 구성(plan)이 있으면 그 라운드의 종류 수 · 표시 방식을 따른다.
  // 없으면 종류 수는 카드 수의 절반에서 시작해 라운드마다 1개씩 늘어난다 (8장: 4 → 5 → … → 8).
  // 횟수는 종류마다 가능한 한 고르게 나눈다 (8장에 3종류면 3·3·2번, 4종류 이상이면 최대 2번).
  // 순서는 무작위 후보를 여러 개 만들어 가장 덜 뻔한 것을 고른다 (seqScore). 매 판 새로 섞으므로 같은 세트를 다시 해도 다르다.
  function makeSequence(set, n, round, prev) {
    const step = set.plan && set.plan[round];
    const words = set.words;
    const distinct = Math.max(1, Math.min(words.length, n, step ? step.kinds : Math.ceil(n / 2) + round));
    const pool = shuffle([...words]).slice(0, distinct);
    const base = [];
    for (let i = 0; i < n; i++) base.push(pool[i % pool.length]); // 고르게 채우기
    let seq = null;
    let best = Infinity;
    for (let tries = 0; tries < 400; tries++) {
      const cand = shuffle([...base]);
      const score = seqScore(cand, prev);
      if (score < best) { best = score; seq = cand; }
    }

    // 카드마다 보이는 모습 — 섞기는 정한 장수만큼 글자 / 사진+이름 / 사진을 무작위 자리에 둔다
    const show = step ? step.show : 'both';
    const faces = seq.map(() => (show === 'text' ? 'text' : show === 'both' ? 'both' : 'image'));
    if (show === 'mix' && step.mix) {
      const idx = shuffle(seq.map((_, i) => i));
      const nText = step.mix.text || 0;
      const nBoth = step.mix.both || 0;
      idx.forEach((i, k) => { faces[i] = k < nText ? 'text' : k < nText + nBoth ? 'both' : 'image'; });
    }
    return seq.map((w, i) => ({ w, face: faces[i] }));
  }

  // 순서 점수 — 낮을수록 덜 뻔하고 어렵다.
  //   같은 단어 연달아(A A) 금지 · 한 칸 건너 반복(A B A) · 같은 두 단어 순서 반복(A B … A B) ·
  //   바로 전 라운드와 같은 자리에 같은 단어 → 감점.  글자 하나가 같은 비슷한 이름끼리 이웃(윤기-윤민) → 가점.
  function seqScore(seq, prev) {
    let score = 0;
    const pairs = new Set();
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1];
      const b = seq[i];
      if (a === b) score += 1000;
      if (i >= 2 && seq[i - 2] === b) score += 10;
      const pair = a.text + '\u0000' + b.text;
      if (pairs.has(pair)) score += 6;
      pairs.add(pair);
      if (a !== b && similar(a.text, b.text)) score -= 2;
    }
    if (prev) seq.forEach((w, i) => { if (prev[i] === w) score += 3; });
    return score;
  }

  const similar = (a, b) => [...a].some((ch) => b.includes(ch));

  function buildTimeline(set, t0) {
    const beats = [];
    const events = [];
    let t = t0;
    const n = music.cards;
    const listen = music.listenBeats; // 곡의 "음악만" 구간 — 이 동안 카드가 한 박에 한 장씩 나타난다
    const bpm = music.bpm;
    const spb = 60 / bpm;
    let prev = null;
    for (let r = 0; r < set.rounds; r++) {
      const seq = makeSequence(set, n, r, prev);
      prev = seq.map((x) => x.w);
      events.push({ t, kind: 'round', round: r, bpm, seq });
      for (let l = 0; l < listen; l++) {
        // 듣기 박마다 카드를 한 장씩 보여 준다 (카드가 듣기 박보다 많으면 마지막 박에 나머지를 한꺼번에)
        beats.push({ t, spb, part: 'listen', n: l });
        const from = Math.round(l * n / listen);
        const to = l === listen - 1 ? n : Math.round((l + 1) * n / listen);
        if (to > from) events.push({ t, kind: 'reveal', from, to });
        t += spb;
      }
      for (let i = 0; i < n; i++) {
        beats.push({ t, spb, part: 'say', n: i });
        events.push({ t, kind: 'say', i });
        t += spb;
      }
    }
    beats.push({ t, spb: 0.5, part: 'end' });
    events.push({ t, kind: 'end' });
    return { beats, events };
  }

  // ── 진행 ───────────────────────────────
  let prevActive = null;

  function onEvent(ev) {
    switch (ev.kind) {
      case 'round':
        renderCards(ev.seq);
        cards.forEach((c) => c.classList.add('wait')); // 듣기 박마다 한 장씩 나타난다
        prevActive = null;
        el.roundLabel.textContent = `${ev.round + 1}/${current.rounds}`;
        break;
      case 'reveal':
        for (let i = ev.from; i < ev.to; i++) {
          cards[i].classList.remove('wait');
          cards[i].classList.add('show');
        }
        break;
      case 'say':
        if (prevActive) prevActive.classList.remove('active');
        prevActive = cards[ev.i];
        prevActive.classList.add('active');
        break;
      case 'end':
        if (prevActive) prevActive.classList.remove('active');
        finish(true);
        break;
    }
  }

  let starting = false;

  async function start() {
    if (!current || stopFn || starting || el.start.disabled) return;
    starting = true;
    Beat.ensure(); // 클릭 직후에 만들어야 브라우저가 소리를 허용한다
    let buffer = null;
    if (photoOn() || musicOn()) {
      el.start.textContent = el.again.textContent = '불러오는 중…';
      const [, loaded] = await Promise.all([
        preloadImages(),
        musicOn()
          ? Beat.loadMusic(music.url)
            .catch((err) => { dlg.alert(`${err.message}\n이번 판은 기본 비트로 진행합니다.`, '배경음악 오류'); return null; })
          : null,
      ]);
      buffer = loaded;
      el.start.textContent = '▶ 시작';
      el.again.textContent = '↻ 한 번 더';
    }
    starting = false;
    Beat.setVolume(el.volume.value / 100);
    el.idle.hidden = true;
    el.end.hidden = true;
    el.stop.hidden = false;
    el.setSelect.disabled = true;
    const now = Beat.now() + 0.15;
    if (buffer) {
      // 곡의 첫 박 1마디 전부터 재생해 짧은 전주를 들려주고, 첫 박에 맞춰 게임을 시작한다
      const lead = Math.min(music.offset, 4 * 60 / music.bpm);
      const t0 = now + lead;
      const { beats, events } = buildTimeline(current, t0);
      const until = events[events.length - 1].t;
      stopFn = Beat.run({ beats, events, onEvent, music: { buffer, at: now, offset: music.offset - lead, until } });
    } else {
      const { beats, events } = buildTimeline(current, now + 0.15);
      stopFn = Beat.run({ beats, events, onEvent });
    }
  }

  function finish(cleared) {
    // 끝까지 간 경우에는 마무리 소리(심벌 · 음악 페이드아웃)가 끝까지 울리게 끊지 않는다
    if (stopFn && !cleared) stopFn();
    stopFn = null;
    el.stop.hidden = true;
    el.setSelect.disabled = false;
    if (cleared) {
      el.endInfo.textContent = `「${current.name}」 ${current.rounds}라운드`;
      el.end.hidden = false;
    } else {
      el.idle.hidden = false;
      renderPreview();
    }
  }

  el.start.addEventListener('click', start);
  el.again.addEventListener('click', start);
  el.stop.addEventListener('click', () => finish(false));

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.closest('input, select, textarea')) return;
    e.preventDefault(); // 포커스된 버튼이 한 번 더 눌리지 않게
    e.target.blur?.();
    if (stopFn) finish(false);
    else if (current) start();
  });

  // ── 전체화면 ───────────────────────────
  el.fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else el.stage.requestFullscreen?.().catch(() => dlg.alert('이 브라우저에서는 전체화면을 쓸 수 없습니다.'));
  });

  setOrient(store.get('orient') === 'portrait' ? 'portrait' : 'landscape');
  // 곡 정보(BPM · 라운드 구조 · 곡 주소)를 먼저 받고 세트를 불러온다. 실패하면 기본 비트로 진행
  api('/api/music')
    .then((m) => { music = m; })
    .catch((e) => dlg.alert(`${errMsg(e)}\n기본 비트(${music.bpm} BPM)로 진행합니다.`, '배경음악 정보 불러오기 실패'))
    .then(loadSets)
    .catch((e) => dlg.alert(errMsg(e), '세트 목록 불러오기 실패'));
})();
