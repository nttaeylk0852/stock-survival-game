import { getDb } from '../../db';
import { TickEvent } from '@stock-survival/shared';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from '../economy/ledger';
import { PlayersModule } from '../players';
import { CompaniesModule } from '../companies';
import { OrderBookModule } from './orderbook';
import { InfluenceModule } from './influence';
import { CircuitBreaker } from './circuit-breaker';
import type { MarketSession } from '../world/market-session';
import type { DailyActionsModule } from '../players/daily-actions';

export class AmmModule implements GameModule {
  name = 'market/amm';

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule,
    private companies: CompaniesModule,
    private orderBook: OrderBookModule,
    private influence: InfluenceModule,
    private circuitBreaker: CircuitBreaker,
    private marketSession: MarketSession,
    private dailyActions: DailyActionsModule
  ) {}

  init(): void {}

  /**
   * 코어 풀 연산(서킷브레이커·잔고 검증·ensureAmmAccount·풀 갱신·ledger.transfer).
   * 플레이어 경로(buyFromAmm/sellToAmm)와 세력 경로가 공유한다.
   * — holderId는 포지션/영향력 기록용 식별자이며, 실제 이체는 accountId 기준으로 이뤄진다.
   */
  marketOrder(
    accountId: string,
    holderId: string,
    companyId: string,
    side: 'buy' | 'sell',
    quantity: number
  ): { price: number; total: number } {
    if (this.circuitBreaker.isHalted()) throw new Error('Trading halted by circuit breaker');
    if (!this.marketSession.isMarketOpen()) throw new Error('Market closed');
    const company = this.companies.getCompany(companyId);
    if (!company || company.status !== 'ACTIVE') throw new Error('Company not tradable');
    if (quantity <= 0) throw new Error('Quantity must be positive');

    const pool = this.getPool(companyId);
    const k = pool.cashReserve * pool.shareReserve;
    this.ensureAmmAccount(companyId);

    const db = getDb();
    let total: number;
    let newCashReserve: number;
    let newShareReserve: number;

    if (side === 'buy') {
      newShareReserve = pool.shareReserve - quantity;
      if (newShareReserve <= 0) throw new Error('Insufficient AMM liquidity');
      newCashReserve = k / newShareReserve;
      total =
        (newCashReserve - pool.cashReserve) *
        (1 + this.config.market.ammSlippageRate + this.config.market.ammFeeRate);
      this.ledger.transfer(accountId, `amm-${companyId}`, total, 'AMM_TRADE');
      db.prepare(`UPDATE amm_pools SET cash_reserve = ?, share_reserve = ? WHERE company_id = ?`).run(
        pool.cashReserve + total,
        newShareReserve,
        companyId
      );
    } else {
      newShareReserve = pool.shareReserve + quantity;
      newCashReserve = k / newShareReserve;
      total =
        (pool.cashReserve - newCashReserve) *
        (1 - this.config.market.ammSlippageRate - this.config.market.ammFeeRate);
      this.ledger.transfer(`amm-${companyId}`, accountId, total, 'AMM_TRADE');
      db.prepare(`UPDATE amm_pools SET cash_reserve = ?, share_reserve = ? WHERE company_id = ?`).run(
        newCashReserve,
        newShareReserve,
        companyId
      );
    }

    return { price: total / quantity, total };
  }

  buyFromAmm(characterId: string, companyId: string, quantity: number): { price: number; total: number } {
    const result = this.marketOrder(
      this.players.getAccountId(characterId),
      characterId,
      companyId,
      'buy',
      quantity
    );
    this.orderBook.addShares(characterId, companyId, quantity);
    this.influence.recordTradeInfluence(companyId, result.price, quantity);
    return result;
  }

  sellToAmm(characterId: string, companyId: string, quantity: number): { price: number; total: number } {
    const holdings = this.orderBook.getPortfolioEntry(characterId, companyId);
    if (holdings.shares < quantity) throw new Error('Insufficient shares');

    const result = this.marketOrder(
      this.players.getAccountId(characterId),
      characterId,
      companyId,
      'sell',
      quantity
    );
    this.orderBook.addShares(characterId, companyId, -quantity);
    this.influence.recordTradeInfluence(companyId, result.price, quantity);
    return result;
  }

  trade(
    characterId: string,
    companyId: string,
    side: 'buy' | 'sell',
    quantity: number,
    limitPrice?: number,
    orderType: 'limit' | 'stop' = 'limit'
  ): { method: 'orderbook' | 'amm'; price: number; total: number } {
    if (this.circuitBreaker.isHalted()) throw new Error('Trading halted by circuit breaker');
    if (!this.dailyActions.canTrade(characterId)) throw new Error('Daily trade limit reached');

    if (orderType === 'stop') {
      if (!limitPrice || limitPrice <= 0) throw new Error('Stop price is required');
      const order = this.orderBook.placeOrder(
        characterId,
        companyId,
        side,
        limitPrice,
        quantity,
        'stop'
      );
      this.dailyActions.recordTrade(characterId);
      return { method: 'orderbook', price: order.price, total: order.price * quantity };
    }

    if (limitPrice) {
      this.orderBook.placeOrder(characterId, companyId, side, limitPrice, quantity);
      this.dailyActions.recordTrade(characterId);
      return { method: 'orderbook', price: limitPrice, total: limitPrice * quantity };
    }

    const result =
      side === 'buy'
        ? this.buyFromAmm(characterId, companyId, quantity)
        : this.sellToAmm(characterId, companyId, quantity);
    this.dailyActions.recordTrade(characterId);
    return { method: 'amm', ...result };
  }

  /** 손절(stop) 예약주문 트리거 — 개장 중 가격 교차 시 시장가로 체결. */
  onPriceTick(_event: TickEvent): void {
    if (!this.marketSession.isMarketOpen()) return;

    for (const order of this.orderBook.getOpenStopOrders()) {
      const company = this.companies.getCompany(order.companyId);
      if (!company || company.status !== 'ACTIVE') continue;
      const current = company.currentPrice;

      const triggered =
        (order.side === 'sell' && current <= order.price) ||
        (order.side === 'buy' && current >= order.price);
      if (!triggered) continue;

      this.orderBook.cancelOrder(order.id, order.characterId);
      try {
        if (order.side === 'sell') {
          const holdings = this.orderBook.getPortfolioEntry(order.characterId, order.companyId);
          const qty = Math.min(order.quantity, holdings.shares);
          if (qty > 0) this.sellToAmm(order.characterId, order.companyId, qty);
        } else {
          this.buyFromAmm(order.characterId, order.companyId, order.quantity);
        }
      } catch {
        // 잔고 부족 등으로 체결 실패해도 주문은 이미 취소됨.
      }
    }
  }

  private getPool(companyId: string): { cashReserve: number; shareReserve: number } {
    const db = getDb();
    const row = db.prepare(`SELECT cash_reserve, share_reserve FROM amm_pools WHERE company_id = ?`).get(
      companyId
    ) as { cash_reserve: number; share_reserve: number } | undefined;
    if (!row) throw new Error('AMM pool not found');
    return { cashReserve: row.cash_reserve, shareReserve: row.share_reserve };
  }

  private ensureAmmAccount(companyId: string): void {
    const db = getDb();
    const id = `amm-${companyId}`;
    db.prepare(
      `INSERT OR IGNORE INTO accounts (id, type, owner_id, balance) VALUES (?, 'amm_pool', ?, 0)`
    ).run(id, companyId);
  }
}
