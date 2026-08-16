# 묶음 실행 설명 (6b–13)

> 저가형은 **다음 작업 한 섹션만** `docs/PLAN.md`로 덮어쓴다. 이 파일 전체를 PLAN에 넣지 말 것.
> 구현은 PLAN만 본다. 전역 grep 금지. 거래 일일캡을 다시 만들지 말 것.

---

## 묶음 6b — 거래 일일캡 삭제

다음 구현해야할 묶음: 6b

### 목표
거래 하루 횟수 한도를 없앤다. 장만 열려 있으면 거래 횟수 제한 없음.
정보 구매 한도(`dailyIntelPurchaseLimit`)는 유지.
DB 컬럼 `trades_used`는 DROP하지 말 것 (기존 DB). 읽기/한도 검사만 제거.

### 하지 말 것
스탑로스 발동/접수 로직 변경. 새 한도 추가. `ammFeeRate` 변경.

### 1. `config/market.json`
`dailyTradeLimit` 키를 삭제한다.

변경 전:
```json
  "historicalMedianWindow": 20,
  "dailyTradeLimit": 25
```
변경 후:
```json
  "historicalMedianWindow": 20
```

### 2. `packages/server/src/core/config-loader.ts`
`MarketConfig`에서 `dailyTradeLimit: number;` 줄을 삭제.

### 3. `packages/shared/src/index.ts`
변경 전:
```ts
export interface DailyActionsState {
  tradesUsed: number;
  tradeLimit: number;
  intelUsed: number;
  intelLimit: number;
}
```
변경 후:
```ts
export interface DailyActionsState {
  intelUsed: number;
  intelLimit: number;
}
```

### 4. `packages/server/src/modules/players/daily-actions.ts`
- `canTrade` 함수 삭제.
- `recordTrade` 함수 삭제.
- `usage()`는 `intel_used`만 읽어도 된다.
- `getState()`는 `intelUsed` / `intelLimit`만 반환.
- `resetAll()`과 `canPurchaseIntel` / `recordIntelPurchase`는 유지.
- 파일 상단 주석에서 “거래 횟수·”를 지운다.

`getState` 변경 후:
```ts
getState(characterId: string): DailyActionsState {
  const u = this.usage(characterId);
  return {
    intelUsed: u.intelUsed,
    intelLimit: this.config.intel.dailyIntelPurchaseLimit,
  };
}
```

### 5. `packages/server/src/modules/market/amm.ts`
`trade()`에서 다음을 **삭제**:
- `if (!this.dailyActions.canTrade(characterId)) throw new Error('Daily trade limit reached');`
- `this.dailyActions.recordTrade(characterId);` (stop / limit / market 세 곳)

`dailyActions`를 이 파일에서 더 이상 쓰지 않으면:
- constructor 인자 `private dailyActions: DailyActionsModule` 삭제
- `import type { DailyActionsModule }` 삭제
- `packages/server/src/core/bootstrap.ts`의 `new AmmModule(...)`에서 `dailyActions` 인자 삭제

`GameContext`의 `dailyActions` 필드는 API·intel용으로 **남긴다.**

### 6. `packages/server/src/test/run-tests.ts`
- 테스트 `'daily trade limit caps the number of trades'` **전체 삭제**.
- 테스트 `'daily actions reset when the market reopens'`를 정보 구매 기준으로 교체:

```ts
await test('daily intel usage resets when the market reopens', () => {
  const character = newCharacter(ctx, 'Resetter');
  const rumor = ctx.intel.generateRumor(companyId);
  ctx.intel.purchaseIntel(character.id, rumor.id);
  assert(ctx.dailyActions.getState(character.id).intelUsed > 0, 'intel should be counted');
  driveTime(ctx, 4);
  driveTime(ctx, 9);
  assertEqual(
    ctx.dailyActions.getState(character.id).intelUsed,
    0,
    'daily intel usage should reset at market open'
  );
});
```

`tradesUsed` / `dailyTradeLimit` / `canTrade` / `recordTrade` / `'Daily trade limit reached'`를 이 파일에 남기지 말 것.

### 검증
- [ ] `npm test` 통과
- [ ] `dailyTradeLimit`이 config와 MarketConfig에 없음
- [ ] 거래가 장 중 횟수 제한 없이 됨 (기존 AMM 테스트가 커버)

### 완료 후
PROGRESS 묶음 6b 체크. 다음 작업 = 묶음 7. PLAN을 아래 묶음 7 섹션으로 교체. **멈춤.**


---

## 묶음 7 — 스탑로스 접수

다음 구현해야할 묶음: 7

### 목표
걸기·취소·저장·내 목록. **아직 체결하지 않음.** sell only.
공개 경로는 `amm.trade(..., orderType:'stop')` (API와 동일).

### 하지 말 것
`onPriceTick` 발동 로직 수정. 일일캡/횟수. 매수 스탑 허용. 거래 한도.

### 이미 있는 것 (다시 짜지 말 것)
`Order.type = 'limit' | 'stop'`, DB `orders.order_type`,
`placeOrder(..., type)`, `getOpenStopOrders()`, `cancelOrder()`,
`POST /api/trade`의 `orderType`, 지정가 매칭에서 stop 제외.

### 1. `packages/server/src/modules/market/orderbook.ts`
`placeOrder` 초반, quantity/price 검사 뒤에:

```ts
if (type === 'stop' && side !== 'sell') {
  throw new Error('Stop-loss is sell only');
}
```

함수 추가 (`getOpenOrders` 근처):

```ts
getOpenOrdersForCharacter(characterId: string): Order[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM orders WHERE character_id = ? AND status = 'open' ORDER BY created_at DESC`
    )
    .all(characterId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    characterId: row.character_id as string,
    companyId: row.company_id as string,
    side: row.side as 'buy' | 'sell',
    type: (row.order_type as Order['type']) ?? 'limit',
    price: row.price as number,
    quantity: row.quantity as number,
    status: row.status as Order['status'],
    createdAt: row.created_at as number,
  }));
}
```

### 2. `packages/server/src/api/routes.ts`
`GET /characters/:id/portfolio` 핸들러 **다음**에:

```ts
router.get(
  '/characters/:id/orders',
  handle((req, res) => {
    const character = ctx.players.getCharacter(req.params.id);
    if (!character) throw new Error('Character not found');
    ok(res, { orders: ctx.orderBook.getOpenOrdersForCharacter(req.params.id) });
  })
);
```

### 3. `packages/server/src/test/run-tests.ts`
`runStopLossIntakeTests(ctx, companyId)` 추가. `main`에서 `runTimeDesignTests` **앞**에 호출.

공개 경로는 `ctx.amm.trade`. `placeOrder` 직행 테스트를 7에 추가하지 말 것.

| 테스트 이름 | 단언 |
|---|---|
| stop-loss placement does not sell | `buyFromAmm` 10주 → `trade(id, companyId, 'sell', 10, stopPrice, 'stop')` → shares===10, cash 불변, `getOpenOrdersForCharacter`에 type==='stop' status==='open' |
| stop-loss cancel keeps shares | 위 접수 후 `cancelOrder` → status cancelled, shares===10 |
| stop-loss buy is rejected | `trade(..., 'buy', 1, price, 'stop')` throw |
| stop-loss without shares is rejected | 0주 캐릭터 `trade(..., 'sell', 1, price, 'stop')` throw `'Insufficient shares'` |

`stopPrice`는 `currentPrice * 0.5` (현재가보다 낮게). 발동(`onPriceTick`)을 이 테스트에서 호출하지 말 것.

### 검증
- [ ] `npm test` 통과

### 완료 후
PROGRESS 묶음 7 체크. 다음 작업 = 묶음 8. PLAN을 묶음 8로 교체. 발동 코드 손대지 말 것. **멈춤.**

---

## 묶음 8 — 스탑로스 발동

다음 구현해야할 묶음: 8

### 목표
조건가 이하 → AMM 시장가 매도. 실패해도 주문이 `open`으로 남음.
발동 경로에서 `trade()` / `recordTrade` / `cancelOrder` 금지.

### 하지 말 것
수수료 공식 변경. 일일캡. 접수 API 재설계.

### 1. `packages/server/src/modules/market/amm.ts` — `onPriceTick`

변경 후 (이 내용으로 교체):

```ts
onPriceTick(_event: TickEvent): void {
  if (!this.marketSession.isMarketOpen()) return;

  for (const order of this.orderBook.getOpenStopOrders()) {
    if (order.side !== 'sell') continue;
    const company = this.companies.getCompany(order.companyId);
    if (!company || company.status !== 'ACTIVE') continue;
    if (company.currentPrice > order.price) continue;

    const holdings = this.orderBook.getPortfolioEntry(order.characterId, order.companyId);
    const qty = Math.min(order.quantity, holdings.shares);
    if (qty <= 0) continue;

    try {
      this.sellToAmm(order.characterId, order.companyId, qty);
      getDb().prepare(`UPDATE orders SET status = 'filled' WHERE id = ?`).run(order.id);
    } catch {
      // 체결 실패 시 주문은 open 유지
    }
  }
}
```

파일 상단에 `getDb`가 이미 import 되어 있다.

### 2. `packages/server/src/test/run-tests.ts`
기존 `'stop-loss order triggers a market sell on price drop'`를 **삭제**하고
`runStopLossTriggerTests(ctx, companyId)`로 교체. `main`에서 intake 테스트 다음에 호출.

접수는 반드시 `ctx.amm.trade(..., 'stop')`.

| 테스트 | 단언 |
|---|---|
| stop-loss triggers market sell on drop | 10주 매수 → stop 접수 → `UPDATE companies SET current_price = stopPrice-1` → `onPriceTick` → shares===0, 해당 주문 status==='filled' |
| stop-loss does not fire above trigger | current = stopPrice+1 → shares 그대로, status open |
| failed stop-loss stays open | 접수 후 주식을 `sellToAmm`으로 전부 매도 → 가격을 관통 → `onPriceTick` → 주문 status==='open' (cancelled/filled면 실패) |
| stop-loss does not fire while closed | 접수 후 `driveTime(ctx, 4)` → 가격 관통 → `onPriceTick` → shares 그대로, status open |

### 검증
- [ ] `npm test` 통과

### 완료 후
PROGRESS 묶음 8 체크. 다음 작업 = 묶음 9. PLAN을 묶음 9로. **멈춤.**

---

## 묶음 9 — 스탑로스 × 장

다음 구현해야할 묶음: 9

### 목표
휴장 땐 **신규** 손절/주문 금지. 이미 걸린 손절은 휴장에도 남음. 취소는 휴장에도 됨.
거래 횟수 한도는 **만들지 말 것.** (6b에서 삭제됨)

### 코드
이미 `placeOrder` / `marketOrder`가 휴장 시 throw `'Market closed'`.
`cancelOrder`가 개장 체크를 **하면 그 체크를 삭제**한다. 신규만 막는다.
동작이 아래 테스트와 맞으면 코드를 더 바꾸지 말 것.

### 테스트 `runStopLossSessionTests` (`main`에서 trigger 다음)

| 테스트 | 단언 |
|---|---|
| closed market rejects new stop | `driveTime(4)` 후 `trade(..., 'stop')` throw `'Market closed'` |
| existing stop survives close | 개장 중 걸고 `driveTime(4)` → `getOpenOrdersForCharacter`에 그대로 open |
| cancel works while closed | 개장 중 걸고 `driveTime(4)` 후 `cancelOrder` 성공, status cancelled |
| stop fires after reopen | 개장 중 걸고 `driveTime(4)`, 가격을 관통, `driveTime(10)` 후 `onPriceTick` → 8의 규칙대로 filled + 매도 |

### 검증
- [ ] `npm test` 통과
- [ ] 거래/손절 횟수 한도 테스트가 없음

### 완료 후
PROGRESS 묶음 9 체크. 다음 작업 = 묶음 10. PLAN을 묶음 10으로. **멈춤.**


---

## 묶음 10 — 직업

다음 구현해야할 묶음: 10

### 목표
정규/알바. 대가·거래제한 없음. 초반만 10%.
시즌 wall-clock(`season.ts`의 Date.now())은 **고치지 말 것.**

### 하지 말 것
여유에 CPI 곱하기. `Date.now()`로 7일. 직업 시뮬. 거래횟수 페널티. 출퇴근.

### 1. `config/jobs.json` (신규 파일)
```json
{
  "regularAllowanceRatio": 0.1,
  "regularDurationGameDays": 7,
  "regularIndependenceMultiple": 2,
  "partTimeExtra": 50
}
```

### 2. `packages/server/src/core/config-loader.ts`
```ts
export interface JobsConfig {
  regularAllowanceRatio: number;
  regularDurationGameDays: number;
  regularIndependenceMultiple: number;
  partTimeExtra: number;
}
```
`loadAllConfig()`에 `jobs: loadConfig<JobsConfig>('jobs.json')` 추가.

### 3. `packages/server/src/db/index.ts`
`characters` CREATE TABLE에 컬럼 추가:
```
job_kind TEXT,
job_started_total_minutes INTEGER,
regular_done_season INTEGER NOT NULL DEFAULT 0
```
기존 DB용 ALTER (`runMigrations` 하단, order_type과 같은 패턴):
`PRAGMA table_info(characters)` 후 세 컬럼 없으면 ADD COLUMN. `regular_done_season` 기본값 0.
`createCharacter` INSERT는 새 컬럼을 생략해도 된다.

### 4. `packages/shared/src/index.ts` — `Character`에 추가
```ts
jobKind: 'regular' | 'parttime' | null;
jobStartedTotalMinutes: number | null;
regularDoneSeason: boolean;
```
`PlayersModule.getCharacter` row 매핑에 같은 필드. `job_kind` null → `jobKind: null`. `regular_done_season` 0/1 → boolean.

### 5. `packages/server/src/modules/market/orderbook.ts`
순자산 한곳:
```ts
getNetWorth(characterId: string): number {
  const accountId = this.players.getAccountId(characterId);
  const cash = this.ledger.getBalance(accountId);
  let stock = 0;
  for (const e of this.getPortfolio(characterId)) {
    const company = this.companies.getCompany(e.companyId);
    stock += e.shares * (company?.currentPrice ?? 0);
  }
  return cash + stock;
}
```
`packages/server/src/api/routes.ts`의 portfolio `netWorth`를 `ctx.orderBook.getNetWorth(id)`로 교체.

### 6. 신규 `packages/server/src/modules/players/jobs.ts`

순수 함수 (export, 테스트용):
```ts
export function regularPay(
  cpi: number, meal: number, rest: number, starter: number, ratio: number
): number {
  return (meal + rest) * cpi + starter * ratio;
}

export function partTimePay(cpi: number, rest: number, extra: number): number {
  return rest * cpi + extra;
}

export function gameDayIndex(totalMinutes: number): number {
  return Math.floor(totalMinutes / (24 * 60));
}

export function regularShouldEnd(
  currentTotalMinutes: number,
  startedTotalMinutes: number,
  durationDays: number,
  netWorth: number,
  starter: number,
  multiple: number
): boolean {
  return (
    gameDayIndex(currentTotalMinutes) - gameDayIndex(startedTotalMinutes) >= durationDays ||
    netWorth >= starter * multiple
  );
}
```


`JobsModule` (`GameModule`):
- constructor(config, ledger, players, orderBook, macro)
- `takeJob(characterId, kind: 'regular'|'parttime', totalMinutes: number)`
  - 살아 있어야 함. 이미 job_kind 있으면 throw.
  - regular인데 `regularDoneSeason`이면 throw `'Regular job unavailable this season'`
  - 거래횟수/개장 **검사 금지**
  - `job_started_total_minutes` = 인자 `totalMinutes` (API가 `ctx.tickLoop.getGameTime().totalMinutes`를 넘김)
- `quitJob(characterId)` — regular면 `regular_done_season=1` 후 kind NULL. parttime은 kind NULL만.
- `getJob(characterId)`
- `onMarketOpen(gameTime: GameTime)`:
  1. 산 캐릭터 전원, regular면 `regularShouldEnd` → 종료 시 kind NULL + regular_done_season=1, **그날 mint 없음**
  2. 남은 직장에 `ledger.mint(accountId, pay, 'JOB_INCOME')`
  - regularPay / partTimePay에 `macro.getCpiIndex()`, config survival meal/rest, economy.starterCash, jobs.* 사용

시즌 종료: `SeasonModule.onSeasonEnd`에서 캐릭터를 죽인 뒤
`UPDATE characters SET regular_done_season = 0, job_kind = NULL, job_started_total_minutes = NULL`
(`season.ts`의 시간 공식은 바꾸지 말 것.)

### 7. 연결
- `api/context.ts`에 `jobs: JobsModule`
- `bootstrap.ts`에서 생성·register. `MarketSessionModule` 개장 분기(`!wasOpen && nowOpen`)에 `this.jobs.onMarketOpen(event.gameTime)` 추가. MarketSessionModule constructor에 `jobs` 인자 추가.
- API (`routes.ts` 또는 `routes-market.ts`):
  - `POST /api/jobs` body `{ characterId, kind }` → takeJob(..., tickLoop totalMinutes)
  - `DELETE /api/jobs` body `{ characterId }` → quitJob
  - `GET /characters/:id` 응답에 `job: getJob(...)`, `netWorth: orderBook.getNetWorth(...)` 포함

### 8. 테스트 `runJobTests`

| 테스트 | 단언 |
|---|---|
| regularPay formula | `(500+200)*1.0 + 10000*0.1 === 1700` (함수 인자로 고정) |
| partTimePay formula | `200*1.0 + 50 === 250` |
| regularPay allowance ignores cpi | `regularPay(2, 500, 200, 10000, 0.1) === 1400 + 1000` |
| regular payday on open | take regular → `driveTime(4)` → `driveTime(9)` → 잔고 += regularPay(현재CPI, config값) |
| parttime payday on open | 동일, partTimePay |
| job does not block trades | 직장 있어도 `amm.trade` 시장가 성공 |
| regular ends after 7 game days | take 후 `job_started_total_minutes`를 `current - 7*1440`으로 UPDATE → 개장 훅 → kind null, 그날 mint 없음, take regular throw |
| regular ends at independence | 주식을 사서 netWorth ≥ starter*2 만든 뒤 개장 → 종료 |
| parttime allowed after regular ends | 정규 종료 후 take parttime 성공 |

개장 훅은 `driveTime` → `MarketSessionModule.onTick`. bootstrap 연결이 맞으면 `driveTime(4)`→`driveTime(9)`로 급여가 들어온다.

### 검증
- [ ] `npm test` 통과

### 완료 후
PROGRESS 묶음 10 체크. 다음 작업 = 묶음 11. PLAN을 묶음 11로. **멈춤.**

---

## 묶음 11 — 시즌 순자산 랭킹

다음 구현해야할 묶음: 11

### 목표
지금 살아있는 캐릭터 순자산 + 내 등수. 테이블·영구보드·뉴비보드 없음.
`getNetWorth`는 10에서 생김. 재구현하지 말 것.

### 1. 신규 `packages/server/src/modules/players/ranking.ts`
```ts
listLive(orderBook, players): { characterId, name, netWorth }[]
// is_alive=1, netWorth 내림차순, 동점이면 created_at 오름차순

rankFor(characterId): { rank, netWorth, total, board }
// 죽은 캐릭터면 throw 'Character not alive'
```
bootstrap에 넣거나 SeasonModule에 붙여도 됨. **새 테이블 금지.**

### 2. API
```
GET /api/ranking?characterId=
→ { myRank, myNetWorth, total, board: [{ rank, characterId, name, netWorth }] }
characterId 없으면 myRank=null, myNetWorth=null, board+total만.
```

### 3. 테스트 `runRankingTests`
- 현금만 다른 3명 → 등수 1·2·3, 이름 일치
- 같은 현금 + 한쪽만 주식 → 주식 쪽이 위
- 동점 → `created_at` 이른 쪽이 위
- `rankFor`의 rank가 board와 일치
- 시즌 킬(`season.onSeasonEnd`) 후 total===0

### 검증
- [ ] `npm test` 통과

### 완료 후
PROGRESS 묶음 11 체크. 다음 작업 = 묶음 12. PLAN을 묶음 12로. **멈춤.**


---

## 묶음 12 — 웹 UI

다음 구현해야할 묶음: 12

### 목표
브라우저 4탭. Expo / create-expo-app / 차트 라이브러리 **금지**.
`packages/web`은 npm workspace에 넣지 말 것 (빌드 없음).

### 1. 뉴스 기억 — `packages/server/src/modules/intel/index.ts`
`broadcastNews`가 최근 50개를 메모리 배열에 넣은 뒤 slice.
`getRecentNews(): { title, body, companyId, createdAt }[]`
루머 구매 목록과 분리. `isFake` 넣지 말 것.

### 2. API
`GET /api/news` → `ctx.intel.getRecentNews()` (`routes-market.ts` world 근처)

### 3. `packages/server/src/api/ws.ts` — `buildPricePayload`
각 회사에 `factors: this.ctx.companies.getPriceFactors(company.id)` 추가 (이름+화살표만).

### 4. `packages/server/src/index.ts`
`app.use('/api', ...)` **앞**에:
```ts
app.use(express.static(path.resolve(__dirname, '../../../packages/web/public')));
```

### 5. 정적 파일 (신규)
- `packages/web/public/index.html`
- `packages/web/public/app.js`
- `packages/web/public/styles.css`

바닐라 JS. 프레임워크 금지.
로컬스토리지에 username / characterId. 없으면 `POST /api/users` + `POST /api/characters`.
탭 4개 (버튼, 라우터 라이브러리 금지):

| 탭 | 데이터 | 조작 |
|---|---|---|
| 시세 | `GET /api/companies`, 선택 시 `GET /api/companies/:id` (priceFactors, priceHistory는 **숫자 나열**. 차트 금지) | 없음 |
| 뉴스 | `GET /api/news` + WS `news`면 목록 앞에 추가 | 없음. intel 구매 UI 없음 |
| 생존 | character + portfolio + job + world.macro.cpiIndex | eat / rest / take·quit job |
| 주문 | 보유, `GET /api/characters/:id/orders`, world.market.open | 시장가 / 지정가 / 손절(매도만) / 취소 |

상단에 한 줄: `금리↑ → 밥값↑ → 손절 걸어라.`
`userInfluence` / 조작 수치 화면에 내지 말 것.

### 6. 테스트
서버 테스트 하나: `broadcastNews` 후 `getRecentNews().length >= 1`.
기존 테스트 회귀.

### 검증
- [ ] `npm test` 통과

### 완료 후
PROGRESS 묶음 12 체크. 다음 작업 = 묶음 13. PLAN을 묶음 13으로. **멈춤.**

---

## 묶음 13 — 유저 기관 (뼈대, 꺼 둠)

다음 구현해야할 묶음: 13

### 목표
`userInstitutionEnabled === false`면 기존 투표와 **비트 단위로 동일**.
테스트 외에서 flag를 true로 커밋하지 말 것.

### 1. `config/market.json`에만 추가
```json
"userInstitutionEnabled": false,
"institutionTermGameDays": 30,
"institutionMinNetWorthMultiple": 3,
"institutionSeatPerCompany": 1
```
`MarketConfig`에 같은 필드. `userInfluenceCap`은 이미 0.3 — 가결 공식 유지.

### 2. DB `institution_seats`
```
company_id TEXT PRIMARY KEY,
character_id TEXT,
started_total_minutes INTEGER,
status TEXT
```
status: `'held' | 'offered' | 'empty'`

### 3. 신규 `packages/server/src/modules/governance/institution.ts` (또는 governance 메서드)
flag false면 좌석·오퍼 로직 전부 return. 기존 `vote`/`resolveAgendas` 분기하지 말 것.
flag true일 때만 (테스트에서 config 덮어쓰기):
- 회사당 좌석 1
- 자격: 그 회사 보유 + netWorth ≥ starter × multiple
- 임기 `institutionTermGameDays` (gameDayIndex, Date.now 금지)
- 미달·임기 종료 → 박탈 후 차순위 offer
- refuse → 그다음 후보자

### 4. API
```
GET  /api/institutions
POST /api/institutions/:companyId/accept
POST /api/institutions/:companyId/refuse
```
flag false면 `{ enabled: false }` (403 아님). 기존 agendas는 그대로.

### 5. 테스트
- flag false: 기존 agenda 테스트 통과 + institutions GET이 `{ enabled: false }`
- flag true는 **테스트 함수 안에서만** `ctx.config.market.userInstitutionEnabled = true`:
  - 자격 미달 박탈
  - 차순위 refuse 후 3순위
  - 임기 30일 후 empty
커밋된 `market.json`의 값은 false 유지.

### 검증
- [ ] `npm test` 통과
- [ ] `userInstitutionEnabled`가 json에서 false

### 완료 후
PROGRESS 묶음 13 체크. 다음 작업 = 없음. PLAN을 빈 템플릿으로:
```
# Plan
다음 구현해야할 묶음: 없음
```
**멈춤.** 시즌 시계·FORCE_CAPITAL은 하지 말 것.


---

## 묶음 14 — 시즌 시계 (게임시간 기준)

다음 구현해야할 묶음: 14

### 목표
시즌 종료 판정을 현실 시간(`Date.now()`)에서 **게임 시간**으로 바꾼다.
지금은 `seasonStartedAt = Date.now()` + `seasonLengthDays × 24h`(현실 90일)이라
한 판이 현실 3개월이다. 로그라이크로 성립하지 않는다.

### 하지 말 것
캐릭터 사망 처리·시즌 번호 증가·`SEASON_END` 브로드캐스트 로직 변경.
`season_medals` 테이블 변경. 랭킹 로직 변경. 새 테이블 추가.

### 1. `config/world.json`
`"seasonLengthDays": 90` → `"seasonLengthDays": 7`
(게임 7일 = `realSecondsPerGameMinute:1` 기준 현실 약 2.8시간)

### 2. `packages/server/src/modules/world/season.ts`
- `private seasonStartedAt = Date.now();` → `private seasonStartedTotalMinutes = 0;`
- `getSeasonInfo()`가 `startedAt`/`endsAt` 대신
  `startedTotalMinutes` / `endsTotalMinutes` / `remainingMinutes`를 반환.
  `endsTotalMinutes = startedTotalMinutes + seasonLengthDays × 1440`
- `onTick(event)`은 `event.gameTime.totalMinutes >= endsTotalMinutes`일 때 `onSeasonEnd()` 호출.
- `onSeasonEnd()`에서 `this.seasonStartedTotalMinutes = event.gameTime.totalMinutes`로 갱신.
  (event가 없으면 0 대신 마지막 값 유지)
- `seasonStartedTotalMinutes`를 `system_state`에 `season_started_minutes` 키로 저장/복원.
  `season_number` 저장 방식과 동일한 패턴을 쓴다.
- `awardMedal()`의 `Date.now()`는 기록용 타임스탬프이므로 **그대로 둔다.**

### 3. 응답 타입
`packages/shared/src/index.ts`에 `SeasonInfo`가 있으면 필드명을 위와 맞춘다.
없으면 만들지 마라.

### 4. 테스트 `runSeasonTests`
- 시즌 시작 직후 `remainingMinutes === seasonLengthDays × 1440`
- `driveTime`으로 게임 7일을 넘기면 시즌 번호가 +1 되고 산 캐릭터가 0명
- 시즌 종료 후 `startedTotalMinutes`가 종료 시점으로 갱신됨
- `Date.now()`에 의존하는 단언을 쓰지 마라

### 검증
- [ ] `npm test` 통과
- [ ] `season.ts`에 시즌 길이용 `Date.now()`가 남아있지 않음

### 완료 후
PROGRESS 묶음 14 체크. 다음 작업 = 묶음 15. PLAN을 묶음 15로. **멈춤.**

---

## 묶음 15 — 죽음과 다시하기

다음 구현해야할 묶음: 15

### 목표
캐릭터가 죽거나 시즌이 끝나면 결과 화면을 띄우고 새 캐릭터로 다시 시작하게 한다.
지금은 죽으면 웹이 그냥 멈춘다.

### 하지 말 것
사망 조건 변경. 부활·보험·이어하기. 영구 성장 요소. 새 시장.

### 1. 서버 — 런 요약
`GET /api/characters/:id` 응답에 이미 `character.isAlive`가 있다. 여기에 추가:
- `deathCause`: characters 테이블에 `death_cause TEXT` 컬럼 추가(마이그레이션),
  사망 처리 시 `'starvation'|'exposure'|'season_end'` 중 하나를 기록
- `survivedGameDays`: `(지금 totalMinutes − 생성 시 totalMinutes) / 1440` 내림
  (characters에 `created_total_minutes INTEGER` 컬럼 추가. 생성 시 기록)
- `peakNetWorth`: characters에 `peak_net_worth REAL`. 순자산 조회 시 갱신하지 말고,
  생존 틱에서 현재 순자산이 더 크면 UPDATE

### 2. 웹 — 결과 화면
`packages/web/public/app.js`:
- `loadCharacter()` 후 `character.isAlive === false`면 다른 렌더를 건너뛰고 `renderGameOver()`
- 결과 카드: 사인 / 생존 게임일 / 최고 순자산 / 최종 순자산 / 최종 등수(`GET /api/ranking`)
- 버튼 하나: "다시 시작" → `localStorage.removeItem('characterId')` 후
  `POST /api/characters`로 새 캐릭터 생성 → `location.reload()`
- 닉네임(`username`)은 지운다. 같은 이름으로 계속 하게 둔다.

### 3. 테스트
- 굶겨 죽인 뒤 `deathCause === 'starvation'`
- 시즌 종료로 죽으면 `deathCause === 'season_end'`
- `survivedGameDays`가 0 이상 정수
- `peakNetWorth >= 현재 순자산`

### 검증
- [ ] `npm test` 통과

### 완료 후
PROGRESS 묶음 15 체크. 다음 작업 = 묶음 16. PLAN을 묶음 16으로. **멈춤.**

---

## 묶음 16 — 영어화

다음 구현해야할 묶음: 16

### 목표
해외 인디 커뮤니티 배포용. 유저에게 보이는 문자열을 **전부 영어**로 바꾼다.
다국어 프레임워크·언어 전환 UI 금지. 영어 하나로 통일한다.

### 하지 말 것
i18n 라이브러리 도입. 언어 선택 UI. 코드 주석 번역(주석은 한국어 유지).
숫자 포맷 로직 변경 외의 게임 규칙 변경.

### 1. `packages/web/public/index.html`
- `<html lang="ko">` → `<html lang="en">`
- 탭: Market / News / Survival / Orders
- 온보딩 줄: `Rates up → food costs up → set a stop-loss.`

### 2. `packages/web/public/app.js`
모든 사용자 문자열을 영어로. `toLocaleString('ko-KR')` → `'en-US'`,
`toLocaleTimeString('ko-KR')` → `'en-US'`.
바꿀 문자열 예: 닉네임 입력, 주문/취소 토스트, 매수/매도(Buy/Sell),
시장가/지정가/손절(Market/Limit/Stop), 밥 먹기(Eat)/휴식(Rest),
정규직(Full-time)/알바(Part-time)/무직(Unemployed)/그만두기(Quit),
생존(Alive)/사망(Dead), 보유 없음(No holdings), 주문 없음(No orders), 뉴스 없음(No news).

### 3. 서버가 내보내는 문자열
- `config/companies.json` / `companies.seed.json` 회사명·설명 영어로
- `config/sectors.json` 섹터 표시명 영어로
- `config/news-events.json` headline·본문 영어로
- 루머 생성 문구가 코드에 하드코딩돼 있으면 그 문자열만 영어로
- `throw new Error('...')` 메시지 중 API로 유저에게 노출되는 것 영어로
  (이미 대부분 영어다. 한국어인 것만 바꾼다.)

### 4. 테스트
문자열을 비교하는 기존 테스트가 깨지면 그 테스트의 기대값도 같이 바꾼다.
새 테스트는 만들지 마라.

### 검증
- [ ] `npm test` 통과
- [ ] `packages/web/public/*.html|js`에 한글 문자열이 남아있지 않음

### 완료 후
PROGRESS 묶음 16 체크. 다음 작업 = 묶음 17. PLAN을 묶음 17로. **멈춤.**

---

## 묶음 17 — 첫 3분 온보딩

다음 구현해야할 묶음: 17

### 목표
처음 온 사람이 3분 안에 "뭘 하는 게임인지" 알게 한다.
`prompt()` 팝업을 없애고 시작 화면을 만든다.

### 하지 말 것
튜토리얼 강제 진행(스킵 불가). 별도 튜토리얼 시즌. 조작 수치·계수 공개.
`userInfluenceCap` 등 조작 관련 숫자를 화면에 내지 마라.

### 1. 시작 화면 (`index.html` + `app.js`)
`localStorage`에 `characterId`가 없으면 탭 UI를 숨기고 시작 화면을 보여준다.
- 제목: Stock Survival
- 3줄:
  - `You have rent, hunger, and a market that does not care.`
  - `News moves rates. Rates move prices. Prices move your dinner.`
  - `Set a stop-loss before you log off.`
- 닉네임 input + `Start` 버튼
- Start → `POST /api/users` + `POST /api/characters` → 탭 UI 표시
`prompt()` 호출을 전부 제거한다.

### 2. 탭별 첫 방문 힌트
`localStorage`의 `hint_seen_<tab>`이 없으면 그 탭 상단에 한 줄 힌트 + 닫기(×).
- Market: `Arrows show why a price moved. No numbers — figure it out.`
- News: `A shock hits one sector first, then spreads. Watch the delay.`
- Survival: `Eat or you die. Food price follows CPI.`
- Orders: `Stop-loss is sell-only. It protects you while you sleep.`
닫으면 `localStorage`에 기록하고 다시 띄우지 않는다.

### 3. 헤더 상태 줄
헤더에 항상 표시: 게임 날짜 / 장 상태(Open·Closed) / 현금 / 순자산.
`world_state` WS 메시지로 갱신한다.

### 4. 테스트
서버 테스트 변경 없음. 기존 테스트 회귀만 확인.

### 검증
- [ ] `npm test` 통과
- [ ] `app.js`에 `prompt(` 가 없음

### 완료 후
PROGRESS 묶음 17 체크. 다음 작업 = 묶음 18. PLAN을 묶음 18로. **멈춤.**

---

## 묶음 18 — 랭킹 노출 + 화면 정리

다음 구현해야할 묶음: 18

### 목표
이미 있는 `GET /api/ranking`을 화면에 붙이고, 스크린샷이 될 만큼만 다듬는다.

### 하지 말 것
차트 라이브러리(Chart.js 등) 설치 금지. CSS 프레임워크 금지. 프레임워크 금지.
영구 랭킹·뉴비보드 만들지 마라. 새 API 만들지 마라.

### 1. 랭킹 탭
다섯 번째 탭 `Ranking` 추가. `GET /api/ranking?characterId=`로
상위 20명 + 내 등수. 내 줄은 강조 클래스. 30초마다 갱신.

### 2. 스파크라인 (라이브러리 없이)
회사 상세의 `priceHistory` 숫자 나열을 CSS 막대로 바꾼다.
- `div` 20개, 각각 `height: {정규화값}%`
- 마지막 값이 첫 값보다 낮으면 `--bad`, 높으면 `--good`
- 캔버스·SVG·외부 라이브러리 쓰지 마라. div + inline height만.

### 3. `styles.css` 정리
- 등폭 숫자(`font-variant-numeric: tabular-nums`) 가격 전체 적용
- 카드 여백·행 높이 통일, 모바일 폭(360px)에서 깨지지 않게
- 회사 행에 `▲/▼` 색상 적용(`--good`/`--bad`)

### 4. 테스트
서버 테스트 변경 없음. 기존 테스트 회귀만 확인.

### 검증
- [ ] `npm test` 통과
- [ ] `package.json`에 새 의존성이 추가되지 않음

### 완료 후
PROGRESS 묶음 18 체크. 다음 작업 = 묶음 19. PLAN을 묶음 19로. **멈춤.**

---

## 묶음 19 — 배포

다음 구현해야할 묶음: 19

### 목표
인터넷에 24시간 떠 있는 주소를 만든다. Fly.io 기준.

### 하지 말 것
PostgreSQL 전환. 계정/비밀번호 시스템. CI 파이프라인. 도메인 구매 자동화.

### 1. `Dockerfile` (저장소 루트, 신규)
- `node:20-alpine` 베이스
- `better-sqlite3` 빌드용 `python3 make g++` 설치 (빌드 스테이지)
- `npm ci` → `npm run build` → 런타임 스테이지에 `dist` + `node_modules` + `config` + `packages/web/public` 복사
- `CMD ["node", "packages/server/dist/index.js"]`
- `EXPOSE 3000`

### 2. `fly.toml` (신규)
- `internal_port = 3000`
- `[[mounts]] source = "game_data", destination = "/data"`
- `[env] DB_PATH = "/data/game.db"`, `PORT = "3000"`
- `[http_service] force_https = true`, `auto_stop_machines = false`
  (시뮬레이션이 계속 돌아야 하므로 절대 자동 정지시키지 마라)
- `[[http_service.checks]]`로 `/health` 확인

### 3. `packages/server/src/index.ts`
- `DB_PATH` 환경변수가 있으면 그 경로를 쓰는지 확인. 이미 그렇다면 변경 없음.
- 서버 시작 시 DB 파일이 없으면 마이그레이션을 자동 실행하도록 한다.
- 정적 파일 경로가 컨테이너에서도 맞는지 확인 (`__dirname` 기준 상대경로).

### 4. `docs/DEPLOY.md` (신규, 짧게)
```
fly launch --no-deploy
fly volumes create game_data --size 1
fly deploy
fly logs
```
+ 롤백 방법 한 줄, DB 백업 방법 한 줄.

### 5. `README.md`
Quick Start 아래에 "Deploy" 섹션 3줄 추가. 설계 본문(§0~§11)은 건드리지 마라.

### 검증
- [ ] `npm test` 통과
- [ ] `docker build .` 성공 (실행은 안 해도 됨)
- [ ] `config/` 와 `packages/web/public/` 가 이미지에 포함됨

### 완료 후
PROGRESS 묶음 19 체크. 다음 작업 = 없음. PLAN을 빈 템플릿으로:
```
# Plan
다음 구현해야할 묶음: 없음
```
**멈춤.**

---

## 묶음 20 — 런타임 고정과 테스트 복구

다음 구현해야할 묶음: 20

### 목표
`npm test`가 **끝까지** 돌아 전 스위트가 PASS로 보이게 한다.
지금은 stop-loss 스위트 직후 네이티브 크래시(code 134)로 죽고,
jobs / ranking / time / institution / death / season 테스트가 아예 실행되지 않는다.

### 증상 (그대로 옮김)
```
PASS  failed stop-loss stays open
#  node.exe: Assertion failed: (env) != nullptr  at src/api/hooks.cc:142
#  Statement::`scalar deleting destructor'
npm error code 134
```
원인: 로컬 Node가 v24. `better-sqlite3@11`은 Node 20/22 대상이다.
GC가 prepared statement를 정리할 때 이미 사라진 env의 cleanup hook을 건드려 죽는다.

### 하지 말 것
- `better-sqlite3` 버전 올리기. (Alpine 재컴파일 리스크. 지금 건드리지 마라)
- 테스트 케이스 삭제·skip으로 크래시를 숨기기.
- 게임 규칙·config 수치 변경.
- PostgreSQL 전환.

### 1. `.nvmrc` (저장소 루트, 신규)
```
20
```

### 2. `package.json` (루트)
`"scripts"` 옆에 추가:
```json
"engines": { "node": ">=20 <21" }
```

### 3. `packages/server/src/db/index.ts`
파일 끝에 추가 (기존 export 아래):
```ts
/** 테스트·종료 시 statement finalize를 GC에 맡기지 않고 명시적으로 닫는다. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

### 4. `packages/server/src/test/run-tests.ts`
- 상단 import에 `closeDb`를 추가한다. (`from '../db'` — 이미 db에서 뭔가 import 중이면 거기 합친다)
- `main()` 마지막의
  ```ts
  process.exit(summarize());
  ```
  를 아래로 바꾼다:
  ```ts
  const code = summarize();
  closeDb();
  process.exitCode = code;
  ```
- 파일 맨 아래 `main().catch(...)` 안의 `process.exit(1)`은
  ```ts
  closeDb();
  process.exitCode = 1;
  ```
  로 바꾼다.

`process.exit()`를 즉시 호출하면 열린 statement가 강제 정리되며 크래시한다.
`exitCode`만 세팅하면 이벤트 루프가 정상 종료된다.

### 5. `packages/server/src/index.ts`
`shutdown()` 안 `server.close(() => process.exit(0));` 를:
```ts
server.close(() => {
  closeDb();
  process.exit(0);
});
```
`closeDb`를 `./db` import에 추가한다.

### 6. 임시 파일 정리
저장소 루트에서 아래 파일이 있으면 지운다:
`test-out.txt`, `test-out2.txt`, `weblist.txt`, `weblines.txt`, `nodever.txt`, `gitlog.txt`, `gitstatus.txt`

`.gitignore`에 아래 줄이 없으면 추가:
```
data/
*.db
*.db-wal
*.db-shm
test-out*.txt
```

### 검증
- [ ] Node 20에서 `npm test` 실행
- [ ] 출력 끝에 `Statement::` / `Assertion failed` / `code 134`가 **없다**
- [ ] 아래 이름이 PASS로 보인다 (하나라도 안 보이면 실패):
      job / ranking / market open / institution / death / season
- [ ] 실패한 테스트가 있으면 그 테스트만 고친다. 게임 규칙은 바꾸지 마라.

### 만약 Node가 20이 아니라면
`node -v`가 v20이 아니면 **코드를 더 고치지 말고** 이렇게만 답하고 멈춰라:
"Node 20이 필요합니다. nvm-windows로 `nvm install 20` → `nvm use 20` 후 다시 시켜주세요."

### 완료 후
PROGRESS 묶음 20 체크. 다음 작업 = 묶음 21. PLAN을 묶음 21로. **멈춤.**

---

## 묶음 21 — 캐릭터 토큰 인증

다음 구현해야할 묶음: 21

### 목표
지금은 `characterId` 문자열만 알면 **아무나 남의 캐릭터로 매매·손절취소·퇴사**가 된다.
캐릭터마다 비밀 토큰을 발급하고, 남의 캐릭터를 조작하는 요청을 막는다.

### 하지 말 것
- 비밀번호 / 이메일 / 회원가입 / OAuth / JWT 라이브러리. **새 의존성 금지.**
- 세션·쿠키. 토큰은 헤더로만 받는다.
- 조회 전용 API(`/companies`, `/world`, `/ranking` 보드, `/intel` 목록)에 인증 붙이기. 그대로 열어둔다.
- 게임 규칙·밸런스 변경.

### 1. `packages/server/src/db/index.ts`
`CREATE TABLE IF NOT EXISTS characters (...)` 안에 컬럼 추가:
```
auth_token TEXT,
```
그리고 `runMigrations()` 아래쪽, 기존 `peak_net_worth` ALTER 블록 **바로 뒤**에 같은 패턴으로:
```ts
if (!charCols.some((c) => c.name === 'auth_token')) {
  database.exec(`ALTER TABLE characters ADD COLUMN auth_token TEXT`);
}
```

### 2. `packages/server/src/modules/players/index.ts`
- `createCharacter(userId, name)` 안에서 캐릭터 INSERT 시 토큰을 함께 저장한다.
  토큰 = `randomUUID()` 두 번 이어붙인 문자열에서 `-` 제거 (`node:crypto`의 `randomUUID`. 새 패키지 금지)
- 반환 객체에 토큰을 넣지 말고, 아래 메서드를 추가한다:
```ts
/** 캐릭터 생성 직후 한 번만 클라이언트에 내려줄 비밀 토큰. */
getAuthToken(characterId: string): string | null

/** 토큰이 그 캐릭터의 것인지 검사. 토큰이 없거나 다르면 false. */
verifyAuthToken(characterId: string, token: string | undefined): boolean
```
`verifyAuthToken`은 저장된 토큰이 NULL이면 **false**를 반환한다 (구 캐릭터는 조작 불가 → 새로 만들어야 함).

### 3. `packages/server/src/api/http.ts`
파일 끝에 추가:
```ts
/** 토큰을 확인한 뒤 핸들러를 부른다. 실패 시 401/403. */
export function handleAuth(
  getCharacterId: (req: Request) => string | undefined,
  verify: (characterId: string, token: string | undefined) => boolean,
  fn: (req: Request, res: Response) => void
) {
  return (req: Request, res: Response): void => {
    try {
      const characterId = getCharacterId(req);
      if (!characterId) throw new Error('characterId is required');
      const token = req.header('x-character-token') ?? undefined;
      if (!token) {
        fail(res, new Error('Missing character token'), 401);
        return;
      }
      if (!verify(characterId, token)) {
        fail(res, new Error('Character token mismatch'), 403);
        return;
      }
      fn(req, res);
    } catch (err) {
      fail(res, err);
    }
  };
}
```

### 4. `packages/server/src/api/routes.ts`
- `POST /api/characters` 응답에 토큰을 포함한다:
  ```ts
  ok(res, { character, token: ctx.players.getAuthToken(character.id), balance: ... });
  ```
- 아래 라우트의 `handle(...)`을 `handleAuth(...)`로 바꾼다.
  두 번째 인자는 항상 `(id, t) => ctx.players.verifyAuthToken(id, t)`:

  | 라우트 | characterId 위치 |
  | --- | --- |
  | `POST /jobs` | `req.body.characterId` |
  | `DELETE /jobs` | `req.body.characterId` |

- `GET /characters/:id` 는 **그대로 둔다** (조회는 공개).
- `GET /ranking` 도 그대로 둔다.

### 5. `packages/server/src/api/routes-market.ts`
같은 방식으로 아래를 `handleAuth`로 바꾼다:

| 라우트 | characterId 위치 |
| --- | --- |
| `POST /trade` | `req.body.characterId` |
| `DELETE /orders/:id` | `req.body.characterId` |
| `POST /survival/eat` | `req.body.characterId` |
| `POST /survival/rest` | `req.body.characterId` |
| `POST /intel/:id/purchase` | `req.body.characterId` |
| `POST /agendas` | `req.body.characterId` |
| `POST /agendas/:id/vote` | `req.body.characterId` |

`GET` 라우트는 하나도 건드리지 마라.

### 6. `packages/web/public/app.js`
- 캐릭터 생성 성공 시 `localStorage.setItem('characterToken', res.token)` 를
  기존 `localStorage.setItem('characterId', ...)` **바로 옆 두 곳 모두**에 추가한다.
- `fetch`를 감싼 공용 요청 함수(`api` 또는 그와 같은 역할의 함수)에서,
  method가 GET이 아니면 헤더에 다음을 넣는다:
  ```js
  'x-character-token': localStorage.getItem('characterToken') || ''
  ```
- 응답이 401 또는 403이면 `localStorage.removeItem('characterId')` 후
  시작 화면(`showStartScreen()`)으로 되돌린다.
- 문자열은 전부 영어 (묶음 16 규칙).

### 7. 테스트 — `packages/server/src/test/run-tests.ts`
`runAuthTests(ctx, companyId)`를 추가하고, `main()`에서 `runDeathTests` **앞**에 부른다.
서버 라우트를 띄우지 말고 `ctx.players`를 직접 쓴다.

| 테스트 | 단언 |
| --- | --- |
| new character has an auth token | `getAuthToken(id)`가 20자 이상 문자열 |
| correct token verifies | `verifyAuthToken(id, token) === true` |
| wrong token is rejected | `verifyAuthToken(id, 'nope') === false` |
| missing token is rejected | `verifyAuthToken(id, undefined) === false` |
| other character token is rejected | A의 토큰으로 B 검증 시 false |

### 검증
- [ ] `npm test` 통과 (묶음 20에서 고친 전 스위트 포함)
- [ ] `package.json`에 새 의존성이 추가되지 않음
- [ ] `GET` 라우트에 `handleAuth`가 붙지 않음

### 완료 후
PROGRESS 묶음 21 체크. 다음 작업 = 묶음 22. PLAN을 묶음 22로. **멈춤.**

---

## 묶음 22 — 공개 운영 위생

다음 구현해야할 묶음: 22

### 목표
공개 주소에 올렸을 때 봇/도배로 즉사하지 않게 하고, 문서를 현실과 맞춘다.

### 하지 말 것
- 새 npm 패키지 설치 (`express-rate-limit` 포함). 인메모리로 직접 짠다.
- 게임 규칙 변경. 아래 3번의 config 수치 외 밸런스 손대지 마라.
- CI, 모니터링 SaaS 연동, 도메인 자동화.

### 1. `packages/server/src/api/rate-limit.ts` (신규)
```ts
import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@stock-survival/shared';

/** IP당 고정 윈도우 카운터. 프로세스 메모리만 쓴다. */
export function rateLimit(windowMs: number, max: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'GET') { next(); return; }

    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > max) {
      const body: ApiResponse = { ok: false, error: 'Too many requests' };
      res.status(429).json(body);
      return;
    }
    next();
  };
}
```
윈도우가 지난 항목은 `resetAt` 비교로 자연 만료된다. 별도 청소 타이머를 만들지 마라.

### 2. `packages/server/src/index.ts`
`app.use('/api', createRouter(ctx));` **바로 앞**에:
```ts
app.use('/api', rateLimit(60_000, 120));
```
import 추가. 숫자를 config로 빼지 마라 (운영 상수다).

### 3. `config/world.json` — 시즌 길이
현재 `seasonLengthDays: 7` + `realSecondsPerGameMinute: 1` → 한 시즌 **2시간 48분**.
하루 8시즌은 너무 빠르다. 아래로 바꾼다 (코드 변경 없음):
```json
"realSecondsPerGameMinute": 3
```
→ 게임 1일 = 현실 1.2시간, 시즌 7일 = 현실 **약 8.4시간**.
`seasonLengthDays`는 7 그대로 둔다. 다른 수치는 건드리지 마라.

### 4. `packages/server/package.json`
`scripts`에 추가:
```json
"smoke": "tsx src/test/smoke-api.ts"
```
루트 `package.json` `scripts`에도 추가:
```json
"smoke": "npm run smoke --workspace=@stock-survival/server"
```
`smoke-api.ts` 내용은 고치지 마라. 실행도 하지 마라 (서버가 떠 있어야 한다).

### 5. `README.md` — 사실과 맞추기
설계 본문 §0~§11은 **한 글자도 건드리지 마라.** 위쪽 사용설명 부분만 고친다.
- 1줄 요약: `Mobile client (Expo)` → `Browser client (vanilla JS) + authoritative Node.js server`
- Structure 목록: `packages/mobile/ — Expo app` 줄을 `packages/web/ — browser client (static)` 로 교체
- Quick Start에 한 줄 추가: `Requires Node 20 (see .nvmrc).`
- API 표에 빠진 행을 추가한다:

  | Method | Path | Description |
  | --- | --- | --- |
  | POST | `/api/jobs` | Take a job (`regular` / `parttime`) |
  | DELETE | `/api/jobs` | Quit the current job |
  | GET | `/api/ranking` | Live net-worth board (+ my rank) |
  | GET | `/api/institutions` | Institution seats (disabled by default) |

- API 표 아래에 한 줄 추가:
  `Write endpoints require the \`x-character-token\` header returned by \`POST /api/characters\`.`

### 6. `docs/DEPLOY.md`
맨 아래에 두 줄 추가:
```
- 정기 백업: 로컬에서 하루 1회 `fly ssh sftp get /data/game.db ./backups/game-$(date +%F).db`.
- 배포 직후 확인: `curl https://<앱>.fly.dev/health` → `{"ok":true,...}`, 그 다음 `npm run smoke`.
```

### 검증
- [ ] `npm test` 통과
- [ ] `package.json`에 새 **의존성**이 추가되지 않음 (scripts는 추가 OK)
- [ ] README 설계 본문(`# 설계 결정 문서` 이후)이 diff에 없음

### 완료 후
PROGRESS 묶음 22 체크. 다음 작업 = 묶음 23. PLAN을 묶음 23으로. **멈춤.**

---

## 묶음 23 — 출시 점검

다음 구현해야할 묶음: 23

### 목표
실제 배포 전에 이미지가 진짜 뜨는지 확인하고, 주인이 따라 할 체크리스트를 남긴다.

### 하지 말 것
- `fly deploy` 실행. (주인이 직접 한다. 너는 하지 마라)
- 새 기능, 새 화면, 새 API.
- config 수치 변경.

### 1. `docker build`
```
docker build -t stock-survival:test .
```
- 실패하면 `Dockerfile`만 고쳐서 통과시킨다. 서버 코드를 고치지 마라.
- 자주 나는 원인: `packages/web`가 `npm ci`에 필요한 workspace인데 manifest 복사가 빠짐.
  그 경우 `COPY packages/web/package.json packages/web/package.json` 를 추가하거나,
  `packages/web`에 package.json이 없다면 workspace 대상이 아니므로 그대로 둔다.
- Docker가 설치돼 있지 않으면 **코드를 고치지 말고** "Docker 미설치로 건너뜀"이라고만 적고 3번으로 간다.

### 2. 이미지 내용 확인 (빌드 성공한 경우만)
```
docker run --rm stock-survival:test ls config packages/web/public
```
`config/*.json` 과 `index.html app.js styles.css` 가 보여야 한다.

### 3. `docs/RELEASE.md` (신규)
아래를 그대로 쓴다. 채점표가 아니라 주인이 순서대로 따라갈 목록이다.
```markdown
# 출시 체크리스트

## 배포
1. `nvm use 20`
2. `npm test` — 전부 PASS
3. `fly launch --no-deploy`
4. `fly volumes create game_data --size 1`
5. `fly deploy`
6. `curl https://<앱>.fly.dev/health` → `{"ok":true,...}`
7. `npm run smoke` (BASE를 배포 주소로)

## 첫 플레이 확인 (본인, 30분)
- [ ] 시작 화면에서 닉네임 입력 → 캐릭터 생성됨
- [ ] Market 탭에 가격과 원인(▲/▼ + 요인 이름)이 보임
- [ ] 매수 → 보유 수량 증가
- [ ] 손절(stop) 주문이 걸림 / 취소됨
- [ ] News 탭에 뉴스가 흐름
- [ ] Survival 탭에서 먹기·쉬기로 체력 회복
- [ ] 굶어 죽으면 결과 화면 → 새 캐릭터 시작됨
- [ ] Ranking에 내 등수가 보임
- [ ] 다른 브라우저(시크릿)에서 내 characterId로 매매 시도 → 실패

## 공개 전
- [ ] 백업 1회 받아봄 (DEPLOY.md)
- [ ] 지인 3~5명 테스트
- [ ] 밸런스는 config/*.json 만 수정
```

### 4. `docs/PROGRESS.md`
`## 현재 위치` 아래 추정치 줄을 사실에 맞게 한 줄로 갱신한다:
```
- 추정: 시뮬 ~90% / 한 판 플레이 ~80% / 공개 출시 준비 ~90% (남은 것 = 실제 배포와 플레이 검증).
```

### 검증
- [ ] `npm test` 통과
- [ ] `docs/RELEASE.md` 존재
- [ ] `fly deploy`를 실행하지 않았음

### 완료 후
PROGRESS 묶음 23 체크. 다음 작업 = 없음. PLAN을 빈 템플릿으로:
```
# Plan
다음 구현해야할 묶음: 없음
```
**멈춤.**
