# 5. 운영 가이드

## 운영자 조회 도구(`admin/`)
- 읽기 전용, 기본 `127.0.0.1`만 바인딩, 공개 앱 산출물에 포함되지 않음(테스트로 확인).
- 합성 데이터: `node admin/server.mjs --synthetic` (기본 포트 8787, `ADMIN_PORT`로 변경).
- 실제 데이터: 아래 환경변수가 모두 있어야 하며 하나라도 없으면 조회가 차단된다. **값은 채팅·Git·문서에 쓰지 않는다.**
  - `ADMIN_SUPABASE_URL`, `ADMIN_SUPABASE_PUBLISHABLE_KEY`(공개 가능한 publishable 키), `ADMIN_JWT`(관리자 계정의 사용자 JWT), `ADMIN_TOKEN`(24자 이상, 로컬 화면 로그인용).
  - secret/service_role 키는 쓰지 않는다. 서버가 `axis_an.admin_user`에 등록된 사용자만 허용.
- 로컬 감사 로그 `admin/.audit/`(Git 제외, 조회 종류·기간만 기록, 레코드 본문 없음).

## 서버 적용 순서(운영자가 직접, 지금은 적용하지 않음)
1. 기존 로그인 검증을 `axis_an.verify_proof`에 연결(현재는 의도적으로 오류).
2. 마이그레이션 `20261026_analytics.sql` 적용 → `server/migrations/tests/run.sh`로 임시 DB에서 먼저 검증.
3. `axis_an.config`에 운영 주체·문의처·정책 버전·지역·처리 서비스·보존 기간 입력, `admin_user` 등록.
4. `config.js`의 `analytics` 값을 같은 내용으로 채우고 `enabled:true`, 그 뒤 배포.
5. 보존 삭제는 `select axis_an.run_retention(true)`(미리보기) 확인 후 `false`로 정기 실행.

## 운영자가 정해야 할 것
보존 기간 4종(이벤트·스냅샷·동의·감사), 문의처, 운영 주체, 저장 지역, 처리 서비스 목록, 정책 버전, 법률 검토, 관리자 계정 목록.

## 서버 적용 전/후 동작
- 적용 전·`config.js` 미기입: 동의 화면도 전송도 없음(현재 상태). 기존 로그인·저장은 변함없음.
- 적용 후에도 `collection_ready()`가 거짓이면 서버가 모두 거부.
