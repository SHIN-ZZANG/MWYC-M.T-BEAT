// 요청 · 응답 공용 도우미
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, data) {
  const body = data === undefined ? '' : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const MAX_BODY = 1024 * 1024; // 1MB

// 본문을 Buffer 로 읽는다. 한도를 넘으면 413.
export function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > max) {
      reject(new HttpError(413, `요청 본문이 너무 큽니다 (최대 ${Math.round(max / 1024)}KB).`));
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(new HttpError(413, `요청 본문이 너무 큽니다 (최대 ${Math.round(max / 1024)}KB).`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const buf = await readBody(req);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, '요청 본문이 올바른 JSON 이 아닙니다.');
  }
}
