import { v4 as uuidv4 } from 'uuid';
import { Order, PortfolioEntry } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from '../economy/ledger';
import { PlayersModule } from '../players';
import { CompaniesModule } from '../companies';
import { InfluenceModule } from './influence';

export class OrderBookModule implements GameModule {
  name = 'market/orderbook';

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule,
    private companies: CompaniesModule,
    private influence: InfluenceModule
  ) {}

  init(): void {}

  placeOrder(
    characterId: string,
    companyId: string,
    side: 'buy' | 'sell',
    price: number,
    quantity: number
  ): Order {
    if (quantity <= 0 || price <= 0) throw new Error('Invalid order');
    const company = this.companies.getCompany(companyId);
    if (!company || company.status !== 'ACTIVE') throw new Error('Company not tradable');

    if (side === 'sell') {
      const holdings = this.getPortfolioEntry(characterId, companyId);
      if (holdings.shares < quantity) throw new Error('Insufficient shares');
    } else {
      const accountId = this.players.getAccountId(characterId);
      const balance = this.ledger.getBalance(accountId);
      if (balance < price * quantity) throw new Error('Insufficient balance');
    }

    const db = getDb();
    const orderId = uuidv4();
    const now = Date.now();

    db.prepare(
      `INSERT INTO orders (id, character_id, company_id, side, price, quantity, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
    ).run(orderId, characterId, companyId, side, price, quantity, now);

    this.matchOrders(companyId);

    const order = this.getOrder(orderId)!;
    return order;
  }

  matchOrders(companyId: string): void {
    const db = getDb();
    const buys = db
      .prepare(
        `SELECT * FROM orders WHERE company_id = ? AND side = 'buy' AND status = 'open'
         ORDER BY price DESC, created_at ASC LIMIT ?`
      )
      .all(companyId, this.config.market.orderBookMaxDepth) as Record<string, unknown>[];

    const sells = db
      .prepare(
        `SELECT * FROM orders WHERE company_id = ? AND side = 'sell' AND status = 'open'
         ORDER BY price ASC, created_at ASC LIMIT ?`
      )
      .all(companyId, this.config.market.orderBookMaxDepth) as Record<string, unknown>[];

    for (const buyRow of buys) {
      for (const sellRow of sells) {
        if ((buyRow.status as string) !== 'open' || (sellRow.status as string) !== 'open') continue;
        if ((buyRow.price as number) < (sellRow.price as number)) break;

        const tradePrice = (sellRow.created_at as number) < (buyRow.created_at as number)
          ? (sellRow.price as number)
          : (buyRow.price as number);
        const qty = Math.min(buyRow.quantity as number, sellRow.quantity as number);

        this.executeTrade(
          buyRow.character_id as string,
          sellRow.character_id as string,
          companyId,
          tradePrice,
          qty,
          buyRow.id as string,
          sellRow.id as string
        );

        buyRow.quantity = (buyRow.quantity as number) - qty;
        sellRow.quantity = (sellRow.quantity as number) - qty;
        if ((buyRow.quantity as number) <= 0) buyRow.status = 'filled';
        if ((sellRow.quantity as number) <= 0) sellRow.status = 'filled';
      }
    }
  }

  private executeTrade(
    buyerId: string,
    sellerId: string,
    companyId: string,
    price: number,
    quantity: number,
    buyOrderId: string,
    sellOrderId: string
  ): void {
    const total = price * quantity;
    const buyerAccount = this.players.getAccountId(buyerId);
    const sellerAccount = this.players.getAccountId(sellerId);

    const db = getDb();
    const tx = db.transaction(() => {
      this.ledger.transfer(buyerAccount, sellerAccount, total, 'TRADE');
      this.addShares(buyerId, companyId, quantity);
      this.addShares(sellerId, companyId, -quantity);

      const buyOrder = db.prepare(`SELECT quantity FROM orders WHERE id = ?`).get(buyOrderId) as {
        quantity: number;
      };
      const sellOrder = db.prepare(`SELECT quantity FROM orders WHERE id = ?`).get(sellOrderId) as {
        quantity: number;
      };

      const buyRemaining = buyOrder.quantity - quantity;
      const sellRemaining = sellOrder.quantity - quantity;

      db.prepare(`UPDATE orders SET quantity = ?, status = ? WHERE id = ?`).run(
        buyRemaining,
        buyRemaining <= 0 ? 'filled' : 'open',
        buyOrderId
      );
      db.prepare(`UPDATE orders SET quantity = ?, status = ? WHERE id = ?`).run(
        sellRemaining,
        sellRemaining <= 0 ? 'filled' : 'open',
        sellOrderId
      );
    });
    tx();

    this.influence.recordTradeInfluence(companyId, price, quantity);
  }

  addShares(characterId: string, companyId: string, delta: number): void {
    const db = getDb();
    const existing = this.getPortfolioEntry(characterId, companyId);
    const newShares = existing.shares + delta;
    if (newShares < 0) throw new Error('Negative shares');
    if (newShares === 0) {
      db.prepare(`DELETE FROM portfolio WHERE character_id = ? AND company_id = ?`).run(
        characterId,
        companyId
      );
    } else {
      db.prepare(
        `INSERT INTO portfolio (character_id, company_id, shares) VALUES (?, ?, ?)
         ON CONFLICT(character_id, company_id) DO UPDATE SET shares = excluded.shares`
      ).run(characterId, companyId, newShares);
    }
  }

  getPortfolioEntry(characterId: string, companyId: string): PortfolioEntry {
    const db = getDb();
    const row = db
      .prepare(`SELECT shares FROM portfolio WHERE character_id = ? AND company_id = ?`)
      .get(characterId, companyId) as { shares: number } | undefined;
    return { characterId, companyId, shares: row?.shares ?? 0 };
  }

  getPortfolio(characterId: string): PortfolioEntry[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT character_id AS characterId, company_id AS companyId, shares
         FROM portfolio WHERE character_id = ?`
      )
      .all(characterId) as PortfolioEntry[];
    return rows;
  }

  getOrder(orderId: string): Order | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      characterId: row.character_id as string,
      companyId: row.company_id as string,
      side: row.side as 'buy' | 'sell',
      price: row.price as number,
      quantity: row.quantity as number,
      status: row.status as Order['status'],
      createdAt: row.created_at as number,
    };
  }

  getOpenOrders(companyId: string): Order[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM orders WHERE company_id = ? AND status = 'open' ORDER BY created_at DESC`
      )
      .all(companyId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      characterId: row.character_id as string,
      companyId: row.company_id as string,
      side: row.side as 'buy' | 'sell',
      price: row.price as number,
      quantity: row.quantity as number,
      status: row.status as Order['status'],
      createdAt: row.created_at as number,
    }));
  }

  cancelOrder(orderId: string, characterId: string): void {
    const order = this.getOrder(orderId);
    if (!order || order.characterId !== characterId) throw new Error('Order not found');
    if (order.status !== 'open') throw new Error('Order not open');
    const db = getDb();
    db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).run(orderId);
  }
}
