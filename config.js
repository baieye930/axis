// Supabase 대시보드 → Project Settings → API Keys 에서 복사해 넣으세요.
// supabaseUrl: Project URL (예: https://abcdefghijk.supabase.co)
// supabaseKey: Publishable key(sb_publishable_…) 또는 Legacy 'anon' key(eyJ…)
//   ※ secret / service_role 키는 절대 넣지 마세요.
window.AXIS_CONFIG = {
  supabaseUrl: "https://grjjxzuyezjuolzdjuxo.supabase.co",
  supabaseKey: "sb_publishable_A8iimb6VMYOHENV3JDl2mw_u2Qik6Fx",
  // 이용 분석·동의. 아래 운영 정보를 운영자가 확정해 모두 채우고 enabled 를 true 로 바꾸기 전에는
  // 동의 화면이 나오지 않고 분석 데이터는 어떤 것도 수집·전송하지 않는다. (docs/analytics/operations.md)
  analytics: {
    enabled: false,
    operator: "",        // 운영 주체(상호/이름)
    contact: "",         // 문의처(이메일 등)
    policyVersion: "",   // 동의 문서 버전(예: "2026-11-01.1"). 내용이 바뀌면 올려서 재동의를 받는다
    region: "",          // 서버(데이터 저장) 지역
    processors: "",      // 처리 서비스(예: 데이터베이스·인증 제공자 이름)
    retentionDays: { events: "", snapshots: "", consent: "", audit: "" }
  }
};
