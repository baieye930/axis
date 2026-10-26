import test from 'node:test';
import assert from 'node:assert/strict';
import { circMean, circDiff, fmtClock, dayCompletion, isRecorded, overview, userList, userDetail, dateRange, dateAdd, MIN_USERS } from '../lib/stats.mjs';

const clk = (h, m = 0) => h * 60 + m;
const row = (u, d, a = {}, extra = {}) => ({ u, d, actual: { wake: 7, bed: 1380, total: 8, done: 4, skipped: 0, ...a }, ...extra });
const days = (from, n) => dateRange(from, dateAdd(from, n - 1));
const users = (n) => Array.from({ length: n }, (_, i) => 'u' + i);

test('시각 평균: 23:30과 00:30은 00:00 (일반 평균 12:00이 아님)', () => {
  const c = circMean([clk(23, 30), clk(0, 30)]);
  assert.equal(fmtClock(c.mean), '00:00');
  assert.ok(c.R > 0.9);
  assert.equal(fmtClock(circMean([clk(6, 30), clk(7, 30)]).mean), '07:00');
});
test('자정 이후 취침(1500분 = 01:00)도 원 위에서 계산', () => {
  assert.equal(fmtClock(circMean([clk(23), 1500]).mean), '00:00');   // 23:00 과 01:00
});
test('분산이 큰 시각은 평균의 한계를 표시', () => {
  const c = circMean([clk(0), clk(8), clk(16)]);
  assert.equal(c.scattered, true);
});
test('시각 차이는 자정을 넘어도 올바름', () => { assert.equal(circDiff(clk(0, 30), clk(23, 30)), 60); assert.equal(circDiff(clk(23, 30), clk(0, 30)), -60); });

test('일 완료율: 분모 = 유효한 루틴 − 제외, 분모 0이면 계산하지 않음', () => {
  assert.equal(dayCompletion(row('a', '2026-10-01', { total: 8, skipped: 2, done: 3 })), 0.5);
  assert.equal(dayCompletion(row('a', '2026-10-01', { total: 0, done: 0 })), null);
  assert.equal(dayCompletion(row('a', '2026-10-01', { total: 3, skipped: 3, done: 0 })), null);
  assert.equal(dayCompletion(row('a', '2026-10-01', { total: 4, done: 9 })), 1);
});
test('계획만 있는 날은 기록일이 아니다', () => {
  assert.equal(isRecorded({ u: 'a', d: 'x', plan: { wake_exp: 7 }, actual: null }), false);
  assert.equal(isRecorded({ u: 'a', d: 'x', plan: {}, actual: { total: 8, done: 0, skipped: 0 } }), false);   // 기상도 완료도 없음
  assert.equal(isRecorded(row('a', 'x')), true);
});

function build(nUsers, perUser) {
  const rows = [];
  users(nUsers).forEach((u, i) => days('2026-10-01', perUser(i).n).forEach((d) => rows.push(row(u, d, perUser(i).a))));
  return rows;
}
const base = { from: '2026-10-01', to: '2026-10-14', today: '2026-10-14' };

test('기본 지표(사용자 평균의 평균)와 가중 지표는 다른 값이며 이름이 구분됨', () => {
  // 5명: 4명은 3일 × (1/1 항목 완료=100%), 1명은 10일 × (0/10 완료=0%)
  const rows = [];
  for (let i = 0; i < 4; i++) days('2026-10-01', 3).forEach((d) => rows.push(row('f' + i, d, { total: 1, done: 1 })));
  days('2026-10-01', 10).forEach((d) => rows.push(row('heavy', d, { total: 10, done: 0 })));
  const o = overview({ rows, ...base });
  assert.equal(o.completion.rate, 0.8);                    // (1+1+1+1+0)/5
  assert.ok(o.completion_pooled.rate < 0.2 && o.completion_pooled.rate !== o.completion.rate);   // 12/112
  assert.notEqual(o.completion.def, o.completion_pooled.def);
});
test('소수 집단은 표시하지 않음(표본 5명 미만)', () => {
  const o = overview({ rows: build(MIN_USERS - 1, () => ({ n: 5, a: {} })), ...base });
  assert.equal(o.completion.suppressed, true);
  assert.equal(o.wake.suppressed, true);
  assert.equal(o.completion.n, MIN_USERS - 1);
});
test('기록일이 3일 미만인 사용자는 사용자 평균에서 제외', () => {
  const rows = build(5, () => ({ n: 3, a: { total: 4, done: 2 } }));
  days('2026-10-01', 2).forEach((d) => rows.push(row('few', d, { total: 4, done: 4 })));
  const o = overview({ rows, ...base });
  assert.equal(o.completion.n, 5);
  assert.equal(o.completion.rate, 0.5);
});
test('실제 기상·취침: 자정 전후 사용자 평균이 올바름', () => {
  const rows = [];
  users(5).forEach((u, i) => days('2026-10-01', 4).forEach((d) => rows.push(row(u, d, { wake: 7, bed: i % 2 ? clk(23, 30) : 1470 }))));   // 23:30 과 00:30 이 섞임
  const o = overview({ rows, ...base });
  assert.equal(o.wake.mean, '07:00');
  assert.ok(Math.abs(circDiff(o.bed.minutes, 0)) <= 60, 'bed mean ' + o.bed.mean);   // 23:30~00:30 사이
  assert.notEqual(o.bed.mean, '12:00');
});
test('중복 재전송 행은 통계를 늘리지 않음', () => {
  const rows = build(5, () => ({ n: 4, a: {} }));
  const dup = [...rows, ...rows, ...rows];
  assert.equal(overview({ rows: dup, ...base }).samples.recorded_user_days, 20);
});
test('계획만 있는 날은 완료율·누락률 분모에 들어가지 않음', () => {
  const rows = build(5, () => ({ n: 4, a: { total: 4, done: 2 } }));
  users(5).forEach((u) => days('2026-10-10', 4).forEach((d) => rows.push({ u, d, plan: { wake_exp: 7, routines: [{ id: 'move', state: 'planned' }] }, actual: null })));
  const o = overview({ rows, ...base });
  assert.equal(o.completion.rate, 0.5);
  assert.equal(o.samples.plan_only_user_days, 20);
  // 기록 4일 / (첫 기록 10-01 ~ 오늘 10-14 = 14일) → 누락률 = 1 - 4/14
  assert.ok(Math.abs(o.missing.rate - (1 - 4 / 14)) < 0.001);
});
test('미래 날짜는 누락으로 세지 않음', () => {
  const rows = build(5, () => ({ n: 4, a: {} }));
  const o = overview({ rows, from: '2026-10-01', to: '2026-10-31', today: '2026-10-07' });
  assert.ok(Math.abs(o.missing.rate - (1 - 4 / 7)) < 0.001);
  assert.equal(o.daily.at(-1).d, '2026-10-07');
});
test('기록 유지율(D7)', () => {
  const rows = [];
  users(6).forEach((u, i) => { rows.push(row(u, '2026-10-01')); if (i < 3) rows.push(row(u, '2026-10-09')); });   // 3명은 +8일에 다시 기록
  const o = overview({ rows, from: '2026-10-01', to: '2026-10-05', today: '2026-10-30' });
  assert.equal(o.retention_d7.rate, 0.5);
  assert.equal(o.retention_d7.n, 6);
});
test('충돌 수락 비율 = 수락/(수락+취소)', () => {
  const events = users(5).flatMap((u) => [{ u, d: '2026-10-02', n: 'conflict_shown', c: 2 }, { u, d: '2026-10-02', n: 'conflict_accepted', c: 1 }, { u, d: '2026-10-02', n: 'conflict_cancelled', c: 1 }]);
  const o = overview({ rows: build(5, () => ({ n: 3, a: {} })), events, ...base });
  assert.equal(o.conflicts.accept_rate, 0.5);
  assert.equal(o.conflicts.shown, 10);
});
test('수면은 건강 동의 행(health 있음)만 사용', () => {
  const rows = build(5, () => ({ n: 3, a: {} })).map((r, i) => (i % 3 === 0 ? { ...r, health: { sleepH: 7 } } : r));
  const o = overview({ rows, ...base });
  assert.equal(o.sleep_h.suppressed ? 'sup' : o.sleep_h.mean, 7);
});
test('사용자 목록·상세: 평균 시각과 계획 대비 실제', () => {
  const rows = [row('x', '2026-10-01', { wake: 24.5, bed: 1500 }, { plan: { wake_exp: 23.5, st: 'saved', routines: [{ id: 'move', state: 'moved' }] } }),
                row('x', '2026-10-02', { wake: 23.5, bed: 1380 }), { u: 'x', d: '2026-10-03', plan: { wake_exp: 7 }, actual: null }];
  const list = userList({ rows, named: [{ u: 'x', name: 'tester', login: 'nick', created: '2026-09-01', last: '2026-10-02', health: false }], from: '2026-10-01', to: '2026-10-03' });
  assert.equal(list[0].recorded_days, 2);
  assert.equal(list[0].wake, '00:00');
  const det = userDetail({ rows, from: '2026-10-01', to: '2026-10-04', today: '2026-10-04' });
  assert.deepEqual(det.map((x) => x.status), ['recorded', 'recorded', 'plan_only', 'none']);
  assert.equal(det[0].wake_diff_min, 60);
  assert.equal(det[0].plan.moved, 1);
  assert.equal(det[2].actual, undefined);
});
