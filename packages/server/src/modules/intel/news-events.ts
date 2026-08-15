import { NewsEvent, NewsEventsConfig } from '../../core/config-loader';

/** 상태기반 bias 평가에 필요한 스냅샷. */
export interface NewsState {
  interestRate: number;
  baseInterestRate: number;
  inflationRate: number;
  commodities: Record<string, number>;
  commodityBasePrices: Record<string, number>;
  sectorIndices: Record<string, number>;
}

/** bias 키가 현재 상태에서 활성인지 판정 (§4.2 상태가 확률을 결정). */
export function isBiasConditionMet(
  biasKey: string,
  state: NewsState,
  config: NewsEventsConfig
): boolean {
  if (biasKey === 'interestRateHigh') {
    return state.interestRate - state.baseInterestRate > config.interestRateHighDelta;
  }
  if (biasKey === 'interestRateLow') {
    return state.baseInterestRate - state.interestRate > config.interestRateHighDelta;
  }
  if (biasKey === 'inflationHigh') {
    return state.inflationRate > config.inflationHighThreshold;
  }
  if (biasKey.startsWith('commoditySpike.')) {
    const name = biasKey.slice('commoditySpike.'.length);
    const price = state.commodities[name];
    const base = state.commodityBasePrices[name];
    if (price === undefined || base === undefined || base <= 0) return false;
    return price / base > config.commoditySpikeThreshold;
  }
  if (biasKey.startsWith('sectorHot.')) {
    const name = biasKey.slice('sectorHot.'.length);
    const index = state.sectorIndices[name];
    return index !== undefined && index > config.sectorHotThreshold;
  }
  if (biasKey.startsWith('sectorCold.')) {
    const name = biasKey.slice('sectorCold.'.length);
    const index = state.sectorIndices[name];
    return index !== undefined && index < config.sectorColdThreshold;
  }
  return false;
}

/** 가중치 = baseWeight × Π(활성 bias 배수). */
export function computeEventWeight(
  event: NewsEvent,
  state: NewsState,
  config: NewsEventsConfig
): number {
  let weight = event.baseWeight;
  for (const [key, multiplier] of Object.entries(event.bias ?? {})) {
    if (isBiasConditionMet(key, state, config)) weight *= multiplier;
  }
  return weight;
}

/** 가중 랜덤 선택 (rand 주입으로 결정론적 테스트). */
export function selectNewsEvent(
  events: NewsEvent[],
  state: NewsState,
  config: NewsEventsConfig,
  rand: () => number = Math.random
): NewsEvent | null {
  if (events.length === 0) return null;
  const weighted = events.map((event) => ({
    event,
    weight: Math.max(0, computeEventWeight(event, state, config)),
  }));
  const total = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (total <= 0) return weighted[0].event;
  let r = rand() * total;
  for (const { event, weight } of weighted) {
    r -= weight;
    if (r <= 0) return event;
  }
  return weighted[weighted.length - 1].event;
}

export interface HeadlineContext {
  [key: string]: string;
}

/** {slot} 치환 (미지원 슬롯은 원문 유지). */
export function renderHeadline(template: string, ctx: HeadlineContext): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => ctx[key] ?? match);
}
