import { GameTime, TickEvent } from '@stock-survival/shared';
import { AppConfig } from './config-loader';
import { eventBus } from './event-bus';
import { moduleRegistry } from './module-registry';

export class TickLoop {
  private tickCount = 0;
  private gameTime: GameTime;
  private intervalId: NodeJS.Timeout | null = null;
  private lastPriceTick = 0;
  private lastSurvivalTick = 0;

  constructor(private config: AppConfig) {
    this.gameTime = {
      year: config.world.startYear,
      month: config.world.startMonth,
      day: config.world.startDay,
      hour: 8,
      minute: 0,
      totalMinutes: 0,
    };
  }

  getGameTime(): GameTime {
    return { ...this.gameTime };
  }

  getTickCount(): number {
    return this.tickCount;
  }

  start(): void {
    const ms = this.config.world.realSecondsPerGameMinute * 1000;
    this.intervalId = setInterval(() => this.tick(), ms);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private advanceTime(): void {
    this.gameTime.minute += 1;
    this.gameTime.totalMinutes += 1;
    if (this.gameTime.minute >= 60) {
      this.gameTime.minute = 0;
      this.gameTime.hour += 1;
    }
    if (this.gameTime.hour >= 24) {
      this.gameTime.hour = 0;
      this.gameTime.day += 1;
    }
    if (this.gameTime.day > 30) {
      this.gameTime.day = 1;
      this.gameTime.month += 1;
    }
    if (this.gameTime.month > 12) {
      this.gameTime.month = 1;
      this.gameTime.year += 1;
    }
  }

  private async tick(): Promise<void> {
    this.tickCount += 1;
    this.advanceTime();
    const baseEvent: TickEvent = {
      type: 'TICK',
      gameTime: this.getGameTime(),
      tickCount: this.tickCount,
    };

    await eventBus.emit(baseEvent);
    for (const mod of moduleRegistry.getAll()) {
      if (mod.onTick) await mod.onTick(baseEvent);
    }

    const now = Date.now();
    if (now - this.lastPriceTick >= this.config.world.priceTickIntervalSeconds * 1000) {
      this.lastPriceTick = now;
      const priceEvent: TickEvent = { ...baseEvent, type: 'PRICE_TICK' };
      await eventBus.emit(priceEvent);
      for (const mod of moduleRegistry.getAll()) {
        if (mod.onPriceTick) await mod.onPriceTick(priceEvent);
      }
    }

    if (now - this.lastSurvivalTick >= this.config.world.survivalTickIntervalSeconds * 1000) {
      this.lastSurvivalTick = now;
      const survivalEvent: TickEvent = { ...baseEvent, type: 'SURVIVAL_TICK' };
      await eventBus.emit(survivalEvent);
      for (const mod of moduleRegistry.getAll()) {
        if (mod.onSurvivalTick) await mod.onSurvivalTick(survivalEvent);
      }
    }
  }
}
