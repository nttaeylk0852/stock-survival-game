import type { DailyActionsState } from '@stock-survival/shared';
import type { AppConfig } from '../../core/config-loader';
import type { GameModule } from '../../core/module-registry';
import { getDb } from '../../db';

/**
 * 일일 행동 리소스 (§7) — 정보 구매권 캡.
 * — "관찰은 무한, 행동은 유한": 접속시간이 아니라 행동 횟수로 고인물 격차를 제어한다.
 * — 매 게임일 개장(09:00) 시 MarketSessionModule이 resetAll()로 초기화한다.
 */
export class DailyActionsModule implements GameModule {
  name = 'daily-actions';

  constructor(private config: AppConfig) {}

  init(): void {}

  private usage(characterId: string): { intelUsed: number } {
    const db = getDb();
    const row = db
      .prepare(`SELECT intel_used FROM daily_actions WHERE character_id = ?`)
      .get(characterId) as { intel_used: number } | undefined;
    return { intelUsed: row?.intel_used ?? 0 };
  }

  canPurchaseIntel(characterId: string): boolean {
    return this.usage(characterId).intelUsed < this.config.intel.dailyIntelPurchaseLimit;
  }

  recordIntelPurchase(characterId: string): void {
    getDb()
      .prepare(
        `INSERT INTO daily_actions (character_id, trades_used, intel_used) VALUES (?, 0, 1)
         ON CONFLICT(character_id) DO UPDATE SET intel_used = intel_used + 1`
      )
      .run(characterId);
  }

  resetAll(): void {
    getDb().prepare(`DELETE FROM daily_actions`).run();
  }

  getState(characterId: string): DailyActionsState {
    const u = this.usage(characterId);
    return {
      intelUsed: u.intelUsed,
      intelLimit: this.config.intel.dailyIntelPurchaseLimit,
    };
  }
}
