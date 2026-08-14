# survival

`modules/survival/index.ts`

- **역할**: 생존 압박 시뮬레이션. SURVIVAL_TICK마다 살아있는 모든 캐릭터의 배고픔·날씨 피해를 적용하고, 체력이 0이 되면 사망 처리한다.
- **config**: `survival.json` — `maxHealth`, `hungerThresholdMinutes`, `hungerDamagePerTick`, `weatherDamagePerTick`, `mealCostBase`, `restCostBase`, `mealHealthRestore`
- **주요 함수**
  - `eat()` — `mealCostBase × CPI` 지불 → 체력 회복 + `lastMealAt` 갱신
  - `rest()` — `restCostBase × CPI` 지불 → `isHomeless = false` (날씨 피해 면제)
  - `onSurvivalTick()` — 마지막 식사 경과시간이 임계치 초과 시 굶주림 피해, 노숙 상태 + 혹한/혹서일 때 날씨 피해, 체력 0이면 `players.killCharacter()`
- **피해 판정**: 겨울(12·1·2월) 또는 여름(6~8월)이 혹독한 날씨이며, 판정은 `world/clock`이 담당한다.
- **물가 연동**: 식비·숙박비는 `macro.getCpiIndex()`를 곱하므로 인플레이션이 오르면 생존 비용도 오른다.
