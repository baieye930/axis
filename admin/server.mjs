// AXIS 운영자 조회 도구 (읽기 전용, 로컬 전용).
//   node admin/server.mjs --synthetic     합성 데이터로 실행(실제 데이터 없음)
//   ADMIN_TOKEN=… ADMIN_SUPABASE_URL=… ADMIN_SUPABASE_PUBLISHABLE_KEY=… ADMIN_JWT=… node admin/server.mjs     실제 데이터(서버 반영 후)
// 127.0.0.1 에만 바인딩한다. 공개 주소·터널·포트 공개 기능은 없다. 이 폴더는 공개 앱(GitHub Pages)에 배포하지 않는다.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overview, userList, userDetail, dateDiff } from './lib/stats.mjs';
import { syntheticSource, supabaseSource } from './lib/source.mjs';
import { audit } from './lib/audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.ADMIN_PORT || 8787);
const synthetic = process.argv.includes('--synthetic');
const TOKEN = process.env.ADMIN_TOKEN || '';
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));

const source = synthetic ? syntheticSource() : supabaseSource();
// 실제 데이터 모드는 관리자 인증이 모두 구성되어 있어야 한다. 아니면 개인 데이터 조회를 모두 막는다.
const blocked = !synthetic && (!source || TOKEN.length < 24);
if (!synthetic && !source) console.error('[admin] 실제 데이터 모드에 필요한 환경변수(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_PUBLISHABLE_KEY, ADMIN_JWT)가 없어 조회가 차단됩니다. 합성 데이터는 --synthetic');
if (!synthetic && TOKEN.length < 24) console.error('[admin] ADMIN_TOKEN(24자 이상)이 없어 조회가 차단됩니다.');

const cookieName = 'axis_admin';
const digest = (s) => createHash('sha256').update(s).digest();
const sameToken = (a) => a && TOKEN && timingSafeEqual(digest(a), digest(TOKEN));
const authed = (req) => {
  if (synthetic && !TOKEN) return true;
  const h = req.headers.authorization || '', c = (req.headers.cookie || '').split(/;\s*/).find((x) => x.startsWith(cookieName + '='));
  return sameToken(h.replace(/^Bearer\s+/i, '')) || sameToken(c ? decodeURIComponent(c.slice(cookieName.length + 1)) : '');
};
const SEC = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'content-type': type, ...SEC, ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/app.css': ['app.css', 'text/css; charset=utf-8'] };

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  // DNS 리바인딩 방지: Host 가 로컬 주소가 아니면 거부
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, { error: 'forbidden_host' });
  if (req.method !== 'GET' && !(req.method === 'POST' && url.pathname === '/login')) return send(res, 405, { error: 'read_only' });
  if (FILES[url.pathname]) { const [f, t] = FILES[url.pathname]; return send(res, 200, readFileSync(join(HERE, 'public', f)), t); }
  if (url.pathname === '/login' && req.method === 'POST') {
    let b = ''; for await (const c of req) { b += c; if (b.length > 2048) return send(res, 413, { error: 'too_large' }); }
    const t = (() => { try { return JSON.parse(b).token; } catch { return ''; } })();
    if (!sameToken(t)) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': `${cookieName}=${encodeURIComponent(t)}; HttpOnly; SameSite=Strict; Path=/` });
  }
  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
  if (url.pathname === '/api/meta') return send(res, 200, { mode: synthetic ? 'synthetic' : 'real', blocked, needs_login: !authed(req), today: source ? source.today : null });
  if (blocked) { audit({ mode: 'real', action: url.pathname, result: 'denied' }); return send(res, 503, { error: 'admin_auth_not_configured', message: '관리자 인증이 구성되지 않아 실제 데이터 조회가 차단되어 있어요.' }); }
  if (!authed(req)) { audit({ mode: source.mode, action: url.pathname, result: 'denied' }); return send(res, 401, { error: 'unauthorized' }); }
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!isDate(from) || !isDate(to) || from > to || dateDiff(from, to) > 400) return send(res, 400, { error: 'bad_range' });
  const today = source.today;
  try {
    if (url.pathname === '/api/overview') {
      const [rows, profiles, events] = await Promise.all([source.days(from, to), source.profiles(), source.events(from, to)]);
      audit({ mode: source.mode, action: 'overview', from, to, rows: rows.length, result: 'ok' });
      return send(res, 200, overview({ rows, profiles, events, from, to, today }));
    }
    if (url.pathname === '/api/users') {
      const [rows, named] = await Promise.all([source.days(from, to), source.named()]);
      audit({ mode: source.mode, action: 'users', from, to, rows: named.length, result: 'ok' });
      return send(res, 200, { from, to, users: userList({ rows, named, from, to }) });
    }
    if (url.pathname === '/api/user') {
      const u = url.searchParams.get('u') || '';
      if (!/^[A-Za-z0-9]{3,16}$/.test(u)) return send(res, 400, { error: 'bad_user' });
      const rows = await source.userDays(u, from, to);
      audit({ mode: source.mode, action: 'user', u, from, to, rows: rows.length, result: 'ok' });
      return send(res, 200, { u, from, to, days: userDetail({ rows, from, to, today }) });
    }
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    audit({ mode: source.mode, action: url.pathname, result: e.status === 403 ? 'denied' : 'error' });
    return send(res, e.status === 403 ? 403 : 502, { error: e.status === 403 ? 'denied' : 'upstream_error' });   // 업스트림 응답 본문은 그대로 전달하지 않는다
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(PORT, HOST, () => console.log(`[admin] http://${HOST}:${PORT}  (${synthetic ? '합성 데이터' : blocked ? '실제 데이터 모드 — 인증 미구성으로 차단됨' : '실제 데이터'})  읽기 전용 · 로컬 전용`));
}
