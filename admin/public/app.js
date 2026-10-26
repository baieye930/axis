'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x == null ? '–' : Math.round(x * 1000) / 10 + '%');
const st = { tab: 'stats', from: null, to: null, today: null, user: null };
const dAdd = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function api(path) {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (r.status === 401) { location.reload(); throw new Error('unauthorized'); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || j.error || '오류'); }
  return r.json();
}
function setPeriod(days) { st.to = st.today; st.from = dAdd(st.today, -(days - 1)); $('#from').value = st.from; $('#to').value = st.to; document.querySelectorAll('.period [data-days]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.days === days))); }

function metric(label, m, fmt, sub) {
  if (!m || m.suppressed) return `<div class="card sup"><div class="k">${esc(label)}</div><div class="v">표본 부족</div><div class="s">${m ? `대상 ${m.n}명 · ${MIN}명 이상일 때 표시` : ''}</div></div>`;
  return `<div class="card"><div class="k">${esc(label)}</div><div class="v">${esc(fmt(m))}</div><div class="s">${esc(sub ? sub(m) : `표본 ${m.n}명`)}${m.note ? ` · <span class="warn">${esc(m.note)}</span>` : ''}</div></div>`;
}
const MIN = 5;
function trend(daily) {
  const w = 600, h = 140, pad = 24, n = daily.length || 1, bw = (w - pad * 2) / n;
  const bars = daily.map((x, i) => { const hh = x.completion == null ? 0 : (h - pad * 2) * x.completion; return `<rect x="${pad + i * bw + 1}" y="${h - pad - hh}" width="${Math.max(1, bw - 2)}" height="${hh}" rx="2" fill="#B66A1F"><title>${esc(x.d)} · 기록 ${x.recorded}명 · 완료율 ${x.completion == null ? '표본 부족' : pct(x.completion)}</title></rect>`; }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="일별 평균 완료율"><line x1="${pad}" x2="${w - pad}" y1="${h - pad}" y2="${h - pad}" stroke="#e7d8c3"/>${bars}<text x="${pad}" y="${h - 6}" font-size="10" fill="#6b5a47">${esc(daily[0]?.d || '')}</text><text x="${w - pad}" y="${h - 6}" font-size="10" fill="#6b5a47" text-anchor="end">${esc(daily.at(-1)?.d || '')}</text></svg><div class="s muted">일별 평균 완료율 (그날 기록한 사용자가 ${MIN}명 이상인 날만)</div></div>`;
}
async function showStats() {
  $('#status').textContent = '불러오는 중…';
  const o = await api(`/api/overview?from=${st.from}&to=${st.to}`);
  $('#status').textContent = `${o.from} ~ ${o.to} · 분석 동의 사용자 ${o.analytics_users}명 · 기록한 사용자‑일 ${o.samples.recorded_user_days} · 계획만 있는 사용자‑일 ${o.samples.plan_only_user_days} (기록으로 세지 않음)`;
  const cards = [
    metric('가입 사용자', { n: o.signups }, (m) => m.n + '명', () => '기간 내 가입'),
    metric('활동 사용자', { n: o.active_users }, (m) => m.n + '명', () => '최근 활동일이 기간 이후'),
    metric('기록 사용자', { n: o.recording_users }, (m) => m.n + '명', () => '기간 내 기록일이 있는 사용자'),
    metric('기록 유지율 (D7)', o.retention_d7, (m) => pct(m.rate), (m) => `대상 ${m.n}명 · ${m.def}`),
    metric('평균 실제 기상', o.wake, (m) => m.mean, (m) => `표본 ${m.n}명 · 원형 평균`),
    metric('평균 실제 취침', o.bed, (m) => m.mean, (m) => `표본 ${m.n}명 · 원형 평균`),
    metric('평균 수면 시간', o.sleep_h, (m) => m.mean + '시간', (m) => `표본 ${m.n}명 · ${m.note}`),
    metric('루틴 완료율 (기본)', o.completion, (m) => pct(m.rate), (m) => `표본 ${m.n}명`),
    metric('완료 항목 비율 (가중)', o.completion_pooled, (m) => pct(m.rate), (m) => `대상 항목 ${m.items}개 · 기본 지표와 다름`),
    metric('기록 누락률', o.missing, (m) => pct(m.rate), (m) => `표본 ${m.n}명`),
    metric('계획 시간 이동 비율', o.plan_edits, (m) => pct(m.moved_rate), (m) => `제외 ${pct(m.skipped_rate)} · 직접 지정 ${pct(m.locked_rate)}`),
    metric('충돌 제안 수락 비율', o.conflicts, (m) => pct(m.accept_rate), (m) => `수락 ${m.accepted} · 취소 ${m.cancelled} · 표시 ${m.shown}`),
    metric('운동 기록', o.workout, (m) => m.sessions_per_recorded_user_day + '회/일', (m) => `사용자‑일 ${m.user_days} · 평균 세트 ${m.avg_sets}`),
    metric('식사 기록', o.meals, (m) => m.avg_kcal + ' kcal', (m) => `단백질 ${m.avg_protein_g}g · 사용자‑일 ${m.user_days}`),
  ].join('');
  const hab = Object.entries(o.habits).map(([k, m]) => metric('습관 · ' + k, m, (x) => pct(x.rate))).join('');
  $('#view').innerHTML = `<div class="grid">${cards}</div><h3>일별 추이</h3>${trend(o.daily)}<h3>기본 습관별 완료율</h3><div class="grid">${hab}</div>
    <p class="note defs">모든 비율은 기록한 날만 대상으로 하며, 계획만 작성한 날·미래·사용 시작 이전은 포함하지 않아요. 사용자당 일별 값 → 사용자 평균 → 사용자 전체 평균 순서로 계산합니다(자세한 정의: docs/analytics/metrics.md). 상관관계는 원인이나 의학적 판단이 아니에요.</p>`;
}
async function showUsers() {
  $('#status').textContent = '불러오는 중…';
  const r = await api(`/api/users?from=${st.from}&to=${st.to}`);
  $('#status').textContent = `${st.from} ~ ${st.to} · 개인별 분석에 동의한 ${r.users.length}명 (이메일은 표시하지 않아요)`;
  if (!r.users.length) { $('#view').innerHTML = '<p class="muted">표시할 사용자가 없어요. (개인별 분석 동의가 있는 사용자만 보여요)</p>'; return; }
  $('#view').innerHTML = `<table><thead><tr><th>닉네임·표시 이름</th><th>ID</th><th>로그인</th><th>가입일</th><th>최근 활동</th><th>기록일</th><th>평균 기상</th><th>평균 취침</th><th>완료율</th></tr></thead><tbody>`
    + r.users.map((u) => `<tr class="click" tabindex="0" data-u="${esc(u.u)}"><td>${esc(u.name)}</td><td class="num">${esc(u.u.slice(0, 8))}</td><td>${esc(u.login)}</td><td>${esc(String(u.created).slice(0, 10))}</td><td>${esc(String(u.last || '').slice(0, 10))}</td><td class="num">${u.recorded_days}</td><td class="num">${esc(u.wake)}${u.wake_scattered ? ' ⚠' : ''}</td><td class="num">${esc(u.bed)}${u.bed_scattered ? ' ⚠' : ''}</td><td class="num">${pct(u.completion)}</td></tr>`).join('')
    + `</tbody></table><p class="note">⚠ 시각이 크게 흩어져 있어 평균의 의미가 작아요. 평균 시각은 자정 전후를 고려한 원형 평균입니다.</p>`;
  document.querySelectorAll('tr.click').forEach((tr) => { const go = () => showUser(tr.dataset.u); tr.addEventListener('click', go); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); });
}
async function showUser(u) {
  st.user = u; $('#status').textContent = '불러오는 중…';
  const r = await api(`/api/user?u=${encodeURIComponent(u)}&from=${st.from}&to=${st.to}`);
  $('#status').textContent = `${st.from} ~ ${st.to} · 사용자 ${u.slice(0, 8)}`;
  const chip = (d) => `<span class="chip ${d.status === 'recorded' ? 'rec' : d.status === 'plan_only' ? 'plan' : 'none'}">${esc(d.label)}</span>`;
  $('#view').innerHTML = `<button class="back" id="back">‹ 사용자 목록</button><table><thead><tr><th>날짜</th><th>상태</th><th>예상 기상</th><th>실제 기상</th><th>차이</th><th>실제 취침</th><th>계획 루틴</th><th>이동/제외/직접</th><th>완료/대상</th><th>제외</th><th>미완료</th><th>완료율</th></tr></thead><tbody>`
    + r.days.map((d) => { const a = d.actual || {}, p = d.plan || {}; return `<tr><td class="num">${esc(d.d)}</td><td>${chip(d)}</td><td class="num">${p.wake_exp ?? '–'}</td><td class="num">${esc(a.wake ?? '–')}</td><td class="num">${d.wake_diff_min == null ? '–' : (d.wake_diff_min > 0 ? '+' : '') + d.wake_diff_min + '분'}</td><td class="num">${esc(a.bed ?? '–')}</td><td class="num">${p.routines ?? '–'}</td><td class="num">${p.routines ? `${p.moved}/${p.skipped}/${p.locked}` : '–'}</td><td class="num">${a.done == null ? '–' : a.done + '/' + a.eligible}</td><td class="num">${a.skipped ?? '–'}</td><td class="num">${a.incomplete ?? '–'}</td><td class="num">${pct(a.completion)}</td></tr>`; }).join('')
    + `</tbody></table><p class="note">‘기록 없음’은 그날 기록이 없는 것이고, ‘계획만 있음’은 계획만 저장된 날입니다. 둘 다 실패나 놓침이 아니에요. 자유 메모·약속 제목·인증정보는 수집하지 않아 보이지 않습니다.</p>`;
  $('#back').addEventListener('click', () => { st.user = null; show(); });
}
function show() { (st.tab === 'users' ? (st.user ? showUser(st.user) : showUsers()) : showStats()).catch((e) => { $('#status').textContent = ''; $('#view').innerHTML = `<p class="err" role="alert">${esc(e.message)}</p>`; }); }

(async function init() {
  const meta = await fetch('/api/meta').then((r) => r.json());
  const m = $('#mode'); m.textContent = meta.mode === 'synthetic' ? '합성 데이터 (실제 사용자 아님)' : '실제 데이터'; m.className = 'mode ' + (meta.mode === 'real' ? 'real' : '');
  if (meta.blocked) { $('#blocked').hidden = false; return; }
  if (meta.needs_login) {
    $('#login').hidden = false;
    $('#loginForm').addEventListener('submit', async (e) => { e.preventDefault(); const r = await fetch('/login', { method: 'POST', body: JSON.stringify({ token: $('#tok').value }) }); if (r.ok) location.reload(); else $('#loginMsg').textContent = '토큰이 맞지 않아요.'; });
    return;
  }
  st.today = meta.today; $('#app').hidden = false; setPeriod(30);
  document.querySelectorAll('.period [data-days]').forEach((b) => b.addEventListener('click', () => { setPeriod(+b.dataset.days); show(); }));
  $('#apply').addEventListener('click', () => { st.from = $('#from').value; st.to = $('#to').value; document.querySelectorAll('.period [data-days]').forEach((b) => b.setAttribute('aria-pressed', 'false')); show(); });
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; st.user = null; document.querySelectorAll('.tabs [data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b))); show(); }));
  show();
})();
