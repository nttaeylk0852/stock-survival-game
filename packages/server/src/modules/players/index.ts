import { v4 as uuidv4 } from 'uuid';
import { Character } from '@stock-survival/shared';
import { getDb } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from '../economy/ledger';

export class PlayersModule implements GameModule {
  name = 'players';

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule
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

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO accounts (id, type, owner_id, balance) VALUES (?, 'player', ?, 0)`).run(
        accountId,
        characterId
      );
      db.prepare(
        `INSERT INTO characters (id, user_account_id, account_id, name, health, last_meal_at, is_homeless, is_alive, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`
      ).run(
        characterId,
        userAccountId,
        accountId,
        name,
        this.config.survival.maxHealth,
        now,
        now
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
        `SELECT id, account_id, name, health, last_meal_at, is_homeless, is_alive, created_at
         FROM characters WHERE id = ?`
      )
      .get(characterId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      name: row.name as string,
      health: row.health as number,
      lastMealAt: row.last_meal_at as number,
      isHomeless: Boolean(row.is_homeless),
      isAlive: Boolean(row.is_alive),
      createdAt: row.created_at as number,
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

  killCharacter(characterId: string): { seizedAmount: number } {
    const character = this.getCharacter(characterId);
    if (!character || !character.isAlive) {
      throw new Error('Character not found or already dead');
    }

    const db = getDb();
    const seizedAmount = this.ledger.seizeAll(character.accountId);

    db.prepare(`UPDATE characters SET is_alive = 0, health = 0 WHERE id = ?`).run(characterId);

    return { seizedAmount };
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
}
