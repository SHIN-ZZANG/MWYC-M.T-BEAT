(function () {
  const $ = (s) => document.querySelector(s);
  const form = $('#form');
  const wordsEl = $('#words');
  const listEl = $('#setList');

  let sets = [];
  let currentId = null; // null = 새 세트
  let dirty = false;

  // ── 사진 ───────────────────────────────
  const photoInput = $('#photoInput');
  let photoTarget = null; // 사진을 고르고 있는 행

  // 가운데 기준 정사각형으로 잘라 최대 512px JPEG 로 줄인다
  async function toSquareJpeg(file, size = 512) {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error('이 사진 형식은 읽을 수 없습니다. JPG · PNG · WEBP 로 올려 주세요.');
    }
    const s = Math.min(bmp.width, bmp.height);
    const out = Math.min(size, s);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = out;
    canvas.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, out, out);
    bmp.close?.();
    return new Promise((resolve, reject) => canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('사진 변환에 실패했습니다.'))), 'image/jpeg', 0.85));
  }

  async function uploadPhoto(blob) {
    const res = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    let data = null;
    try { data = await res.json(); } catch { /* 본문 없음 */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `사진 올리기 실패 (${res.status})`);
      err.reqId = res.headers.get('X-Request-Id');
      throw err;
    }
    return data.file;
  }

  function setRowPhoto(row, file) {
    row.dataset.image = file || '';
    const btn = row.querySelector('.photo-btn');
    btn.classList.toggle('has', !!file);
    if (file) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = '/media/' + encodeURIComponent(file);
      btn.replaceChildren(img);
      btn.title = '사진 바꾸기';
    } else {
      btn.textContent = '＋ 사진';
      btn.title = '사진 올리기';
    }
    row.querySelector('.photo-del').hidden = !file;
    const zoom = row.querySelector('.zoom');
    zoom.disabled = !file;
    if (!file) zoom.value = '1';
    applyZoom(row);
    const emoji = row.querySelector('.emoji');
    emoji.disabled = !!file;
    emoji.title = file ? '사진이 있어 이모지는 쓰이지 않습니다. 사진을 빼면 쓸 수 있습니다.' : '';
  }

  // 사진 확대 — 썸네일에도 게임 카드와 같은 배율로 보여 준다
  function applyZoom(row) {
    const img = row.querySelector('.photo-btn img');
    if (img) img.style.transform = `scale(${row.querySelector('.zoom').value})`;
  }

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    const row = photoTarget;
    photoInput.value = '';
    if (!file || !row) return;
    const btn = row.querySelector('.photo-btn');
    btn.classList.add('busy');
    btn.disabled = true;
    try {
      const name = await uploadPhoto(await toSquareJpeg(file));
      setRowPhoto(row, name);
      markDirty();
    } catch (err) {
      dlg.alert(errMsg(err), '사진 올리기 실패');
    } finally {
      btn.classList.remove('busy');
      btn.disabled = false;
    }
  });

  // ── 단어 행 ────────────────────────────
  const ZOOMS = [1, 1.2, 1.4, 1.6, 1.8, 2];

  function addWordRow(w = { text: '', emoji: '', image: '', zoom: 1 }, focus = false) {
    const row = document.createElement('div');
    row.className = 'word-row';

    const cell = document.createElement('div');
    cell.className = 'photo-cell';
    const pbtn = document.createElement('button');
    pbtn.type = 'button';
    pbtn.className = 'photo-btn';
    pbtn.addEventListener('click', () => { photoTarget = row; photoInput.click(); });
    const pdel = document.createElement('button');
    pdel.type = 'button';
    pdel.className = 'photo-del';
    pdel.title = '사진 빼기';
    pdel.textContent = '✕';
    pdel.addEventListener('click', () => { setRowPhoto(row, ''); markDirty(); });
    cell.append(pbtn, pdel);

    const zoom = document.createElement('select');
    zoom.className = 'zoom';
    zoom.title = '사진 확대 — 누끼처럼 얼굴이 작은 사진을 카드에서 크게 보여 줍니다';
    ZOOMS.forEach((z) => zoom.add(new Option(z === 1 ? '원래' : `${z}배`, String(z))));
    zoom.value = String(ZOOMS.includes(w.zoom) ? w.zoom : 1);
    zoom.addEventListener('change', () => applyZoom(row));

    const emoji = document.createElement('input');
    emoji.className = 'emoji';
    emoji.maxLength = 16;
    emoji.placeholder = '🙂';
    emoji.value = w.emoji;
    const text = document.createElement('input');
    text.className = 'text';
    text.maxLength = 20;
    text.placeholder = '단어';
    text.value = w.text;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.title = '이 단어 빼기';
    del.textContent = '✕';
    del.addEventListener('click', () => { row.remove(); markDirty(); updateCount(); });
    // 마지막 칸에서 Enter → 새 행
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (row === wordsEl.lastElementChild) addWordRow(undefined, true);
        else row.nextElementSibling.querySelector('.text').focus();
      }
    });
    row.append(cell, zoom, emoji, text, del);
    wordsEl.appendChild(row);
    setRowPhoto(row, w.image || '');
    updateCount();
    if (focus) emoji.focus();
  }

  function collectWords() {
    return [...wordsEl.querySelectorAll('.word-row')].map((r) => ({
      emoji: r.querySelector('.emoji').value.trim(),
      text: r.querySelector('.text').value.trim(),
      image: r.dataset.image || '',
      zoom: Number(r.querySelector('.zoom').value),
    })).filter((w) => w.text || w.emoji || w.image);
  }

  function updateCount() {
    $('#wordCount').textContent = `(${collectWords().length}개)`;
  }

  // 카드 하나에 주어지는 시간(초) 기준 난이도
  const LEVELS = [
    { min: 0.6, label: '쉬움', cls: 'easy' },
    { min: 0.45, label: '보통', cls: 'normal' },
    { min: 0.35, label: '어려움', cls: 'hard' },
    { min: 0, label: '매우 어려움', cls: 'extreme' },
  ];
  const levelOf = (sec) => LEVELS.find((l) => sec >= l.min);

  // 게임 배경음악 (서버 고정값) — 모든 세트가 같은 곡 · 같은 BPM · 같은 라운드 구조
  let music = null; // { title, bpm, offset, listenBeats, cards, url }

  function updateBpmNote() {
    const preview = $('#speedPreview');
    const rounds = Math.round(+form.rounds.value);
    if (!music || !(rounds >= 1 && rounds <= 20)) {
      preview.hidden = true; // 범위 밖 값은 저장할 때 오류로 알려 준다
      return;
    }
    preview.hidden = false;
    // 전체 박 수 = 라운드마다 (듣기 + 카드) 박자 수 — 게임과 같은 계산
    const spb = 60 / music.bpm;
    const beats = rounds * (music.listenBeats + music.cards);
    $('#spTime').textContent = `카드 하나당 ${spb.toFixed(2)}초  ·  전체 약 ${Math.round(beats * spb)}초`;
    const lv = levelOf(spb);
    const el = $('#spLevel');
    el.className = 'level ' + lv.cls;
    el.textContent = `난이도: ${lv.label}`;
  }

  // ── 라운드 구성 ────────────────────────
  // 라운드마다 { kinds: 나올 단어 종류 수, show: 'text' | 'mix' | 'image' }. 표는 항상 라운드 수만큼 있다.
  const planBody = $('#planBody');
  const SHOWS = [['text', '단어'], ['mix', '섞기'], ['image', '사진']];

  function planRow(p) {
    const tr = document.createElement('tr');
    const no = document.createElement('td');
    const kc = document.createElement('td');
    const kinds = document.createElement('input');
    kinds.type = 'number';
    kinds.className = 'kinds';
    kinds.min = 2;
    kinds.max = 8;
    kinds.value = p.kinds;
    kc.append(kinds, ' 개');
    const sc = document.createElement('td');
    const show = document.createElement('select');
    show.className = 'show';
    SHOWS.forEach(([v, label]) => show.add(new Option(label, v)));
    show.value = p.show;
    sc.appendChild(show);
    tr.append(no, kc, sc);
    return tr;
  }

  function readPlan() {
    return [...planBody.rows].map((r) => ({
      kinds: Number(r.querySelector('.kinds').value),
      show: r.querySelector('.show').value,
    }));
  }

  // 라운드 수가 바뀌면 줄 수를 맞춘다 (늘어나면 마지막 줄을 복사)
  function syncPlanRows() {
    const n = Number(form.rounds.value);
    if (!Number.isInteger(n) || n < 1 || n > 20) return;
    while (planBody.rows.length < n) {
      const last = readPlan().at(-1) || { kinds: 3, show: 'text' };
      planBody.appendChild(planRow(last));
    }
    while (planBody.rows.length > n) planBody.lastElementChild.remove();
    [...planBody.rows].forEach((r, i) => { r.cells[0].textContent = `${i + 1}`; });
  }

  // 추천: 앞 3/7 은 단어, 뒤 2/7 은 사진, 사이는 섞기. 단어 수는 3에서 1개씩 늘어 넣은 단어 수까지.
  function recommendedPlan(n, wordCount) {
    const maxK = Math.max(2, Math.min(8, wordCount));
    const text = Math.max(1, Math.round(n * 3 / 7));
    const image = Math.min(n - text, Math.round(n * 2 / 7));
    const mix = n - text - image;
    return Array.from({ length: n }, (_, i) => ({
      kinds: Math.min(maxK, 3 + i),
      show: i < text ? 'text' : i < text + mix ? 'mix' : 'image',
    }));
  }

  // 구성 없이 저장된 옛 세트 — 게임의 예전 자동 규칙과 같은 값(단어 수 4 → 5 → …, 모두 사진)으로 채워 보여 준다
  function autoPlan(n, wordCount) {
    const maxK = Math.max(2, Math.min(8, wordCount));
    return Array.from({ length: n }, (_, i) => ({ kinds: Math.min(maxK, 4 + i), show: 'image' }));
  }

  function setPlan(plan) {
    planBody.replaceChildren(...plan.map(planRow));
    syncPlanRows();
  }

  function fillRecommended() {
    const n = Number(form.rounds.value) || 1;
    setPlan(recommendedPlan(n, collectWords().filter((w) => w.text).length));
    markDirty();
  }

  function updatePlanWarn() {
    const warn = $('#planWarn');
    const msgs = [];
    const words = collectWords().filter((w) => w.text);
    // 단어 수 입력 상한 = 넣은 단어 수 (카드 8장이 최대)
    const maxK = Math.max(2, Math.min(8, words.length));
    planBody.querySelectorAll('.kinds').forEach((el) => { el.max = maxK; });
    readPlan().forEach((p, i) => {
      if (p.kinds > words.length) msgs.push(`${i + 1}라운드 — 단어 수(${p.kinds})가 넣은 단어(${words.length}개)보다 많습니다.`);
    });
    if (readPlan().some((p) => p.show !== 'text')) {
      const bare = words.filter((w) => !w.image && !w.emoji).map((w) => w.text);
      const emojiOnly = words.filter((w) => !w.image && w.emoji).map((w) => w.text);
      if (bare.length) msgs.push(`사진 · 이모지가 없어 사진 라운드에서도 글자로 나오는 단어: ${bare.join(', ')}`);
      if (emojiOnly.length) msgs.push(`사진이 없어 이모지로 나오는 단어: ${emojiOnly.join(', ')}`);
    }
    warn.textContent = msgs.join('\n');
    warn.hidden = !msgs.length;
  }

  $('#planFillBtn').addEventListener('click', fillRecommended);

  function markDirty() { dirty = true; updatePlanWarn(); }
  form.addEventListener('input', (e) => {
    if (e.target === form.rounds) syncPlanRows();
    markDirty(); updateCount(); updateBpmNote();
  });

  // ── 목록 ───────────────────────────────
  function renderList() {
    listEl.replaceChildren(...sets.map((s) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.classList.toggle('on', s.id === currentId);
      b.textContent = s.name;
      const small = document.createElement('small');
      small.textContent = `단어 ${s.wordCount}개 · ${s.rounds}라운드`;
      b.appendChild(small);
      b.addEventListener('click', () => open(s.id));
      li.appendChild(b);
      return li;
    }));
  }

  async function reloadList() {
    sets = await api('/api/sets');
    renderList();
  }

  // ── 폼 채우기 ──────────────────────────
  function fill(s) {
    form.name.value = s.name;
    form.rounds.value = s.rounds;
    form.showLabel.checked = s.showLabel;
    wordsEl.replaceChildren();
    s.words.forEach((w) => addWordRow(w));
    // 구성이 없으면 — 옛 세트는 예전 자동 규칙대로, 새 세트(단어 없음)는 추천 구성으로 채운다
    const wordCount = s.words.filter((w) => w.text).length;
    setPlan(s.plan && s.plan.length ? s.plan
      : wordCount ? autoPlan(s.rounds, wordCount) : recommendedPlan(s.rounds, 5));
    updateBpmNote();
    updatePlanWarn();
    dirty = false;
  }

  async function confirmLeave() {
    return !dirty || dlg.confirm('저장하지 않은 변경이 있습니다.\n버리고 이동할까요?', '변경 버리기', { danger: true });
  }

  async function open(id) {
    if (id === currentId) return;
    if (!(await confirmLeave())) return;
    try {
      const s = await api(`/api/sets/${id}`);
      currentId = s.id;
      $('#formTitle').textContent = `「${s.name}」 수정`;
      $('#deleteBtn').hidden = false;
      fill(s);
      renderList();
    } catch (e) {
      dlg.alert(errMsg(e), '세트 불러오기 실패');
    }
  }

  async function openNew() {
    if (!(await confirmLeave())) return;
    currentId = null;
    $('#formTitle').textContent = '새 세트';
    $('#deleteBtn').hidden = true;
    fill({ name: '', rounds: 5, showLabel: true,
      words: [{ text: '', emoji: '', image: '' }, { text: '', emoji: '', image: '' }] });
    renderList();
    form.name.focus();
  }

  // ── 저장 · 삭제 ────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: form.name.value.trim(),
      rounds: +form.rounds.value,
      showLabel: form.showLabel.checked,
      plan: readPlan(),
      words: collectWords(),
    };
    try {
      const saved = currentId
        ? await api(`/api/sets/${currentId}`, { method: 'PUT', body })
        : await api('/api/sets', { method: 'POST', body });
      currentId = saved.id;
      $('#formTitle').textContent = `「${saved.name}」 수정`;
      $('#deleteBtn').hidden = false;
      fill(saved);
      await reloadList();
      await dlg.alert('저장되었습니다.');
    } catch (err) {
      dlg.alert(errMsg(err), '저장 실패');
    }
  });

  $('#deleteBtn').addEventListener('click', async () => {
    if (!currentId) return;
    const name = form.name.value || '이 세트';
    if (!(await dlg.confirm(`「${name}」 세트를 삭제하시겠습니까?\n삭제 후에는 되돌릴 수 없습니다.`, '삭제 확인', { danger: true }))) return;
    try {
      await api(`/api/sets/${currentId}`, { method: 'DELETE' });
      dirty = false;
      currentId = -1; // openNew 에서 같은 id 로 보지 않게
      await reloadList();
      if (sets.length) { currentId = null; await open(sets[0].id); } else { await openNew(); }
    } catch (err) {
      dlg.alert(errMsg(err), '삭제 실패');
    }
  });

  $('#addWordBtn').addEventListener('click', () => { addWordRow(undefined, true); markDirty(); });
  $('#newBtn').addEventListener('click', openNew);

  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  // ── 시작 ───────────────────────────────
  api('/api/music')
    .then((m) => { music = m; updateBpmNote(); })
    .catch((e) => dlg.alert(errMsg(e), '배경음악 정보 불러오기 실패'));
  reloadList()
    .then(() => (sets.length ? open(sets[0].id) : openNew()))
    .catch((e) => dlg.alert(errMsg(e), '세트 목록 불러오기 실패'));
})();
