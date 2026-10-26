-- AXIS 이용 분석·동의·운영자 조회 (초안)
--
-- 상태: 작성만 했고 어떤 서버에도 적용하지 않았다. 로컬 임시 Postgres에서만 검증했다(server/migrations/tests).
-- 운영 적용 전 반드시 docs/analytics/operations.md 의 "운영 전 확정 사항"을 채우고, 스테이징에서 먼저 실행한다.
--
-- 기존 axis_* 테이블·RPC의 구조는 이 저장소에 없어서 전제하지 않는다.
-- 이 파일은 새 스키마(axis_an)와 새 RPC만 만든다. 기존 객체는 읽지도 바꾸지도 않는다.
-- 닉네임 계정의 본인 확인은 기존 로그인 검증을 재사용해야 하므로, 아래 axis_an.verify_proof 한 곳만 기존 방식에 맞게 구현한다.

begin;

create schema if not exists axis_an;
revoke all on schema axis_an from public;

-- ---------------------------------------------------------------- 운영 설정 (값이 비어 있으면 수집 비활성)
create table axis_an.config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
comment on table axis_an.config is '운영자가 확정해야 하는 값. 필수 키가 모두 채워지고 collection_enabled=true 일 때만 수집한다.';

create function axis_an.cfg(k text) returns text language sql stable
as $$ select value from axis_an.config where key = k $$;

create function axis_an.collection_ready() returns boolean language sql stable
as $$
  select coalesce(axis_an.cfg('collection_enabled'), 'false') = 'true'
     and coalesce(axis_an.cfg('operator_name'), '') <> ''
     and coalesce(axis_an.cfg('contact'), '') <> ''
     and coalesce(axis_an.cfg('policy_version'), '') <> ''
     and coalesce(axis_an.cfg('retention_events_days'), '') <> ''
     and coalesce(axis_an.cfg('retention_snapshots_days'), '') <> ''
     and coalesce(axis_an.cfg('retention_consent_days'), '') <> ''
     and coalesce(axis_an.cfg('retention_audit_days'), '') <> ''
$$;

-- ---------------------------------------------------------------- 사용자 프로필(분석용 최소 정보)
-- user_ref 는 앱의 계정 키(닉네임 계정: 해시 키, Google 계정: 'g:<uid>')다. 이메일·비밀번호 값·토큰은 저장하지 않는다.
create table axis_an.profile (
  user_ref       text primary key,
  login_type     text not null check (login_type in ('nick', 'google')),
  nick           text,          -- 앱 닉네임(개인별 분석 동의가 있을 때만 채움)
  display_name   text,          -- Google 표시 이름(본인 확인된 실명이 아님. 동의가 있을 때만 채움)
  tz             text,
  created_at     timestamptz not null default now(),
  last_active_at timestamptz,
  deleted_at     timestamptz
);

-- ---------------------------------------------------------------- 동의(현재 상태 + 이력)
create table axis_an.consent (
  user_ref       text primary key,
  items          jsonb not null,       -- {"service":bool,"analytics":bool,"personal":bool,"health":bool}
  doc_version    text not null,
  effective_at   timestamptz not null, -- 서버 확인 시각 = 이 범위의 적용 시작 시점
  updated_at     timestamptz not null default now()
);
create table axis_an.consent_history (
  id           bigserial primary key,
  user_ref     text not null,
  items        jsonb not null,
  prev_items   jsonb,
  doc_version  text not null,
  recorded_at  timestamptz not null default now()   -- IP·기기 정보는 저장하지 않는다
);
create index on axis_an.consent_history (user_ref, recorded_at);

-- ---------------------------------------------------------------- 제품 이벤트(허용 목록)
create table axis_an.event_def (
  name  text primary key,
  props jsonb not null   -- {속성: {"t":"enum","v":[..]} | {"t":"bool"} | {"t":"int","min":0,"max":50}}
);
insert into axis_an.event_def(name, props) values
  ('screen_open',  '{"screen":{"t":"enum","v":["today","check","log","guide","wtoday","wweek","wlog","wdiet","wguide"]}}'),
  ('plan_save',    '{"kind":{"t":"enum","v":["today","future"]},"adj":{"t":"int","min":0,"max":60},"appts":{"t":"int","min":0,"max":20}}'),
  ('appt_add',     '{"repeat":{"t":"enum","v":["once","daily","weekdays","days"]}}'),
  ('appt_edit',    '{"repeat":{"t":"enum","v":["once","daily","weekdays","days"]}}'),
  ('appt_delete',  '{"repeat":{"t":"enum","v":["once","daily","weekdays","days"]}}'),
  ('conflict_shown',    '{"mode":{"t":"enum","v":["appt","backlog"]},"items":{"t":"int","min":0,"max":40},"hard":{"t":"bool"}}'),
  ('conflict_accepted', '{"mode":{"t":"enum","v":["appt","backlog"]},"moved":{"t":"int","min":0,"max":40},"skipped":{"t":"int","min":0,"max":40},"kept":{"t":"int","min":0,"max":40}}'),
  ('conflict_cancelled','{"mode":{"t":"enum","v":["appt","backlog"]}}'),
  ('routine_start','{"segment":{"t":"enum","v":["am","pm"]}}'),
  ('routine_done', '{"item":{"t":"enum","v":["water","sun1","move","shower","commute","deep1","hard","meal1","sun2","work","nsdr","deep2","light","sun3","home","meal2","read","plan","dim","screen","sleep","caff"]},"via":{"t":"enum","v":["timeline","now","run"]}}'),
  ('routine_skip', '{"item":{"t":"enum","v":["water","sun1","move","shower","commute","deep1","hard","meal1","sun2","work","nsdr","deep2","light","sun3","home","meal2","read","plan","dim","screen","sleep","caff"]}}'),
  ('notify_setting_change','{"setting":{"t":"enum","v":["screen_alert","lock_push","tone"]},"value":{"t":"enum","v":["on","off","soft","polite","brief"]}}'),
  ('record_save',  '{"ok":{"t":"bool"},"kind":{"t":"enum","v":["day","prefs"]},"reason":{"t":"enum","v":["none","network","auth","other"]}}');

create table axis_an.event (
  id          text primary key,            -- 클라이언트가 만든 이벤트 ID(재전송 중복 방지)
  user_ref    text not null,
  name        text not null references axis_an.event_def(name),
  props       jsonb not null default '{}',
  schema_v    int  not null default 1,
  occurred_at timestamptz not null,        -- 클라이언트 UTC 시각
  logical_date date not null,              -- 새벽 4시 경계 기준 앱 날짜
  tz          text,                        -- 사용자 시간대(IANA)
  received_at timestamptz not null default now()   -- 서버 수신 시각
);
create index on axis_an.event (user_ref, occurred_at);
create index on axis_an.event (received_at);

-- ---------------------------------------------------------------- 날짜별 요약(계획과 실제를 분리해서 저장)
create table axis_an.day_snapshot (
  user_ref     text not null,
  logical_date date not null,
  schema_v     int  not null default 1,
  tz           text,
  plan         jsonb,    -- 계획: 예상 기상, 루틴 ID·유형·계획 시간/길이·고정 여부·상태·변경 출처. 약속 제목은 없다.
  actual       jsonb,    -- 실제: 기상·취침, 루틴 완료/건너뜀/미기록, 완료 대상 수·완료 수
  habits       jsonb,    -- 기본 습관 ID별 완료 여부(사용자 정의 습관은 제외)
  health       jsonb,    -- 건강 관련(수면·컨디션·수분·운동·식사). 건강 동의가 있을 때만 저장
  scope        jsonb not null,   -- 저장 시점의 동의 범위 {"analytics":true,"personal":bool,"health":bool}
  recorded_at  timestamptz not null,       -- 클라이언트 기록 시각(UTC)
  received_at  timestamptz not null default now(),
  primary key (user_ref, logical_date)
);
create index on axis_an.day_snapshot (logical_date);

-- ---------------------------------------------------------------- 관리자 접근과 감사
create table axis_an.admin_user (
  admin_id uuid primary key,     -- 승인된 내부 사용자 ID(Supabase auth uid). 사용자가 바꿀 수 있는 메타데이터는 보지 않는다.
  label    text,
  active   boolean not null default true
);
create table axis_an.admin_audit (
  id        bigserial primary key,
  admin_id  uuid,
  at        timestamptz not null default now(),
  action    text not null,
  scope     jsonb not null default '{}',   -- 기간·대상 축약 ID·행 수만. 개인 기록 본문과 인증값은 넣지 않는다.
  result    text not null check (result in ('ok', 'denied', 'error'))
);

-- 접근 차단: 모든 테이블 RLS를 켜고 정책을 만들지 않는다. 읽기·쓰기는 아래 SECURITY DEFINER 함수로만 한다.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'axis_an' loop
    execute format('alter table axis_an.%I enable row level security', t);
    execute format('revoke all on axis_an.%I from public', t);
  end loop;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema axis_an from anon;
    revoke all on all sequences in schema axis_an from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema axis_an from authenticated;
    revoke all on all sequences in schema axis_an from authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------- 본인 확인
-- Google 계정: 앱이 보낸 키 'g:<uid>' 가 로그인 세션의 uid와 같아야 한다.
-- 닉네임 계정: 기존 로그인(axis_login 이 쓰는 PBKDF2 증명) 검증을 여기서 호출해야 한다. 그 함수의 이름과 시그니처는
-- 이 저장소에서 확인할 수 없으므로 아래 본문을 서버의 실제 검증으로 바꾸기 전까지 닉네임 계정은 거부된다.
create function axis_an.verify_proof(p_key text, p_proof text) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
begin
  raise exception 'axis_an.verify_proof 를 기존 닉네임 로그인 검증에 연결해야 합니다' using errcode = '0A000';
end $$;

create function axis_an.caller_ref(p_key text, p_proof text) returns text
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
begin
  if p_key is null or length(p_key) < 3 or length(p_key) > 100 then
    raise exception 'invalid key' using errcode = '28000';
  end if;
  if left(p_key, 2) = 'g:' then
    if auth.uid() is null or ('g:' || auth.uid()::text) <> p_key then
      raise exception 'not allowed' using errcode = '28000';
    end if;
    return p_key;
  end if;
  if not axis_an.verify_proof(p_key, p_proof) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return p_key;
end $$;

-- ---------------------------------------------------------------- 입력 검증
-- 문자열 값은 식별자·열거형·날짜·시각 형식만 허용한다(공백·한글·긴 문자열 = 자유 텍스트 → 거부).
create function axis_an.json_clean(j jsonb) returns boolean language plpgsql immutable
as $$
declare v jsonb;
begin
  case jsonb_typeof(j)
    when 'string' then return (j #>> '{}') ~ '^[A-Za-z0-9_:+./-]{1,40}$';
    when 'object' then
      for v in select value from jsonb_each(j) loop
        if not axis_an.json_clean(v) then return false; end if;
      end loop;
      return not exists (select 1 from jsonb_object_keys(j) k where k !~ '^[A-Za-z0-9_]{1,24}$');
    when 'array' then
      for v in select value from jsonb_array_elements(j) loop
        if not axis_an.json_clean(v) then return false; end if;
      end loop;
      return jsonb_array_length(j) <= 60;
    else return true;
  end case;
end $$;

create function axis_an.valid_event(p_name text, p_props jsonb) returns boolean language plpgsql stable
as $$
declare d jsonb; k text; spec jsonb; val jsonb;
begin
  select props into d from axis_an.event_def where name = p_name;
  if d is null or jsonb_typeof(p_props) <> 'object' then return false; end if;
  for k, val in select key, value from jsonb_each(p_props) loop
    spec := d -> k;
    if spec is null then return false; end if;
    case spec ->> 't'
      when 'enum' then
        if jsonb_typeof(val) <> 'string' or not (spec -> 'v') @> to_jsonb(val #>> '{}') then return false; end if;
      when 'bool' then
        if jsonb_typeof(val) <> 'boolean' then return false; end if;
      when 'int' then
        if jsonb_typeof(val) <> 'number' or (val #>> '{}') !~ '^[0-9]+$'
           or (val #>> '{}')::int < (spec ->> 'min')::int or (val #>> '{}')::int > (spec ->> 'max')::int then return false; end if;
      else return false;
    end case;
  end loop;
  return true;
end $$;

-- ---------------------------------------------------------------- 사용자 RPC: 동의 기록
-- p_items: {"service":bool,"analytics":bool,"personal":bool,"health":bool}
create function public.axis_an_consent_put(p_key text, p_proof text, p_items jsonb, p_doc_version text,
                                           p_nick text default null, p_display text default null, p_tz text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare ref text; cur jsonb; nw jsonb; ver text;
begin
  ref := axis_an.caller_ref(p_key, p_proof);
  if not axis_an.collection_ready() then
    return jsonb_build_object('ok', false, 'error', 'not_ready');   -- 운영 정보가 채워지기 전에는 동의도 서버에 기록하지 않는다
  end if;
  ver := axis_an.cfg('policy_version');
  if p_doc_version is distinct from ver then
    return jsonb_build_object('ok', false, 'error', 'version_mismatch', 'policy_version', ver);
  end if;
  if jsonb_typeof(p_items) <> 'object' or exists (select 1 from jsonb_each(p_items) e where e.key not in ('service','analytics','personal','health') or jsonb_typeof(e.value) <> 'boolean') then
    return jsonb_build_object('ok', false, 'error', 'bad_items');
  end if;
  nw := jsonb_build_object('service', coalesce((p_items->>'service')::boolean, false), 'analytics', coalesce((p_items->>'analytics')::boolean, false),
                           'personal', coalesce((p_items->>'personal')::boolean, false), 'health', coalesce((p_items->>'health')::boolean, false));
  -- 하위 항목은 분석 동의 없이 켜질 수 없다
  if not (nw->>'analytics')::boolean then nw := nw || '{"personal":false,"health":false}'; end if;
  select items into cur from axis_an.consent where user_ref = ref;
  insert into axis_an.profile(user_ref, login_type, tz) values (ref, case when left(ref,2)='g:' then 'google' else 'nick' end, left(p_tz, 40))
    on conflict (user_ref) do update set tz = coalesce(excluded.tz, axis_an.profile.tz), deleted_at = null;
  insert into axis_an.consent(user_ref, items, doc_version, effective_at) values (ref, nw, ver, now())
    on conflict (user_ref) do update set items = excluded.items, doc_version = excluded.doc_version,
      effective_at = case when axis_an.consent.items is distinct from excluded.items then now() else axis_an.consent.effective_at end,
      updated_at = now();
  if cur is distinct from nw then
    insert into axis_an.consent_history(user_ref, items, prev_items, doc_version) values (ref, nw, cur, ver);
  end if;
  -- 이름 필드는 개인별 분석 동의가 있을 때만 보관한다
  update axis_an.profile set
      nick = case when (nw->>'personal')::boolean then left(p_nick, 20) else null end,
      display_name = case when (nw->>'personal')::boolean then left(p_display, 20) else null end
    where user_ref = ref;
  -- 철회 처리: 정책은 docs/analytics/data-model.md
  if not (nw->>'analytics')::boolean then
    delete from axis_an.event where user_ref = ref;
    delete from axis_an.day_snapshot where user_ref = ref;
  elsif not (nw->>'health')::boolean then
    update axis_an.day_snapshot set health = null, scope = scope || '{"health":false}' where user_ref = ref and health is not null;
  end if;
  return jsonb_build_object('ok', true, 'items', nw, 'effective_at', now());
end $$;

-- 현재 동의 상태 조회(본인)
create function public.axis_an_consent_get(p_key text, p_proof text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare ref text; c record;
begin
  ref := axis_an.caller_ref(p_key, p_proof);
  select items, doc_version, effective_at into c from axis_an.consent where user_ref = ref;
  return jsonb_build_object('ok', true, 'ready', axis_an.collection_ready(), 'policy_version', axis_an.cfg('policy_version'),
                            'items', c.items, 'doc_version', c.doc_version, 'effective_at', c.effective_at);
end $$;

-- ---------------------------------------------------------------- 사용자 RPC: 이벤트 수집
create function public.axis_an_events_put(p_key text, p_proof text, p_batch jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare ref text; c jsonb; e jsonb; n_ok int := 0; n_dup int := 0; n_bad int := 0; ins int;
begin
  ref := axis_an.caller_ref(p_key, p_proof);
  if jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) > 50 or pg_column_size(p_batch) > 32768 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  if not axis_an.collection_ready() then return jsonb_build_object('ok', false, 'error', 'not_ready'); end if;
  select items into c from axis_an.consent where user_ref = ref;
  if c is null or not coalesce((c->>'analytics')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'no_consent'); end if;
  for e in select value from jsonb_array_elements(p_batch) loop
    begin
      if jsonb_typeof(e) <> 'object' or coalesce(e->>'id','') !~ '^[A-Za-z0-9_-]{8,40}$'
         or not axis_an.valid_event(e->>'n', coalesce(e->'p','{}'::jsonb))
         or (e->>'t')::timestamptz is null or (e->>'d')::date is null
         or (e->>'t')::timestamptz < (select effective_at from axis_an.consent where user_ref = ref) then   -- 동의 시작 이전 이벤트는 받지 않는다
        n_bad := n_bad + 1; continue;
      end if;
      insert into axis_an.event(id, user_ref, name, props, schema_v, occurred_at, logical_date, tz)
        values (ref || ':' || (e->>'id'), ref, e->>'n', coalesce(e->'p','{}'::jsonb), coalesce((e->>'v')::int, 1),
                (e->>'t')::timestamptz, (e->>'d')::date, left(e->>'z', 40))
        on conflict (id) do nothing;
      get diagnostics ins = row_count;
      if ins = 1 then n_ok := n_ok + 1; else n_dup := n_dup + 1; end if;
    exception when others then n_bad := n_bad + 1;
    end;
  end loop;
  update axis_an.profile set last_active_at = now() where user_ref = ref and (last_active_at is null or last_active_at < now() - interval '10 minutes');
  return jsonb_build_object('ok', true, 'accepted', n_ok, 'duplicate', n_dup, 'rejected', n_bad);
end $$;

-- ---------------------------------------------------------------- 사용자 RPC: 날짜별 요약
create function public.axis_an_snapshots_put(p_key text, p_proof text, p_batch jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare ref text; c record; s jsonb; n_ok int := 0; n_bad int := 0; hl jsonb; cd date; eff date;
begin
  ref := axis_an.caller_ref(p_key, p_proof);
  if jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) > 14 or pg_column_size(p_batch) > 65536 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  if not axis_an.collection_ready() then return jsonb_build_object('ok', false, 'error', 'not_ready'); end if;
  select items, effective_at into c from axis_an.consent where user_ref = ref;
  if c.items is null or not coalesce((c.items->>'analytics')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'no_consent'); end if;
  eff := (c.effective_at at time zone coalesce((select tz from axis_an.profile where user_ref = ref), 'UTC'))::date;
  for s in select value from jsonb_array_elements(p_batch) loop
    begin
      cd := (s->>'d')::date;
      -- 동의 이전 날짜는 받지 않는다(과거 기록을 소급해서 분석하지 않는다)
      if jsonb_typeof(s) <> 'object' or cd is null or cd < eff or cd > current_date + 1
         or not axis_an.json_clean(s - 'rec') or (s->>'rec')::timestamptz is null
         or exists (select 1 from jsonb_object_keys(s) k where k not in ('d','v','tz','rec','plan','actual','habits','health')) then
        n_bad := n_bad + 1; continue;
      end if;
      hl := case when coalesce((c.items->>'health')::boolean, false) then s->'health' else null end;
      insert into axis_an.day_snapshot(user_ref, logical_date, schema_v, tz, plan, actual, habits, health, scope, recorded_at)
        values (ref, cd, coalesce((s->>'v')::int, 1), left(s->>'tz', 40), s->'plan', s->'actual', s->'habits', hl,
                jsonb_build_object('analytics', true, 'personal', coalesce((c.items->>'personal')::boolean, false), 'health', coalesce((c.items->>'health')::boolean, false)),
                (s->>'rec')::timestamptz)
        on conflict (user_ref, logical_date) do update set
          schema_v = excluded.schema_v, tz = excluded.tz,
          -- 이미 지난 날짜의 계획은 바꾸지 않는다(과거 계획 변경이 실제 기록을 덮어쓰지 않게 한다)
          plan = case when axis_an.day_snapshot.logical_date < (now() at time zone coalesce(excluded.tz,'UTC'))::date - 1 then axis_an.day_snapshot.plan else excluded.plan end,
          actual = excluded.actual, habits = excluded.habits, health = excluded.health, scope = excluded.scope, recorded_at = excluded.recorded_at, received_at = now()
        where axis_an.day_snapshot.recorded_at <= excluded.recorded_at;     -- 오래된 재전송이 최신 값을 덮지 않는다
      n_ok := n_ok + 1;
    exception when others then n_bad := n_bad + 1;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'accepted', n_ok, 'rejected', n_bad);
end $$;

-- ---------------------------------------------------------------- 계정 삭제 연결 지점
-- 기존 삭제 RPC(axis_delete_account / axis_g_delete_account)가 호출하거나, 앱이 삭제 직전에 호출한다.
create function axis_an.purge_user(p_ref text) returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  delete from axis_an.event where user_ref = p_ref;
  delete from axis_an.day_snapshot where user_ref = p_ref;
  delete from axis_an.consent where user_ref = p_ref;
  update axis_an.profile set nick = null, display_name = null, tz = null, deleted_at = now() where user_ref = p_ref;
  -- 동의 이력은 동의 사실의 증명을 위해 최소 정보(항목·버전·시각)만 보존기간(retention_consent_days) 동안 둔다. 보존기간이 지나면 run_retention 이 지운다.
end $$;
create function public.axis_an_purge(p_key text, p_proof text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare ref text;
begin
  ref := axis_an.caller_ref(p_key, p_proof);
  perform axis_an.purge_user(ref);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- 운영자 읽기 RPC
create function axis_an.is_admin() returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$ select auth.uid() is not null and exists (select 1 from axis_an.admin_user where admin_id = auth.uid() and active) $$;

create function axis_an.audit(p_action text, p_scope jsonb, p_result text) returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$ begin insert into axis_an.admin_audit(admin_id, action, scope, result) values (auth.uid(), p_action, coalesce(p_scope,'{}'::jsonb), p_result); end $$;

-- 전체 집계용: 분석 동의 사용자의 날짜별 요약. 이름·식별 정보 없음(사용자는 축약 가명 ID). 건강 항목은 건강 동의가 있는 행만.
create function public.axis_admin_days(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare r jsonb;
begin
  if not axis_an.is_admin() then perform axis_an.audit('days', jsonb_build_object('from', p_from, 'to', p_to), 'denied'); return jsonb_build_object('error', 'denied'); end if;
  if p_to - p_from > 400 then raise exception 'range too large'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'u', left(md5(s.user_ref || coalesce(axis_an.cfg('pseudonym_salt'), '')), 10), 'd', s.logical_date, 'tz', s.tz,
      'plan', s.plan, 'actual', s.actual, 'habits', s.habits,
      'health', case when (s.scope->>'health')::boolean then s.health else null end,
      'personal', (s.scope->>'personal')::boolean)), '[]'::jsonb)
    into r
    from axis_an.day_snapshot s join axis_an.consent c on c.user_ref = s.user_ref
   where s.logical_date between p_from and p_to and (c.items->>'analytics')::boolean;
  perform axis_an.audit('days', jsonb_build_object('from', p_from, 'to', p_to, 'rows', jsonb_array_length(r)), 'ok');
  return r;
end $$;

-- 가입·활동 통계용 프로필(이름 없음)
create function public.axis_admin_profiles() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare r jsonb;
begin
  if not axis_an.is_admin() then perform axis_an.audit('profiles', '{}', 'denied'); return jsonb_build_object('error', 'denied'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'u', left(md5(p.user_ref || coalesce(axis_an.cfg('pseudonym_salt'), '')), 10), 'created', p.created_at, 'last', p.last_active_at,
      'login', p.login_type, 'analytics', coalesce((c.items->>'analytics')::boolean, false), 'personal', coalesce((c.items->>'personal')::boolean, false),
      'health', coalesce((c.items->>'health')::boolean, false), 'deleted', p.deleted_at is not null)), '[]'::jsonb)
    into r from axis_an.profile p left join axis_an.consent c on c.user_ref = p.user_ref;
  perform axis_an.audit('profiles', jsonb_build_object('rows', jsonb_array_length(r)), 'ok');
  return r;
end $$;

-- 이름과 연결된 사용자 목록: 개인별 분석 동의가 있는 사용자만. 이메일은 포함하지 않는다.
create function public.axis_admin_named_users() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare r jsonb;
begin
  if not axis_an.is_admin() then perform axis_an.audit('named_users', '{}', 'denied'); return jsonb_build_object('error', 'denied'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'u', left(md5(p.user_ref || coalesce(axis_an.cfg('pseudonym_salt'), '')), 10), 'name', coalesce(p.display_name, p.nick), 'login', p.login_type,
      'created', p.created_at, 'last', p.last_active_at, 'health', (c.items->>'health')::boolean)), '[]'::jsonb)
    into r from axis_an.profile p join axis_an.consent c on c.user_ref = p.user_ref
   where (c.items->>'analytics')::boolean and (c.items->>'personal')::boolean and p.deleted_at is null;
  perform axis_an.audit('named_users', jsonb_build_object('rows', jsonb_array_length(r)), 'ok');
  return r;
end $$;

-- 사용자 상세: 가명 ID(위 목록의 u)로 조회. 개인별 분석 동의가 없으면 빈 결과.
create function public.axis_admin_user_days(p_u text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare r jsonb; ref text;
begin
  if not axis_an.is_admin() then perform axis_an.audit('user_days', jsonb_build_object('u', left(p_u, 10)), 'denied'); return jsonb_build_object('error', 'denied'); end if;
  if p_to - p_from > 400 then raise exception 'range too large'; end if;
  select c.user_ref into ref from axis_an.consent c
   where left(md5(c.user_ref || coalesce(axis_an.cfg('pseudonym_salt'), '')), 10) = p_u and (c.items->>'analytics')::boolean and (c.items->>'personal')::boolean;
  if ref is null then perform axis_an.audit('user_days', jsonb_build_object('u', left(p_u, 10), 'rows', 0), 'ok'); return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('d', s.logical_date, 'plan', s.plan, 'actual', s.actual, 'habits', s.habits,
      'health', case when (s.scope->>'health')::boolean then s.health else null end) order by s.logical_date), '[]'::jsonb)
    into r from axis_an.day_snapshot s where s.user_ref = ref and s.logical_date between p_from and p_to;
  perform axis_an.audit('user_days', jsonb_build_object('u', left(p_u, 10), 'from', p_from, 'to', p_to, 'rows', jsonb_array_length(r)), 'ok');
  return r;
end $$;


-- 제품 이벤트 집계: (가명 사용자, 날짜, 이벤트 이름)별 횟수만 돌려준다. 이벤트 속성은 노출하지 않는다.
create function public.axis_admin_events(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare r jsonb;
begin
  if not axis_an.is_admin() then perform axis_an.audit('events', jsonb_build_object('from', p_from, 'to', p_to), 'denied'); return jsonb_build_object('error', 'denied'); end if;
  if p_to - p_from > 400 then raise exception 'range too large'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('u', g.u, 'd', g.d, 'n', g.name, 'c', g.c)), '[]'::jsonb) into r from (
    select left(md5(e.user_ref || coalesce(axis_an.cfg('pseudonym_salt'), '')), 10) as u, e.logical_date as d, e.name, count(*) as c
      from axis_an.event e join axis_an.consent c on c.user_ref = e.user_ref
     where e.logical_date between p_from and p_to and (c.items->>'analytics')::boolean
     group by 1, 2, 3) g;
  perform axis_an.audit('events', jsonb_build_object('from', p_from, 'to', p_to, 'rows', jsonb_array_length(r)), 'ok');
  return r;
end $$;

-- ---------------------------------------------------------------- 보존기간 정리 (운영 데이터 대상 실행은 승인 후)
create function axis_an.run_retention(p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare ev int; sn int; au int; ch int; pr int;
begin
  if not axis_an.collection_ready() then return jsonb_build_object('skipped', 'not_ready'); end if;
  select count(*) into ev from axis_an.event where received_at < now() - (axis_an.cfg('retention_events_days') || ' days')::interval;
  select count(*) into sn from axis_an.day_snapshot where received_at < now() - (axis_an.cfg('retention_snapshots_days') || ' days')::interval;
  select count(*) into au from axis_an.admin_audit where at < now() - (axis_an.cfg('retention_audit_days') || ' days')::interval;
  select count(*) into ch from axis_an.consent_history h where h.recorded_at < now() - (axis_an.cfg('retention_consent_days') || ' days')::interval
     and not exists (select 1 from axis_an.consent c where c.user_ref = h.user_ref);       -- 현재 유효한 동의가 있는 사용자의 이력은 지우지 않는다
  select count(*) into pr from axis_an.profile p where p.deleted_at is not null and p.deleted_at < now() - (axis_an.cfg('retention_consent_days') || ' days')::interval;
  if not p_dry_run then
    delete from axis_an.event where received_at < now() - (axis_an.cfg('retention_events_days') || ' days')::interval;
    delete from axis_an.day_snapshot where received_at < now() - (axis_an.cfg('retention_snapshots_days') || ' days')::interval;
    delete from axis_an.admin_audit where at < now() - (axis_an.cfg('retention_audit_days') || ' days')::interval;
    delete from axis_an.consent_history h where h.recorded_at < now() - (axis_an.cfg('retention_consent_days') || ' days')::interval
       and not exists (select 1 from axis_an.consent c where c.user_ref = h.user_ref);
    delete from axis_an.profile p where p.deleted_at is not null and p.deleted_at < now() - (axis_an.cfg('retention_consent_days') || ' days')::interval;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'events', ev, 'snapshots', sn, 'audit', au, 'consent_history', ch, 'profiles', pr);
end $$;

-- ---------------------------------------------------------------- 실행 권한
-- 기본 PUBLIC 실행 권한을 끄고 필요한 역할에만 준다.
revoke all on function public.axis_an_consent_put(text,text,jsonb,text,text,text,text) from public;
revoke all on function public.axis_an_consent_get(text,text) from public;
revoke all on function public.axis_an_events_put(text,text,jsonb) from public;
revoke all on function public.axis_an_snapshots_put(text,text,jsonb) from public;
revoke all on function public.axis_an_purge(text,text) from public;
revoke all on function public.axis_admin_days(date,date) from public;
revoke all on function public.axis_admin_profiles() from public;
revoke all on function public.axis_admin_named_users() from public;
revoke all on function public.axis_admin_user_days(text,date,date) from public;
revoke all on function public.axis_admin_events(date,date) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.axis_an_consent_put(text,text,jsonb,text,text,text,text) to anon;
    grant execute on function public.axis_an_consent_get(text,text) to anon;
    grant execute on function public.axis_an_events_put(text,text,jsonb) to anon;
    grant execute on function public.axis_an_snapshots_put(text,text,jsonb) to anon;
    grant execute on function public.axis_an_purge(text,text) to anon;   -- 닉네임 계정은 anon 키 + 증명으로 호출한다
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.axis_an_consent_put(text,text,jsonb,text,text,text,text) to authenticated;
    grant execute on function public.axis_an_consent_get(text,text) to authenticated;
    grant execute on function public.axis_an_events_put(text,text,jsonb) to authenticated;
    grant execute on function public.axis_an_snapshots_put(text,text,jsonb) to authenticated;
    grant execute on function public.axis_an_purge(text,text) to authenticated;
    -- 운영자 RPC는 로그인한 계정만 호출할 수 있고, 함수 안에서 admin_user 목록으로 다시 검사한다. anon 에는 주지 않는다.
    grant execute on function public.axis_admin_days(date,date) to authenticated;
    grant execute on function public.axis_admin_profiles() to authenticated;
    grant execute on function public.axis_admin_named_users() to authenticated;
    grant execute on function public.axis_admin_user_days(text,date,date) to authenticated;
    grant execute on function public.axis_admin_events(date,date) to authenticated;
  end if;
end $$;

commit;
