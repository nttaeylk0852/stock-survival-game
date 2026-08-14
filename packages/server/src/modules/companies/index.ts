import { Company, CompanyStats, TickEvent } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { calculateFairPrice, applyStabilityFactor } from './pricing';
import { SectorsModule } from './sectors';

export class CompaniesModule implements GameModule {
  name = 'companies';

  constructor(
    private config: AppConfig,
    private sectors: SectorsModule
  ) {}

  init(): void {
    const db = getDb();
    for (const seed of this.config.companySeeds) {
      const existing = db.prepare(`SELECT id FROM companies WHERE id = ?`).get(seed.id);
      if (existing) continue;

      const price = calculateFairPrice(
        seed.basePrice,
        seed.stats as unknown as CompanyStats,
        this.config.companies.aiWeights,
        this.sectors.getSectorMultiplier(seed.sectors)
      );

      db.prepare(
        `INSERT INTO companies (id, name, base_price, stats_json, sectors_json, supply_sensitivity,
         shares_outstanding, current_price, status, loss_streak_ticks, price_history_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?)`
      ).run(
        seed.id,
        seed.name,
        seed.basePrice,
        JSON.stringify(seed.stats),
        JSON.stringify(seed.sectors),
        seed.supplySensitivity,
        seed.sharesOutstanding,
        price,
        JSON.stringify([price])
      );

      db.prepare(
        `INSERT OR IGNORE INTO amm_pools (company_id, cash_reserve, share_reserve) VALUES (?, ?, ?)`
      ).run(seed.id, seed.basePrice * 10000, 10000);
    }
  }

  getCompany(companyId: string): Company | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(companyId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToCompany(row);
  }

  getAllCompanies(): Company[] {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM companies`).all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToCompany(r));
  }

  updateStat(companyId: string, statKey: keyof CompanyStats, delta: number): void {
    const company = this.getCompany(companyId);
    if (!company) throw new Error('Company not found');
    const stats = { ...company.stats, [statKey]: (company.stats[statKey] ?? 0) + delta };
    const db = getDb();
    db.prepare(`UPDATE companies SET stats_json = ? WHERE id = ?`).run(
      JSON.stringify(stats),
      companyId
    );
  }

  getFairPrice(companyId: string): number {
    const company = this.getCompany(companyId);
    if (!company) throw new Error('Company not found');
    return calculateFairPrice(
      company.basePrice,
      company.stats,
      this.config.companies.aiWeights,
      this.sectors.getSectorMultiplier(company.sectors)
    );
  }

  onPriceTick(_event: TickEvent): void {
    const db = getDb();
    for (const company of this.getAllCompanies()) {
      if (company.status !== 'ACTIVE') continue;

      const fairPrice = this.getFairPrice(company.id);
      const history = this.getPriceHistory(company.id);
      const stablePrice = applyStabilityFactor(
        fairPrice,
        history,
        this.config.market.priceStabilityMaxDrop,
        this.config.market.priceStabilityMaxGain,
        this.config.market.historicalMedianWindow
      );

      history.push(stablePrice);
      if (history.length > this.config.market.historicalMedianWindow * 2) {
        history.splice(0, history.length - this.config.market.historicalMedianWindow * 2);
      }

      let lossStreak = company.lossStreakTicks;
      if (company.stats.profit < 0) {
        lossStreak += 1;
      } else {
        lossStreak = 0;
      }

      let status: Company['status'] = company.status;
      const debtRatio =
        company.stats.revenue > 0 ? company.stats.debt / company.stats.revenue : Infinity;
      if (
        debtRatio > this.config.companies.bankruptcyDebtRevenueRatio &&
        lossStreak >= this.config.companies.bankruptcyLossStreakTicks
      ) {
        status = 'DELISTED';
      }

      db.prepare(
        `UPDATE companies SET current_price = ?, price_history_json = ?, loss_streak_ticks = ?, status = ? WHERE id = ?`
      ).run(stablePrice, JSON.stringify(history), lossStreak, status, company.id);
    }
  }

  getPriceHistory(companyId: string): number[] {
    const db = getDb();
    const row = db.prepare(`SELECT price_history_json FROM companies WHERE id = ?`).get(companyId) as
      | { price_history_json: string }
      | undefined;
    return row ? JSON.parse(row.price_history_json) : [];
  }

  private rowToCompany(row: Record<string, unknown>): Company {
    return {
      id: row.id as string,
      name: row.name as string,
      basePrice: row.base_price as number,
      stats: JSON.parse(row.stats_json as string),
      sectors: JSON.parse(row.sectors_json as string),
      supplySensitivity: row.supply_sensitivity as number,
      sharesOutstanding: row.shares_outstanding as number,
      currentPrice: row.current_price as number,
      status: row.status as Company['status'],
      lossStreakTicks: row.loss_streak_ticks as number,
    };
  }
}
