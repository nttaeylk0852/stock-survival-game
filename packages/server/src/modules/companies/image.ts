/**
 * 이미지 2축(§3): 브랜드(x) → revenue, 경영진 신뢰도(y) → 변동성·거버넌스·루머.
 * 순수 함수 모음 — 상태 없음, 밸런스 수치는 config에서 인자로 받는다.
 */

/** 브랜드(0~100) → revenue 배율 [min, max] 선형 보간. */
export function computeBrandMultiplier(brand: number, min: number, max: number): number {
  const t = Math.max(0, Math.min(100, brand)) / 100;
  return min + t * (max - min);
}

/** 경영진 신뢰도 → 주가 변동폭 배율. 신뢰도가 낮을수록 >1 (변동성↑). */
export function computeVolatilityFactor(
  credibility: number,
  defaultCredibility: number,
  sensitivity: number
): number {
  return 1 + (sensitivity * (defaultCredibility - credibility)) / 100;
}

/** 경영진 신뢰도 → 거버넌스 가결 배율. 신뢰도가 낮을수록 <1 (통과 어려움). */
export function computeGovernancePassFactor(
  credibility: number,
  defaultCredibility: number,
  sensitivity: number
): number {
  return 1 + (sensitivity * (credibility - defaultCredibility)) / 100;
}

/** 경영진 신뢰도 → 루머 fake 확률. 신뢰도가 낮을수록 fake↑ (0~1 클램프). */
export function computeRumorFakeRate(
  baseRate: number,
  credibility: number,
  defaultCredibility: number,
  sensitivity: number
): number {
  const factor = 1 + (sensitivity * (defaultCredibility - credibility)) / 100;
  return Math.max(0, Math.min(1, baseRate * factor));
}
