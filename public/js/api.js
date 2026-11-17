// 공용 API 호출. 실패하면 서버가 준 메시지 + 요청 ID 를 담은 Error 를 던진다.
window.api = async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    const reqId = res.headers.get('X-Request-Id');
    const err = new Error((data && data.error) || `요청 실패 (${res.status})`);
    err.reqId = reqId;
    throw err;
  }
  return data;
};

window.errMsg = function errMsg(err) {
  return err.message + (err.reqId ? `\n(요청 ID: ${err.reqId})` : '');
};
