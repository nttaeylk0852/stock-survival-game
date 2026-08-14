import { CompanyStats } from '@stock-survival/shared';

export function calculateFairPrice(
  basePrice: number,
  stats: CompanyStats,
  weights: Record<string, number>,
  sectorMultiplier: number
): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const statValue = (stats as unknown as Record<string, number>)[key] ?? 0;
    weightedSum += (statValue / 100) * weight;
    totalWeight += Math.abs(weight);
  }
  const normalized = totalWeight > 0 ? weightedSum / totalWeight : 1;
  const score = 0.5 + normalized;
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
