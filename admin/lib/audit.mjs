// 로컬 조회 감사 기록. 조회한 범위와 결과만 남기고 개인 기록 본문·인증값은 남기지 않는다.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.audit');
export function audit(entry, file = join(DIR, 'local.log')) {
  const safe = {
    at: new Date().toISOString(), admin: 'local', mode: String(entry.mode || ''), action: String(entry.action || ''),
    scope: { from: entry.from || null, to: entry.to || null, u: entry.u ? String(entry.u).slice(0, 8) : null, rows: Number.isFinite(entry.rows) ? entry.rows : null },
    result: ['ok', 'denied', 'error'].includes(entry.result) ? entry.result : 'error',
  };
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(safe) + '\n', { mode: 0o600 }); } catch { /* 감사 기록 실패가 조회를 막지는 않지만 서버 측 감사는 별도로 남는다 */ }
  return safe;
}
