-- 로컬 임시 Postgres 전용 테스트 하네스: Supabase 환경을 흉내 낸다. 운영 DB에 실행하지 않는다.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- 합성 닉네임 계정(기존 검증 대신): key=증명 일치하면 통과
create table public.test_nick_accounts (key text primary key, proof text not null);
insert into public.test_nick_accounts values ('nickA','proofA'), ('nickB','proofB');
