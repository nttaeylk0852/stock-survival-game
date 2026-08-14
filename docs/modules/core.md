# core & api

## config-loader (`core/config-loader.ts`)
- `config/*.json` 8개를 읽어 타입이 붙은 `AppConfig`로 반환한다. **밸런스 수치는 코드에 하드코딩하지 말고 반드시 여기서 로드한다.**

## event-bus (`core/event-bus.ts`)
- 모듈 간 느슨한 결합용 이벤트 버스. 이벤트 타입: `TICK` / `PRICE_TICK` / `SURVIVAL_TICK` / `SEASON_END`. `'*'`로 전체 구독 가능.

## module-registry (`core/module-registry.ts`)
- `GameModule` 인터페이스(`init` / `onTick` / `onPriceTick` / `onSurvivalTick`) 구현체를 등록·초기화한다. 새 모듈은 여기에 등록해야 틱을 받는다.

## tick-loop (`core/tick-loop.ts`)
- 게임 시간 진행 엔진. 기본값은 현실 1초 = 게임 1분, 30초마다 `PRICE_TICK`, 60초마다 `SURVIVAL_TICK`.

## bootstrap (`core/bootstrap.ts`)
- 모든 모듈을 의존성 순서(ledger → players → macro → sectors → companies → influence → orderbook → amm → governance → intel → clock → survival → season)로 생성·등록하고 `GameContext`를 반환한다. 서버와 테스트가 공유한다.

## api (`api/`)
- `routes.ts` + `routes-market.ts` — REST 엔드포인트. 모든 응답은 `ApiResponse` (`{ ok, data, error }`) 형식.
- `http.ts` — `ok()` / `fail()` / `handle()` 응답 헬퍼. 핸들러에서 throw하면 자동으로 에러 응답이 된다.
- `ws.ts` — `/ws` 경로 브로드캐스트. `TICK` → `world_state`, `PRICE_TICK` → `company_prices`, 루머·시즌종료 → `news`.
- `context.ts` — 모든 모듈 인스턴스를 담는 `GameContext` 타입.
