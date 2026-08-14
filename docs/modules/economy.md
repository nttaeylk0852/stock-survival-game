# economy

## ledger (`modules/economy/ledger.ts`)
- **역할**: 모든 화폐 이동의 단일 통로. 발행(mint), 이체(transfer), 압류(seize/seizeAll)를 담당하고 매 TICK마다 통화량 보존을 검증한다.
- **config**: `economy.json` — `starterCash`
- **주요 함수**: `mint()` 중앙은행에서 신규 발행 · `transfer()` 잔고 검증 후 이체 · `seizeAll()` 사망 시 전액 국고 이전 · `getBalance()` · `assertConservation()` 총 공급 = 총 발행 검증
- **규칙**: 계좌 잔고를 직접 UPDATE하지 말고 반드시 이 모듈을 경유할 것.

## macro (`modules/economy/macro.ts`)
- **역할**: 통화량 기반 인플레이션 계산, 금리 자동 조절, CPI 지수 갱신, 국채 발행.
- **config**: `economy.json` — `targetInflationRate`, `baseInterestRate`, `bondIssueRate`, `newbieChurnPenaltyThreshold`
- **주요 함수**: `getState()` MacroState 반환 · `getCpiIndex()` 물가지수(식비/숙박비에 곱해짐) · `buyBond()` 국채 매입 · `onPriceTick()` 인플레이션·금리·CPI 재계산
