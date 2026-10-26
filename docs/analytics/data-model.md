# 3. 데이터 모델·수집 항목·흐름

## 수집 항목과 목적
| 항목 | 내용 | 필요한 동의 | 목적 |
|---|---|---|---|
| 서비스 | 계정 키, 닉네임/Google 표시 이름, 날짜별 계획·기록·설정 | 서비스(필수) | 저장·동기화 |
| 이벤트 | 허용 목록의 이벤트 13종, 속성은 열거형/범위 제한 정수/불리언만 | 분석 | 기능 이용 현황 |
| 일 스냅샷 | 계획(예상 기상, 루틴 ID·유형·시간·상태)과 실제(기상·취침·완료 수)를 분리, 기본 습관 완료 | 분석 | 계획 대비 실행 통계 |
| 건강 | 수면·컨디션·수분·운동 요약·식사 요약 | 건강(분석 전제) | 건강 관련 기록과 루틴의 관계 통계 |
| 계정 연결 열람 | 위 값을 닉네임·표시 이름과 연결해 운영자가 열람 | 개인별(분석 전제) | 개별 사용 흐름 파악 |

**수집하지 않는 것**: 비밀번호·토큰·OAuth 코드, 자유 입력 문장(메모·약속 제목), 정밀 위치, 연락처, Oura 원본 응답, 기기 지문, 이메일(관리자 화면에 표시·내보내기 없음).

## 서버 (`server/migrations/20261026_analytics.sql`, 미적용)
- 스키마 `axis_an`: `config`, `profile`, `consent`, `consent_history`, `event_def`, `event`, `day_snapshot`, `admin_user`, `admin_audit`. 모든 테이블 RLS 거부, 접근은 SECURITY DEFINER RPC만.
- 사용자 RPC: `axis_an_consent_put/get`, `axis_an_events_put`, `axis_an_snapshots_put`, `axis_an_purge`.
- 운영자 RPC: `axis_admin_days/profiles/named_users/user_days/events`(읽기 전용, 매 호출 감사 기록, 비관리자는 `denied`).
- 유지 기간 삭제: `axis_an.run_retention(dry_run)`.
- 수집 게이트: `axis_an.collection_ready()` — 운영 정보와 보존 기간이 모두 채워지고 `collection_enabled=true`일 때만 수집.

## 클라이언트 흐름
1. 로그인 후 동의 기록이 없거나 문서 버전이 바뀌면 동의 화면. 게스트는 분석 코드가 아예 동작하지 않음.
2. 동의 항목별로 이벤트 큐에 적재 → 5초 묶음 전송(같은 ID로 재시도, 서버가 중복 제거).
3. 철회: 서버에 동의 기록 전송, 미전송 이벤트·재시도 큐 즉시 삭제, 이후 수집 중단. 과거 기록 소급 분석 없음(서버가 동의 시각 이전 스냅샷 거부).
4. 계정 삭제 시 분석 데이터 먼저 삭제 요청.

## 보존·철회 정책(초안, 운영자 확정 필요)
보존 기간은 `config.js`/`axis_an.config`의 값이 비어 있으면 수집이 꺼진다. 값은 운영자가 정한다.
