/**
 * 서킷브레이커 상태 (§5): 거래 일시정지.
 * — 의존성 순환 회피를 위해 OrderBook/Amm/CentralBank가 공유하는 단일 객체.
 * — 돈·주문을 건드리지 않는 순수 상태 머신.
 */
export class CircuitBreaker {
  private remainingTicks = 0;

  /** 거래 일시정지 요청. 이미 정지 중이면 남은 틱을 연장한다. */
  halt(ticks: number): void {
    this.remainingTicks = Math.max(this.remainingTicks, ticks);
  }

  /** 매 PRICE_TICK마다 1틱씩 감소. */
  tick(): void {
    if (this.remainingTicks > 0) this.remainingTicks -= 1;
  }

  isHalted(): boolean {
    return this.remainingTicks > 0;
  }
}
