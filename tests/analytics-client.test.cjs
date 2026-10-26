// 이용 분석·동의 클라이언트 검증 (합성 계정, 네트워크는 가로채서 기록만 한다). 운영 서버에 요청을 보내지 않는다.
// 사용: python3 tests/build-testcopy.py <ON폴더>; python3 tests/build-testcopy.py <OFF폴더> --policy-incomplete; node tests/analytics-client.test.cjs <ON> <OFF> [캡처폴더]
const { chromium } = require('playwright');
const path = require('path');
const [ON, OFF, SHOTS] = process.argv.slice(2);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

async function open(dir, { session, ls = {}, mode = 'ok', time = '2026-10-26T10:00:00' } = {}) {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c.addInitScript(([session, ls]) => { try { if (session && !localStorage.getItem('axis.session')) localStorage.setItem('axis.session', JSON.stringify(session)); for (const k in ls) if (!localStorage.getItem(k)) localStorage.setItem(k, ls[k]); localStorage.setItem('axis.wostart', '1'); } catch (e) {} }, [session, ls]);
  const p = await c.newPage();
  const log = { calls: [], errors: [] };
  p.on('pageerror', (e) => log.errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  let netMode = mode; log.setMode = (m) => { netMode = m; };
  await p.route(/\/rest\/v1\/rpc\/(axis_[a-z_]+)/, async (r) => {
    const fn = r.request().url().match(/rpc\/(axis_[a-z_]+)/)[1]; let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    log.calls.push({ fn, body });
    if (fn.startsWith('axis_an_') && netMode === 'fail') return r.abort();
    const j = fn === 'axis_days_get' ? { ok: true, days: [], prefs: null } : fn === 'axis_an_consent_put' ? { ok: true, effective_at: '2026-10-26T00:00:00Z' }
      : fn === 'axis_an_events_put' ? { ok: true, accepted: (body.p_batch || []).length } : fn === 'axis_an_snapshots_put' ? { ok: true, accepted: (body.p_batch || []).length } : { ok: true };
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
  });
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)(?!.*supabase\.co\/rest)/, (r) => r.abort());
  await p.clock.install({ time: new Date(time) });
  await p.goto('file://' + path.resolve(dir, 'index.html'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(900);
  return { b, c, p, log };
}
const A = { key: 'testkeyAAAA', nick: '테스터A', proof: 'proofA' }, B = { key: 'testkeyBBBB', nick: '테스터B', proof: 'proofB' };
const an = (log, fn) => log.calls.filter((c) => c.fn === fn);
const anAll = (log) => log.calls.filter((c) => c.fn.startsWith('axis_an_'));
const wake = async (p) => { if (!(await p.$eval('#consent', (e) => e.hidden))) return; const b = await p.$('[data-pick="7"]'); if (b && await b.isVisible()) { await b.click(); await p.waitForTimeout(300); } };
const theme = (p) => p.evaluate(() => { document.querySelectorAll('[data-look="light"]').forEach((x) => x.click()); document.documentElement.setAttribute('data-theme', 'light'); document.documentElement.setAttribute('data-phase', 'day'); });

(async () => {
  // 1. 운영 정보가 비어 있으면(현재 config.js) 동의 화면도 전송도 없다
  { const { b, p, log } = await open(OFF, { session: A });
    await wake(p); await p.click('.tabbar [data-tab="guide"]'); await p.click('#mtSet'); await p.waitForTimeout(200);
    ok(await p.$eval('#consent', (e) => e.hidden), '운영 정보 미완성: 동의 화면이 나오지 않음');
    ok(!(await p.evaluate(() => __T.anPolicyOK())), '운영 정보 미완성: 정책 비활성');
    await p.evaluate(() => __T.track('screen_open', { screen: 'today' })); await p.waitForTimeout(6500);
    ok(anAll(log).length === 0 && (await p.evaluate(() => __T.anQ().length)) === 0, '운영 정보 미완성: 분석 이벤트를 쌓지도 보내지도 않음');
    await p.evaluate(() => { document.getElementById('privacyAcc').open = true; });
    ok(/아직 켜지지 않았어요/.test(await p.textContent('#privacyBody')), '설정에 분석 비활성 상태를 정직하게 표시');
    ok(log.errors.length === 0, '오류 없음'); await b.close(); }

  // 2~3. 동의 화면: 미선택·필수 확인·동의 전 전송 없음·서비스만 동의
  { const { b, p, log } = await open(ON, { session: A });
    await wake(p);
    ok(!(await p.$eval('#consent', (e) => e.hidden)), '신규(동의 기록 없음) 사용자에게 동의 화면 표시');
    ok(await p.evaluate(() => [...document.querySelectorAll('#consentBody input[type=checkbox]')].every((i) => !i.checked)), '모든 체크박스(전체 동의 포함)가 기본 미선택');
    ok(await p.$eval('#csGo', (e) => e.disabled), '필수 항목 미선택이면 계속하기 비활성');
    ok(/필수 항목에 동의하지 않으면/.test(await p.textContent('#csMsg')), '필수 미동의 시 기능 제한 이유 안내');
    ok(/동의하지 않고 나가기/.test(await p.textContent('#csOut')), '거절 경로(나가기)가 숨겨지지 않고 표시');
    await p.evaluate(() => __T.track('screen_open', { screen: 'today' })); await p.waitForTimeout(6500);
    ok(anAll(log).length === 0, '동의 전에는 분석 이벤트·동의 외 요청이 전송되지 않음');
    await theme(p); if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'consent1.png') });
    await p.click('#consentBody details.cs-more summary'); await theme(p); if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'consent2.png') });
    await p.check('[data-ci="service"]'); await p.waitForTimeout(100);
    ok(/선택 항목 없이 계속하기/.test(await p.textContent('#csGo')), '선택 항목이 없으면 버튼 문구가 실제 선택과 일치');
    await p.check('[data-ci="analytics"]'); await p.waitForTimeout(100);
    ok(/선택한 항목에 동의하고 계속하기/.test(await p.textContent('#csGo')), '선택 항목이 있으면 버튼 문구가 바뀜');
    await p.uncheck('[data-ci="analytics"]');
    await p.click('#csGo'); await p.waitForTimeout(600);
    const c = await p.evaluate(() => __T.consentGet());
    ok(c && c.items.service === true && c.items.analytics === false && c.v === 'test-1', '서비스만 동의: 선택 항목은 거절로 저장');
    ok(an(log, 'axis_an_consent_put').length === 1 && an(log, 'axis_an_consent_put')[0].body.p_items.analytics === false, '동의 이력을 서버 기록(RPC) 시도');
    await p.evaluate(() => { __T.track('plan_save', { kind: 'today', adj: 1, appts: 0 }); }); await p.waitForTimeout(6500);
    ok(an(log, 'axis_an_events_put').length === 0 && (await p.evaluate(() => __T.anQ().length)) === 0, '분석 거절 후에도 이벤트를 쌓지 않음');
    await wake(p); ok(await p.$eval('#tab-today', (e) => !e.hidden), '분석 거절 후에도 기본 기능(홈)이 정상');
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
    ok(await p.$eval('#consent', (e) => e.hidden), '새로고침 후 동의가 유지되어 화면이 다시 나오지 않음');
    ok(log.errors.length === 0, '오류 없음'); await b.close(); }

  // 4~5. 분석 동의 → 이벤트(허용 목록·속성 검증), 철회 → 큐 삭제
  { const { b, p, log } = await open(ON, { session: A, ls: { 'axis.consent.testkeyAAAA': JSON.stringify({ v: 'test-1', items: { service: true, analytics: true, personal: false, health: false }, at: '2026-10-25T00:00:00Z', since: '2026-10-25', srv: '2026-10-25T00:00:00Z' }) } });
    await wake(p);
    ok(await p.$eval('#consent', (e) => e.hidden), '기존 유효 동의가 있으면 다시 요구하지 않음');
    ok(await p.evaluate(() => __T.anOn('analytics')) && !(await p.evaluate(() => __T.anOn('personal'))), '항목별 동의 판정(분석 O, 개인별 X)');
    const base0 = await p.evaluate(() => __T.anQ().length);
    await p.evaluate(() => { __T.track('screen_open', { screen: 'today', memo: '자유 텍스트', extra: 1 }); __T.track('click_anything', {}); __T.track('appt_add', { repeat: '병원 가기' }); __T.track('routine_done', { item: 'move', via: 'timeline' }); __T.track('plan_save', { kind: 'future', adj: 999, appts: 2 }); });
    const q = await p.evaluate(() => __T.anQ());
    ok(q.length - base0 === 4 && !q.some((e) => e.n === 'click_anything'), '허용 목록에 없는 이벤트는 쌓지 않음(4건만)');
    ok(!JSON.stringify(q).includes('자유 텍스트') && !JSON.stringify(q).includes('병원'), '허용되지 않은 속성·자유 텍스트 값은 제거');
    ok(q.find((e) => e.n === 'plan_save').p.adj === undefined, '범위를 벗어난 숫자 속성은 제거');
    ok(q.every((e) => /^[0-9a-f]{20}$/.test(e.id) && e.d === '2026-10-26' && e.z && e.t), '이벤트에 ID·논리 날짜·시간대·UTC 시각 포함');
    await p.waitForTimeout(6500);
    const ev = an(log, 'axis_an_events_put');
    ok(ev.length >= 1 && ev[0].body.p_key === 'testkeyAAAA' && ev[0].body.p_proof === 'proofA', '이벤트가 해당 계정 키로 전송');
    ok((await p.evaluate(() => __T.anQ().length)) === 0, '전송 성공 후 큐 비움');
    // 6. 네트워크 실패: 큐 유지·같은 ID로 재시도(중복은 서버가 거름)
    log.setMode('fail'); await p.evaluate(() => __T.track('routine_skip', { item: 'nsdr' })); await p.waitForTimeout(6500);
    const pending = await p.evaluate(() => __T.anQ()); ok(pending.length === 1, '전송 실패 시 이벤트를 보관');
    log.setMode('ok'); const failedIds = pending.map((e) => e.id); await p.clock.runFor(70000); await p.waitForTimeout(500);
    const sent = an(log, 'axis_an_events_put').flatMap((c) => c.body.p_batch.map((e) => e.id));
    ok(sent.filter((id) => id === failedIds[0]).length >= 2 && (await p.evaluate(() => __T.anQ().length)) === 0, '재시도는 같은 이벤트 ID로 보내고 성공 후 비움');
    ok(await p.$eval('#tab-today', (e) => !e.hidden), '네트워크 실패 중에도 앱이 정상 동작');
    // 5. 철회
    await p.evaluate(() => __T.track('routine_skip', { item: 'sun1' }));
    await p.evaluate(() => { ['alert'].forEach((id) => { const e = document.getElementById(id); if (e) e.hidden = true; }); });
    await wake(p); await p.waitForTimeout(300);
    await p.click('.tabbar [data-tab="guide"]'); await p.click('#mtSet'); await p.evaluate(() => { document.getElementById('privacyAcc').open = true; }); await theme(p);
    if (SHOTS) { await p.evaluate(() => document.getElementById('privacyAcc').scrollIntoView()); await p.waitForTimeout(300); await p.screenshot({ path: path.join(SHOTS, 'privacy1.png') }); }
    await p.click('#privStop'); await p.waitForTimeout(600);
    ok((await p.evaluate(() => __T.anQ().length)) === 0, '철회 시 미전송 이벤트 큐 삭제');
    const cw = an(log, 'axis_an_consent_put').at(-1); ok(cw && cw.body.p_items.analytics === false && cw.body.p_items.personal === false, '철회가 서버 동의 기록으로 전송(분석·하위 항목 모두 꺼짐)');
    await p.evaluate(() => __T.track('screen_open', { screen: 'log' })); ok((await p.evaluate(() => __T.anQ().length)) === 0, '철회 후 새 이벤트를 쌓지 않음');
    const callsBefore = anAll(log).length; await p.clock.runFor(30000); ok(anAll(log).length === callsBefore, '철회 후 재시도 큐에서도 전송하지 않음');
    ok(log.errors.length === 0, '오류 없음'); await b.close(); }

  // 7. 계정 전환: A의 대기 이벤트가 B로 전송되지 않음, 동의도 섞이지 않음
  { const aConsent = JSON.stringify({ v: 'test-1', items: { service: true, analytics: true, personal: true, health: true }, at: '2026-10-25T00:00:00Z', since: '2026-10-25', srv: '2026-10-25T00:00:00Z' });
    const aQ = JSON.stringify([{ id: 'aaaaaaaaaaaaaaaaaaaa', n: 'screen_open', p: { screen: 'today' }, t: '2026-10-26T09:00:00.000Z', d: '2026-10-26', z: 'Asia/Seoul', v: 1 }]);
    const { b, p, log } = await open(ON, { session: B, ls: { 'axis.consent.testkeyAAAA': aConsent, 'axis.q.testkeyAAAA': aQ } });
    await wake(p);
    ok(!(await p.$eval('#consent', (e) => e.hidden)), '다른 계정(B)은 A의 동의를 물려받지 않아 동의 화면이 나옴');
    ok(!(await p.evaluate(() => __T.anOn('analytics'))), 'B의 분석 동의는 꺼짐');
    await p.evaluate(() => __T.track('screen_open', { screen: 'log' })); await p.waitForTimeout(6500);
    ok(anAll(log).every((c) => c.body.p_key === 'testkeyBBBB') && an(log, 'axis_an_events_put').length === 0, 'B 세션에서 A의 대기 이벤트가 전송되지 않음');
    await p.evaluate(() => __T.logout('t')); await p.waitForTimeout(300);
    ok((await p.evaluate(() => localStorage.getItem('axis.q.testkeyAAAA'))) === aQ, 'A의 대기 데이터는 A 계정 몫으로만 남음');
    await b.close(); }

  // 8. 날짜별 요약: 구조화·분리·건강 동의·자유 텍스트 없음
  for (const health of [false, true]) {
    const { b, p, log } = await open(ON, { session: A, ls: { 'axis.consent.testkeyAAAA': JSON.stringify({ v: 'test-1', items: { service: true, analytics: true, personal: true, health }, at: '2026-10-25T00:00:00Z', since: '2026-10-25', srv: '2026-10-25T00:00:00Z' }) } });
    await wake(p);
    await p.evaluate(() => { const S = __T.S, t = S.today; S.days[t].sleepH = 7; S.days[t].cups = 5; S.days[t].meals = [{ id: 'm', at: '12:00', n: '비밀 식사 이름', kcal: 500, p: 30, c: 50, f: 10 }]; S.days[t].checks = { move: true, sleep: true }; S.days[t].bedAt = '00:30'; S.days[t].adj = { nsdr: { dt: 30 } };
      S.days[t].extra = [{ id: 'z1', t: '비밀 약속 제목', at: '15:00', to: '16:00', v: 2, shove: false }]; __T.anBuildSnap(t); });
    await p.waitForTimeout(6500);
    const sn = an(log, 'axis_an_snapshots_put'); const body = JSON.stringify(sn.map((c) => c.body));
    ok(sn.length >= 1, `요약 전송 (건강 동의 ${health})`);
    ok(!body.includes('비밀 약속 제목') && !body.includes('비밀 식사 이름'), `요약에 약속 제목·식사 이름 등 자유 텍스트 없음 (건강 ${health})`);
    const s0 = sn.at(-1).body.p_batch[0];
    ok(s0.plan && s0.actual && s0.plan.routines.length > 5 && s0.actual.done === 2 && s0.plan.appts.length === 1 && s0.plan.appts[0].len === 60, `계획과 실제를 분리해 저장 (건강 ${health})`);
    ok(s0.plan.routines.find((r) => r.id === 'nsdr').state === 'moved' && s0.plan.routines.find((r) => r.id === 'nsdr').src === 'user', `사용자 이동 상태·변경 출처 기록 (건강 ${health})`);
    ok(s0.actual.bed === 1470, `취침 00:30은 논리 하루 기준 1470분 (건강 ${health})`);
    ok(health ? (s0.health && s0.health.sleepH === 7 && s0.health.meals && s0.health.meals.n === 1) : s0.health === undefined, `건강 필드는 건강 동의가 있을 때만 포함 (건강 ${health})`);
    ok(Object.keys(s0.habits).every((k) => ['sleep', 'move', 'sun', 'food', 'bond', 'water', 'caff', 'dark'].includes(k)), `기본 습관 ID만 포함 (건강 ${health})`);
    // 동의 이전 날짜·오래된 날짜는 만들지 않음
    const old = await p.evaluate(() => { const S = __T.S, d = __T.shift(S.today, -3); S.days[d] = { date: d, wake: 7, checks: { move: true } }; __T.anBuildSnap(d); return Object.keys(__T.anSnaps()); });
    ok(old.length === 0, `동의 시작일 이전 날짜는 요약하지 않음(소급 없음) (건강 ${health})`);
    ok(log.errors.length === 0, '오류 없음'); await b.close();
  }

  // 9. 계획만 있는 미래 날짜: actual 없음(실패·수행으로 계산되지 않게)
  { const { b, p, log } = await open(ON, { session: A, ls: { 'axis.consent.testkeyAAAA': JSON.stringify({ v: 'test-1', items: { service: true, analytics: true, personal: false, health: false }, at: '2026-10-25T00:00:00Z', since: '2026-10-25', srv: '2026-10-25T00:00:00Z' }) } });
    await wake(p);
    await p.evaluate(() => { const t = __T.shift(__T.S.today, 1); __T.commitPlan(t, 'x', (d) => { d.adj = { nsdr: { dt: 20 } }; }); __T.anBuildSnap(t); });
    const sm = await p.evaluate(() => __T.anSnaps()); const k = Object.keys(sm)[0];
    ok(k && sm[k].plan && !sm[k].actual && !sm[k].habits, '계획만 작성한 미래 날짜는 계획만 담고 실제 기록·습관은 없음');
    await b.close(); }

  // 10. 동의 문서 버전 변경 시 재동의
  { const { b, p } = await open(ON, { session: A, ls: { 'axis.consent.testkeyAAAA': JSON.stringify({ v: 'OLD', items: { service: true, analytics: true, personal: true, health: true }, at: '2026-10-25T00:00:00Z', since: '2026-10-25', srv: 'x' }) } });
    await wake(p);
    ok(!(await p.$eval('#consent', (e) => e.hidden)), '문서 버전이 바뀌면 다시 동의 화면 표시');
    ok(!(await p.evaluate(() => __T.anOn('analytics'))), '새 버전 동의 전에는 기존 동의로 수집하지 않음');
    await b.close(); }

  // 11. 게스트는 어떤 분석도 보내지 않음
  { const { b, p, log } = await open(ON, { session: { guest: true } });
    await wake(p); await p.evaluate(() => __T.track('screen_open', { screen: 'today' })); await p.waitForTimeout(6500);
    ok(await p.$eval('#consent', (e) => e.hidden) && anAll(log).length === 0, '게스트: 동의 화면도 분석 전송도 없음');
    await b.close(); }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
