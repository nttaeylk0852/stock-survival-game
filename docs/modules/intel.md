# intel

`modules/intel/index.ts`

- **역할**: 정보 비대칭 시스템. 루머를 생성하고(일정 확률로 가짜), 유료 판매하며, 대주주에게 조기경보를 제공한다.
- **config**: `intel.json` — `rumorFakeRate`(가짜 비율), `infoPurchaseCostBase`(가격), `majorShareholderThreshold`(대주주 기준 지분율), `earlyWarningLeadTicks`
- **주요 함수**
  - `generateRumor()` — 루머 생성 후 DB 저장. 등록된 리스너에게 통지 (WebSocket 뉴스 푸시용)
  - `purchaseIntel()` — 대금을 국고로 이체하고 구매 이력 기록. 이때 비로소 진위(`isFake`)가 공개된다
  - `getAvailableIntel()` — 아직 구매하지 않은 최신 20건
  - `notifyMajorShareholders()` — 지분율이 기준 이상인 홀더에게 조기경보
  - `onRumor()` — 루머 생성 이벤트 구독 (API 계층에서 사용)
  - `onPriceTick()` — 30% 확률로 무작위 회사 루머 생성
- **주의**: API 응답에서 미구매 정보의 `isFake`는 노출하지 않는다(구매 전에는 진위를 알 수 없어야 함).
