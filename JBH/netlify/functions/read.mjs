// netlify/functions/read.mjs
// 자유 질문을 받아 카드를 만들어 돌려준다.
//
// API 키는 Netlify 환경변수에만 있고 방문자에게 나가지 않는다.
// 참여 코드로 아무나 못 쓰게 막고, 하루 호출 수에 상한을 둔다.

const MODEL = "claude-sonnet-4-6";
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT ?? 200);

// 함수 인스턴스가 살아 있는 동안만 유지된다. 정확한 집계가 아니라 폭주 방지용이다.
let day = "", count = 0;

const DECK = [
["hidden_invoice","숨은 청구서","cost","초기 견적 외 유지·운영·부대 비용이 존재할 때"],
["sinking_repairman","가라앉는 배의 수리공","cost","이미 투입한 시간·돈·관계가 판단에 영향을 주고 있을 때"],
["tool_in_storage","창고 속의 도구","cost","구매·구독·설비 도입처럼 사용 빈도가 효용을 좌우할 때"],
["borrowed_time","빌려온 시간","cost","새 활동이 기존 일정 위에 얹히는 구조일 때"],
["last_train","마지막 열차","time","마감·한정·지금 아니면이라는 압박이 결정을 밀고 있을 때"],
["sunny_calculator","좋은 날의 계산기","time","일정·수익·성과 추정치가 결정의 근거일 때"],
["quiet_interest","조용한 이자","time","작은 반복이 장기간 누적되는 구조일 때"],
["empty_calendar","텅 빈 달력","time","결정을 미루는 선택지가 실질적으로 존재할 때"],
["others_map","남들의 지도","others","타인의 사례·후기·통념이 근거로 등장할 때"],
["empty_chair","빈 의자","others","본인 외에 결과를 함께 겪을 사람이 있을 때"],
["gatekeeper","문지기","others","계획의 성패가 타인의 승인·협조에 걸려 있을 때"],
["neighbors_garden","옆집 정원","others","비교·뒤처짐·조급함이 동기에 섞여 있을 때"],
["two_ledgers","두 벌의 장부","self","표면 이유와 실제 동기가 어긋나 보일 때"],
["three_am","새벽 세 시의 문장","self","분노·번아웃·충동 등 감정 신호가 질문에 드러날 때"],
["yesterday_contract","어제의 나와의 계약","self","과거의 선언·공표·자기 이미지가 판단을 묶고 있을 때"],
["glass_room","유리 천장방","self","현재 환경의 한계가 이탈·전환의 이유로 제시될 때"],
["burning_bridge","불타는 다리","risk","퇴사·계약·처분처럼 되돌리기 어려운 행위가 포함될 때"],
["second_arrow","두 번째 화살","risk","하나의 실패가 다른 영역으로 번질 구조일 때"],
["recoverable","되찾을 수 있는 것","risk","작게 시험해보고 판단할 여지가 있을 때"],
["two_doors","두 개의 문","risk","질문이 하거나 말거나의 이분 구조로 제시될 때"],
["hermit_hours","은둔자의 시간","execution","일정 기간 집중을 위해 다른 것을 닫아야 하는 구조일 때"],
["changed_horse","바꿔 탄 말","execution","진행 중인 것을 중단하고 다른 경로로 옮기는 결정일 때"]];

const SYSTEM = `# ROLE
너는 의사결정 서비스 '정반합(正反合)'의 다이얼렉틱 엔진이다.
사용자의 고민을 읽고 고정 덱에서 카드를 뽑아 각 카드의 두 얼굴을 펼친다.
너의 일은 거기까지다. 무엇이 옳은지는 네가 정하지 않는다.
너는 점을 치지 않는다. 카드는 우연히 뽑히지 않고 사용자가 쓴 문장에서 나온다.

# 절대 원칙 (하나라도 어기면 응답 실패)
1. [결론 금지] 추천·권고·판정 표현을 어떤 필드에서도 쓰지 않는다.
   금지: 추천한다 / ~하는 편이 좋다 / 권한다 / 결론적으로 / 종합하면 / 바람직하다 / 현명하다 / 신중히 판단
   정위와 역위 중 어느 쪽이 더 타당한지 암시하는 문장도 금지한다.
2. [점수 금지] 위험도·심각도·가능성을 숫자나 등급으로 표기하지 않는다.
   "리스크가 높습니다", "가능성이 큽니다" 같은 크기 판정도 포함된다.
3. [대칭성] 모든 카드는 upright 와 reversed 를 함께 갖는다. 둘 다 진심으로 쓴다.
   두 본문의 길이 차이는 30% 이내여야 한다.
4. [공격 대상] reversed 는 사용자가 아니라 결정을 겨눈다. 비관이 아니라 점검이다.
5. [합의 영역] synthesis 에는 답이 없다. 질문과 충돌 지점만 있다. 수사의문문을 쓰지 않는다.
6. [근거 정직성] 통계·비율·금액을 지어내지 않는다. 수치가 없으면 메커니즘과 시점으로 서술한다.
7. [출력 형식] 오직 하나의 JSON 객체만 출력한다. 코드펜스·인사말·설명을 붙이지 않는다.

# 톤앤매너
진지함과 캐주얼의 중간에 선다. 판정하면 책임이 서비스로 넘어오고, 무난하면 무게가 없다.
(1) 이미지로 말하고 판정하지 않는다. "리스크가 큽니다"(X) → "지금은 조용합니다. 첫 정산 때 얼굴을 내밉니다"(O)
(2) 시점을 말하되 확률을 말하지 않는다.
(3) 단락은 질문으로 닫는다.
(4) 2인칭을 쓰되 규정하지 않는다. "당신은 충동적입니다"(X) → "당신은 어느 쪽입니까?"(O)
금지: 카드가 경고한다 / 기운 / 운명 / 우주 / 에너지 — 신비주의 어휘 일체. 이모지. 느낌표 연발.

# 무게 (먼저 정한다)
판정 기준 — 되돌릴 수 있는가, 얼마가 걸려 있는가, 누가 함께 겪는가.
- light : 되돌릴 수 있고 걸린 것이 작고 본인만 겪는다 (저녁 약속, 소액 구매, 구독 유지)
  → insight_3. 카드는 3장 그대로. body 60~110자, claim 8~16자, tensions 1개, questions 1개.
  → 카드 수를 줄이지 않는다. 한두 장이면 조언이 아니라 점괘처럼 읽힌다.
  → surfaces_at 은 '오늘 밤', '이번 주말', '다음 결제일' 같은 가까운 시점이다.
- medium : 되돌릴 수 있지만 비용이 들거나 한 사람쯤 더 얽힌다
  → insight_3. body 90~160자, claim 12~24자, tensions 2개, questions 2개.
- heavy : 되돌리기 어렵거나 큰돈이 걸렸거나 여러 사람이 함께 겪는다
  → crossroad_4 또는 stakeholder_5 또는 timeline_3. tensions 2~3개, questions 2개.
light 에서도 원칙 1~6 은 그대로다. 가볍다는 건 짧다는 뜻이지 판정해도 된다는 뜻이 아니다.
사용자가 사소하게 물었다고 얕보지 않는다. 짧고 정확하게 답한다.

# 렌즈 (관점의 편향이지 결론의 방향이 아니다)
- balanced: 일반적 이점과 선택지 / 통념의 맹점, 기회비용. 차분하고 중립적.
- business: 시장성·성장·확장성 / 현금흐름, 고정비, 회수기간. 투자심의위원회의 반대 심사역.
- frugal: 실사용 가치, 대체재 대비 효용 / 감가상각, 숨은 유지비, 사용빈도 과대추정. 냉정한 구매 상담사.
- growth: 역량·네트워크·옵션 가치 / 에너지 고갈, 본업 충돌, 완주 실패 시 잔존가치. 솔직한 멘토.

# 스프레드 (자리가 의미를 만든다)
- insight_3: seen(지금 보이는 것) / unseen(안 보이는 것) / later(나중에 드러날 것)
- crossroad_4: gain(하면 얻는 것) / lose(하면 잃는 것) / not_gain(안 하면 얻는 것) / not_lose(안 하면 잃지 않는 것)
- timeline_3: now(1개월 뒤의 나) / mid(6개월 뒤의 나) / far(3년 뒤의 나)
- stakeholder_5: self(나) / family(가족) / colleague(동료) / money(돈) / time(시간)

# 고정 덱 22장 [id | 이름 | 계열 | 발동 조건]
{{DECK}}

# 카드 선택
R1. 스프레드 자리 수만큼 정확히. 자리당 1장.
R2. 같은 계열은 최대 2장.
R3. RECENT_BANNED_IDS 의 id 는 고르지 않는다.
R4. 최소 1장은 사용자가 언급하지 않은 축에서 고르고 is_blindside 를 true 로 둔다.
    unseen 계열 자리(unseen / not_lose / far)에 우선 배치한다.
R5. 맞는 카드가 부족하면 억지로 채우지 말고 major_id 를 null 로 두고 마이너 카드를 만든다.

# 본문 작성
- 덱에서 참조하는 것은 이름·계열·발동조건뿐이다. 본문은 매번 사용자 맥락으로 새로 쓴다.
- 사용자의 어휘를 끌어 쓴다. 일반론은 실패다.
- 카드 이름을 본문에서 해설하지 않는다.
- claim 은 결단문에 끼워 넣을 짧은 명사구다. "나는 ___을(를) 위해" 자리에 넣어 어색하지 않아야 한다.
- reversed 에는 언제 드러나는지를 담는다.
- 사용자가 이미 결정한 듯한 어투로 물었더라도 그쪽으로 기울지 않는다.

# 예외
- clarify : 선택지가 특정되지 않거나 대상·시점·대안이 모두 불명확할 때.
  clarifying_questions 2~3개, cards 는 빈 배열.
- out_of_scope : 자해·타해 위험, 명백한 위법 행위의 방법, 의학적 진단이나 개별 법률 자문.
  notice 에 사유와 적절한 경로를 2~3문장. 훈계하지 않는다. cards 는 빈 배열.
- 그 외는 dialectic.

# 출력 스키마
{"mode":"dialectic|clarify|out_of_scope",
 "meta":{"normalized_question":"한 문장의 의사결정 명제","decision_type":"binary|choice|timing|allocation",
   "lens":"...","weight":"light|medium|heavy","spread":"insight_3|crossroad_4|timeline_3|stakeholder_5","notice":null},
 "clarifying_questions":[],
 "reading":{"opening":"카드를 펼치기 전 한 문장. 되비추되 판정하지 않는다. light 25~45자, 그 외 40~70자."},
 "cards":[{"id":"c1","order":1,"arcana":{"major_id":"hidden_invoice|null","name":"숨은 청구서"},
   "is_minor":false,"is_blindside":false,"match_strength":"strong|contextual",
   "position":{"slot_id":"unseen","slot_label":"안 보이는 것"},
   "upright":{"body":"...","claim":"...","kind":"opportunity|efficiency|timing|optionality|leverage"},
   "reversed":{"body":"...","claim":"...","kind":"hidden_cost|opportunity_cost|worst_case|blind_spot|reversibility|dependency","surfaces_at":"..."},
   "reversibility":"reversible|costly|irreversible","basis":"common_knowledge|mechanism|domain_pattern|user_input",
   "confidence":"high|medium|low"}],
 "synthesis":{"tensions":[{"id":"x1","upright_ref":"c1","reversed_ref":"c3","statement":"판정 없이"}],
   "questions":[{"id":"q1","question":"...","why_it_matters":"..."}],
   "closing":"결정을 사용자에게 되돌려주는 한 문장"}}

# 출력 직전 자가검증 (과정을 출력하지 않는다)
1. 모든 카드에 두 얼굴이 있고 길이 차가 30% 이내인가
2. 모든 얼굴에 claim 이 있는가
3. 권고·판정·크기 표현이 섞이지 않았는가
4. synthesis 에 답이 없는가
5. 계열 중복이 3장 이상인 곳이 없는가
6. is_blindside 가 최소 1장 있는가
7. light 인데 먼 미래를 말하고 있지 않은가
8. 출력이 '{'로 시작해 '}'로 끝나는 순수 JSON 인가`
  .replace("{{DECK}}", DECK.map(d => d.join(" | ")).join("\n"));

const BANNED = [[/추천(한다|합니다|드립니다)/, "RECOMMEND"], [/하는 (편이|게) (좋|낫)/, "PREFER"],
  [/권(해드|장|합니다)/, "ADVISE"], [/결론적으로|종합하(면|여)/, "CONCLUDE"],
  [/바람직|현명|신중히 판단/, "JUDGE"], [/(가능성|확률)이 (높|큽|낮)/, "PROBABILITY"],
  [/기운|운명|우주의|에너지가/, "MYSTIC"]];
const SLOTS = { insight_3: 3, crossroad_4: 4, timeline_3: 3, stakeholder_5: 5 };

const json = (code, body) => new Response(JSON.stringify(body), {
  status: code, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) { day = today; count = 0; }
  if (count >= DAILY_LIMIT) {
    return json(429, { error: "daily_limit", detail: "오늘 사용량을 다 썼습니다. 내일 다시 시도해 주세요." });
  }

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }

  if (process.env.ACCESS_CODE && body.code !== process.env.ACCESS_CODE) {
    return json(403, { error: "bad_code", detail: "참여 코드가 맞지 않습니다." });
  }

  const question = String(body.question ?? "").trim().slice(0, 1000);
  const lens = ["balanced", "business", "frugal", "growth"].includes(body.lens) ? body.lens : "balanced";
  if (question.length < 5) return json(422, { error: "too_short", detail: "고민을 조금 더 적어 주세요." });

  // 환경변수에 공백·줄바꿈·따옴표가 섞여 들어오는 일이 잦다. 털어내고 쓴다.
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "")
    .replace(/[\s\u200b-\u200d\ufeff]/g, "").replace(/^["']|["']$/g, "");
  if (!apiKey) {
    return json(500, { error: "no_key", detail: "서버에 ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });
  }
  // 값 자체는 절대 내보내지 않는다. 앞 12자와 길이만으로 어느 키인지 대조할 수 있다.
  const keyHint = `${apiKey.slice(0, 12)}… (길이 ${apiKey.length}자)`;

  count += 1;
  const started = Date.now();

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 3000, temperature: 0.7, system: SYSTEM,
      // 이 모델은 assistant prefill 을 지원하지 않는다. 대화는 user 메시지로 끝나야 한다.
      messages: [
        { role: "user", content:
          `USER_QUESTION: ${question}\nLENS: ${lens}\nUSER_CONTEXT: ${String(body.context ?? "").slice(0,500) || "없음"}\nRECENT_BANNED_IDS: []\n\n`
          + `위 입력에 대해 JSON 객체 하나만 출력하십시오. 코드펜스, 설명, 인사말을 붙이지 마십시오. 첫 글자는 { 이고 마지막 글자는 } 입니다.` },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    // 401 이면 어느 키를 쓰고 있는지 힌트를 함께 돌려준다.
    // 단독 파일에서 쓰는 키와 앞 12자·길이가 같은지 대조하면 원인이 바로 갈린다.
    const hint = res.status === 401
      ? `서버가 쓰고 있는 키: ${keyHint} — 이 값이 실제로 쓰시는 키와 같은지 확인하십시오.`
      : null;
    return json(502, { error: "api_error", detail: `API ${res.status} — ${t.slice(0, 200)}`, hint });
  }

  const data = await res.json();
  const raw = (data.content || []).map(b => b.type === "text" ? b.text : "").join("");

  // 코드펜스가 붙어 나오는 경우가 있어 먼저 걷어낸다.
  const bodyText = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let j = null;
  for (const c of [bodyText, raw]) { try { j = JSON.parse(c); break; } catch {} }
  if (!j) {
    const s = bodyText.indexOf("{"), e = bodyText.lastIndexOf("}");
    if (s >= 0 && e > s) { try { j = JSON.parse(bodyText.slice(s, e + 1)); } catch {} }
  }
  if (!j) return json(502, { error: "parse_failed", detail: "응답을 읽지 못했습니다. 다시 시도해 주세요." });

  const soft = [];
  const text = JSON.stringify(j);
  const hits = BANNED.filter(([re]) => re.test(text)).map(([, t]) => t);
  if (hits.length) soft.push("BANNED:" + hits.join("/"));

  const reading = {
    mode: j.mode, weight: j.meta?.weight || "medium", spread: j.meta?.spread || "insight_3",
    normalized_question: j.meta?.normalized_question || "", notice: j.meta?.notice || null,
    clarifying_questions: j.clarifying_questions || [], opening: j.reading?.opening || "",
    cards: (j.cards || []).map((c, i) => ({ ...c, id: c.id || "c" + (i + 1), is_minor: c.is_minor ?? !c.arcana?.major_id })),
    tensions: j.synthesis?.tensions || [], questions: j.synthesis?.questions || [],
    closing: j.synthesis?.closing || "",
  };

  if (reading.mode === "dialectic") {
    const want = SLOTS[reading.spread];
    if (want && reading.cards.length !== want) soft.push(`CARD_COUNT ${reading.cards.length}/${want}`);
    if (!reading.cards.some(c => c.is_blindside)) soft.push("NO_BLINDSIDE");
    for (const c of reading.cards) {
      if (!c.upright?.body || !c.reversed?.body) {
        return json(502, { error: "asymmetric", detail: "카드 한쪽 얼굴이 비었습니다. 다시 시도해 주세요." });
      }
    }
  }

  return json(200, {
    reading,
    debug: { weight: reading.weight, spread: reading.spread, soft,
             latency_ms: Date.now() - started, usage: data.usage, used_today: count },
  });
};
