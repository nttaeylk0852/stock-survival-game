# companies

## companies (`modules/companies/index.ts`)
- **역할**: 시드로부터 회사 생성, 스탯 기반 적정가 산출, 매 PRICE_TICK마다 주가 갱신 및 파산(상장폐지) 판정.
- **config**: `companies.json` — `aiWeights`, `bankruptcyDebtRevenueRatio`, `bankruptcyLossStreakTicks` / `companies.seed.json` / `market.json` — 가격 안정화 값
- **주요 함수**: `getCompany()` · `getAllCompanies()` · `getFairPrice()` 스탯 가중합 적정가 · `updateStat()` 안건 가결 시 스탯 변경 · `onPriceTick()` 가격·연속적자·상태 갱신
- **파산 조건**: 부채/매출 비율 초과 **그리고** 연속 적자 틱 초과 시 `DELISTED`.

## pricing (`modules/companies/pricing.ts`)
- **역할**: 순수 함수 가격 공식 모음(상태 없음).
- **주요 함수**: `calculateFairPrice()` 스탯 가중합 × 섹터 배수 · `applyStabilityFactor()` 로그 변화율을 최대 하락/상승폭으로 클램프해 급등락 제한 · `historicalMedian()`

## sectors (`modules/companies/sectors.ts`)
- **역할**: 섹터 지수를 매 PRICE_TICK 랜덤 변동시켜 회사 주가에 배수로 반영.
- **config**: `sectors.json` — `indices`, `volatilityPerTick`
- **주요 함수**: `getSectorMultiplier()` 회사가 속한 섹터 지수 평균 · `getIndices()` · `onPriceTick()` 지수를 0.5~2.0 범위에서 변동
