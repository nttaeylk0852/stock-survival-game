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
  taylor: {
    a: number;
    b: number;
    targetGrowthRate: number;
    normalStep: number;
    bigStep: number;
    bigGapThreshold: number;
  };
  businessCycle: {
    periodDays: number;
    amplitude: number;
  };
}

export interface MarketConfig {
  userInfluenceCap: number;
  userInstitutionEnabled: boolean;
  institutionTermGameDays: number;
  institutionMinNetWorthMultiple: number;
  institutionSeatPerCompany: number;
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

export interface JobsConfig {
  regularAllowanceRatio: number;
  regularDurationGameDays: number;
  regularIndependenceMultiple: number;
  partTimeExtra: number;
}

export interface WorldConfig {
  startYear: number;
  startMonth: number;
  startDay: number;
  realSecondsPerGameMinute: number;
  priceTickIntervalSeconds: number;
  survivalTickIntervalSeconds: number;
  seasonLengthDays: number;
  marketOpenHour: number;
  marketCloseHour: number;
  settlementEndHour: number;
  mainSessionHours: number[];
  mainSessionVolatilityBoost: number;
  mainSessionNewsBoost: number;
}

export interface CompaniesConfig {
  aiWeights: Record<string, number>;
  bankruptcyDebtRevenueRatio: number;
  bankruptcyLossStreakTicks: number;
  defaultMargin: number;
  defaultMaterialSensitivity: number;
  brandRevenueMultiplierMin: number;
  brandRevenueMultiplierMax: number;
  managementCredibilityDefault: number;
  managementVolatilitySensitivity: number;
  managementGovernanceSensitivity: number;
  managementRumorSensitivity: number;
}

export interface IntelConfig {
  rumorFakeRate: number;
  infoPurchaseCostBase: number;
  majorShareholderThreshold: number;
  earlyWarningLeadTicks: number;
  dailyIntelPurchaseLimit: number;
}

export interface SectorsConfig {
  indices: Record<string, number>;
  rateSensitivity?: Record<string, number>;
  sectorContagionDrop: number;
  indexMin: number;
  indexMax: number;
}

export interface CentralBankConfig {
  largeCapTopN: number;
  largeCapStabilityMaxDrop: number;
  largeCapStabilityMaxGain: number;
  bailoutDebtRevenueRatio: number;
  bailoutDrawdownThreshold: number;
  bailoutDebtReliefRatio: number;
  bailoutDilutionMultiplier: number;
  bailoutCooldownTicks: number;
  circuitBreakerIndexDrop: number;
  circuitBreakerHaltTicks: number;
  circuitBreakerCooldownTicks: number;
}

export interface CommodityConfig {
  basePrice: number;
  cpiWeight: number;
  volatility: number;
}

export type CommoditiesConfig = Record<string, CommodityConfig>;

export type NewsEffects = Record<string, number>;

export interface NewsChainStep {
  after: number;
  effects: NewsEffects;
  headline?: string;
}

export interface NewsEvent {
  id: string;
  headlineVariants: string[];
  baseWeight: number;
  bias?: Record<string, number>;
  effects: NewsEffects;
  chain?: NewsChainStep[];
}

export interface NewsEventsConfig {
  eventTickProbability: number;
  interestRateHighDelta: number;
  inflationHighThreshold: number;
  sectorHotThreshold: number;
  sectorColdThreshold: number;
  commoditySpikeThreshold: number;
  events: NewsEvent[];
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
    jobs: loadConfig<JobsConfig>('jobs.json'),
    survival: loadConfig<SurvivalConfig>('survival.json'),
    world: loadConfig<WorldConfig>('world.json'),
    companies: loadConfig<CompaniesConfig>('companies.json'),
    centralBank: loadConfig<CentralBankConfig>('central-bank.json'),
    intel: loadConfig<IntelConfig>('intel.json'),
    sectors: loadConfig<SectorsConfig>('sectors.json'),
    newsEvents: loadConfig<NewsEventsConfig>('news-events.json'),
    commodities: loadConfig<CommoditiesConfig>('commodities.json'),
    companySeeds: loadConfig<CompanySeed[]>('companies.seed.json'),
  };
}

export type AppConfig = ReturnType<typeof loadAllConfig>;
