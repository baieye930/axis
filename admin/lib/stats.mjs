// AXIS 운영자 통계 계산 (순수 함수, 의존성 없음). 지표 정의는 docs/analytics/metrics.md 와 같다.
//
// 입력 행(axis_admin_days):  {u, d:'YYYY-MM-DD', tz, plan, actual, habits, health, personal}
//   actual: {wake: 시간(소수, 논리 하루 기준: 새벽 4시 이전은 24+), bed: 논리 하루 시작(00:00)부터의 분,
//            total: 그날 유효한 완료 대상 루틴 수, done: 완료 수, skipped: 제외 수}
//   plan:   {wake_exp, st, routines:[{id,type,start,len,fixed,state,src}], appts:[…]}
//   health: {sleepH, fresh, focus, slump, cups, wo:{sessions,sets,volume}, meals:{n,kcal,p,c,f}}
// 프로필(axis_admin_profiles): {u, created, last, login, analytics, personal, health, deleted}
// 이벤트 집계(axis_admin_events): {u, d, n, c}

export const MIN_USERS = 5;          // 이 수보다 적은 집단의 집계는 보여주지 않는다(소수 집단 보호)
export const MIN_USER_DAYS = 3;      // 사용자 평균에 포함하려면 기간 내 기록일이 이 수 이상이어야 한다
export const SCATTER_R = 0.5;        // 원형 평균의 집중도(R)가 이보다 작으면 "분산 큼" 표시

const DAY = 1440;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const round3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

export const dateAdd = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const dateDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
export const dateRange = (from, to) => { const o = []; for (let d = from; d <= to; d = dateAdd(d, 1)) o.push(d); return o; };

/** 시각(분, 24시간 원 위의 값) 평균은 일반 평균이 아니라 원형 평균으로 계산한다. 23:30과 00:30의 평균은 00:00이다. */
export function circMean(mins) {
  const v = mins.filter((x) => Number.isFinite(x));
  if (!v.length) return { mean: null, R: null, n: 0, scattered: false };
  let sx = 0, sy = 0;
  for (const m of v) { const a = (2 * Math.PI * (((m % DAY) + DAY) % DAY)) / DAY; sx += Math.cos(a); sy += Math.sin(a); }
  const R = Math.hypot(sx, sy) / v.length;
  let ang = Math.atan2(sy, sx); if (ang < 0) ang += 2 * Math.PI;
  const m = R < 1e-9 ? null : Math.round((ang * DAY) / (2 * Math.PI)) % DAY;
  return { mean: m, R: round3(R), n: v.length, scattered: R < SCATTER_R };
}
export const fmtClock = (m) => (m == null ? '–' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
/** 두 시각(분)의 차이를 -720..720 으로 돌려준다(자정을 넘는 차이도 올바르게). */
export const circDiff = (a, b) => { let d = (a - b) % DAY; if (d > DAY / 2) d -= DAY; if (d < -DAY / 2) d += DAY; return d; };

/** 그날 기록이 있는가: 실제 기록(기상·완료·습관)이 하나라도 있어야 한다. 계획만 있는 날은 기록일이 아니다. */
export function isRecorded(r) {
  const a = r && r.actual;
  if (!a) return false;
  if (Number.isFinite(a.wake) || (a.done || 0) > 0) return true;
  return !!(r.habits && Object.values(r.habits).some((x) => x === true));
}
/** 그날의 완료율: 완료 / (유효한 대상 − 제외). 분모가 0이면 계산하지 않는다(null). 계획만 있는 날·미기록일은 호출하지 않는다. */
export function dayCompletion(r) {
  const a = r.actual; if (!a) return null;
  const elig = (a.total || 0) - (a.skipped || 0);
  if (!(elig > 0)) return null;
  return Math.min(1, Math.max(0, (a.done || 0) / elig));
}

function byUser(rows) { const m = new Map(); for (const r of rows) { if (!m.has(r.u)) m.set(r.u, []); m.get(r.u).push(r); } return m; }
const sup = (n) => ({ suppressed: true, n, reason: `표본이 ${MIN_USERS}명 미만이라 표시하지 않아요` });

/** 사용자별 값 목록을 사용자 평균들의 평균으로 합친다(기본 지표: 일 → 사용자 → 전체). */
function userLevel(users, f, minDays = MIN_USER_DAYS) {
  const vals = [];
  for (const [, rows] of users) {
    const rec = rows.filter(isRecorded);
    if (rec.length < minDays) continue;
    const v = f(rec);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  return vals;
}

/** (사용자, 날짜)가 같은 행이 여러 번 와도 한 번만 센다(재전송·중복 보호). 뒤에 온 행이 우선. */
export const dedupe = (rows) => [...new Map(rows.map((r) => [r.u + '|' + r.d, r])).values()];

export function overview({ rows: rawRows, profiles = [], events = [], from, to, today }) {
  const rows = dedupe(rawRows);
  const inRange = rows.filter((r) => r.d >= from && r.d <= to);
  const users = byUser(inRange);
  const out = { from, to, window_days: dateDiff(from, to) + 1, definitions_version: 1 };
  const popN = users.size;

  // 가입·활동
  const prof = profiles.filter((p) => !p.deleted);
  out.signups = prof.filter((p) => String(p.created).slice(0, 10) >= from && String(p.created).slice(0, 10) <= to).length;
  out.active_users = prof.filter((p) => p.last && String(p.last).slice(0, 10) >= from).length;     // 기간 시작 이후 앱을 쓴 적이 있는 사용자(최근 활동일 기준)
  const recUsers = [...users.entries()].filter(([, rs]) => rs.some(isRecorded)).length;
  out.recording_users = recUsers;
  out.analytics_users = popN;
  out.consented_users = prof.filter((p) => p.analytics).length;

  // 기록 유지율(D7): 첫 기록일 +7~+13일 사이에 다시 기록한 사용자 비율. 첫 기록일이 기간 안이고 +13일이 오늘 이내인 사용자만 대상.
  const firstDay = new Map();
  for (const r of rows) if (isRecorded(r)) { const f = firstDay.get(r.u); if (!f || r.d < f) firstDay.set(r.u, r.d); }
  const recDays = byUser(rows.filter(isRecorded));
  const cohort = [...firstDay.entries()].filter(([, f]) => f >= from && f <= to && (!today || dateAdd(f, 13) <= today));
  const kept = cohort.filter(([u, f]) => recDays.get(u).some((r) => r.d >= dateAdd(f, 7) && r.d <= dateAdd(f, 13))).length;
  out.retention_d7 = cohort.length < MIN_USERS ? sup(cohort.length) : { rate: round3(kept / cohort.length), n: cohort.length, kept, def: '첫 기록일 +7~+13일 안에 다시 기록' };

  // 실제 기상·취침(원형 평균). 사용자별 평균 → 사용자 평균
  const clockAgg = (key, conv) => {
    const per = userLevel(users, (rec) => { const c = circMean(rec.map((r) => conv(r.actual && r.actual[key])).filter(Number.isFinite)); return c.mean; });
    if (per.length < MIN_USERS) return sup(per.length);
    const c = circMean(per);
    return { mean: fmtClock(c.mean), minutes: c.mean, n: per.length, R: c.R, scattered: c.scattered, note: c.scattered ? '사용자 간 분산이 커서 평균의 의미가 작아요' : null };
  };
  out.wake = clockAgg('wake', (h) => (Number.isFinite(h) ? Math.round(h * 60) : NaN));
  out.bed = clockAgg('bed', (m) => (Number.isFinite(m) ? m : NaN));

  // 평균 수면(건강 동의 행만)
  const sleepPer = userLevel(users, (rec) => mean(rec.map((r) => r.health && r.health.sleepH).filter(Number.isFinite)));
  out.sleep_h = sleepPer.length < MIN_USERS ? sup(sleepPer.length) : { mean: round1(mean(sleepPer)), n: sleepPer.length, note: '건강 기록 분석에 동의한 사용자만' };

  // 루틴 완료율 — 기본: 일별 완료율 → 사용자 기간 평균 → 사용자 평균
  const compPer = userLevel(users, (rec) => mean(rec.map(dayCompletion).filter((x) => x != null)));
  out.completion = compPer.length < MIN_USERS ? sup(compPer.length)
    : { rate: round3(mean(compPer)), n: compPer.length, def: '사용자별 일 완료율의 기간 평균을 사용자 전체에서 평균(분모: 유효한 루틴 − 제외)' };
  // 별도 지표: 전체 완료 항목 / 전체 대상 항목(많이 기록한 사용자의 비중이 커진다)
  let D = 0, E = 0, nUsers = 0;
  for (const [, rows2] of users) { const rec = rows2.filter(isRecorded); if (rec.length < MIN_USER_DAYS) continue; nUsers++; for (const r of rec) { const a = r.actual; const el = (a.total || 0) - (a.skipped || 0); if (el > 0) { E += el; D += Math.min(a.done || 0, el); } } }
  out.completion_pooled = nUsers < MIN_USERS ? sup(nUsers) : { rate: round3(D / E), n: nUsers, items: E, def: '완료 항목 합계 / 대상 항목 합계(가중 지표, 기본 지표와 다름)' };

  // 항목별 완료율: 습관 ID별로 사용자 평균. 기본 습관 ID만 합친다.
  const habitIds = new Set(); for (const r of inRange) if (r.habits) Object.keys(r.habits).forEach((k) => habitIds.add(k));
  out.habits = {};
  for (const h of [...habitIds].sort()) {
    const per = userLevel(users, (rec) => { const v = rec.map((r) => r.habits && r.habits[h]).filter((x) => typeof x === 'boolean'); return v.length ? v.filter(Boolean).length / v.length : null; });
    out.habits[h] = per.length < MIN_USERS ? sup(per.length) : { rate: round3(mean(per)), n: per.length };
  }

  // 계획 수정·제외 비율(계획 행 기준): 이동/제외/직접 지정 상태의 루틴 / 계획된 루틴
  let plan = 0, moved = 0, skipped = 0, locked = 0, planUsers = new Set();
  for (const r of inRange) for (const x of (r.plan && r.plan.routines) || []) { plan++; planUsers.add(r.u); if (x.state === 'moved') moved++; else if (x.state === 'skipped') skipped++; else if (x.state === 'locked') locked++; }
  out.plan_edits = planUsers.size < MIN_USERS || !plan ? sup(planUsers.size)
    : { moved_rate: round3(moved / plan), skipped_rate: round3(skipped / plan), locked_rate: round3(locked / plan), routines: plan, n: planUsers.size, def: '계획된 루틴 중 상태별 비율(미래 초안 포함 아님: 저장된 계획 기준)' };

  // 충돌 제안 수락 비율: 수락 / (수락 + 취소). 표시만 하고 응답하지 않은 경우는 분모에서 뺀다.
  const ev = events.filter((e) => e.d >= from && e.d <= to);
  const cnt = (n) => ev.filter((e) => e.n === n).reduce((s, e) => s + e.c, 0);
  const cu = new Set(ev.filter((e) => e.n.startsWith('conflict_')).map((e) => e.u));
  const acc = cnt('conflict_accepted'), can = cnt('conflict_cancelled'), shown = cnt('conflict_shown');
  out.conflicts = cu.size < MIN_USERS || acc + can === 0 ? sup(cu.size)
    : { accept_rate: round3(acc / (acc + can)), accepted: acc, cancelled: can, shown, n: cu.size, def: '수락 / (수락 + 취소)' };

  // 운동·식사 요약(건강 동의 행만)
  const wo = inRange.filter((r) => r.health && r.health.wo && r.health.wo.sessions > 0);
  const woU = new Set(wo.map((r) => r.u));
  out.workout = woU.size < MIN_USERS ? sup(woU.size) : { sessions_per_recorded_user_day: round1(mean(wo.map((r) => r.health.wo.sessions))), avg_sets: round1(mean(wo.map((r) => r.health.wo.sets).filter(Number.isFinite))), user_days: wo.length, n: woU.size };
  const ml = inRange.filter((r) => r.health && r.health.meals && r.health.meals.n > 0);
  const mlU = new Set(ml.map((r) => r.u));
  out.meals = mlU.size < MIN_USERS ? sup(mlU.size) : { avg_kcal: Math.round(mean(ml.map((r) => r.health.meals.kcal).filter(Number.isFinite))), avg_protein_g: round1(mean(ml.map((r) => r.health.meals.p).filter(Number.isFinite))), user_days: ml.length, n: mlU.size };

  // 표본 수와 기록 누락률: 사용자별 (기록일 / 첫 기록 이후 기간 내 경과일). 미래·사용 시작 이전은 포함하지 않는다.
  const last = today && today < to ? today : to;
  const miss = [];
  for (const [u, rs] of users) {
    const rec = rs.filter(isRecorded); if (!rec.length) continue;
    const f = firstDay.get(u) || rec[0].d, start = f > from ? f : from;
    const span = dateDiff(start, last) + 1; if (span < 1) continue;
    miss.push(1 - new Set(rec.map((r) => r.d)).size / span);
  }
  out.missing = miss.length < MIN_USERS ? sup(miss.length) : { rate: round3(mean(miss)), n: miss.length, def: '1 − 기록일 / (첫 기록 이후 경과일). 계획만 있는 날과 사용 시작 전은 제외' };

  // 일별 추이
  out.daily = dateRange(from, last).map((d) => {
    const day = inRange.filter((r) => r.d === d && isRecorded(r));
    const comp = day.map(dayCompletion).filter((x) => x != null);
    return { d, recorded: day.length, completion: day.length >= MIN_USERS && comp.length ? round3(mean(comp)) : null };
  });
  out.samples = { users_in_window: popN, recorded_user_days: inRange.filter(isRecorded).length, plan_only_user_days: inRange.filter((r) => !isRecorded(r)).length };
  return out;
}

/** 이름이 연결된 사용자 목록(개인별 분석 동의 사용자만 서버가 보내준다). */
export function userList({ rows: raw, named, from, to }) {
  const rows = dedupe(raw);
  const users = byUser(rows.filter((r) => r.d >= from && r.d <= to));
  return named.map((p) => {
    const rs = (users.get(p.u) || []).filter(isRecorded);
    const wake = circMean(rs.map((r) => (Number.isFinite(r.actual.wake) ? Math.round(r.actual.wake * 60) : NaN)).filter(Number.isFinite));
    const bed = circMean(rs.map((r) => r.actual.bed).filter(Number.isFinite));
    const comp = mean(rs.map(dayCompletion).filter((x) => x != null));
    return { u: p.u, name: p.name, login: p.login, created: p.created, last: p.last, recorded_days: rs.length,
      wake: fmtClock(wake.mean), wake_scattered: wake.scattered, bed: fmtClock(bed.mean), bed_scattered: bed.scattered,
      completion: comp == null ? null : round3(comp), health_consent: !!p.health };
  });
}

/** 사용자 상세: 날짜별 구조화 기록. 기록없음 / 계획만 / 기록을 구분하고 계획과 실제를 나란히 보여준다. */
export function userDetail({ rows, from, to, today }) {
  const byDate = new Map(rows.map((r) => [r.d, r]));
  return dateRange(from, today && today < to ? today : to).map((d) => {
    const r = byDate.get(d);
    if (!r) return { d, status: 'none', label: '기록 없음' };
    const rec = isRecorded(r), a = r.actual || {}, p = r.plan || {};
    const row = { d, status: rec ? 'recorded' : 'plan_only', label: rec ? '기록' : '계획만 있음' };
    row.plan = { wake_exp: p.wake_exp ?? null, state: p.st ?? null, routines: (p.routines || []).length, moved: (p.routines || []).filter((x) => x.state === 'moved').length,
      skipped: (p.routines || []).filter((x) => x.state === 'skipped').length, locked: (p.routines || []).filter((x) => x.state === 'locked').length, appts: (p.appts || []).length };
    if (rec) {
      const el = (a.total || 0) - (a.skipped || 0);
      row.actual = { wake: Number.isFinite(a.wake) ? fmtClock(Math.round(a.wake * 60) % DAY) : null, bed: Number.isFinite(a.bed) ? fmtClock(a.bed % DAY) : null,
        done: a.done ?? 0, eligible: el > 0 ? el : 0, skipped: a.skipped ?? 0, incomplete: Math.max(0, el - (a.done || 0)), completion: round3(dayCompletion(r)) };
      if (Number.isFinite(p.wake_exp) && Number.isFinite(a.wake)) row.wake_diff_min = circDiff(Math.round(a.wake * 60), Math.round(p.wake_exp * 60));
      if (r.health) row.health = r.health;
    }
    return row;
  });
}
