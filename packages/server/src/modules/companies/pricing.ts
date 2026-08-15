import { Company, CompanyStats } from '@stock-survival/shared';

/** 설명 레이어: 요인명 + 방향만 노출 (§6 — 수치·수식은 비공개). */
export interface PriceFactor {
  name: string;
  direction: '▲' | '▼' | '—';
}

/**
 * 파생 profit (§3): 매 틱 계산.
 * profit = revenue × margin − 원자재비(materialIndex × materialSensitivity) − 이자(debt × 금리)
 */
export function deriveProfit(
  revenue: number,
  margin: number,
  materialIndex: number,
  materialSensitivity: number,
  debt: number,
  interestRate: number
): number {
  return revenue * margin - materialIndex * materialSensitivity - debt * interestRate;
}

/** 스탯 가중합 → 정규화 점수(0.5~1.5 범위). */
export function computeStatScore(stats: CompanyStats, weights: Record<string, number>): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const statValue = (stats as unknown as Record<string, number>)[key] ?? 0;
    weightedSum += (statValue / 100) * weight;
    totalWeight += Math.abs(weight);
  }
  const normalized = totalWeight > 0 ? weightedSum / totalWeight : 1;
  return 0.5 + normalized;
}

export function calculateFairPrice(
  basePrice: number,
  stats: CompanyStats,
  weights: Record<string, number>,
  sectorMultiplier: number
): number {
  const score = computeStatScore(stats, weights);
  return Math.max(1, basePrice * score * sectorMultiplier);
}

export function applyStabilityFactor(
  fairPrice: number,
  history: number[],
  maxDrop: number,
  maxGain: number,
  window: number
): number {
  if (history.length === 0) return fairPrice;

  const recent = history.slice(-window);
  const median = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (median <= 0) return fairPrice;

  const ratio = fairPrice / median;
  const logDelta = Math.log(ratio);
  const clamped = Math.max(-maxDrop, Math.min(maxGain, logDelta));
  return Math.max(1, median * Math.exp(clamped));
}

export function historicalMedian(history: number[], window: number): number {
  if (history.length === 0) return 0;
  const recent = history.slice(-window);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

/**
 * 시가총액 상위 N개 기업 id (§5 대기업 판별). 현재가 × 발행주식수 기준 내림차순.
 * — companies·centralBank 공용 순수 헬퍼 (의존성 순환 방지를 위해 로컬 시총 계산).
 */
export function largeCapIds(companies: Company[], topN: number): string[] {
  return companies
    .slice()
    .sort((a, b) => b.currentPrice * b.sharesOutstanding - a.currentPrice * a.sharesOutstanding)
    .slice(0, topN)
    .map((c) => c.id);
}
