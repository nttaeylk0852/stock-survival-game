import { Company, CompanyStats, TickEvent } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import {
  calculateFairPrice,
  applyStabilityFactor,
  computeStatScore,
  deriveProfit,
  largeCapIds,
  PriceFactor,
} from './pricing';
import { computeBrandMultiplier, computeVolatilityFactor } from './image';
import { SectorsModule } from './sectors';
import { MacroModule } from '../economy/macro';
import type { MarketSession } from '../world/market-session';

interface FactorState {
  interestRate: number;
  materialIndex: number;
  sectorMultiplier: number;
  statScore: number;
}

export class CompaniesModule implements GameModule {
  name = 'companies';

  /** 요인별 수치는 비공개 — 방향(▲/▼/—)만 getPriceFactors로 노출 (§6). */
  private factorState = new Map<string, FactorState>();
  private priceFactors = new Map<string, PriceFactor[]>();

  constructor(
    private config: AppConfig,
    private sectors: SectorsModule,
    private macro: MacroModule,
    private marketSession: MarketSession
  ) {}

  init(): void {
    const db = getDb();
    for (const seed of this.config.companySeeds) {
      const existing = db.prepare(`SELECT id FROM companies WHERE id = ?`).get(seed.id);
      if (existing) continue;

      const stats: CompanyStats = {
        ...(seed.stats as unknown as CompanyStats),
        profit: this.deriveProfitFromStats(seed.stats as unknown as CompanyStats),
      };

      const price = calculateFairPrice(
        seed.basePrice,
        stats,
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
        JSON.stringify(stats),
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

  /** 설명 레이어: 요인명 + 방향(▲/▼/—)만 반환. 수치는 비공개 (§6). */
  getPriceFactors(companyId: string): PriceFactor[] {
    return this.priceFactors.get(companyId) ?? [];
  }

  onPriceTick(_event: TickEvent): void {
    const db = getDb();
    const interestRate = this.macro.getInterestRate();
    const materialIndex = this.macro.getMaterialIndex();

    // §5 차등 클램프: 시총 상위 N 대기업은 좁은 폭, 중소기업은 기존 폭.
    const activeCompanies = this.getAllCompanies().filter((c) => c.status === 'ACTIVE');
    const largeIds = new Set(largeCapIds(activeCompanies, this.config.centralBank.largeCapTopN));

    for (const company of activeCompanies) {

      // §3 파생 profit 계산 → stats.profit 갱신 (파산 판정 연동)
      company.stats.profit = this.deriveProfitFromStats(company.stats);

      const fairPrice = calculateFairPrice(
        company.basePrice,
        company.stats,
        this.config.companies.aiWeights,
        this.sectors.getSectorMultiplier(company.sectors)
      );

      this.recordFactors(company, interestRate, materialIndex);

      const history = this.getPriceHistory(company.id);
      const isLarge = largeIds.has(company.id);
      const credibility =
        company.stats.managementCredibility ??
        this.config.companies.managementCredibilityDefault;
      const volFactor = computeVolatilityFactor(
        credibility,
        this.config.companies.managementCredibilityDefault,
        this.config.companies.managementVolatilitySensitivity
      );
      const sessionVol = this.marketSession.getVolatilityMultiplier();
      const maxDrop =
        (isLarge
          ? this.config.centralBank.largeCapStabilityMaxDrop
          : this.config.market.priceStabilityMaxDrop) *
        volFactor *
        sessionVol;
      const maxGain =
        (isLarge
          ? this.config.centralBank.largeCapStabilityMaxGain
          : this.config.market.priceStabilityMaxGain) *
        volFactor *
        sessionVol;
      const stablePrice = applyStabilityFactor(
        fairPrice,
        history,
        maxDrop,
        maxGain,
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
        `UPDATE companies SET current_price = ?, price_history_json = ?, stats_json = ?, loss_streak_ticks = ?, status = ? WHERE id = ?`
      ).run(
        stablePrice,
        JSON.stringify(history),
        JSON.stringify(company.stats),
        lossStreak,
        status,
        company.id
      );

      // §4.4 파산 전이 → 동일 섹터 지수 전염
      if (company.status === 'ACTIVE' && status === 'DELISTED') {
        this.sectors.onCompanyBankrupt(company.sectors);
      }
    }
  }

  getPriceHistory(companyId: string): number[] {
    const db = getDb();
    const row = db.prepare(`SELECT price_history_json FROM companies WHERE id = ?`).get(companyId) as
      | { price_history_json: string }
      | undefined;
    return row ? JSON.parse(row.price_history_json) : [];
  }

  private deriveProfitFromStats(stats: CompanyStats): number {
    const brandMultiplier = computeBrandMultiplier(
      stats.brand,
      this.config.companies.brandRevenueMultiplierMin,
      this.config.companies.brandRevenueMultiplierMax
    );
    return deriveProfit(
      stats.revenue * brandMultiplier,
      stats.margin ?? this.config.companies.defaultMargin,
      this.macro.getMaterialIndex(),
      stats.materialSensitivity ?? this.config.companies.defaultMaterialSensitivity,
      stats.debt,
      this.macro.getInterestRate()
    );
  }

  private recordFactors(company: Company, interestRate: number, materialIndex: number): void {
    const sectorMultiplier = this.sectors.getSectorMultiplier(company.sectors);
    const statScore = computeStatScore(company.stats, this.config.companies.aiWeights);
    const prev = this.factorState.get(company.id);

    const factors: PriceFactor[] = [
      { name: '금리', direction: this.direction(prev?.interestRate, interestRate, true) },
      { name: '원자재', direction: this.direction(prev?.materialIndex, materialIndex, true) },
      { name: '섹터', direction: this.direction(prev?.sectorMultiplier, sectorMultiplier, false) },
      { name: '실적', direction: this.direction(prev?.statScore, statScore, false) },
    ];

    this.factorState.set(company.id, { interestRate, materialIndex, sectorMultiplier, statScore });
    this.priceFactors.set(company.id, factors);
  }

  private direction(
    prev: number | undefined,
    curr: number,
    inverted: boolean
  ): PriceFactor['direction'] {
    if (prev === undefined) return '—';
    const delta = curr - prev;
    if (Math.abs(delta) < 1e-9) return '—';
    const up = delta > 0;
    // 금리·원자재 상승 = 주가 하락 요인(▼)
    return inverted ? (up ? '▼' : '▲') : up ? '▲' : '▼';
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
