import { Company, TickEvent } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { CompaniesModule } from '../companies';
import { SectorsModule } from '../companies/sectors';
import { IntelModule } from '../intel';
import { CircuitBreaker } from '../market/circuit-breaker';
import { largeCapIds } from '../companies/pricing';

/**
 * 중앙은행 개입 (§5) — 순수 헬퍼 레이어.
 * — 구제금융은 돈 발행 없음(희석만) → ledger 보존 불변 유지.
 * — 모든 함수는 상태를 갖지 않는 순수 함수 (테스트 용이성).
 */

/** 시가총액 = 현재가 × 발행주식수. */
export function computeMarketCap(company: Company): number {
  return company.currentPrice * company.sharesOutstanding;
}

/** 부채비율 = debt / revenue (revenue ≤ 0 이면 무한대). */
export function debtRevenueRatio(company: Company): number {
  return company.stats.revenue > 0 ? company.stats.debt / company.stats.revenue : Infinity;
}

/**
 * 구제금융 발동 조건 (§5):
 *   시총 상위 N && 부채비율 > 위험선 && 고점대비 -X%
 */
export function shouldBailout(
  company: Company,
  isLargeCap: boolean,
  priceHistory: number[],
  debtRatioThreshold: number,
  drawdownThreshold: number
): boolean {
  if (!isLargeCap) return false;
  if (debtRevenueRatio(company) <= debtRatioThreshold) return false;

  const peak = priceHistory.length > 0 ? Math.max(...priceHistory) : company.currentPrice;
  if (peak <= 0) return false;
  const drawdown = (peak - company.currentPrice) / peak;
  return drawdown >= drawdownThreshold;
}

/**
 * 신주발행 희석 적용 (§5): 시총 보존한 채 sharesOutstanding↑ · currentPrice↓, 부채 일부 탕감.
 * — AMM 풀·계좌는 건드리지 않음 (돈 발행 없음).
 * — 반환: 갱신된 { sharesOutstanding, currentPrice, debt }.
 */
export function applyDilution(
  company: Company,
  debtReliefRatio: number,
  dilutionMultiplier: number
): { sharesOutstanding: number; currentPrice: number; debt: number } {
  const newShares = company.sharesOutstanding * dilutionMultiplier;
  const newPrice = Math.max(1, company.currentPrice / dilutionMultiplier);
  const newDebt = company.stats.debt * (1 - debtReliefRatio);
  return { sharesOutstanding: newShares, currentPrice: newPrice, debt: newDebt };
}

/**
 * 중앙은행 개입 모듈 (§5): onPriceTick에서 트리거 기반으로만 판정 (상시 계산 없음).
 * — 구제금융은 돈 발행 없음(희석만) → ledger 보존 불변 유지.
 * — 등록 순서: companies → intel → centralBank (최신 가격·뉴스 반영 후 판정).
 */
export class CentralBankModule implements GameModule {
  name = 'central-bank';

  private lastDay = -1;
  private dayOpenIndex = 1;
  private circuitBreakerCooldown = 0;
  private bailoutCooldown = new Map<string, number>();

  constructor(
    private config: AppConfig,
    private companies: CompaniesModule,
    private sectors: SectorsModule,
    private intel: IntelModule,
    private circuitBreaker: CircuitBreaker
  ) {}

  init(): void {}

  onPriceTick(event: TickEvent): void {
    const cb = this.config.centralBank;

    // ① 서킷브레이커 틱 감소 + 쿨다운 감소
    this.circuitBreaker.tick();
    if (this.circuitBreakerCooldown > 0) this.circuitBreakerCooldown -= 1;
    this.decrementBailoutCooldowns();

    // ② day-open 지수 추적 → 하루 낙폭 판정 (서킷브레이커)
    const index = this.compositeIndex();
    if (event.gameTime.day !== this.lastDay) {
      this.lastDay = event.gameTime.day;
      this.dayOpenIndex = index;
    }
    if (this.dayOpenIndex > 0 && this.circuitBreakerCooldown === 0) {
      const drawdown = (this.dayOpenIndex - index) / this.dayOpenIndex;
      if (drawdown >= cb.circuitBreakerIndexDrop) {
        this.circuitBreaker.halt(cb.circuitBreakerHaltTicks);
        this.circuitBreakerCooldown = cb.circuitBreakerCooldownTicks;
        this.intel.broadcastNews(
          '[Circuit breaker] Market plunge',
          `The index fell ${Math.round(drawdown * 100)}% in a day; trading is halted.`,
          null
        );
      }
    }

    // ③ 구제금융 (시총 상위 N 대기업만, 공짜 아님 — 희석 페널티)
    const active = this.companies.getAllCompanies().filter((c) => c.status === 'ACTIVE');
    const largeIds = new Set(largeCapIds(active, cb.largeCapTopN));
    for (const company of active) {
      if (!largeIds.has(company.id)) continue;
      if ((this.bailoutCooldown.get(company.id) ?? 0) > 0) continue;

      const history = this.companies.getPriceHistory(company.id);
      if (!shouldBailout(company, true, history, cb.bailoutDebtRevenueRatio, cb.bailoutDrawdownThreshold)) {
        continue;
      }

      const d = applyDilution(company, cb.bailoutDebtReliefRatio, cb.bailoutDilutionMultiplier);
      this.applyCompanyDilution(company, d);
      this.bailoutCooldown.set(company.id, cb.bailoutCooldownTicks);
      this.intel.broadcastNews(
        `[Bailout] ${company.name} government intervention`,
        'New shares are issued and some debt is written off, diluting existing shares.',
        company.id
      );
    }
  }

  private compositeIndex(): number {
    const values = Object.values(this.sectors.getIndices());
    if (values.length === 0) return 1;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private decrementBailoutCooldowns(): void {
    for (const [id, ticks] of [...this.bailoutCooldown]) {
      const next = ticks - 1;
      if (next <= 0) this.bailoutCooldown.delete(id);
      else this.bailoutCooldown.set(id, next);
    }
  }

  /** 희석 적용: sharesOutstanding/currentPrice/debt만 갱신 (AMM 풀·계좌 불변). */
  private applyCompanyDilution(
    company: Company,
    d: { sharesOutstanding: number; currentPrice: number; debt: number }
  ): void {
    const db = getDb();
    const stats = { ...company.stats, debt: d.debt };
    db.prepare(
      `UPDATE companies SET shares_outstanding = ?, current_price = ?, stats_json = ? WHERE id = ?`
    ).run(d.sharesOutstanding, d.currentPrice, JSON.stringify(stats), company.id);
  }
}
