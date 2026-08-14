import { v4 as uuidv4 } from 'uuid';
import { IntelItem, TickEvent } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from '../economy/ledger';
import { PlayersModule } from '../players';
import { OrderBookModule } from '../market/orderbook';
import { CompaniesModule } from '../companies';

export class IntelModule implements GameModule {
  name = 'intel';
  private rumorListeners: ((item: IntelItem) => void)[] = [];

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule,
    private orderBook: OrderBookModule,
    private companies: CompaniesModule
  ) {}

  init(): void {}

  /** Subscribe to newly generated rumors (used by the WebSocket layer). */
  onRumor(listener: (item: IntelItem) => void): void {
    this.rumorListeners.push(listener);
  }

  generateRumor(companyId: string | null): IntelItem {
    const db = getDb();
    const id = uuidv4();
    const isFake = Math.random() < this.config.intel.rumorFakeRate;
    const company = companyId ? this.companies.getCompany(companyId) : null;

    const titles = isFake
      ? ['Breaking: Secret merger leaked!', 'Insider tip: CEO resigning tomorrow', 'Analyst predicts 200% surge']
      : ['Q3 earnings beat expectations', 'New product launch confirmed', 'Sector index rising'];

    const item: IntelItem = {
      id,
      title: titles[Math.floor(Math.random() * titles.length)],
      body: isFake
        ? 'Unverified rumor from anonymous source.'
        : `Confirmed update regarding ${company?.name ?? 'market'}.`,
      companyId,
      isFake,
      cost: this.config.intel.infoPurchaseCostBase,
      createdAt: Date.now(),
    };

    db.prepare(
      `INSERT INTO intel_items (id, title, body, company_id, is_fake, cost, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, item.title, item.body, companyId, isFake ? 1 : 0, item.cost, item.createdAt);

    for (const listener of this.rumorListeners) {
      listener(item);
    }

    return item;
  }

  purchaseIntel(characterId: string, intelId: string): IntelItem {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM intel_items WHERE id = ?`).get(intelId) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new Error('Intel not found');

    const accountId = this.players.getAccountId(characterId);
    this.ledger.transfer(accountId, 'acct-treasury', row.cost as number, 'INFO_PURCHASE');

    db.prepare(
      `INSERT INTO intel_purchases (character_id, intel_id, purchased_at) VALUES (?, ?, ?)`
    ).run(characterId, intelId, Date.now());

    return {
      id: row.id as string,
      title: row.title as string,
      body: row.body as string,
      companyId: row.company_id as string | null,
      isFake: Boolean(row.is_fake),
      cost: row.cost as number,
      createdAt: row.created_at as number,
    };
  }

  getAvailableIntel(characterId: string): IntelItem[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT i.* FROM intel_items i
         LEFT JOIN intel_purchases p ON i.id = p.intel_id AND p.character_id = ?
         WHERE p.intel_id IS NULL
         ORDER BY i.created_at DESC LIMIT 20`
      )
      .all(characterId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      body: row.body as string,
      companyId: row.company_id as string | null,
      isFake: Boolean(row.is_fake),
      cost: row.cost as number,
      createdAt: row.created_at as number,
    }));
  }

  notifyMajorShareholders(companyId: string, message: string): void {
    const db = getDb();
    const company = this.companies.getCompany(companyId);
    if (!company) return;

    const threshold = company.sharesOutstanding * this.config.intel.majorShareholderThreshold;
    const holders = db
      .prepare(`SELECT character_id, shares FROM portfolio WHERE company_id = ? AND shares >= ?`)
      .all(companyId, threshold) as { character_id: string; shares: number }[];

    for (const holder of holders) {
      this.generateRumor(companyId);
      console.log(`[intel] Early warning to ${holder.character_id}: ${message}`);
    }
  }

  onPriceTick(_event: TickEvent): void {
    if (Math.random() < 0.3) {
      const companies = this.companies.getAllCompanies().filter((c) => c.status === 'ACTIVE');
      if (companies.length > 0) {
        const company = companies[Math.floor(Math.random() * companies.length)];
        this.generateRumor(company.id);
        if (Math.random() < 0.5) {
          this.notifyMajorShareholders(company.id, 'Material event approaching');
        }
      }
    }
  }
}
