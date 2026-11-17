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
    const emoji = row.querySelector('.emoji');
    emoji.disabled = !!file;
    emoji.title = file ? '사진이 있어 이모지는 쓰이지 않습니다. 사진을 빼면 쓸 수 있습니다.' : '';
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
  function addWordRow(w = { text: '', emoji: '', image: '' }, focus = false) {
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
    row.append(cell, emoji, text, del);
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

  function markDirty() { dirty = true; }
  form.addEventListener('input', () => { markDirty(); updateCount(); updateBpmNote(); });

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
    updateBpmNote();
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
