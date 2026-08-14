import { TickEvent } from '@stock-survival/shared';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';

export class SectorsModule implements GameModule {
  name = 'sectors';
  private indices: Record<string, number>;

  constructor(private config: AppConfig) {
    this.indices = { ...config.sectors.indices };
  }

  init(): void {}

  getSectorMultiplier(sectors: string[]): number {
    if (sectors.length === 0) return 1;
    const sum = sectors.reduce((acc, s) => acc + (this.indices[s] ?? 1), 0);
    return sum / sectors.length;
  }

  getIndices(): Record<string, number> {
    return { ...this.indices };
  }

  onPriceTick(_event: TickEvent): void {
    for (const sector of Object.keys(this.indices)) {
      const change = (Math.random() - 0.5) * 2 * this.config.sectors.volatilityPerTick;
      this.indices[sector] = Math.max(0.5, Math.min(2.0, this.indices[sector] + change));
    }
  }
}
