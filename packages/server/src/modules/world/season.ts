import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { eventBus } from '../../core/event-bus';
import { LedgerModule } from '../economy/ledger';
import { PlayersModule } from '../players';
import { TickEvent } from '@stock-survival/shared';

export class SeasonModule implements GameModule {
  name = 'world/season';
  private seasonNumber = 1;
  private seasonStartedTotalMinutes = 0;
  private currentTotalMinutes = 0;

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule
  ) {}

  init(): void {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM system_state WHERE key = 'season_number'`).get() as
      | { value: string }
      | undefined;
    if (row) this.seasonNumber = parseInt(row.value, 10);

    const startRow = db
      .prepare(`SELECT value FROM system_state WHERE key = 'season_started_minutes'`)
      .get() as { value: string } | undefined;
    if (startRow) this.seasonStartedTotalMinutes = parseInt(startRow.value, 10);
  }

  getSeasonInfo() {
    const seasonLengthMinutes = this.config.world.seasonLengthDays * 1440;
    const endsTotalMinutes = this.seasonStartedTotalMinutes + seasonLengthMinutes;
    return {
      seasonNumber: this.seasonNumber,
      startedTotalMinutes: this.seasonStartedTotalMinutes,
      endsTotalMinutes,
      remainingMinutes: Math.max(0, endsTotalMinutes - this.currentTotalMinutes),
      medals: [] as string[],
    };
  }

  awardMedal(userAccountId: string, medal: string): void {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO season_medals (user_account_id, medal, season_number, earned_at)
       VALUES (?, ?, ?, ?)`
    ).run(userAccountId, medal, this.seasonNumber, Date.now());
  }

  onSeasonEnd(event?: TickEvent): void {
    const db = getDb();
    const aliveChars = db
      .prepare(`SELECT id FROM characters WHERE is_alive = 1`)
      .all() as { id: string }[];

    for (const { id } of aliveChars) {
      try {
        this.players.killCharacter(id, 'season_end');
      } catch {
        // already dead
      }
    }

    db.prepare(
      `UPDATE characters SET regular_done_season = 0, job_kind = NULL, job_started_total_minutes = NULL`
    ).run();

    const endedSeasonNumber = this.seasonNumber;
    this.seasonNumber += 1;
    if (event) {
      this.seasonStartedTotalMinutes = event.gameTime.totalMinutes;
    }
    db.prepare(
      `INSERT INTO system_state (key, value) VALUES ('season_number', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(this.seasonNumber));
    db.prepare(
      `INSERT INTO system_state (key, value) VALUES ('season_started_minutes', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(this.seasonStartedTotalMinutes));

    console.log(`[season] Season ${endedSeasonNumber} ended. Great Depression event triggered.`);

    void eventBus.emit({
      type: 'SEASON_END',
      gameTime: event?.gameTime ?? {
        year: 0,
        month: 0,
        day: 0,
        hour: 0,
        minute: 0,
        totalMinutes: 0,
      },
      tickCount: event?.tickCount ?? 0,
    });
  }

  onTick(event: TickEvent): void {
    this.currentTotalMinutes = event.gameTime.totalMinutes;
    const endsTotalMinutes =
      this.seasonStartedTotalMinutes + this.config.world.seasonLengthDays * 1440;
    if (event.gameTime.totalMinutes >= endsTotalMinutes) {
      this.onSeasonEnd(event);
    }
  }
}
