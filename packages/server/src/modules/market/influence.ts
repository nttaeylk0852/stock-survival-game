import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { CompaniesModule } from '../companies';

export class InfluenceModule implements GameModule {
  name = 'market/influence';
  private userInfluenceByCompany = new Map<string, number>();

  constructor(
    private config: AppConfig,
    private companies: CompaniesModule
  ) {}

  init(): void {}

  recordTradeInfluence(companyId: string, price: number, quantity: number): void {
    const company = this.companies.getCompany(companyId);
    if (!company) return;

    const fairPrice = company.currentPrice;
    const priceDelta = Math.abs(price - fairPrice) / fairPrice;
    const volumeRatio = (quantity * price) / (company.sharesOutstanding * fairPrice);
    const influence = priceDelta * volumeRatio;

    const current = this.userInfluenceByCompany.get(companyId) ?? 0;
    const cap = this.config.market.userInfluenceCap;
    const newInfluence = Math.min(cap, current + influence);
    this.userInfluenceByCompany.set(companyId, newInfluence);

    if (newInfluence >= cap * 0.9) {
      console.log(`[influence] Company ${companyId} near user influence cap: ${newInfluence.toFixed(3)}`);
    }
  }

  recordGovernanceInfluence(companyId: string, delta: number): number {
    const current = this.userInfluenceByCompany.get(companyId) ?? 0;
    const cap = this.config.market.userInfluenceCap;
    const applied = Math.min(delta, cap - current);
    if (applied > 0) {
      this.userInfluenceByCompany.set(companyId, current + applied);
    }
    return applied;
  }

  getUserInfluence(companyId: string): number {
    return this.userInfluenceByCompany.get(companyId) ?? 0;
  }

  getRemainingCap(companyId: string): number {
    return this.config.market.userInfluenceCap - this.getUserInfluence(companyId);
  }

  onPriceTick(): void {
    for (const key of this.userInfluenceByCompany.keys()) {
      const current = this.userInfluenceByCompany.get(key)!;
      this.userInfluenceByCompany.set(key, current * 0.95);
    }
  }
}
