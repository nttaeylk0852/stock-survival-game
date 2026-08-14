import fs from 'fs';
import path from 'path';

const CONFIG_ROOT = path.resolve(__dirname, '../../../../config');

export function loadConfig<T>(filename: string): T {
  const filePath = path.join(CONFIG_ROOT, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

export interface EconomyConfig {
  starterCash: number;
  targetInflationRate: number;
  baseInterestRate: number;
  bondIssueRate: number;
  newbieChurnPenaltyThreshold: number;
  newbieChurnPenaltyMultiplier: number;
}

export interface MarketConfig {
  userInfluenceCap: number;
  ammSlippageRate: number;
  ammFeeRate: number;
  orderBookMaxDepth: number;
  priceStabilityMaxDrop: number;
  priceStabilityMaxGain: number;
  historicalMedianWindow: number;
}

export interface SurvivalConfig {
  maxHealth: number;
  hungerThresholdMinutes: number;
  hungerDamagePerTick: number;
  weatherDamagePerTick: number;
  mealCostBase: number;
  restCostBase: number;
  mealHealthRestore: number;
}

export interface WorldConfig {
  startYear: number;
  startMonth: number;
  startDay: number;
  realSecondsPerGameMinute: number;
  priceTickIntervalSeconds: number;
  survivalTickIntervalSeconds: number;
  seasonLengthDays: number;
}

export interface CompaniesConfig {
  aiWeights: Record<string, number>;
  bankruptcyDebtRevenueRatio: number;
  bankruptcyLossStreakTicks: number;
}

export interface IntelConfig {
  rumorFakeRate: number;
  infoPurchaseCostBase: number;
  majorShareholderThreshold: number;
  earlyWarningLeadTicks: number;
}

export interface SectorsConfig {
  indices: Record<string, number>;
  volatilityPerTick: number;
}

export interface CompanySeed {
  id: string;
  name: string;
  basePrice: number;
  stats: Record<string, number>;
  sectors: string[];
  supplySensitivity: number;
  sharesOutstanding: number;
}

export function loadAllConfig() {
  return {
    economy: loadConfig<EconomyConfig>('economy.json'),
    market: loadConfig<MarketConfig>('market.json'),
    survival: loadConfig<SurvivalConfig>('survival.json'),
    world: loadConfig<WorldConfig>('world.json'),
    companies: loadConfig<CompaniesConfig>('companies.json'),
    intel: loadConfig<IntelConfig>('intel.json'),
    sectors: loadConfig<SectorsConfig>('sectors.json'),
    companySeeds: loadConfig<CompanySeed[]>('companies.seed.json'),
  };
}

export type AppConfig = ReturnType<typeof loadAllConfig>;
