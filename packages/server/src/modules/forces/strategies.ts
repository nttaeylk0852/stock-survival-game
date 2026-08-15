import { Company } from '@stock-survival/shared';

/** 세력 전략이 내놓는 매매 신호. side=null 이면 관망. */
export interface ForceSignal {
  side: 'buy' | 'sell' | null;
  /** 신호 강도(0~1). 괴리·수익률 크기에 비례. */
  strength: number;
}

export interface ValueParams {
  /** |적정가-현재가| / 현재가 가 이 임계값을 넘으면 신호 발생. */
  gapThreshold: number;
}

export interface MomentumParams {
  /** 수익률을 계산할 과거 틱 수. */
  window: number;
  /** 이 수익률을 넘으면 추세로 판단. */
  returnThreshold: number;
}

export interface ShortParams {
  /** 현재가가 적정가보다 이 비율 이상 높으면 고평가 판정. */
  overvalueThreshold: number;
}

function clampStrength(ratio: number, threshold: number): number {
  if (threshold <= 0) return 0;
  return Math.max(0, Math.min(1, ratio / threshold));
}

/** 가치투자(역방향): 저평가(적정가>현재가)면 매수, 고평가면 매도. */
export function valueStrategy(company: Company, fairPrice: number, params: ValueParams): ForceSignal {
  const price = company.currentPrice;
  if (price <= 0) return { side: null, strength: 0 };
  const gap = (fairPrice - price) / price;
  if (gap > params.gapThreshold) {
    return { side: 'buy', strength: clampStrength(gap, params.gapThreshold) };
  }
  if (gap < -params.gapThreshold) {
    return { side: 'sell', strength: clampStrength(-gap, params.gapThreshold) };
  }
  return { side: null, strength: 0 };
}

/** 모멘텀(추세 추종): N틱 수익률 양(+)이면 매수, 음(-)이면 매도. */
export function momentumStrategy(priceHistory: number[], params: MomentumParams): ForceSignal {
  if (priceHistory.length < params.window + 1) return { side: null, strength: 0 };
  const now = priceHistory[priceHistory.length - 1];
  const past = priceHistory[priceHistory.length - 1 - params.window];
  if (past <= 0) return { side: null, strength: 0 };
  const ret = (now - past) / past;
  if (ret > params.returnThreshold) {
    return { side: 'buy', strength: clampStrength(ret, params.returnThreshold) };
  }
  if (ret < -params.returnThreshold) {
    return { side: 'sell', strength: clampStrength(-ret, params.returnThreshold) };
  }
  return { side: null, strength: 0 };
}

/** 공매도(헤지펀드): 고평가 + 악재 기업에 대해서만 공격(매도=숏). */
export function shortStrategy(
  company: Company,
  fairPrice: number,
  badNews: boolean,
  params: ShortParams
): ForceSignal {
  if (!badNews) return { side: null, strength: 0 };
  const price = company.currentPrice;
  if (price <= 0) return { side: null, strength: 0 };
  const gap = (fairPrice - price) / price;
  if (gap < -params.overvalueThreshold) {
    return { side: 'sell', strength: clampStrength(-gap, params.overvalueThreshold) };
  }
  return { side: null, strength: 0 };
}
