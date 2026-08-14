# players

`modules/players/index.ts`

- **역할**: 유저 계정과 캐릭터의 생명주기 관리. 캐릭터 생성 시 전용 계좌를 만들고 시작 자금을 발행하며, 사망 시 전 재산을 국고로 압류한다.
- **config**: `economy.json` — `starterCash` / `survival.json` — `maxHealth`
- **주요 함수**
  - `createUser()` — 유저 계정 생성 (username 유니크)
  - `createCharacter()` — 계좌 + 캐릭터를 한 트랜잭션으로 생성 후 `ledger.mint()`로 시작금 지급
  - `getCharacter()` / `getActiveCharacter()` — 조회 (후자는 살아있는 최신 캐릭터)
  - `killCharacter()` — `seizeAll()`로 잔고 압류 후 `is_alive = 0` 처리
  - `updateCharacter()` — health / lastMealAt / isHomeless 부분 갱신
  - `getAccountId()` — 캐릭터의 실제 계좌 uuid 조회 (**계좌 ID를 문자열로 추측하지 말 것**)
- **주의**: 계좌 ID는 uuid이며 `player-{characterId}` 같은 규칙이 아니다. 반드시 `getAccountId()`를 사용한다.
