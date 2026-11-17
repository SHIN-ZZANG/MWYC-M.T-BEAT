// 사진 올리기 API. 본문 = 파일 그대로.
// 사진은 브라우저에서 512px 로 줄여서 보낸다.
import { HttpError, sendJson, readBody } from '../http-util.js';
import { saveImage } from '../media.js';
import { IMAGE_MAX_BYTES } from '../limits.js';
import { log } from '../logger.js';

export async function upload(req, res, _params, ctx) {
  const buf = await readBody(req, IMAGE_MAX_BYTES);
  if (buf.length === 0) throw new HttpError(400, '사진 파일이 비어 있습니다.');
  const file = saveImage(buf);
  if (!file) throw new HttpError(415, 'JPG · PNG · WEBP 사진만 올릴 수 있습니다.');
  log.info('사진 저장', { reqId: ctx.reqId, file, bytes: buf.length });
  sendJson(res, 201, { file });
}
