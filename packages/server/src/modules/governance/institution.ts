import { GameTime, TickEvent } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { CompaniesModule } from '../companies';
import { OrderBookModule } from '../market/orderbook';
import { PlayersModule } from '../players';
import { gameDayIndex } from '../players/jobs';

export type InstitutionSeatStatus = 'held' | 'offered' | 'empty';

export interface InstitutionSeat {
  companyId: string;
  characterId: string | null;
  startedTotalMinutes: number | null;
  status: InstitutionSeatStatus;
}

export interface InstitutionOverview {
  enabled: boolean;
  seats: InstitutionSeat[];
}

/**
 * 유저 기관 뼈대 (§묶음 13).
 * `userInstitutionEnabled === false`면 좌석·오퍼 로직 전부 no-op. 기존 vote/resolveAgendas를 건드리지 않는다.
 * flag true(테스트에서만)일 때만 회사당 1좌석 선출/박탈/차순위 오퍼를 수행한다.
 */
export class InstitutionModule implements GameModule {
  name = 'governance/institution';

  constructor(
    private config: AppConfig,
    private players: PlayersModule,
    private orderBook: OrderBookModule,
    private companies: CompaniesModule
  ) {}

  init(): void {}

  get enabled(): boolean {
    return this.config.market.userInstitutionEnabled === true;
  }

  getOverview(): InstitutionOverview {
    if (!this.enabled) return { enabled: false, seats: [] };
    return { enabled: true, seats: this.listSeats() };
  }

  listSeats(): InstitutionSeat[] {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM institution_seats ORDER BY company_id ASC`)
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToSeat(row));
  }

  getSeat(companyId: string): InstitutionSeat | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM institution_seats WHERE company_id = ?`).get(companyId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToSeat(row) : null;
  }

  accept(companyId: string, characterId: string, totalMinutes: number): InstitutionSeat {
    if (!this.enabled) throw new Error('User institutions are disabled');
    const seat = this.getSeat(companyId);
    if (!seat || seat.status !== 'offered' || seat.characterId !== characterId) {
      throw new Error('No offer for this character');
    }
    if (!this.isEligible(characterId, companyId)) {
      throw new Error('Not eligible for institution seat');
    }

    const db = getDb();
    db.prepare(
      `UPDATE institution_seats SET character_id = ?, started_total_minutes = ?, status = 'held'
       WHERE company_id = ?`
    ).run(characterId, totalMinutes, companyId);
    return this.getSeat(companyId)!;
  }

  refuse(companyId: string, characterId: string, totalMinutes: number): InstitutionSeat {
    if (!this.enabled) throw new Error('User institutions are disabled');
    const seat = this.getSeat(companyId);
    if (!seat || seat.status !== 'offered' || seat.characterId !== characterId) {
      throw new Error('No offer for this character');
    }
    this.offerNext(companyId, characterId);
    return this.getSeat(companyId)!;
  }

  /** 좌석 상태를 평가한다: 자격 미달·임기 종료 → 박탈 후 차순위 offer. flag false면 no-op. */
  runCycle(gameTime: GameTime): void {
    if (!this.enabled) return;

    const db = getDb();
    const companies = this.companies.getAllCompanies();
    for (const company of companies) {
      db.prepare(
        `INSERT OR IGNORE INTO institution_seats (company_id, character_id, started_total_minutes, status)
         VALUES (?, NULL, NULL, 'empty')`
      ).run(company.id);
    }

    for (const company of companies) {
      const seat = this.getSeat(company.id)!;
      if (seat.status === 'held') {
        const expired =
          seat.startedTotalMinutes === null ||
          gameDayIndex(gameTime.totalMinutes) - gameDayIndex(seat.startedTotalMinutes) >=
            this.config.market.institutionTermGameDays;
        if (expired || !this.isEligible(seat.characterId ?? '', company.id)) {
          this.offerNext(company.id, seat.characterId);
        }
      } else if (seat.status === 'empty') {
        this.offerNext(company.id, null);
      } else if (seat.characterId && !this.isEligible(seat.characterId, company.id)) {
        this.offerNext(company.id, seat.characterId);
      }
    }
  }

  onTick(event: TickEvent): void {
    this.runCycle(event.gameTime);
  }

  private rowToSeat(row: Record<string, unknown>): InstitutionSeat {
    return {
      companyId: row.company_id as string,
      characterId: (row.character_id as string | null) ?? null,
      startedTotalMinutes: (row.started_total_minutes as number | null) ?? null,
      status: row.status as InstitutionSeatStatus,
    };
  }

  private isEligible(characterId: string, companyId: string): boolean {
    const character = this.players.getCharacter(characterId);
    if (!character || !character.isAlive) return false;
    const holdings = this.orderBook.getPortfolioEntry(characterId, companyId);
    if (holdings.shares <= 0) return false;
    const threshold =
      this.config.economy.starterCash * this.config.market.institutionMinNetWorthMultiple;
    return this.orderBook.getNetWorth(characterId) >= threshold;
  }

  /** afterCharacterId 직후(순위상 다음) 후보에게 오퍼. 없으면 empty. */
  private offerNext(companyId: string, afterCharacterId: string | null): void {
    const candidates = this.getCandidates(companyId);
    const start = afterCharacterId === null ? 0 : candidates.indexOf(afterCharacterId) + 1;
    const next = start >= 0 && start < candidates.length ? candidates[start] : null;

    const db = getDb();
    if (!next) {
      db.prepare(
        `UPDATE institution_seats SET character_id = NULL, started_total_minutes = NULL, status = 'empty'
         WHERE company_id = ?`
      ).run(companyId);
      return;
    }
    db.prepare(
      `UPDATE institution_seats SET character_id = ?, started_total_minutes = NULL, status = 'offered'
       WHERE company_id = ?`
    ).run(next, companyId);
  }

  /** 자격(그 회사 보유 + 순자산 ≥ starter × multiple)을 갖춘 산 캐릭터를 순자산·보유·id 순으로 정렬. */
  private getCandidates(companyId: string): string[] {
    const db = getDb();
    const rows = db.prepare(`SELECT id FROM characters WHERE is_alive = 1`).all() as { id: string }[];
    const threshold =
      this.config.economy.starterCash * this.config.market.institutionMinNetWorthMultiple;

    return rows
      .map((row) => ({
        id: row.id,
        netWorth: this.orderBook.getNetWorth(row.id),
        shares: this.orderBook.getPortfolioEntry(row.id, companyId).shares,
      }))
      .filter((c) => c.shares > 0 && c.netWorth >= threshold)
      .sort((a, b) => b.netWorth - a.netWorth || b.shares - a.shares || a.id.localeCompare(b.id))
      .map((c) => c.id);
  }
}
