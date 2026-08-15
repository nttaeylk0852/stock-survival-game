import { MacroState, TickEvent } from '@stock-survival/shared';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from './ledger';
import { v4 as uuidv4 } from 'uuid';
import { getDb, SYSTEM_ACCOUNTS } from '../../db';
import { PlayersModule } from '../players';
import { SectorsModule } from '../companies/sectors';

/** 테일러 준칙 목표금리 (순수 함수 — 결정론적 테스트용). */
export function computeTargetInterestRate(
  baseRate: number,
  inflationRate: number,
  targetInflationRate: number,
  marketGrowthRate: number,
  targetGrowthRate: number,
  a: number,
  b: number
): number {
  return (
    baseRate +
    a * (inflationRate - targetInflationRate) +
    b * (marketGrowthRate - targetGrowthRate)
  );
}

/** 목표금리로의 실제금리 이동 (빅스텝/노멀스텝 클램프, 순수 함수). */
export function applyInterestStep(
  current: number,
  target: number,
  bigGapThreshold: number,
  normalStep: number,
  bigStep: number
): number {
  const gap = Math.abs(target - current);
  const step = gap > bigGapThreshold ? bigStep : normalStep;
  const delta = Math.max(-step, Math.min(step, target - current));
  return Math.max(0, Math.min(0.5, current + delta));
}

export class MacroModule implements GameModule {
  name = 'economy/macro';
  private cpiIndex = 1.0;
  private interestRate: number;
  private inflationRate = 0;
  private commodities: Record<string, number> = {};
  private lastProcessedDay: { year: number; month: number; day: number } | null = null;
  private prevDayCpiIndex = 1.0;
  private prevDayAvgSector = 1.0;
  private marketGrowthRate = 0;
  private businessCyclePhase = 0;
  private businessCycleValue = 0;

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule,
    private sectors: SectorsModule
  ) {
    this.interestRate = config.economy.baseInterestRate;
    for (const [key, commodity] of Object.entries(config.commodities)) {
      this.commodities[key] = commodity.basePrice;
    }
    this.recomputeCpi();
  }

  init(): void {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM system_state WHERE key = 'cpi_index'`).get() as
      | { value: string }
      | undefined;
    if (row) this.cpiIndex = parseFloat(row.value);
  }

  getCpiIndex(): number {
    return this.cpiIndex;
  }

  /** 원자재 지수 = 물가지수(원자재 가격 가중평균). §3 profit 파생 계산에 사용. */
  getMaterialIndex(): number {
    return this.cpiIndex;
  }

  getInterestRate(): number {
    return this.interestRate;
  }

  getCommodities(): Record<string, number> {
    return { ...this.commodities };
  }

  /** §4 원자재 이벤트 효과: 가격 × (1+delta) 후 물가지수 재계산. */
  applyCommodityEffect(name: string, delta: number): void {
    const current = this.commodities[name];
    if (current === undefined) return;
    const commodity = this.config.commodities[name];
    const next = current * (1 + delta);
    const min = commodity ? commodity.basePrice * 0.5 : current * 0.5;
    const max = commodity ? commodity.basePrice * 2 : current * 2;
    this.commodities[name] = Math.max(min, Math.min(max, next));
    this.recomputeCpi();
  }

  getBusinessCycle(): { phase: number; value: number } {
    return { phase: this.businessCyclePhase, value: this.businessCycleValue };
  }

  getState(): MacroState {
    return {
      cpiIndex: this.cpiIndex,
      interestRate: this.interestRate,
      moneySupply: this.ledger.getTotalSupply(),
      inflationRate: this.inflationRate,
      commodities: this.getCommodities(),
      businessCycle: this.getBusinessCycle(),
      marketGrowthRate: this.marketGrowthRate,
    };
  }

  setInterestRate(rate: number): void {
    this.interestRate = Math.max(0, Math.min(0.5, rate));
  }

  buyBond(characterId: string, amount: number): string {
    if (amount <= 0) throw new Error('Invalid bond amount');
    const db = getDb();
    const bondId = uuidv4();
    const accountId = this.players.getAccountId(characterId);
    // Bond purchase removes cash from circulation temporarily (held in treasury)
    this.ledger.transfer(accountId, SYSTEM_ACCOUNTS.TREASURY, amount, 'BOND_BUY');
    db.prepare(
      `INSERT INTO bonds (id, character_id, amount, rate, purchased_at) VALUES (?, ?, ?, ?, ?)`
    ).run(bondId, characterId, amount, this.config.economy.bondIssueRate, Date.now());
    return bondId;
  }

  onPriceTick(event: TickEvent): void {
    // 1) 원자재 랜덤워크 + 물가지수 재계산 (매 가격 틱)
    this.randomWalkCommodities();
    this.recomputeCpi();

    // 2) 게임 'day' 변경 시에만 하루 1회 판정
    const day = { year: event.gameTime.year, month: event.gameTime.month, day: event.gameTime.day };
    const isNewDay =
      !this.lastProcessedDay ||
      this.lastProcessedDay.year !== day.year ||
      this.lastProcessedDay.month !== day.month ||
      this.lastProcessedDay.day !== day.day;

    if (!isNewDay) {
      this.persistCpi();
      return;
    }
    this.lastProcessedDay = day;

    this.updateInterestRate();
    this.advanceBusinessCycle();
    this.persistCpi();
  }

  private randomWalkCommodities(): void {
    for (const [key, price] of Object.entries(this.commodities)) {
      const commodity = this.config.commodities[key];
      if (!commodity) continue;
      const change = (Math.random() - 0.5) * 2 * commodity.volatility;
      const next = price * (1 + change);
      this.commodities[key] = Math.max(
        commodity.basePrice * 0.5,
        Math.min(commodity.basePrice * 2, next)
      );
    }
  }

  private recomputeCpi(): void {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const [key, price] of Object.entries(this.commodities)) {
      const commodity = this.config.commodities[key];
      if (!commodity) continue;
      weightedSum += commodity.cpiWeight * (price / commodity.basePrice);
      totalWeight += commodity.cpiWeight;
    }
    this.cpiIndex = totalWeight > 0 ? weightedSum / totalWeight : 1.0;
  }

  private averageSectorIndex(): number {
    const values = Object.values(this.sectors.getIndices());
    if (values.length === 0) return 1;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private updateInterestRate(): void {
    const taylor = this.config.economy.taylor;

    // 물가상승률: 전일 대비 물가지수 변화율
    this.inflationRate =
      this.prevDayCpiIndex > 0
        ? (this.cpiIndex - this.prevDayCpiIndex) / this.prevDayCpiIndex
        : 0;

    // 시장 성장률: 전일 대비 섹터지수 평균 변화율
    const avgSector = this.averageSectorIndex();
    this.marketGrowthRate =
      this.prevDayAvgSector > 0 ? (avgSector - this.prevDayAvgSector) / this.prevDayAvgSector : 0;

    const targetRate = computeTargetInterestRate(
      this.config.economy.baseInterestRate,
      this.inflationRate,
      this.config.economy.targetInflationRate,
      this.marketGrowthRate,
      taylor.targetGrowthRate,
      taylor.a,
      taylor.b
    );

    this.interestRate = applyInterestStep(
      this.interestRate,
      targetRate,
      taylor.bigGapThreshold,
      taylor.normalStep,
      taylor.bigStep
    );

    // §2.2 금리 변동 → 섹터 지수 반영 (매크로 → 섹터 방향)
    this.sectors.onInterestRateChange(this.interestRate);

    this.prevDayCpiIndex = this.cpiIndex;
    this.prevDayAvgSector = avgSector;

    if (this.inflationRate > this.config.economy.newbieChurnPenaltyThreshold) {
      console.log(
        `[macro] High inflation ${(this.inflationRate * 100).toFixed(1)}% — newbie churn penalty active`
      );
    }
  }

  private advanceBusinessCycle(): void {
    const { periodDays, amplitude } = this.config.economy.businessCycle;
    this.businessCyclePhase =
      (this.businessCyclePhase + (2 * Math.PI) / periodDays) % (2 * Math.PI);
    this.businessCycleValue = amplitude * Math.sin(this.businessCyclePhase);
  }

  private persistCpi(): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO system_state (key, value) VALUES ('cpi_index', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(this.cpiIndex));
  }
}
