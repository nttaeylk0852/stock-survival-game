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
  private seasonStartedAt = Date.now();

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
  }

  getSeasonInfo() {
    const seasonLengthMs = this.config.world.seasonLengthDays * 24 * 60 * 60 * 1000;
    return {
      seasonNumber: this.seasonNumber,
      startedAt: this.seasonStartedAt,
      endsAt: this.seasonStartedAt + seasonLengthMs,
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
        this.players.killCharacter(id);
      } catch {
        // already dead
      }
    }

    const endedSeasonNumber = this.seasonNumber;
    this.seasonNumber += 1;
    this.seasonStartedAt = Date.now();
    db.prepare(
      `INSERT INTO system_state (key, value) VALUES ('season_number', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(this.seasonNumber));

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
    const info = this.getSeasonInfo();
    if (Date.now() >= info.endsAt) {
      this.onSeasonEnd(event);
    }
  }
}
