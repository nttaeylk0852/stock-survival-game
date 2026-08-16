import { GameTime } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from '../economy/ledger';
import { MacroModule } from '../economy/macro';
import { OrderBookModule } from '../market/orderbook';
import { PlayersModule } from './index';

export type JobKind = 'regular' | 'parttime';

export interface JobState {
  kind: JobKind;
  startedTotalMinutes: number;
  regularDoneSeason: boolean;
}

/** 정규 급여 = (밥값 + 숙박값) × 지금CPI + 시작자금 × 비율(CPI 안 곱함). */
export function regularPay(
  cpi: number,
  meal: number,
  rest: number,
  starter: number,
  ratio: number
): number {
  return (meal + rest) * cpi + starter * ratio;
}

/** 알바 급여 = 숙박값 × 지금CPI + 고정 수당. */
export function partTimePay(cpi: number, rest: number, extra: number): number {
  return rest * cpi + extra;
}

export function gameDayIndex(totalMinutes: number): number {
  return Math.floor(totalMinutes / (24 * 60));
}

export function regularShouldEnd(
  currentTotalMinutes: number,
  startedTotalMinutes: number,
  durationDays: number,
  netWorth: number,
  starter: number,
  multiple: number
): boolean {
  return (
    gameDayIndex(currentTotalMinutes) - gameDayIndex(startedTotalMinutes) >= durationDays ||
    netWorth >= starter * multiple
  );
}

/**
 * 직업 (§묶음 10) — 대가·거래제한 없음. 정규 = 적응 지원(초반만), 알바 = 구멍.
 * 지급은 게임일 개장(09:00) 훅. `Date.now()` 금지, `gameTime.totalMinutes`만 사용.
 */
export class JobsModule implements GameModule {
  name = 'players/jobs';

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule,
    private orderBook: OrderBookModule,
    private macro: MacroModule
  ) {}

  init(): void {}

  takeJob(characterId: string, kind: JobKind, totalMinutes: number): JobState {
    const db = getDb();
    const character = this.players.getCharacter(characterId);
    if (!character || !character.isAlive) throw new Error('Character not found or dead');

    const row = db
      .prepare(`SELECT job_kind, regular_done_season FROM characters WHERE id = ?`)
      .get(characterId) as { job_kind: string | null; regular_done_season: number } | undefined;
    if (!row) throw new Error('Character not found');
    if (row.job_kind) throw new Error('Already employed');
    if (kind === 'regular' && row.regular_done_season) {
      throw new Error('Regular job unavailable this season');
    }

    db.prepare(`UPDATE characters SET job_kind = ?, job_started_total_minutes = ? WHERE id = ?`).run(
      kind,
      totalMinutes,
      characterId
    );
    return this.getJob(characterId)!;
  }

  quitJob(characterId: string): void {
    const db = getDb();
    const character = this.players.getCharacter(characterId);
    if (!character) throw new Error('Character not found');

    const row = db.prepare(`SELECT job_kind FROM characters WHERE id = ?`).get(characterId) as
      | { job_kind: string | null }
      | undefined;
    if (!row || !row.job_kind) throw new Error('No job to quit');

    if (row.job_kind === 'regular') {
      db.prepare(
        `UPDATE characters SET job_kind = NULL, job_started_total_minutes = NULL, regular_done_season = 1 WHERE id = ?`
      ).run(characterId);
    } else {
      db.prepare(
        `UPDATE characters SET job_kind = NULL, job_started_total_minutes = NULL WHERE id = ?`
      ).run(characterId);
    }
  }

  getJob(characterId: string): JobState | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT job_kind, job_started_total_minutes, regular_done_season FROM characters WHERE id = ?`
      )
      .get(characterId) as
      | { job_kind: string | null; job_started_total_minutes: number | null; regular_done_season: number }
      | undefined;
    if (!row || !row.job_kind) return null;
    return {
      kind: row.job_kind as JobKind,
      startedTotalMinutes: row.job_started_total_minutes ?? 0,
      regularDoneSeason: Boolean(row.regular_done_season),
    };
  }

  onMarketOpen(gameTime: GameTime): void {
    const db = getDb();
    const employed = db
      .prepare(
        `SELECT id, account_id, job_kind, job_started_total_minutes
         FROM characters WHERE is_alive = 1 AND job_kind IS NOT NULL`
      )
      .all() as {
      id: string;
      account_id: string;
      job_kind: string;
      job_started_total_minutes: number | null;
    }[];

    const cpi = this.macro.getCpiIndex();
    const meal = this.config.survival.mealCostBase;
    const rest = this.config.survival.restCostBase;
    const starter = this.config.economy.starterCash;
    const jobs = this.config.jobs;

    for (const row of employed) {
      if (row.job_kind === 'regular') {
        const netWorth = this.orderBook.getNetWorth(row.id);
        if (
          regularShouldEnd(
            gameTime.totalMinutes,
            row.job_started_total_minutes ?? gameTime.totalMinutes,
            jobs.regularDurationGameDays,
            netWorth,
            starter,
            jobs.regularIndependenceMultiple
          )
        ) {
          db.prepare(
            `UPDATE characters SET job_kind = NULL, job_started_total_minutes = NULL, regular_done_season = 1 WHERE id = ?`
          ).run(row.id);
          continue; // 종료일에는 급여 없음
        }
      }

      const pay =
        row.job_kind === 'regular'
          ? regularPay(cpi, meal, rest, starter, jobs.regularAllowanceRatio)
          : partTimePay(cpi, rest, jobs.partTimeExtra);
      this.ledger.mint(row.account_id, pay, 'JOB_INCOME');
    }
  }
}
