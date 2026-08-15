import { v4 as uuidv4 } from 'uuid';
import { Agenda, CompanyStats } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { CompaniesModule } from '../companies';
import { OrderBookModule } from '../market/orderbook';
import { InfluenceModule } from '../market/influence';
import { computeGovernancePassFactor } from '../companies/image';

export class GovernanceModule implements GameModule {
  name = 'governance';

  constructor(
    private config: AppConfig,
    private companies: CompaniesModule,
    private orderBook: OrderBookModule,
    private influence: InfluenceModule
  ) {}

  init(): void {
    this.createSampleAgenda();
  }

  createAgenda(
    companyId: string,
    statKey: keyof CompanyStats,
    delta: number,
    deadlineMinutes: number
  ): Agenda {
    const db = getDb();
    const id = uuidv4();
    const deadline = Date.now() + deadlineMinutes * 60 * 1000;
    db.prepare(
      `INSERT INTO agendas (id, company_id, stat_key, delta, deadline, votes_for, votes_against, status)
       VALUES (?, ?, ?, ?, ?, 0, 0, 'open')`
    ).run(id, companyId, statKey, delta, deadline);
    return this.getAgenda(id)!;
  }

  vote(agendaId: string, characterId: string, vote: 'for' | 'against'): void {
    const agenda = this.getAgenda(agendaId);
    if (!agenda || agenda.status !== 'open') throw new Error('Agenda not open');
    if (Date.now() > agenda.deadline) throw new Error('Voting closed');

    const company = this.companies.getCompany(agenda.companyId);
    if (!company) throw new Error('Company not found');

    const holdings = this.orderBook.getPortfolioEntry(characterId, agenda.companyId);
    if (holdings.shares <= 0) throw new Error('No shares to vote with');

    const db = getDb();
    db.prepare(
      `INSERT INTO votes (agenda_id, character_id, shares, vote) VALUES (?, ?, ?, ?)
       ON CONFLICT(agenda_id, character_id) DO UPDATE SET shares = excluded.shares, vote = excluded.vote`
    ).run(agendaId, characterId, holdings.shares, vote);

    const totals = db
      .prepare(
        `SELECT vote, SUM(shares) as total FROM votes WHERE agenda_id = ? GROUP BY vote`
      )
      .all(agendaId) as { vote: string; total: number }[];

    let votesFor = 0;
    let votesAgainst = 0;
    for (const t of totals) {
      if (t.vote === 'for') votesFor = t.total;
      if (t.vote === 'against') votesAgainst = t.total;
    }

    db.prepare(`UPDATE agendas SET votes_for = ?, votes_against = ? WHERE id = ?`).run(
      votesFor,
      votesAgainst,
      agendaId
    );
  }

  resolveAgendas(): void {
    const db = getDb();
    const open = db
      .prepare(`SELECT id FROM agendas WHERE status = 'open' AND deadline <= ?`)
      .all(Date.now()) as { id: string }[];

    for (const { id } of open) {
      const agenda = this.getAgenda(id)!;
      const company = this.companies.getCompany(agenda.companyId)!;
      const totalUserShares = this.getTotalUserShares(agenda.companyId);
      const maxInfluenceShares = company.sharesOutstanding * this.config.market.userInfluenceCap;

      const credibility =
        company.stats.managementCredibility ??
        this.config.companies.managementCredibilityDefault;
      const passFactor = computeGovernancePassFactor(
        credibility,
        this.config.companies.managementCredibilityDefault,
        this.config.companies.managementGovernanceSensitivity
      );

      let status: Agenda['status'] = 'rejected';
      if (agenda.votesFor * passFactor > agenda.votesAgainst) {
        status = 'passed';
        const influenceRatio = Math.min(1, totalUserShares / maxInfluenceShares);
        const appliedDelta = agenda.delta * influenceRatio;
        this.influence.recordGovernanceInfluence(agenda.companyId, influenceRatio * 0.1);
        this.companies.updateStat(agenda.companyId, agenda.statKey, appliedDelta);
      } else {
        status = 'rejected';
      }

      db.prepare(`UPDATE agendas SET status = ? WHERE id = ?`).run(status, id);
    }
  }

  getAgenda(agendaId: string): Agenda | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM agendas WHERE id = ?`).get(agendaId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      statKey: row.stat_key as keyof CompanyStats,
      delta: row.delta as number,
      deadline: row.deadline as number,
      votesFor: row.votes_for as number,
      votesAgainst: row.votes_against as number,
      status: row.status as Agenda['status'],
    };
  }

  getOpenAgendas(): Agenda[] {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM agendas WHERE status = 'open' ORDER BY deadline ASC`)
      .all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      companyId: row.company_id as string,
      statKey: row.stat_key as keyof CompanyStats,
      delta: row.delta as number,
      deadline: row.deadline as number,
      votesFor: row.votes_for as number,
      votesAgainst: row.votes_against as number,
      status: row.status as Agenda['status'],
    }));
  }

  private getTotalUserShares(companyId: string): number {
    const db = getDb();
    const row = db
      .prepare(`SELECT COALESCE(SUM(shares), 0) as total FROM portfolio WHERE company_id = ?`)
      .get(companyId) as { total: number };
    return row.total;
  }

  private createSampleAgenda(): void {
    const companies = this.companies.getAllCompanies();
    if (companies.length === 0) return;
    const existing = this.getOpenAgendas();
    if (existing.length > 0) return;
    this.createAgenda(companies[0].id, 'rnd', 5, 60);
  }

  onPriceTick(): void {
    this.resolveAgendas();
  }
}
