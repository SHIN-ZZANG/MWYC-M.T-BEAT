// PWA: 서비스 워커 등록 + 화면 맨 위 "앱으로 설치" 안내 띠.
// 띠는 접속할 때마다 보여 준다 (닫으면 지금 화면에서만 숨김). 이미 앱으로 실행 중이면 띄우지 않는다.
//   Chrome · Edge 등   → [설치] 를 누르면 브라우저 설치 창 (준비가 안 됐으면 메뉴 안내)
//   아이폰 · 아이패드  → 공유 버튼 → "홈 화면에 추가" 안내
//   카카오톡 등 앱 안 브라우저 → 설치가 안 되므로 다른 브라우저로 열라고 안내
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[pwa] 서비스 워커 등록 실패', err));
    });
  }

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;

  const ua = navigator.userAgent;
  const inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|\bLine\/|DaumApps|everytimeApp/i.test(ua);
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const MSG = {
    normal: '주소를 치지 않고 홈 화면에서 바로 열 수 있습니다.',
    menu: '브라우저 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 눌러 주세요.',
    ios: '아래(또는 위) 공유 버튼 ⬆︎ 을 누르고 "홈 화면에 추가"를 고르세요.',
    inApp: '이 앱 안의 브라우저에서는 설치할 수 없습니다. 메뉴에서 "다른 브라우저로 열기"를 눌러 Chrome · Safari 로 열어 주세요.',
  };

  // ── 띠 만들기 (글자는 모두 textContent) ──
  const bar = document.createElement('div');
  bar.className = 'install-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', '앱 설치 안내');

  const icon = document.createElement('img');
  icon.className = 'install-icon';
  icon.src = '/icons/icon-192.png';
  icon.alt = '';

  const text = document.createElement('div');
  text.className = 'install-text';
  const title = document.createElement('p');
  title.className = 'install-title';
  title.textContent = '홈 화면에 앱으로 추가';
  const sub = document.createElement('p');
  sub.className = 'install-sub';
  text.append(title, sub);

  // 버튼: [나중에] [설치] (STAGE-Q 설치 띠와 같은 모양)
  const btns = document.createElement('div');
  btns.className = 'install-btns';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '나중에';
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'primary';
  go.textContent = '설치';
  btns.append(close, go);

  bar.append(icon, text, btns);

  if (inApp || ios) {
    // 설치 창을 띄울 수 없는 곳 — 안내만 하고 닫기 버튼 하나
    sub.textContent = inApp ? MSG.inApp : MSG.ios;
    go.hidden = true;
    close.textContent = '알겠음';
  } else {
    sub.textContent = MSG.normal;
  }

  // 위에서 내려오며 나타나고, 올라가며 사라진다
  function hideBar() {
    bar.classList.remove('on');
    setTimeout(() => bar.remove(), 350);
  }

  // ── 설치 ──
  let deferred = null; // beforeinstallprompt — 이것이 있어야 설치 창을 띄울 수 있다 (한 번만 쓸 수 있음)

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 브라우저 기본 안내 대신 이 띠의 버튼으로 띄운다
    deferred = e;
    if (!inApp && !ios) sub.textContent = MSG.normal;
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    hideBar();
  });

  go.addEventListener('click', async () => {
    if (!deferred) {
      // 이 브라우저는 설치 창을 직접 띄울 수 없거나 아직 준비 중 — 메뉴로 안내
      sub.textContent = MSG.menu;
      return;
    }
    const ev = deferred;
    deferred = null;
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === 'accepted') hideBar();
    } catch (err) {
      console.warn('[pwa] 설치 창을 띄우지 못했습니다', err);
      sub.textContent = MSG.menu;
    }
  });

  close.addEventListener('click', hideBar); // 지금 화면에서만 닫는다 — 다음 접속 때는 다시 보인다

  const mount = () => {
    document.body.append(bar);
    // 붙인 직후 바로 on 을 주면 내려오는 움직임 없이 그 자리에 나타난다 — 한 프레임 쉬고 준다
    requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add('on')));
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
