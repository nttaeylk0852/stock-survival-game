# world

## clock (`modules/world/clock.ts`)
- **역할**: 게임 내 시간 조회와 계절 판정. TickLoop이 관리하는 시간을 다른 모듈에 노출하는 얇은 래퍼.
- **config**: `world.json` — `startYear`, `startMonth`, `startDay`, `realSecondsPerGameMinute`
- **주요 함수**: `getGameTime()` · `isWinter()` 12·1·2월 · `isSummer()` 6~8월
- **연계**: `survival`이 혹독한 날씨 피해 판정에 사용한다.

## season (`modules/world/season.ts`)
- **역할**: 시즌 주기 관리. 시즌 종료 시 전 캐릭터를 사망 처리(대공황 이벤트)하고 시즌 번호를 올린 뒤 `SEASON_END` 이벤트를 발행한다.
- **config**: `world.json` — `seasonLengthDays`
- **주요 함수**
  - `getSeasonInfo()` — 시즌 번호·시작·종료 시각
  - `awardMedal()` — 시즌 훈장 부여 (캐릭터가 아닌 유저 계정에 영구 귀속)
  - `onSeasonEnd()` — 전원 리셋 + 시즌 번호 증가 + `SEASON_END` 브로드캐스트
  - `onTick()` — 종료 시각 도달 여부 검사
- **주의**: 시즌 리셋은 캐릭터만 초기화하며, 유저 계정과 훈장 기록은 유지된다.
