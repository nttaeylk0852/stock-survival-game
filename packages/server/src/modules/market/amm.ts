import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from '../economy/ledger';
import { PlayersModule } from '../players';
import { CompaniesModule } from '../companies';
import { OrderBookModule } from './orderbook';
import { InfluenceModule } from './influence';

export class AmmModule implements GameModule {
  name = 'market/amm';

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule,
    private companies: CompaniesModule,
    private orderBook: OrderBookModule,
    private influence: InfluenceModule
  ) {}

  init(): void {}

  buyFromAmm(characterId: string, companyId: string, quantity: number): { price: number; total: number } {
    const company = this.companies.getCompany(companyId);
    if (!company || company.status !== 'ACTIVE') throw new Error('Company not tradable');

    const pool = this.getPool(companyId);
    const k = pool.cashReserve * pool.shareReserve;
    const newShareReserve = pool.shareReserve - quantity;
    if (newShareReserve <= 0) throw new Error('Insufficient AMM liquidity');

    const newCashReserve = k / newShareReserve;
    let total = newCashReserve - pool.cashReserve;
    total *= 1 + this.config.market.ammSlippageRate + this.config.market.ammFeeRate;

    const accountId = this.players.getAccountId(characterId);
    this.ensureAmmAccount(companyId);
    this.ledger.transfer(accountId, `amm-${companyId}`, total, 'AMM_TRADE');

    const db = getDb();
    db.prepare(`UPDATE amm_pools SET cash_reserve = ?, share_reserve = ? WHERE company_id = ?`).run(
      pool.cashReserve + total,
      newShareReserve,
      companyId
    );

    this.orderBook.addShares(characterId, companyId, quantity);
    this.influence.recordTradeInfluence(companyId, total / quantity, quantity);

    return { price: total / quantity, total };
  }

  sellToAmm(characterId: string, companyId: string, quantity: number): { price: number; total: number } {
    const company = this.companies.getCompany(companyId);
    if (!company || company.status !== 'ACTIVE') throw new Error('Company not tradable');

    const holdings = this.orderBook.getPortfolioEntry(characterId, companyId);
    if (holdings.shares < quantity) throw new Error('Insufficient shares');

    const pool = this.getPool(companyId);
    const k = pool.cashReserve * pool.shareReserve;
    const newShareReserve = pool.shareReserve + quantity;
    const newCashReserve = k / newShareReserve;
    let total = pool.cashReserve - newCashReserve;
    total *= 1 - this.config.market.ammSlippageRate - this.config.market.ammFeeRate;

    const accountId = this.players.getAccountId(characterId);
    this.ensureAmmAccount(companyId);
    this.ledger.transfer(`amm-${companyId}`, accountId, total, 'AMM_TRADE');

    const db = getDb();
    db.prepare(`UPDATE amm_pools SET cash_reserve = ?, share_reserve = ? WHERE company_id = ?`).run(
      newCashReserve,
      newShareReserve,
      companyId
    );

    this.orderBook.addShares(characterId, companyId, -quantity);
    this.influence.recordTradeInfluence(companyId, total / quantity, quantity);

    return { price: total / quantity, total };
  }

  trade(
    characterId: string,
    companyId: string,
    side: 'buy' | 'sell',
    quantity: number,
    limitPrice?: number
  ): { method: 'orderbook' | 'amm'; price: number; total: number } {
    if (limitPrice) {
      this.orderBook.placeOrder(characterId, companyId, side, limitPrice, quantity);
      return { method: 'orderbook', price: limitPrice, total: limitPrice * quantity };
    }

    if (side === 'buy') {
      const result = this.buyFromAmm(characterId, companyId, quantity);
      return { method: 'amm', ...result };
    }
    const result = this.sellToAmm(characterId, companyId, quantity);
    return { method: 'amm', ...result };
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
