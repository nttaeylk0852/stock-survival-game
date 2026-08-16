import { v4 as uuidv4 } from 'uuid';
import { randomUUID } from 'node:crypto';
import { Character } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from '../economy/ledger';
import { TickLoop } from '../../core/tick-loop';

export class PlayersModule implements GameModule {
  name = 'players';

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private tickLoop: TickLoop
  ) {}

  init(): void {}

  createUser(username: string): string {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`INSERT INTO user_accounts (id, username, created_at) VALUES (?, ?, ?)`).run(
      id,
      username,
      Date.now()
    );
    return id;
  }

  getUserByUsername(username: string): { id: string; username: string } | null {
    const db = getDb();
    return (
      (db.prepare(`SELECT id, username FROM user_accounts WHERE username = ?`).get(username) as {
        id: string;
        username: string;
      }) ?? null
    );
  }

  createCharacter(userAccountId: string, name: string): Character {
    const db = getDb();
    const characterId = uuidv4();
    const accountId = uuidv4();
    const now = Date.now();
    const token = (randomUUID() + randomUUID()).replace(/-/g, '');

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO accounts (id, type, owner_id, balance) VALUES (?, 'player', ?, 0)`).run(
        accountId,
        characterId
      );
      db.prepare(
        `INSERT INTO characters (id, user_account_id, account_id, name, health, last_meal_at, is_homeless, is_alive, created_at, created_total_minutes, auth_token)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
      ).run(
        characterId,
        userAccountId,
        accountId,
        name,
        this.config.survival.maxHealth,
        now,
        now,
        this.tickLoop.getGameTime().totalMinutes,
        token
      );
    });
    tx();

    this.ledger.mint(accountId, this.config.economy.starterCash, 'CHARACTER_SPAWN');

    return this.getCharacter(characterId)!;
  }

  getCharacter(characterId: string): Character | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, account_id, name, health, last_meal_at, is_homeless, is_alive, created_at,
                job_kind, job_started_total_minutes, regular_done_season,
                death_cause, created_total_minutes, peak_net_worth
         FROM characters WHERE id = ?`
      )
      .get(characterId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const createdTotalMinutes = (row.created_total_minutes as number | null) ?? 0;
    const currentTotalMinutes = this.tickLoop.getGameTime().totalMinutes;
    const survivedGameDays = Math.max(
      0,
      Math.floor((currentTotalMinutes - createdTotalMinutes) / 1440)
    );

    return {
      id: row.id as string,
      accountId: row.account_id as string,
      name: row.name as string,
      health: row.health as number,
      lastMealAt: row.last_meal_at as number,
      isHomeless: Boolean(row.is_homeless),
      isAlive: Boolean(row.is_alive),
      createdAt: row.created_at as number,
      jobKind: (row.job_kind as 'regular' | 'parttime' | null) ?? null,
      jobStartedTotalMinutes: (row.job_started_total_minutes as number | null) ?? null,
      regularDoneSeason: Boolean(row.regular_done_season),
      deathCause: (row.death_cause as Character['deathCause']) ?? null,
      survivedGameDays,
      peakNetWorth: (row.peak_net_worth as number | null) ?? 0,
    };
  }

  getActiveCharacter(userAccountId: string): Character | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id FROM characters WHERE user_account_id = ? AND is_alive = 1 ORDER BY created_at DESC LIMIT 1`
      )
      .get(userAccountId) as { id: string } | undefined;
    if (!row) return null;
    return this.getCharacter(row.id);
  }

  killCharacter(
    characterId: string,
    deathCause: 'starvation' | 'exposure' | 'season_end'
  ): { seizedAmount: number } {
    const character = this.getCharacter(characterId);
    if (!character || !character.isAlive) {
      throw new Error('Character not found or already dead');
    }

    const db = getDb();
    const seizedAmount = this.ledger.seizeAll(character.accountId);

    db.prepare(`UPDATE characters SET is_alive = 0, health = 0, death_cause = ? WHERE id = ?`).run(
      deathCause,
      characterId
    );

    return { seizedAmount };
  }

  /** 생존 틱에서 호출. 현재 순자산이 기존 최고치보다 크면 갱신한다. */
  updatePeakNetWorth(characterId: string, netWorth: number): void {
    const db = getDb();
    db.prepare(
      `UPDATE characters SET peak_net_worth = ? WHERE id = ? AND peak_net_worth < ?`
    ).run(netWorth, characterId, netWorth);
  }

  updateCharacter(
    characterId: string,
    updates: Partial<Pick<Character, 'health' | 'lastMealAt' | 'isHomeless'>>
  ): void {
    const db = getDb();
    if (updates.health !== undefined) {
      db.prepare(`UPDATE characters SET health = ? WHERE id = ?`).run(updates.health, characterId);
    }
    if (updates.lastMealAt !== undefined) {
      db.prepare(`UPDATE characters SET last_meal_at = ? WHERE id = ?`).run(
        updates.lastMealAt,
        characterId
      );
    }
    if (updates.isHomeless !== undefined) {
      db.prepare(`UPDATE characters SET is_homeless = ? WHERE id = ?`).run(
        updates.isHomeless ? 1 : 0,
        characterId
      );
    }
  }

  getAccountId(characterId: string): string {
    const character = this.getCharacter(characterId);
    if (!character) throw new Error('Character not found');
    return character.accountId;
  }

  /** 캐릭터 생성 직후 한 번만 클라이언트에 내려줄 비밀 토큰. */
  getAuthToken(characterId: string): string | null {
    const db = getDb();
    const row = db.prepare(`SELECT auth_token FROM characters WHERE id = ?`).get(characterId) as
      | { auth_token: string | null }
      | undefined;
    return row?.auth_token ?? null;
  }

  /** 토큰이 그 캐릭터의 것인지 검사. 토큰이 없거나 다르면 false. */
  verifyAuthToken(characterId: string, token: string | undefined): boolean {
    const stored = this.getAuthToken(characterId);
    if (!stored) return false;
    return typeof token === 'string' && token === stored;
  }
}
