// 합성 데이터 생성기. 실제 사용자 데이터가 아니다. 같은 시드는 항상 같은 결과를 만든다.
import { dateAdd, dateRange } from './stats.mjs';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const HABITS = ['sleep', 'move', 'sun', 'food', 'bond', 'water', 'caff', 'dark'];
const ITEMS = ['water', 'sun1', 'move', 'deep1', 'meal1', 'sun2', 'nsdr', 'deep2', 'sun3', 'meal2', 'dim', 'sleep'];

export function makeSynthetic({ today = '2026-10-26', users = 36, days = 60, seed = 20261026 } = {}) {
  const r = rng(seed), rows = [], profiles = [], named = [], events = [];
  const start = dateAdd(today, -days + 1);
  for (let i = 0; i < users; i++) {
    const u = 'syn' + String(i).padStart(3, '0');
    const analytics = i % 6 !== 5, personal = analytics && i % 3 !== 2, health = analytics && i % 4 !== 3;
    const joinOffset = Math.floor(r() * (days - 10));
    const first = dateAdd(start, joinOffset);
    const wakeBase = 6 + r() * 3, bedBase = 22 * 60 + r() * 150, diligence = 0.35 + r() * 0.55, nightOwl = i % 9 === 0;
    profiles.push({ u, created: first + 'T03:00:00Z', last: dateAdd(today, -Math.floor(r() * 6)) + 'T10:00:00Z', login: i % 2 ? 'google' : 'nick', analytics, personal, health, deleted: false });
    if (personal) named.push({ u, name: (i % 2 ? '합성 ' : '테스터') + String(i).padStart(2, '0'), login: i % 2 ? 'google' : 'nick', created: first + 'T03:00:00Z', last: dateAdd(today, -Math.floor(r() * 6)) + 'T10:00:00Z', health });
    if (!analytics) continue;
    for (const d of dateRange(first, today)) {
      const roll = r();
      const future = d > today;
      if (roll < 0.15) continue;                                  // 그날 아무 것도 안 함(행 없음 = 기록 없음)
      const total = 8 + Math.floor(r() * 3), skipped = r() < 0.15 ? 1 + Math.floor(r() * 2) : 0;
      const plan = { wake_exp: Math.round(wakeBase * 4) / 4, st: r() < 0.7 ? 'saved' : 'auto',
        routines: ITEMS.slice(0, total).map((id) => ({ id, type: 'habit', start: 420 + Math.floor(r() * 600), len: 20 + Math.floor(r() * 40), fixed: false, state: r() < 0.12 ? 'moved' : r() < 0.06 ? 'skipped' : 'planned', src: 'auto' })), appts: r() < 0.2 ? [{ start: 840, len: 60 }] : [] };
      if (roll < 0.25 && d !== today) { rows.push({ u, d, tz: 'Asia/Seoul', plan, actual: null, habits: null, health: null, personal }); continue; }   // 계획만 있는 날
      const wake = wakeBase + (r() - 0.5) * 1.2 + (nightOwl ? 3 : 0), bed = Math.round(bedBase + (r() - 0.5) * 80 + (nightOwl ? 120 : 0));
      const done = Math.round((total - skipped) * Math.min(1, Math.max(0, diligence + (r() - 0.5) * 0.4)));
      const habits = Object.fromEntries(HABITS.map((h) => [h, r() < diligence]));
      const hl = health ? { sleepH: Math.round((6 + r() * 2.5) * 10) / 10, cups: Math.floor(r() * 12), wo: r() < 0.5 ? { sessions: 1, sets: 10 + Math.floor(r() * 10), volume: 2000 + Math.floor(r() * 4000) } : null, meals: r() < 0.6 ? { n: 2 + Math.floor(r() * 2), kcal: 1500 + Math.floor(r() * 900), p: 60 + Math.floor(r() * 60), c: 150, f: 50 } : null } : null;
      rows.push({ u, d, tz: 'Asia/Seoul', plan, actual: { wake: Math.round(wake * 100) / 100, bed, total, done, skipped }, habits, health: hl, personal });
      if (r() < 0.2) { events.push({ u, d, n: 'conflict_shown', c: 1 }); events.push({ u, d, n: r() < 0.6 ? 'conflict_accepted' : 'conflict_cancelled', c: 1 }); }
    }
  }
  return { today, rows, profiles, named, events };
}
