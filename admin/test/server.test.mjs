import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url)), SRV = join(HERE, '..', 'server.mjs'), AUDIT = join(HERE, '..', '.audit', 'local.log');
function run(args, env, port) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SRV, ...args], { env: { ...process.env, ADMIN_PORT: String(port), ADMIN_TOKEN: '', ADMIN_SUPABASE_URL: '', ADMIN_JWT: '', ADMIN_SUPABASE_PUBLISHABLE_KEY: '', ...env } });
    let out = ''; p.stdout.on('data', (d) => { out += d; if (/\[admin\] http/.test(out)) resolve(p); }); p.stderr.on('data', () => {}); p.on('error', reject);
    setTimeout(() => reject(new Error('timeout ' + out)), 4000);
  });
}
const get = (port, path, opt = {}) => fetch(`http://127.0.0.1:${port}${path}`, opt);

test('실제 데이터 모드: 인증 미구성이면 조회가 모두 차단된다(503)', async () => {
  const p = await run([], {}, 18781);
  try {
    const meta = await (await get(18781, '/api/meta')).json();
    assert.equal(meta.blocked, true);
    const r = await get(18781, '/api/overview?from=2026-10-01&to=2026-10-26');
    assert.equal(r.status, 503);
    assert.equal((await get(18781, '/api/users?from=2026-10-01&to=2026-10-26')).status, 503);
    assert.equal((await get(18781, '/api/user?u=abc12345&from=2026-10-01&to=2026-10-26')).status, 503);
  } finally { p.kill(); }
});
test('합성 모드: 127.0.0.1 에만 바인딩, 읽기 전용, 캐시 금지, 다른 Host 거부', async () => {
  const p = await run(['--synthetic'], {}, 18782);
  try {
    const r = await get(18782, '/api/overview?from=2026-09-27&to=2026-10-26');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    const o = await r.json();
    assert.ok(o.completion && o.wake);
    assert.equal((await get(18782, '/api/overview?from=2026-09-27&to=2026-10-26', { method: 'POST' })).status, 405);
    const code = await new Promise((resolve) => { http.get({ host: '127.0.0.1', port: 18782, path: '/api/overview?from=2026-09-27&to=2026-10-26', headers: { host: 'evil.example:18782' } }, (r) => { r.resume(); resolve(r.statusCode); }); });
    assert.equal(code, 403);   // DNS 리바인딩 방지
    assert.equal((await get(18782, '/api/overview?from=bad&to=2026-10-26')).status, 400);
    assert.equal((await get(18782, '/api/overview?from=2020-01-01&to=2026-10-26')).status, 400);   // 범위 제한
    const users = await (await get(18782, '/api/users?from=2026-09-27&to=2026-10-26')).json();
    assert.ok(users.users.length > 3);
    assert.ok(users.users.every((u) => !('email' in u)));
    assert.doesNotMatch(JSON.stringify(users), /@/);   // 이메일 형태 없음
    const det = await (await get(18782, `/api/user?u=${users.users[0].u}&from=2026-09-27&to=2026-10-26`)).json();
    assert.ok(det.days.length >= 1);
  } finally { p.kill(); }
});
test('운영자 토큰이 설정되면 토큰 없는 요청은 401', async () => {
  const p = await run(['--synthetic'], { ADMIN_TOKEN: 'x'.repeat(30) }, 18783);
  try {
    assert.equal((await get(18783, '/api/overview?from=2026-10-01&to=2026-10-26')).status, 401);
    const ok = await get(18783, '/api/overview?from=2026-10-01&to=2026-10-26', { headers: { authorization: 'Bearer ' + 'x'.repeat(30) } });
    assert.equal(ok.status, 200);
  } finally { p.kill(); }
});
test('감사 기록은 조회 범위만 남기고 개인 기록·인증값을 담지 않는다', async () => {
  if (existsSync(AUDIT)) rmSync(AUDIT);
  const p = await run(['--synthetic'], {}, 18784);
  try {
    const users = await (await get(18784, '/api/users?from=2026-09-27&to=2026-10-26')).json();
    await get(18784, `/api/user?u=${users.users[0].u}&from=2026-09-27&to=2026-10-26`);
    const lines = readFileSync(AUDIT, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(lines.length >= 2);
    for (const l of lines) { assert.deepEqual(Object.keys(l).sort(), ['action', 'admin', 'at', 'mode', 'result', 'scope']); assert.ok((l.scope.u || '').length <= 8); }
    assert.doesNotMatch(readFileSync(AUDIT, 'utf8'), /wake|bed|sleepH|테스터|합성 /);
  } finally { p.kill(); }
});
test('공개 앱 산출물(index.html, config.js, sw.js)에 관리자 코드·비밀값 이름이 없다', () => {
  const root = join(HERE, '..', '..');
  for (const f of ['index.html', 'config.js', 'sw.js', 'manifest.webmanifest']) {
    const t = readFileSync(join(root, f), 'utf8');
    assert.doesNotMatch(t, /ADMIN_JWT|ADMIN_TOKEN|ADMIN_SUPABASE|axis_admin_|service_role\s*[:=]\s*["']ey/i, f);
  }
});
