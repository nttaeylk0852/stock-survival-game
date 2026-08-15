import type { GameTime, MarketSessionState, TickEvent } from '@stock-survival/shared';
import type { AppConfig } from '../../core/config-loader';
import type { GameModule } from '../../core/module-registry';
import type { IntelModule } from '../intel';
import type { DailyActionsModule } from '../players/daily-actions';
import type { MacroModule } from '../economy/macro';

/** 개장 판정 (§7): 09:00 ~ 익일 01:00. 자정을 넘는 구간을 지원한다. */
export function isMarketOpen(gameTime: GameTime, openHour: number, closeHour: number): boolean {
  const h = gameTime.hour;
  if (closeHour > openHour) return h >= openHour && h < closeHour;
  return h >= openHour || h < closeHour;
}

/** 휴장·정산 창 (01:00 ~ 05:00). 자정을 넘는 구간을 지원한다. */
export function isSettlementWindow(
  gameTime: GameTime,
  closeHour: number,
  settlementEndHour: number
): boolean {
  const h = gameTime.hour;
  if (settlementEndHour > closeHour) return h >= closeHour && h < settlementEndHour;
  return h >= closeHour || h < settlementEndHour;
}

/** 메인 세션 판정 (§7): 하루 3~4회(출근/점심/저녁) 뉴스 집중 + 변동성↑. */
export function isMainSession(gameTime: GameTime, mainSessionHours: number[]): boolean {
  return mainSessionHours.includes(gameTime.hour);
}

/**
 * 시장 세션 상태 (§7) — CircuitBreaker와 같은 공유 상태 객체.
 * — 돈·주문을 건드리지 않으며, onTick에서 갱신되어 onPriceTick에서 읽힌다.
 * — amm/orderBook은 개장 여부, intel은 뉴스 배율, companies는 변동성 배율을 읽는다.
 */
export class MarketSession {
  private open = false;
  private mainSession = false;

  constructor(private config: AppConfig) {}

  update(gameTime: GameTime): void {
    this.open = isMarketOpen(
      gameTime,
      this.config.world.marketOpenHour,
      this.config.world.marketCloseHour
    );
    this.mainSession = isMainSession(gameTime, this.config.world.mainSessionHours);
  }

  isMarketOpen(): boolean {
    return this.open;
  }

  isMainSession(): boolean {
    return this.mainSession;
  }

  getVolatilityMultiplier(): number {
    return this.mainSession ? this.config.world.mainSessionVolatilityBoost : 1;
  }

  getNewsMultiplier(): number {
    return this.mainSession ? this.config.world.mainSessionNewsBoost : 1;
  }

  getState(): MarketSessionState {
    return {
      open: this.open,
      isMainSession: this.mainSession,
      volatilityMultiplier: this.getVolatilityMultiplier(),
      newsMultiplier: this.getNewsMultiplier(),
    };
  }
}

/**
 * 시장 세션 모듈 (§7) — 매 TICK 상태 갱신 + 부수효과.
 * — 개장(09:00) 전환 시 일일 행동 리소스 리셋.
 * — 휴장(01:00) 전환 시 "내일 금리 발표" 예고 브로드캐스트(정산).
 */
export class MarketSessionModule implements GameModule {
  name = 'world/market-session';

  constructor(
    private config: AppConfig,
    private session: MarketSession,
    private intel: IntelModule,
    private dailyActions: DailyActionsModule,
    private macro: MacroModule
  ) {}

  init(): void {}

  onTick(event: TickEvent): void {
    const wasOpen = this.session.isMarketOpen();
    this.session.update(event.gameTime);
    const nowOpen = this.session.isMarketOpen();

    if (!wasOpen && nowOpen) {
      this.dailyActions.resetAll();
    }

    if (wasOpen && !nowOpen) {
      const rate = this.macro.getInterestRate();
      this.intel.broadcastNews(
        '[휴장] 시장 마감',
        `오늘 장이 종료되었습니다. 내일 장 시작 전 금리가 발표될 예정입니다. (현재 금리 ${(
          rate * 100
        ).toFixed(2)}%)`,
        null
      );
    }
  }
}
