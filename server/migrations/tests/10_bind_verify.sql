-- 테스트에서만 axis_an.verify_proof 를 합성 계정 검증으로 연결한다(운영에서는 기존 로그인 검증에 연결해야 한다).
create or replace function axis_an.verify_proof(p_key text, p_proof text) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select exists (select 1 from public.test_nick_accounts where key = p_key and proof = p_proof) $$;
