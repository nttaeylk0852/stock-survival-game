# market

## orderbook (`modules/market/orderbook.ts`)
- **역할**: 지정가 주문 접수와 가격/시간 우선 매칭 체결, 포트폴리오(보유 주식) 관리.
- **config**: `market.json` — `orderBookMaxDepth`
- **주요 함수**: `placeOrder()` 주문 접수(매수는 잔고, 매도는 보유주식 사전 검증) · `matchOrders()` 매수 내림차순 × 매도 오름차순 매칭 · `addShares()` 포트폴리오 증감 · `getPortfolio()` · `cancelOrder()`
- **주의**: 체결은 `transfer + addShares + 주문상태 갱신`을 하나의 트랜잭션으로 처리한다.

## amm (`modules/market/amm.ts`)
- **역할**: 상수곱(x·y=k) 유동성 풀 기반 시장가 즉시 매매. 지정가가 없으면 AMM으로 라우팅.
- **config**: `market.json` — `ammSlippageRate`, `ammFeeRate`
- **주요 함수**: `trade()` limitPrice 유무로 orderbook/amm 분기 · `buyFromAmm()` · `sellToAmm()` · `ensureAmmAccount()` `amm-{companyId}` 계좌 보장
- **주의**: 풀 계좌가 없으면 이체가 실패하므로 매수·매도 양쪽에서 계좌를 보장한다.

## influence (`modules/market/influence.ts`)
- **역할**: 유저의 시세 조작 영향력을 회사별로 누적하고 상한(기본 30%)을 강제. 매 PRICE_TICK 5%씩 감쇠.
- **config**: `market.json` — `userInfluenceCap`
- **주요 함수**: `recordTradeInfluence()` 가격 괴리 × 거래량 비중으로 영향력 누적 · `recordGovernanceInfluence()` 안건 가결분 반영 · `getRemainingCap()`
