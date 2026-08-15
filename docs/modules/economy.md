# economy

## ledger (`modules/economy/ledger.ts`)
- **역할**: 모든 화폐 이동의 단일 통로. 발행(mint), 이체(transfer), 압류(seize/seizeAll)를 담당하고 매 TICK마다 통화량 보존을 검증한다.
- **config**: `economy.json` — `starterCash`
- **주요 함수**: `mint()` 중앙은행에서 신규 발행 · `transfer()` 잔고 검증 후 이체 · `seizeAll()` 사망 시 전액 국고 이전 · `getBalance()` · `assertConservation()` 총 공급 = 총 발행 검증
- **규칙**: 계좌 잔고를 직접 UPDATE하지 말고 반드시 이 모듈을 경유할 것.

## macro (`modules/economy/macro.ts`)
- **역할**: 테일러 준칙 금리(빅스텝), 원자재 랜덤워크→물가지수(CPI), 경기사이클 사인파, 국채 발행.
- **config**: `economy.json` — `taylor`(a·b·targetGrowthRate·normalStep·bigStep·bigGapThreshold), `businessCycle`(periodDays·amplitude), `targetInflationRate`, `baseInterestRate` / `commodities.json` — 원자재(basePrice·cpiWeight·volatility)
- **주요 함수**: `getState()` MacroState(금리·CPI·원자재·경기·시장성장률) · `getCpiIndex()`/`getMaterialIndex()` 물가지수=원자재 가중평균 · `getInterestRate()` · `onPriceTick()` 매 틱 원자재 랜덤워크+CPI 재계산, 게임 day 변경 시 하루 1회 테일러 준칙 판정+경기 위상 전진 · `buyBond()`
- **순수 함수**: `computeTargetInterestRate()` 목표금리 = 기본 + a×(물가상승−목표물가) + b×(시장성장률−목표성장률) · `applyInterestStep()` 빅스텝/노멀스텝 클램프 (테스트용)
