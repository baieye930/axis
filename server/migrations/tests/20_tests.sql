\set ON_ERROR_STOP on
-- 단언 도우미
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'PASS: %', msg; end $$;

-- 0. 운영 정보가 비어 있으면 수집이 막힌다
set role anon;
select pg_temp.ok((public.axis_an_consent_put('nickA','proofA','{"analytics":true}','v1')->>'error') = 'not_ready', '운영 설정 전에는 동의 기록도 거절(not_ready)');
select pg_temp.ok((public.axis_an_events_put('nickA','proofA','[]')->>'error') = 'not_ready', '운영 설정 전에는 이벤트 수집 거절');
reset role;

-- 운영 설정 채우기(합성 값)
insert into axis_an.config(key,value) values
 ('collection_enabled','true'),('operator_name','TEST'),('contact','test@example.invalid'),('policy_version','v1'),
 ('retention_events_days','365'),('retention_snapshots_days','365'),('retention_consent_days','1095'),('retention_audit_days','730'),('pseudonym_salt','salt');

-- 1. 인증: 잘못된 증명, 타인 키, Google uid 불일치
set role anon;
do $$ begin
  begin perform public.axis_an_consent_put('nickA','WRONG','{"analytics":true}','v1'); raise exception 'FAIL: 잘못된 증명 허용'; exception when sqlstate '28000' then raise notice 'PASS: 잘못된 증명 거부'; end;
  begin perform public.axis_an_events_put('g:11111111-1111-1111-1111-111111111111',null,'[]'); raise exception 'FAIL: 세션 없이 google 키 허용'; exception when sqlstate '28000' then raise notice 'PASS: 세션 없는 google 키 거부'; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  begin perform public.axis_an_events_put('g:11111111-1111-1111-1111-111111111111',null,'[]'); raise exception 'FAIL: 타인 google 키 허용'; exception when sqlstate '28000' then raise notice 'PASS: 다른 uid의 google 키 거부'; end;
end $$;
reset role; reset request.jwt.claim.sub;

-- 2. 동의 전 이벤트 거절, 동의 후 허용
set role anon;
select pg_temp.ok((public.axis_an_events_put('nickA','proofA','[{"id":"evt-00000001","n":"screen_open","p":{"screen":"today"},"t":"2026-10-26T01:00:00Z","d":"2026-10-26","z":"Asia/Seoul"}]')->>'error') = 'no_consent', '동의 전 이벤트 거절');
select pg_temp.ok((public.axis_an_consent_put('nickA','proofA','{"service":true,"analytics":true,"personal":false,"health":false}','OLD')->>'error') = 'version_mismatch', '문서 버전이 다르면 동의 거절');
select pg_temp.ok((public.axis_an_consent_put('nickA','proofA','{"service":true,"analytics":true,"personal":true,"health":false}','v1','닉A',null,'Asia/Seoul')->>'ok')::boolean, '동의 저장(analytics+personal)');
reset role;
select pg_temp.ok((select (items->>'personal')::boolean from axis_an.consent where user_ref='nickA'), '동의 현재 상태 저장');
select pg_temp.ok((select count(*) from axis_an.consent_history where user_ref='nickA') = 1, '동의 이력 1건');
select pg_temp.ok((select nick from axis_an.profile where user_ref='nickA') = '닉A', '개인별 분석 동의 시 닉네임 보관');
update axis_an.consent set effective_at = '2026-10-20T00:00:00Z' where user_ref='nickA';   -- 테스트용: 동의 시작을 과거로

set role anon;
-- 3. 이벤트: 허용 목록, 자유 텍스트 거부, 중복 방지, 크기 제한
select pg_temp.ok((public.axis_an_events_put('nickA','proofA','[{"id":"evt-00000001","n":"screen_open","p":{"screen":"today"},"t":"2026-10-26T01:00:00Z","d":"2026-10-26","z":"Asia/Seoul"}]')->>'accepted')::int = 1, '허용 이벤트 저장');
select pg_temp.ok((public.axis_an_events_put('nickA','proofA','[{"id":"evt-00000001","n":"screen_open","p":{"screen":"today"},"t":"2026-10-26T01:00:00Z","d":"2026-10-26","z":"Asia/Seoul"}]')->>'duplicate')::int = 1, '재전송 이벤트는 중복으로 처리(행 수 불변)');
select pg_temp.ok((public.axis_an_events_put('nickA','proofA','[{"id":"evt-00000002","n":"screen_open","p":{"screen":"today","memo":"hello"},"t":"2026-10-26T01:00:00Z","d":"2026-10-26"}]')->>'rejected')::int = 1, '허용되지 않은 속성 거부');
select pg_temp.ok((public.axis_an_events_put('nickA','proofA','[{"id":"evt-00000003","n":"appt_add","p":{"repeat":"병원 가기"},"t":"2026-10-26T01:00:00Z","d":"2026-10-26"}]')->>'rejected')::int = 1, '자유 텍스트 값 거부');
select pg_temp.ok((public.axis_an_events_put('nickA','proofA','[{"id":"evt-00000004","n":"click_anything","p":{},"t":"2026-10-26T01:00:00Z","d":"2026-10-26"}]')->>'rejected')::int = 1, '허용 목록에 없는 이벤트 거부');
select pg_temp.ok((public.axis_an_events_put('nickA','proofA','[{"id":"evt-00000005","n":"screen_open","p":{"screen":"today"},"t":"2026-10-10T01:00:00Z","d":"2026-10-10"}]')->>'rejected')::int = 1, '동의 시작 이전 이벤트 거부');
select pg_temp.ok((public.axis_an_events_put('nickA','proofA',(select jsonb_agg(jsonb_build_object('id','evt-1000'||g,'n','screen_open','p','{}'::jsonb,'t','2026-10-26T01:00:00Z','d','2026-10-26')) from generate_series(1,60) g))->>'error') = 'too_large', '배치 50건 초과 거부');
-- 4. 직접 테이블 접근 차단
do $$ begin
  begin perform count(*) from axis_an.event; raise exception 'FAIL: anon 이 event 테이블을 읽음'; exception when insufficient_privilege then raise notice 'PASS: anon 은 axis_an 테이블을 직접 읽을 수 없음'; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  begin perform count(*) from axis_an.day_snapshot; raise exception 'FAIL: authenticated 가 snapshot 을 읽음'; exception when insufficient_privilege then raise notice 'PASS: 로그인 사용자도 axis_an 테이블을 직접 읽을 수 없음'; end;
  if (public.axis_admin_days('2026-10-01','2026-10-31')->>'error') is distinct from 'denied' then raise exception 'FAIL: 일반 사용자가 관리자 RPC 호출'; end if;
  raise notice 'PASS: 일반 로그인 사용자의 관리자 RPC 거부(denied)';
end $$;
reset role; reset request.jwt.claim.sub;
set role anon;
do $$ begin
  begin perform public.axis_admin_profiles(); raise exception 'FAIL: anon 관리자 RPC'; exception when insufficient_privilege then raise notice 'PASS: anon 은 관리자 RPC 실행 권한 없음'; end;
end $$;
reset role;
select pg_temp.ok((select count(*) from axis_an.admin_audit where result='denied') = 1, '거부된 관리자 조회가 감사 기록에 남음');

-- 5. 날짜별 요약: 건강 동의 없으면 health 제거, 소급 거부, 과거 계획 불변
set role anon;
select pg_temp.ok((public.axis_an_snapshots_put('nickA','proofA','[{"d":"2026-10-26","v":1,"tz":"Asia/Seoul","rec":"2026-10-26T01:00:00Z","plan":{"wake_exp":7.5,"st":"saved","routines":[{"id":"move","type":"habit","start":460,"len":50,"fixed":false,"state":"planned","src":"auto"}],"appts":[{"start":900,"len":30}]},"actual":{"wake":7.2,"bed":1390,"total":8,"done":5},"habits":{"sleep":true,"move":false},"health":{"sleepH":7,"cups":9}}]')->>'accepted')::int = 1, '요약 저장');
select pg_temp.ok((public.axis_an_snapshots_put('nickA','proofA','[{"d":"2026-10-10","rec":"2026-10-26T01:00:00Z","actual":{"wake":7}}]')->>'rejected')::int = 1, '동의 시작 이전 날짜 요약 거부(소급 분석 없음)');
select pg_temp.ok((public.axis_an_snapshots_put('nickA','proofA','[{"d":"2026-10-26","rec":"2026-10-26T02:00:00Z","plan":{"note":"병원 3시 약속"}}]')->>'rejected')::int = 1, '요약의 자유 텍스트 거부');
reset role;
select pg_temp.ok((select health is null from axis_an.day_snapshot where user_ref='nickA' and logical_date='2026-10-26'), '건강 동의가 없으면 건강 필드는 저장하지 않음');
select pg_temp.ok((select (plan->>'wake_exp')::numeric from axis_an.day_snapshot where user_ref='nickA' and logical_date='2026-10-26') = 7.5, '계획과 실제를 분리해 저장(plan)');
select pg_temp.ok((select (actual->>'wake')::numeric from axis_an.day_snapshot where user_ref='nickA' and logical_date='2026-10-26') = 7.2, '실제 기록 저장(actual)');
-- 오래된 재전송이 최신 값을 덮지 않음
set role anon;
select public.axis_an_snapshots_put('nickA','proofA','[{"d":"2026-10-26","rec":"2026-10-26T03:00:00Z","actual":{"wake":7.9}}]');
select public.axis_an_snapshots_put('nickA','proofA','[{"d":"2026-10-26","rec":"2026-10-26T01:30:00Z","actual":{"wake":6.0}}]');
reset role;
select pg_temp.ok((select (actual->>'wake')::numeric from axis_an.day_snapshot where user_ref='nickA' and logical_date='2026-10-26') = 7.9, '더 오래된 재전송은 최신 요약을 덮지 않음');

-- 6. 건강 동의 후 건강 필드 저장, 철회 시 제거
set role anon;
select public.axis_an_consent_put('nickA','proofA','{"service":true,"analytics":true,"personal":true,"health":true}','v1','닉A',null,'Asia/Seoul');
select public.axis_an_snapshots_put('nickA','proofA','[{"d":"2026-10-27","rec":"2026-10-27T01:00:00Z","actual":{"wake":7},"health":{"sleepH":6.5}}]');
reset role;
select pg_temp.ok((select (health->>'sleepH')::numeric from axis_an.day_snapshot where user_ref='nickA' and logical_date='2026-10-27') = 6.5, '건강 동의 후 건강 필드 저장');
set role anon;
select public.axis_an_consent_put('nickA','proofA','{"service":true,"analytics":true,"personal":true,"health":false}','v1','닉A');
reset role;
select pg_temp.ok((select count(*) from axis_an.day_snapshot where user_ref='nickA' and health is not null) = 0, '건강 동의 철회 시 건강 필드 제거');
select pg_temp.ok((select count(*) from axis_an.day_snapshot where user_ref='nickA') = 2, '건강 철회가 일반 요약까지 지우지 않음');

-- 7. 분석 동의 철회: 이벤트·요약 삭제, 이름 필드 제거, 이력 보존
set role anon;
select public.axis_an_consent_put('nickA','proofA','{"service":true,"analytics":false,"personal":true,"health":true}','v1','닉A');
reset role;
select pg_temp.ok((select count(*) from axis_an.event where user_ref='nickA') = 0 and (select count(*) from axis_an.day_snapshot where user_ref='nickA') = 0, '분석 동의 철회 시 이벤트·요약 삭제');
select pg_temp.ok((select (items->>'personal')::boolean from axis_an.consent where user_ref='nickA') = false, '분석 철회 시 하위 항목(개인별·건강)도 꺼짐');
select pg_temp.ok((select nick is null from axis_an.profile where user_ref='nickA'), '개인별 동의 철회 시 닉네임 제거');
select pg_temp.ok((select count(*) from axis_an.consent_history where user_ref='nickA') >= 4, '동의 변경 이력 보존');
set role anon;
select pg_temp.ok((public.axis_an_events_put('nickA','proofA','[{"id":"evt-00000010","n":"screen_open","p":{"screen":"today"},"t":"2026-10-27T01:00:00Z","d":"2026-10-27"}]')->>'error') = 'no_consent', '철회 후 이벤트 수집 중단');
reset role;

-- 8. 관리자: 허용된 관리자만, 동의 범위 필터, 가명 ID, 감사 기록
insert into axis_an.admin_user values ('44444444-4444-4444-4444-444444444444','tester',true);
-- 사용자 두 명의 합성 데이터
set role anon;
select public.axis_an_consent_put('nickA','proofA','{"service":true,"analytics":true,"personal":true,"health":true}','v1','닉A',null,'Asia/Seoul');
select public.axis_an_consent_put('nickB','proofB','{"service":true,"analytics":true,"personal":false,"health":false}','v1','닉B',null,'Asia/Seoul');
reset role;
update axis_an.consent set effective_at='2026-10-20T00:00:00Z';
set role anon;
select public.axis_an_snapshots_put('nickA','proofA','[{"d":"2026-10-26","rec":"2026-10-26T04:00:00Z","actual":{"wake":7.5,"total":8,"done":6},"habits":{"move":true},"health":{"sleepH":7}}]');
select public.axis_an_snapshots_put('nickB','proofB','[{"d":"2026-10-26","rec":"2026-10-26T04:00:00Z","actual":{"wake":8.5,"total":8,"done":2},"habits":{"move":false},"health":{"sleepH":4}}]');
reset role;
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.ok((select jsonb_array_length(public.axis_admin_days('2026-10-01','2026-10-31'))) = 2, '관리자: 분석 동의 사용자 2명의 요약 조회');
select pg_temp.ok((select (public.axis_admin_days('2026-10-01','2026-10-31')::text) !~ '닉[AB]|nickA|nickB') , '전체 요약에 닉네임·원본 키가 없음(가명 ID만)');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.axis_admin_days('2026-10-01','2026-10-31')) e where jsonb_typeof(e->'health') = 'object') = 1, '건강 동의가 없는 사용자의 건강 필드는 응답에서 제외');
select pg_temp.ok((select jsonb_array_length(public.axis_admin_named_users())) = 1, '이름 목록은 개인별 분석 동의 사용자만(1명)');
select pg_temp.ok((select (public.axis_admin_named_users()->0->>'name')) = '닉A', '이름 목록에 닉네임 표시');
select pg_temp.ok((select public.axis_admin_named_users()::text !~ 'email|@') , '이름 목록에 이메일 없음');
do $$ declare u text; begin
  u := (public.axis_admin_named_users()->0->>'u');
  if jsonb_array_length(public.axis_admin_user_days(u,'2026-10-01','2026-10-31')) <> 1 then raise exception 'FAIL: 사용자 상세 조회'; end if;
  raise notice 'PASS: 개인별 분석 동의 사용자의 상세 조회';
  -- 개인별 동의가 없는 사용자 B의 가명 ID로는 빈 결과
  if jsonb_array_length(public.axis_admin_user_days(left(md5('nickBsalt'),10),'2026-10-01','2026-10-31')) <> 0 then raise exception 'FAIL: 개인별 동의 없는 사용자 상세 노출'; end if;
  raise notice 'PASS: 개인별 분석 동의가 없으면 상세 결과 없음';
end $$;
reset role; reset request.jwt.claim.sub;
select pg_temp.ok((select count(*) from axis_an.admin_audit where result='ok' and action in ('days','profiles','named_users','user_days')) >= 5, '허용된 조회가 감사 기록에 남음');
select pg_temp.ok((select bool_and(scope::text !~ '닉|proof|7\.5|sleepH') from axis_an.admin_audit), '감사 기록에 개인 기록 본문·인증값 없음');

-- 9. 삭제와 보존기간
set role anon;
select public.axis_an_purge('nickB','proofB');
reset role;
select pg_temp.ok((select count(*) from axis_an.day_snapshot where user_ref='nickB') = 0 and (select count(*) from axis_an.consent where user_ref='nickB') = 0, '계정 삭제 연동: 요약·동의 상태 삭제');
select pg_temp.ok((select deleted_at is not null and nick is null from axis_an.profile where user_ref='nickB'), '삭제 후 프로필 이름 제거, 삭제 표시');
-- 보존기간 정리: 오래된 데이터만 대상
insert into axis_an.event(id,user_ref,name,props,occurred_at,logical_date,received_at) values ('nickA:old-event-01','nickA','screen_open','{}','2020-01-01','2020-01-01','2020-01-01');
select pg_temp.ok((axis_an.run_retention(true)->>'events')::int = 1, '보존기간 정리(드라이런): 대상 1건만 집계');
select pg_temp.ok((select count(*) from axis_an.event where id='nickA:old-event-01') = 1, '드라이런은 삭제하지 않음');
select axis_an.run_retention(false);
select pg_temp.ok((select count(*) from axis_an.event where id='nickA:old-event-01') = 0, '보존기간 정리: 만료 데이터 삭제');
select pg_temp.ok((select count(*) from axis_an.day_snapshot where user_ref='nickA') >= 1, '보존기간 내 데이터는 유지');
select pg_temp.ok((axis_an.collection_ready()), '운영 설정 완료 상태');
delete from axis_an.config where key='contact';
select pg_temp.ok(not axis_an.collection_ready(), '문의처가 비면 수집 비활성');

-- 10. 이벤트 집계 RPC (속성 노출 없음, 동의한 사용자만)
insert into axis_an.consent(user_ref, items, doc_version, effective_at) values ('nickA','{"service":true,"analytics":true,"personal":true,"health":false}','v1','2020-01-01') on conflict (user_ref) do update set items = excluded.items;
insert into axis_an.config(key,value) values ('contact','test@example.invalid');
insert into axis_an.event(id,user_ref,name,props,occurred_at,logical_date) values
 ('nickA:ev-agg-0001','nickA','conflict_shown','{"mode":"appt","items":2,"hard":false}','2026-10-26','2026-10-26'),
 ('nickA:ev-agg-0002','nickA','conflict_accepted','{"mode":"appt","moved":1,"skipped":1,"kept":0}','2026-10-26','2026-10-26');
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.ok((select count(*) from jsonb_array_elements(public.axis_admin_events('2026-10-01','2026-10-31')) e where e->>'n' in ('conflict_shown','conflict_accepted')) = 2, '이벤트 집계: 이름·횟수');
select pg_temp.ok((public.axis_admin_events('2026-10-01','2026-10-31')::text !~ 'mode|moved|nickA'), '이벤트 집계에 속성·원본 키 없음');
reset role; reset request.jwt.claim.sub;
set role authenticated; set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select pg_temp.ok((public.axis_admin_events('2026-10-01','2026-10-31')->>'error') = 'denied', '일반 사용자의 이벤트 집계 조회 거부');
reset role; reset request.jwt.claim.sub;
