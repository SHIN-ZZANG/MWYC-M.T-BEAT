// 홈 화면 앱(PWA)으로 설치 · 실행되게 하는 최소한의 서비스 워커.
// 아무것도 미리 담아 두지 않는다 — API 응답과 배경음악(약 10MB)은 늘 서버에서 받는다.
// 망이 끊겼을 때 화면 요청에만 안내 화면을 대신 내준다 (브라우저 기본 오류 화면 대신).

const CACHE = 'beat-word-game-v1'; // 나중에 캐시를 쓰게 되면 이름을 올려 옛 캐시를 지운다

self.addEventListener('install', () => {
  self.skipWaiting(); // 담아 둘 것이 없으니 바로 새 워커로 바꾼다
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()), // 이미 열린 탭도 바로 맡는다
  );
});

function offlinePage() {
  return new Response(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>연결 없음</title><style>' +
    'html,body{height:100%;margin:0}' +
    'body{display:flex;align-items:center;justify-content:center;background:#14121f;color:#d8d4f0;' +
    'font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif;font-size:15px;line-height:1.7;text-align:center;padding:24px}' +
    '</style></head><body><p>인터넷에 연결되어 있지 않아 게임을 불러오지 못했습니다.<br>' +
    '연결한 뒤 다시 열어 주세요.</p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

self.addEventListener('fetch', (e) => {
  // 화면(페이지 이동) 요청만 다룬다. API · 사진 · 음악 등 나머지는 브라우저가 그대로 처리한다.
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => offlinePage()));
});
