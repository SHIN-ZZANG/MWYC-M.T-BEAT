import path from 'path';
import { fileURLToPath } from 'url';

// 실행 위치(cwd)와 상관없이 프로젝트 루트 기준으로 경로를 잡는다.
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
