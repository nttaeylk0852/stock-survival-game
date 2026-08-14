# governance

`modules/governance/index.ts`

- **역할**: 주주 안건 시스템. 안건 발의 → 보유 주식수 가중 투표 → 마감 시 가결/부결 판정 → 가결 시 회사 스탯 변경.
- **config**: `market.json` — `userInfluenceCap` (유저가 회사에 미칠 수 있는 영향력 상한)
- **주요 함수**
  - `createAgenda()` — 대상 회사·스탯키·변경량·마감시간(분)으로 안건 생성
  - `vote()` — 보유 주식이 있어야 투표 가능, 주식 수만큼 표 가중치 부여 (재투표 시 갱신)
  - `resolveAgendas()` — 마감된 안건 일괄 처리. 매 PRICE_TICK 호출됨
  - `getOpenAgendas()` / `getAgenda()`
- **가결 공식**: 찬성 > 반대이면 가결. 단 스탯 변경량은 그대로 적용되지 않고 `delta × min(1, 전체유저보유주식 / (발행주식수 × userInfluenceCap))`만큼만 반영된다. 즉 유저 지분이 적으면 영향력도 비례해 줄어든다.
- **연계**: 가결 시 `influence.recordGovernanceInfluence()`로 조작 영향력이 누적된다.
