import { v4 as uuidv4 } from 'uuid';
import { IntelItem, TickEvent } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig, NewsEvent, NewsEffects } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from '../economy/ledger';
import { PlayersModule } from '../players';
import { OrderBookModule } from '../market/orderbook';
import { CompaniesModule } from '../companies';
import { SectorsModule } from '../companies/sectors';
import { MacroModule } from '../economy/macro';
import { computeRumorFakeRate } from '../companies/image';
import type { MarketSession } from '../world/market-session';
import type { DailyActionsModule } from '../players/daily-actions';
import {
  HeadlineContext,
  NewsState,
  renderHeadline,
  selectNewsEvent,
} from './news-events';

interface NewsBroadcast {
  title: string;
  body: string;
  companyId: string | null;
}

interface PendingChainStep {
  afterTicks: number;
  effects: NewsEffects;
  headline?: string;
}

export class IntelModule implements GameModule {
  name = 'intel';
  private rumorListeners: ((item: IntelItem) => void)[] = [];
  private newsListeners: ((news: NewsBroadcast) => void)[] = [];
  private pendingChain: PendingChainStep[] = [];

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule,
    private orderBook: OrderBookModule,
    private companies: CompaniesModule,
    private sectors: SectorsModule,
    private macro: MacroModule,
    private marketSession: MarketSession,
    private dailyActions: DailyActionsModule
  ) {}

  init(): void {}

  /** Subscribe to newly generated rumors (used by the WebSocket layer). */
  onRumor(listener: (item: IntelItem) => void): void {
    this.rumorListeners.push(listener);
  }

  /** Subscribe to public news events (separate channel from purchasable rumors). */
  onNews(listener: (news: NewsBroadcast) => void): void {
    this.newsListeners.push(listener);
  }

  broadcastNews(title: string, body: string, companyId: string | null = null): void {
    for (const listener of this.newsListeners) {
      listener({ title, body, companyId });
    }
  }

  generateRumor(companyId: string | null): IntelItem {
    const db = getDb();
    const id = uuidv4();
    const company = companyId ? this.companies.getCompany(companyId) : null;
    const credibility =
      company?.stats.managementCredibility ??
      this.config.companies.managementCredibilityDefault;
    const fakeRate = computeRumorFakeRate(
      this.config.intel.rumorFakeRate,
      credibility,
      this.config.companies.managementCredibilityDefault,
      this.config.companies.managementRumorSensitivity
    );
    const isFake = Math.random() < fakeRate;

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
    if (!this.dailyActions.canPurchaseIntel(characterId)) {
      throw new Error('Daily intel purchase limit reached');
    }

    const accountId = this.players.getAccountId(characterId);
    this.ledger.transfer(accountId, 'acct-treasury', row.cost as number, 'INFO_PURCHASE');

    db.prepare(
      `INSERT INTO intel_purchases (character_id, intel_id, purchased_at) VALUES (?, ?, ?)`
    ).run(characterId, intelId, Date.now());

    this.dailyActions.recordIntelPurchase(characterId);

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

  /** 뉴스 이벤트 발화: 헤드라인 → 브로드캐스트 → 효과 적용 → chain 스케줄. */
  fireEvent(event: NewsEvent): void {
    const ctx = this.buildContextFromEffects(event.effects);
    const variants = event.headlineVariants;
    const template = variants.length > 0
      ? variants[Math.floor(Math.random() * variants.length)]
      : event.id;
    this.broadcastNews(renderHeadline(template, ctx), `[event:${event.id}]`, null);
    this.applyNewsEffects(event.effects);
    for (const step of event.chain ?? []) {
      this.pendingChain.push({
        afterTicks: step.after,
        effects: step.effects,
        headline: step.headline,
      });
    }
  }

  /** chain 큐: 대기 감소 후 도래한 단계 발화 (§4.3 예측→적중). */
  processPendingChain(): void {
    if (this.pendingChain.length === 0) return;
    const ready: PendingChainStep[] = [];
    const remaining: PendingChainStep[] = [];
    for (const step of this.pendingChain) {
      step.afterTicks -= 1;
      if (step.afterTicks <= 0) ready.push(step);
      else remaining.push(step);
    }
    this.pendingChain = remaining;
    for (const step of ready) {
      const ctx = this.buildContextFromEffects(step.effects);
      this.broadcastNews(
        renderHeadline(step.headline ?? '[속보] 연쇄 반응', ctx),
        '[chain]',
        null
      );
      this.applyNewsEffects(step.effects);
    }
  }

  onPriceTick(_event: TickEvent): void {
    // ① pending chain 감소·발화
    this.processPendingChain();

    // ② 뉴스 이벤트 선택·발화 (상태기반 가중 랜덤, 메인 세션 시 집중 투하)
    const newsConfig = this.config.newsEvents;
    if (Math.random() < newsConfig.eventTickProbability * this.marketSession.getNewsMultiplier()) {
      const state = this.buildNewsState();
      const selected = selectNewsEvent(newsConfig.events, state, newsConfig);
      if (selected) this.fireEvent(selected);
    }

    // ③ 기존 루머 생성
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

  private applyNewsEffects(effects: NewsEffects): void {
    this.sectors.applyEffects(effects);
    for (const [key, delta] of Object.entries(effects)) {
      if (key.startsWith('commodity.')) {
        this.macro.applyCommodityEffect(key.slice('commodity.'.length), delta);
      }
    }
  }

  private buildNewsState(): NewsState {
    const commodityBasePrices: Record<string, number> = {};
    for (const [key, commodity] of Object.entries(this.config.commodities)) {
      commodityBasePrices[key] = commodity.basePrice;
    }
    return {
      interestRate: this.macro.getInterestRate(),
      baseInterestRate: this.config.economy.baseInterestRate,
      inflationRate: this.macro.getState().inflationRate,
      commodities: this.macro.getCommodities(),
      commodityBasePrices,
      sectorIndices: this.sectors.getIndices(),
    };
  }

  private buildContextFromEffects(effects: NewsEffects): HeadlineContext {
    const sectorKey = Object.keys(effects).find((k) => k.startsWith('sector.'));
    const commodityKey = Object.keys(effects).find((k) => k.startsWith('commodity.'));
    const sector =
      sectorKey?.slice('sector.'.length) ??
      (Object.keys(this.config.sectors.indices)[0] ?? 'market');
    const commodity =
      commodityKey?.slice('commodity.'.length) ??
      (Object.keys(this.config.commodities)[0] ?? 'commodity');
    const active = this.companies.getAllCompanies().filter((c) => c.status === 'ACTIVE');
    const company =
      active.length > 0 ? active[Math.floor(Math.random() * active.length)].name : '시장';
    const deltas = Object.values(effects).map((d) => Math.abs(d));
    const maxDelta = deltas.length > 0 ? Math.max(...deltas) : 0;
    return {
      company,
      sector,
      commodity,
      changePct: `${Math.round(maxDelta * 100)}%`,
    };
  }
}
