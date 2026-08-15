import { TickEvent } from '@stock-survival/shared';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';

export class SectorsModule implements GameModule {
  name = 'sectors';
  private indices: Record<string, number>;
  private prevInterestRate: number;
  private bankruptcyListeners: ((sectors: string[]) => void)[] = [];

  constructor(private config: AppConfig) {
    this.indices = { ...config.sectors.indices };
    this.prevInterestRate = config.economy.baseInterestRate;
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

  /** §4.1 기준 드리프트 없음: 섹터 변동은 이벤트·금리·파산 전염만. */
  onPriceTick(_event: TickEvent): void {}

  /** 상대 변동 적용: index = clamp(index × (1 + delta)). */
  applySectorEffect(sector: string, delta: number): void {
    const current = this.indices[sector] ?? 1;
    this.indices[sector] = this.clamp(current * (1 + delta));
  }

  /** effects에서 sector.* 키만 처리 (§4 이벤트 효과). */
  applyEffects(effects: Record<string, number>): void {
    for (const [key, delta] of Object.entries(effects)) {
      if (key.startsWith('sector.')) {
        this.applySectorEffect(key.slice('sector.'.length), delta);
      }
    }
  }

  /** §2.2 금리 민감도: index × (1 + Δrate × sensitivity). */
  onInterestRateChange(newRate: number): void {
    const delta = newRate - this.prevInterestRate;
    this.prevInterestRate = newRate;
    if (Math.abs(delta) < 1e-12) return;
    const sensitivity = this.config.sectors.rateSensitivity ?? {};
    for (const sector of Object.keys(this.indices)) {
      this.applySectorEffect(sector, delta * (sensitivity[sector] ?? 0));
    }
  }

  /** §4.4 파산 전염: 동일 섹터 하락 + 구독 리스너 통지. */
  onCompanyBankrupt(sectors: string[]): void {
    const drop = this.config.sectors.sectorContagionDrop;
    for (const sector of sectors) {
      this.applySectorEffect(sector, -drop);
    }
    for (const listener of this.bankruptcyListeners) {
      listener(sectors);
    }
  }

  onBankruptcy(listener: (sectors: string[]) => void): void {
    this.bankruptcyListeners.push(listener);
  }

  private clamp(value: number): number {
    return Math.max(this.config.sectors.indexMin, Math.min(this.config.sectors.indexMax, value));
  }
}
