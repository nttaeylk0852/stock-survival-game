# Stock Survival Architecture

Text-based survival stock roguelike with deep economic simulation. Mobile client (Expo) + authoritative Node.js server.

## Prerequisites

- Node.js 20+
- Docker (optional, for PostgreSQL) OR use built-in SQLite for local dev

## Quick Start

```bash
npm install
npm run db:migrate   # create data/game.db
npm run dev:server   # http://localhost:3000
npm test             # run the server test suite
```

Server: `http://localhost:3000` | WebSocket: `ws://localhost:3000/ws`

## API

All responses use the `ApiResponse` envelope: `{ ok, data?, error? }`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness + current tick |
| POST | `/api/users` | Create (or fetch) a user by `username` |
| POST | `/api/characters` | Create a character (`userId`, `name`) |
| GET | `/api/characters/:id` | Character state + cash balance |
| GET | `/api/characters/:id/portfolio` | Holdings, stock value, net worth |
| GET | `/api/companies` | All companies |
| GET | `/api/companies/:id` | Detail + price history + open orders |
| POST | `/api/trade` | Trade (`limitPrice` omitted → AMM market order) |
| DELETE | `/api/orders/:id` | Cancel an open limit order |
| POST | `/api/survival/eat` | Eat (costs `mealCostBase × CPI`) |
| POST | `/api/survival/rest` | Rest (removes homeless status) |
| GET | `/api/intel?characterId=` | Unpurchased intel (truth stays hidden) |
| POST | `/api/intel/:id/purchase` | Buy intel and reveal `isFake` |
| GET | `/api/agendas` | Open shareholder agendas |
| POST | `/api/agendas` | Propose an agenda |
| POST | `/api/agendas/:id/vote` | Vote weighted by shares held |
| GET | `/api/world` | Game time, macro state, season, sector indices |

WebSocket messages (`WsMessage`): `world_state` (every tick), `company_prices` (every price tick), `news` (rumors, season end).

## Structure

- `config/` — balance tuning (edit JSON, not code)
- `packages/shared/` — shared TypeScript types
- `packages/server/` — game server
- `packages/mobile/` — Expo app
- `docs/modules/` — per-module docs for AI-assisted fixes

---

# 설계 결정 문서 (Design Decisions)

> 2026-08 설계 논의 확정본. 구현 작업 시 이 문서를 유일한 기준(source of truth)으로 삼는다.
> 저비용 모델(DeepSeek V4 Pro 등)로 구현 작업을 시킬 때 이 문서만 컨텍스트로 제공하면 된다.

## 0. 프로젝트 방향 — "퀄리티 마지노선"

빠른 출시를 위해 기능을 쳐내더라도, 아래 두 가지는 **절대 타협 불가**. 이것이 양산형 주식 게임과의 차별점이자 진입장벽(FM식 해자)의 씨앗이다.

- **마지노선 2**: 연쇄 작용을 일으키는 거시/미시 지표의 피드백 루프. 하나의 이벤트가 나비효과를 일으켜야 한다.
- **마지노선 3**: 목적을 가진 시장 AI. 단, **개별 에이전트 수백 개 방식은 기각** (§1).

핵심 원칙: **시뮬레이션 깊이 ≠ 체감 깊이.** 유저가 인과를 느끼지 못하면 랜덤과 구별 불가. 따라서 "설명 레이어"(§6)를 마지노선 2의 필수 구성요소로 승격한다.

## 1. 시장 AI: 중앙 AI + 세력 프로파일 (개별 에이전트 기각)

- **기각**: 시장 70%를 개별 AI 에이전트로 채우는 방식. 이유: 유저는 결과(가격 움직임)만 보므로 체감 차이 없음 + 밸런싱/디버깅 비용 3~5배.
- **채택**: 중앙 AI 하나를 **3~4개 "성향 프로파일"** 전략 함수로 분할 운영.
  - 가치투자 기관 (적정가 괴리 시 역방향 매매)
  - 모멘텀 세력 (추세 추종, 과열 유발)
  - 공매도 헤지펀드 (고평가·악재 기업 공격)
- 코드상으론 전략 함수 3개지만 유저 눈에는 "목적을 가진 세력들"로 보임. 마지노선 3을 1/4 비용으로 충족.
- 유저 구도: **기관(세력) vs 개미(유저)** 경쟁. FM도 선수 개개인이 자율 에이전트가 아니라 정교한 스탯 시뮬레이션 — 핵심은 에이전트 수가 아니라 **피드백 루프의 깊이**.

## 2. 거시 변수 (macro 모듈, 신규)

금리·원자재·경기사이클은 **기업 스탯이 아니라 글로벌 변수**로 두고, 기업에는 민감도 계수만 부여한다.

### 2.1 금리 — 테일러 준칙 기반 (런타임 AI API 불필요)

하루 1회 판정, 전부 결정론적 수식:

```
목표금리 = 기본금리 + a×(물가지수 − 목표물가) + b×(시장지수 성장률 − 목표성장률)
step    = (|목표 − 실제| > 큰갭 || 쇼크이벤트 활성) ? 0.5 : 0.25   // 빅스텝
실제금리 += clamp(목표금리 − 실제금리, −step, +step)
```

- 물가지수는 원자재 가격 가중평균으로 파생. 변수 3개 + 계수 2개로 끝.
- "과열이면 인상, 침체면 인하"가 자동 발생. **빅스텝(0.5%p) 발동 자체가 뉴스 콘텐츠**가 된다.

### 2.2 금리 → 주가: 단순 "금리↑=주가↓" 금지

섹터별 금리 민감도 계수로 현실적 차별화 (if 분기 없이):

```json
"rateSensitivity": { "tech": -1.5, "bio": -2.0, "finance": 0.8, "utility": -0.3 }
```

- `섹터지수 × (1 + 금리변화 × 민감도)`. 금융주는 예대마진으로 **오히려 상승**.
- 부채 많은 기업은 이자비용(§3)으로 이중 타격 → 개연성 자동 발생.

### 2.3 원자재 — 2~3종만 (많으면 관리 비용만 증가)

- 에너지(전 섹터 비용), 실리콘(테크), 곡물(소비재)
- 주가에는 §3의 profit 파생 계산으로만 반영 (별도 메커니즘 불필요).

### 2.4 경기 사이클

- 호황↔불황 사인파 + 이벤트로 위상 점프. 모든 것의 배경음. 구현 쉬움.
- (후순위) 환율: 수출기업(민감도+) vs 내수기업(−), 계수 하나 추가.

## 3. 주가 결정 공식 개편 (pricing.ts)

현재: `basePrice × 스탯가중합 × 섹터배수 → 안정화 클램프` (골격 존재, `calculateFairPrice`).

**변경점**: `profit` 스탯을 고정값이 아니라 **매 틱 파생 계산**으로:

```
profit = revenue × margin − 원자재비(commodity가격 × materialSensitivity) − 이자(debt × 금리)
```

→ 원자재·금리가 자동으로 주가에 흘러들어감. 마지노선 2의 핵심 배관.

### 기업 스탯 구성

- 기존 유지: `revenue, debt, rnd, morale` (+파생 `profit`)
- 신규 민감도 계수: `materialSensitivity`, 섹터 노출도 `sectorExposure: { tech: 0.7, bio: 0.3 }` (기존 `sectors_json` 확장)
- **이미지 2축** (기존 단일 `brand` 대체):
  - x축 = 브랜드(제품/소비자 선호) → `revenue`에 영향
  - y축 = 경영진 신뢰도 → 주가 변동성, 거버넌스 안건 통과율, 루머 신뢰도에 영향
  - "제품은 좋은데 CEO가 사고치는 회사"(머스크 시나리오) 표현 가능. 3축은 불필요.

### 현실 참고 (설계 근거)

주가 ≈ 미래 이익 기대치 ÷ 할인율(금리). 재무제표 = 손익계산서(매출−비용=이익) / 재무상태표(자산·부채) / 현금흐름표. 이 게임의 스탯 구조는 그 단순화 버전.

## 4. 섹터 이벤트 & 뉴스 시스템

### 4.1 sectors.ts 개편

현재 순수 랜덤워크(`onPriceTick`의 `Math.random()`)를 **이벤트 구동 + rateSensitivity**로 교체.

### 4.2 뉴스 생성 = "창작"이 아니라 "선택 + 조립" (런타임 LLM 호출 없음)

1. **이벤트 풀 (config JSON)**: 사전 정의 템플릿 50~100개. 개발 단계에서 LLM으로 대량 생성 (런타임 비용 0).
2. **선택 로직이 개연성 담당**: 랜덤이 아니라 **현재 세계 상태가 확률을 결정**. 금리 높음 → "부채 리스크" 이벤트 가중치↑, 섹터 과열 → "버블 경고" 확률↑ (평균회귀). 뉴스가 세계를 만들고, 세계가 다음 뉴스를 편향 → 자기강화 루프.
3. **템플릿 조립**: `"{company}가 {commodity} 가격 급등으로 실적 경고"` — 실제 게임 상태 값 삽입.

**헤드라인 품질 확보 (다양성이 핵심, 문장력이 아님)**:

- **이벤트당 헤드라인 변형 5~10개**를 개발 단계에 LLM으로 대량 생성 (이벤트 100개 × 변형 8개 = 800개, 비용 $1~2). 같은 이벤트라도 매번 다른 문장 → 패턴 암기 방지.
- **톤 3종 혼합**: 속보체(`[속보] {company} 실적 쇼크`), 기자체(`{sector} 업계, {commodity} 급등에 한숨`), 찌라시체(`{company} 내부자발 매도설 솔솔`) — 루머(intel) 시스템과 톤 연결.
- **상태 파생 슬롯**: `{changePct 구간별 수식어}`(소폭↘/급락↓/폭락⬇), `{원인 이벤트 참조}` 등으로 같은 템플릿도 상황마다 다르게 읽힘.
- **(선택, 후순위) 하이브리드**: 휴장 시간(01~05시)에 그날 이벤트 큐를 초저가 모델(V4 Flash, 호출당 $0.001 미만)에 배치로 넘겨 다음날 헤드라인 사전 생성 → 실시간 아님 + 월 $1 이하. §4 이벤트 시스템 가동 후 "밋밋하다" 판정 시에만 도입.
- 참고: 현실 경제 뉴스 헤드라인 자체가 극도로 템플릿적("○○, △△ 여파에 이틀째 하락"). 유저가 원하는 건 문학성이 아니라 "어디에 영향 주지?"라는 정보이며 그건 chain(§4.3)이 담당.

### 4.3 이벤트 스키마 (chain = 나비효과의 핵심)

```json
{ "id": "chip_shortage", "headline": "반도체 공급난",
  "effects": { "sector.tech": -0.15, "commodity.silicon": 0.3 },
  "chain": [{ "after": 5, "effect": { "sector.auto": -0.08 } }] }
```

- `chain`의 딜레이가 중요: 유저가 "그럼 자동차주 떨어지겠네" **예측 → 적중**하는 경험을 만든다. 즉발이면 예측할 틈이 없음.
- **인과 사슬은 2~3단이 최적.** 5단 이상이면 유저가 추적 불가 → 오히려 랜덤처럼 느낌. 깊이보다 추적 가능성 우선.
- 섹터 추가 = config JSON 한 줄 → 확장성 자동 확보. 기존 intel(루머) 모듈의 뉴스 생성+푸시 구조 재활용.

### 4.4 섹터 전염

한 섹터 기업 파산 → 동일 섹터 지수 하락 (기존 파산 로직에 훅 하나).

## 5. 중앙은행/정부 AI 개입 (트리거 기반, 상시 계산 없음)

원칙: **파산과 수직 추락을 강제로 막지 않는다.** 파산은 콘텐츠다 (파산 → 섹터 전염 뉴스 → 유저 손실/공매도 기회).

- **대기업 (시총 상위 N)**: 안정화 클램프 폭 좁게 + 위기 시 "구제금융 이벤트" — 부채탕감 대신 **주가 희석 페널티** (공짜 구제 아님, 그 자체가 뉴스).
- **중소기업**: 클램프 폭 넓게, 파산 자유 허용. 기존 `applyStabilityFactor`가 극단만 방지.
- 트리거 예시 (if 3~4개 + config 수치 5~6개로 충분):

```
if (시총 상위 N위 && 부채비율 > 위험선 && 주가가 고점 대비 −X%) → 구제 이벤트
if (전체 지수 하루 낙폭 > Y%) → 서킷브레이커(거래 일시정지) + 뉴스
```

- 파산 빈도는 기존 config (`bankruptcyDebtRevenueRatio`, `bankruptcyLossStreakTicks`) 튜닝 문제.

## 6. 설명 레이어 (필수 — "복잡한데 와닿지 않음" 방지)

- 내부적으로 요인별 기여분을 계산하므로 노출만 하면 됨 (구현비 ≈ 0, 체감 효과 최대).
- **노출 수위**: 수치·수식 숨김, **요인 이름만** — "▼ 하락 — 금리인상, 원자재 급등". 크기 힌트는 아이콘 등급(▼/▼▼)까지만.
- 인과는 체감되지만 역산 불가. 정확한 계수를 알아내는 것 자체가 고인물의 콘텐츠(FM 스카우팅처럼).
- **조작 관련 수치(유저 영향력 캡 등)는 절대 비공개.**

## 7. 시간 설계 (실시간 단일 서버 — 포기 불가 핵심)

가격 틱: 20~30초. 접속시간 강제 제한은 **기각** (짜증만 유발). 대신 **"관찰은 무한, 행동은 유한"**:

- **개장**: 09:00~익일 01:00. 휴장: 01:00~05:00 (정산 + "내일 금리 발표" 예고 → 다음날 접속 동기).
- **띄엄띄엄 개장 기각** — 라이트 유저 접속창을 좁힘. 대신 **메인 세션제**: 평소엔 잔잔(체감 60초급), 하루 3~4회(출근/점심/저녁) 뉴스 집중 투하 + 변동성↑. 하드코어는 상시 감시 유인, 라이트는 "저녁 8시만 들어와도 본전".
- **롱 보호**: 안정화 클램프로 하루 낙폭 한계 + **예약 주문(지정가/손절)** 제공 → 자는 동안 방어 가능.
- **고인물 격차 제어**: 접속시간이 아니라 **일일 행동 리소스** (거래 횟수/정보 구매권). 정보 격차는 허용하되 행동 격차는 캡. 물 고임 방지 표준 해법.

## 8. 구현 순서

1. `macro` 모듈 신규 (금리·원자재·경기, config 기반) — 배관
2. `pricing.ts` profit 파생 계산 + **설명 레이어(요인 기여분 기록)** 동시 구현
3. `sectors.ts` 랜덤워크 → 이벤트 구동 + rateSensitivity 교체
4. 뉴스 이벤트 풀 + chain 연쇄 (intel 모듈 확장)
5. 중앙은행 트리거 개입 (구제/서킷브레이커)
6. 세력 프로파일 AI 3종 (피드백 루프 완성 후 — 루프 없이 에이전트만 있으면 반응할 세계가 없음)
7. 이미지 2축 (독립적, 마지막)

전 항목 config JSON 구동 → 섹터/이벤트/원자재 추가에 코드 수정 불필요.

## 9. 비용/모델 운용 전략

- 지금까지: ~$55 (골격). 이번 설계 구현: $30~50 (Sonnet 기준) → **DeepSeek V4 Pro 주력 시 $5~10 수준**.
- V4 Pro 가격 (1M tokens): 입력 $0.435 / 출력 $0.87 / 캐시히트 $0.0036 — Sonnet 대비 실질 ~90% 절약. 성능은 Sonnet의 85~95% (모듈 단위 구현엔 충분; 긴 멀티파일 리팩터링·미묘한 버그만 Opus/Sonnet 스팟 투입).
- 2026-08-16부터 피크/오프피크 요금: 피크 = UTC 01-04, 06-10 (**한국 10~13시, 15~19시**) 약 3배 비쌈 → 작업 시간대 조절.
- **런타임 AI API 연동 불필요** (전부 결정론적 수식) → 서버 운영비 월 $5~20 수준.
- 출시 가능 수준 총비용: UI/온보딩/밸런싱 포함 $200~400 (Sonnet 기준) → V4 Pro 주력 시 $30~60.

## 10. 냉정한 목표 설정

- 이 설계 = "독점적 지위"의 **필요조건**. 충분조건은 밸런싱 반복 + 커뮤니티 (FM도 수십 년 누적).
- 현실 사거리: 주갤 바이럴 → 니치 컬트 인기. 실시간 단일 서버 + 인과 있는 시장 + 세력전 조합은 모바일 실질 경쟁작 부재 → 니치 독점 노려볼 만함.
- 100만 다운로드는 시스템보다 **온보딩(뉴비 첫 10분)** 과 바이럴 운이 결정. 시스템은 자격 요건.
