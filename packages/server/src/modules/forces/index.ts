import { TickEvent } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig, ForceProfile } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from '../economy/ledger';
import { AmmModule } from '../market/amm';
import { CompaniesModule } from '../companies';
import { IntelModule } from '../intel';
import {
  ForceSignal,
  MomentumParams,
  ShortParams,
  ValueParams,
  momentumStrategy,
  shortStrategy,
  valueStrategy,
} from './strategies';

interface ProfileState {
  profile: ForceProfile;
  accountId: string;
  /** 회사별 보유 수량(부호 포함). 양수=롱, 음수=숏. */
  positions: Map<string, number>;
  cooldown: number;
}

/**
 * 세력 AI (§1): 플레이어가 아닌 시스템 계좌(type='force')로 움직이는 자동 트레이더.
 * — positions는 DB portfolio/orders를 쓰지 않고 내부 Map으로 추적(스키마 변경 불필요).
 * — 공매도는 sell(풀에 주식↑, 음수 포지션), 숏커버는 buy(풀에서 주식↓).
 */
export class ForcesModule implements GameModule {
  name = 'forces';

  private states = new Map<string, ProfileState>();

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private amm: AmmModule,
    private companies: CompaniesModule,
    private intel: IntelModule
  ) {}

  init(): void {
    const db = getDb();
    for (const profile of this.config.forces.profiles) {
      const accountId = `force-${profile.id}`;
      const existing = db.prepare(`SELECT id FROM accounts WHERE id = ?`).get(accountId);
      if (!existing) {
        db.prepare(`INSERT INTO accounts (id, type, owner_id, balance) VALUES (?, 'force', NULL, 0)`).run(
          accountId
        );
        this.ledger.mint(accountId, profile.startingCapital, 'FORCE_CAPITAL');
      }
      this.states.set(profile.id, { profile, accountId, positions: new Map(), cooldown: 0 });
    }
  }

  getProfileIds(): string[] {
    return [...this.states.keys()];
  }

  getAccountId(profileId: string): string {
    const state = this.states.get(profileId);
    if (!state) throw new Error(`Unknown force profile: ${profileId}`);
    return state.accountId;
  }

  getPosition(profileId: string, companyId: string): number {
    return this.states.get(profileId)?.positions.get(companyId) ?? 0;
  }

  onPriceTick(_event: TickEvent): void {
    for (const state of this.states.values()) {
      if (state.cooldown > 0) {
        state.cooldown -= 1;
        continue;
      }

      const active = this.companies.getAllCompanies().filter((c) => c.status === 'ACTIVE');
      let acted = false;
      for (const company of active) {
        const fairPrice = this.companies.getFairPrice(company.id);
        const signal = this.evaluate(state.profile, company.id, fairPrice);
        if (!signal.side) continue;
        acted = this.execute(state, company.id, signal) || acted;
      }
      if (acted) state.cooldown = state.profile.cooldownTicks;
    }
  }

  private evaluate(profile: ForceProfile, companyId: string, fairPrice: number): ForceSignal {
    const company = this.companies.getCompany(companyId);
    if (!company) return { side: null, strength: 0 };
    switch (profile.id) {
      case 'value':
        return valueStrategy(company, fairPrice, profile.params as unknown as ValueParams);
      case 'momentum':
        return momentumStrategy(
          this.companies.getPriceHistory(companyId),
          profile.params as unknown as MomentumParams
        );
      case 'short':
        return shortStrategy(
          company,
          fairPrice,
          this.hasBadNews(companyId),
          profile.params as unknown as ShortParams
        );
      default:
        return { side: null, strength: 0 };
    }
  }

  private execute(state: ProfileState, companyId: string, signal: ForceSignal): boolean {
    const company = this.companies.getCompany(companyId);
    if (!company || !signal.side || company.currentPrice <= 0) return false;

    const balance = this.ledger.getBalance(state.accountId);
    const capital = Math.max(0, Math.min(state.profile.startingCapital, balance));
    const budget = capital * state.profile.tradeSizeRatio * signal.strength;
    if (budget <= 0) return false;

    const limit = this.config.forces.positionLimit;
    const current = state.positions.get(companyId) ?? 0;
    const desiredQty = budget / company.currentPrice;

    // 숏커버/롱 추가(매수) 또는 롱 청산/숏 추가(매도)를 한도 내로 클램프.
    const capacity = signal.side === 'buy' ? limit - current : limit + current;
    const qty = Math.min(desiredQty, capacity);
    if (qty <= 0) return false;

    try {
      this.amm.marketOrder(state.accountId, state.profile.id, companyId, signal.side, qty);
    } catch {
      return false; // 서킷브레이커·유동성 부족 시 이번 틱은 포기
    }

    state.positions.set(companyId, signal.side === 'buy' ? current + qty : current - qty);

    if (Math.abs(qty) >= this.config.forces.positionLimit * 0.2) {
      this.intel.broadcastNews(
        `${state.profile.name} 대량 거래`,
        `${company.name} ${signal.side === 'buy' ? '매수' : '매도'} ${qty.toFixed(0)}주`,
        companyId
      );
    }

    return true;
  }

  /** 악재 감지: 실적 적자 또는 최근 루머/뉴스 이력이 있는 기업. */
  private hasBadNews(companyId: string): boolean {
    const company = this.companies.getCompany(companyId);
    if (company && company.stats.profit < 0) return true;
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) AS c FROM intel_items WHERE company_id = ?`).get(companyId) as
      | { c: number }
      | undefined;
    return (row?.c ?? 0) > 0;
  }
}
