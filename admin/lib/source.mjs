// 데이터 원천. 합성 데이터(로컬 검증용)와 Supabase(실제 데이터, 서버 측 환경변수 필요)를 같은 인터페이스로 제공한다.
import { makeSynthetic } from './synthetic.mjs';

export function syntheticSource() {
  const d = makeSynthetic();
  return {
    mode: 'synthetic', today: d.today,
    async days(from, to) { return d.rows.filter((r) => r.d >= from && r.d <= to); },
    async profiles() { return d.profiles; },
    async named() { return d.named; },
    async events(from, to) { return d.events.filter((e) => e.d >= from && e.d <= to); },
    async userDays(u, from, to) { const ok = d.named.some((p) => p.u === u); return ok ? d.rows.filter((r) => r.u === u && r.d >= from && r.d <= to) : []; },
  };
}

/** 실제 데이터: PostgREST RPC. 아래 환경변수가 모두 있을 때만 만든다. 키·토큰 값은 코드·로그·응답에 넣지 않는다.
 *   ADMIN_SUPABASE_URL, ADMIN_SUPABASE_PUBLISHABLE_KEY(공개 anon/publishable 키), ADMIN_JWT(승인된 운영자 계정의 로그인 토큰)
 * 서버 함수가 axis_an.admin_user 목록으로 다시 검사하므로, 이 토큰이 일반 사용자 것이면 모든 호출이 거부된다. */
export function supabaseSource(env = process.env) {
  const base = (env.ADMIN_SUPABASE_URL || '').replace(/\/+$/, ''), key = env.ADMIN_SUPABASE_PUBLISHABLE_KEY, jwt = env.ADMIN_JWT;
  if (!base || !key || !jwt) return null;
  const call = async (fn, body) => {
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${jwt}` }, body: JSON.stringify(body || {}) });
    if (!res.ok) { const e = new Error('upstream_error'); e.status = res.status; throw e; }
    const j = await res.json();
    if (j && j.error === 'denied') { const e = new Error('denied'); e.status = 403; throw e; }
    return j;
  };
  return {
    mode: 'real', today: new Date().toISOString().slice(0, 10),
    days: (from, to) => call('axis_admin_days', { p_from: from, p_to: to }),
    profiles: () => call('axis_admin_profiles'),
    named: () => call('axis_admin_named_users'),
    events: (from, to) => call('axis_admin_events', { p_from: from, p_to: to }),
    userDays: (u, from, to) => call('axis_admin_user_days', { p_u: u, p_from: from, p_to: to }),
  };
}
