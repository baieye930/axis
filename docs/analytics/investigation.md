# 1. 기존 구조 조사

- 앱: `index.html` 한 파일(바닐라 JS, IIFE) + `config.js`. GitHub Pages 정적 배포. 백엔드는 Supabase(공개 키만 프런트에 있음).
- 계정: 닉네임 계정(키+증명으로 RPC 호출), Google 계정(`g:<uid>`), 게스트(서버 저장 없음, 이 기기에서만 동작).
- 저장: 날짜별 `day` 객체(계획 `sc`/`adj`/`extra`, 완료 `done`, 기상·취침, 수면·수분·운동·식단)와 `prefs`를 `axis_days_*` RPC로 저장, 계정별 localStorage 키 사용.
- 논리 하루는 04:00 경계(`logical()`).
- **조사로 알 수 없었던 것**: 운영 DB의 실제 RLS·RPC 권한과 닉네임 증명 검증 방식(저장소에 없음). 그래서 `axis_an.verify_proof`는 "기존 로그인 검증에 연결하기 전에는 오류를 내는" 자리표시로 두었다. 연결 방법은 `operations.md`.
