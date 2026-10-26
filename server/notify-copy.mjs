// AXIS 알림 문구 (서버용 사본). 앱의 index.html 안 NCOPY와 같은 내용이다. 둘을 함께 고쳐야 한다.
// 잠금 화면 푸시(서버가 보내는 알림)가 이 표를 쓰려면 server/README.md의 절차가 필요하다.
// 이 파일은 의존성이 없어서 Supabase Edge Function(Deno)에서 그대로 import 할 수 있다.
export const TONES = ["soft", "polite", "brief"];
export const DEFAULT_TONE = "soft";
export const NCOPY = {
  water:{title:"물과 소금",soft:"물과 소금을 챙길 시간이에요.",polite:"물과 소금을 챙기실 시간입니다.",brief:"물과 소금 시간"},
  sun1:{title:"아침 햇빛 걷기",soft:"햇빛을 쬐며 걸을 시간이에요.",polite:"햇빛을 쬐며 걸으실 시간입니다.",brief:"아침 햇빛 걷기 시간"},
  move:{title:"공복 운동",soft:"운동할 시간이에요. 가볍게 몸을 풀어보세요.",polite:"운동하실 시간입니다. 가볍게 몸을 풀어 주세요.",brief:"운동 시작 시간"},
  deep1:{title:"딥워크 1",soft:"집중할 시간이에요. 하던 일을 잠시 정리해 주세요.",polite:"집중하실 시간입니다. 하시던 일을 잠시 정리해 주세요.",brief:"집중 시작 시간"},
  meal1:{title:"첫 식사",soft:"첫 식사 시간이에요.",polite:"첫 식사 시간입니다.",brief:"첫 식사 시간"},
  sun2:{title:"점심 후 햇빛 걷기",soft:"잠시 밖에서 걸을 시간이에요.",polite:"잠시 밖에서 걸으실 시간입니다.",brief:"점심 후 걷기 시간"},
  caff:{title:"카페인 마감",soft:"오늘 카페인은 여기까지예요.",polite:"오늘 카페인은 여기까지입니다.",brief:"카페인 마감"},
  nsdr:{title:"NSDR",soft:"잠시 쉬어갈 시간이에요.",polite:"잠시 쉬어가실 시간입니다.",brief:"NSDR 시간"},
  caffnsdr:{title:"카페인 마감 · NSDR",soft:"오늘 카페인은 여기까지예요. 잠시 쉬어갈 시간이에요.",polite:"오늘 카페인은 여기까지입니다. 잠시 쉬어가실 시간입니다.",brief:"카페인 마감 · NSDR 시간"},
  sun3:{title:"퇴근길 햇빛",soft:"햇빛을 쬐며 잠시 걸어보세요.",polite:"햇빛을 쬐며 잠시 걸어 보세요.",brief:"퇴근길 햇빛 시간"},
  meal2:{title:"저녁 식사",soft:"저녁 식사 시간이에요.",polite:"저녁 식사 시간입니다.",brief:"저녁 식사 시간"},
  dim:{title:"조명 낮추기",soft:"조명을 낮추고 쉴 준비를 해보세요.",polite:"조명을 낮추고 쉴 준비를 해 주세요.",brief:"조명 낮추기 시간"},
  sleep:{title:"취침",soft:"잠자리에 들 시간이에요. 편안한 밤 보내세요.",polite:"취침하실 시간입니다. 편안한 밤 보내세요.",brief:"취침 시간"},
  plan:{title:"내일 계획",soft:"내일 계획을 가볍게 정리해 볼까요?",polite:"내일 계획을 가볍게 정리해 보시겠어요?",brief:"내일 계획 정리 시간"},   // 문구만 준비. 정기 알림으로 예약하지 않는다
  restEnd:{title:"휴식",soft:"휴식 시간이 끝났어요. 다음 세트를 시작해 주세요.",polite:"휴식 시간이 종료되었습니다. 다음 세트를 시작해 주세요.",brief:"휴식 종료 · 다음 세트 시작"},
  runEnd:{title:"루틴 타이머",soft:"예정된 시간이 끝났어요. 마쳤다면 ‘완료’를 눌러 주세요.",polite:"예정된 시간이 종료되었습니다. 마치셨다면 ‘완료’를 눌러 주세요.",brief:"예정 시간 종료 · 마쳤다면 ‘완료’"},
  extraStart:{title:"내 일정",soft:"‘{t}’ 일정이 시작될 시간이에요.",polite:"‘{t}’ 일정이 시작될 시간입니다.",brief:"‘{t}’ 시작"},
  extraSoon:{title:"내 일정",soft:"‘{t}’ 일정이 {n}분 뒤 시작돼요.",polite:"‘{t}’ 일정이 {n}분 뒤 시작됩니다.",brief:"‘{t}’ {n}분 뒤 시작"}   // 문구만 준비. 사전 알림은 아직 예약하지 않는다
};
// 앱의 핵심 알림 id → 문구 키
export const CORE_EV = {water:"water",sun1:"sun1",move:"move",deep1:"deep1",meal1:"meal1",sun2:"sun2",nsdr:"caffnsdr",sun3:"sun3",meal2:"meal2",dim:"dim",sleep:"sleep"};
// prefs.tone 값이 없거나 모르는 값이면 기본 말투(soft)로 처리한다.
export const toneOf = (prefs) => (prefs && TONES.includes(prefs.tone) ? prefs.tone : DEFAULT_TONE);
// ev: NCOPY의 키, vars: {t, n}. 반환: {title, body}. 알 수 없는 ev면 null(서버는 기존 문구를 그대로 보낸다).
export function notifyText(ev, vars = {}, tone = DEFAULT_TONE) {
  const c = NCOPY[ev];
  if (!c) return null;
  let b = c[TONES.includes(tone) ? tone : DEFAULT_TONE];
  for (const k of Object.keys(vars)) {
    let v = String(vars[k]);
    if (k === "t" && v.length > 40) v = v.slice(0, 40) + "…";
    b = b.split("{" + k + "}").join(v);
  }
  return { title: c.title, body: b };
}
