import { GameTime } from '@stock-survival/shared';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { TickLoop } from '../../core/tick-loop';

export class WorldClockModule implements GameModule {
  name = 'world/clock';

  constructor(
    private config: AppConfig,
    private tickLoop: TickLoop
  ) {}

  init(): void {}

  getGameTime(): GameTime {
    return this.tickLoop.getGameTime();
  }

  isWinter(gameTime: GameTime): boolean {
    return gameTime.month === 12 || gameTime.month <= 2;
  }

  isSummer(gameTime: GameTime): boolean {
    return gameTime.month >= 6 && gameTime.month <= 8;
  }
}
