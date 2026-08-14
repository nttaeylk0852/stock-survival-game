import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function runMigrations(): void {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      owner_id TEXT,
      balance REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      from_account_id TEXT NOT NULL,
      to_account_id TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (from_account_id) REFERENCES accounts(id),
      FOREIGN KEY (to_account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS user_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      user_account_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      health REAL NOT NULL DEFAULT 100,
      last_meal_at INTEGER NOT NULL DEFAULT 0,
      is_homeless INTEGER NOT NULL DEFAULT 1,
      is_alive INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_account_id) REFERENCES user_accounts(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_price REAL NOT NULL,
      stats_json TEXT NOT NULL,
      sectors_json TEXT NOT NULL,
      supply_sensitivity REAL NOT NULL,
      shares_outstanding INTEGER NOT NULL,
      current_price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      loss_streak_ticks INTEGER NOT NULL DEFAULT 0,
      price_history_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      character_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      shares REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (character_id, company_id),
      FOREIGN KEY (character_id) REFERENCES characters(id),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS amm_pools (
      company_id TEXT PRIMARY KEY,
      cash_reserve REAL NOT NULL,
      share_reserve REAL NOT NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS agendas (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      stat_key TEXT NOT NULL,
      delta REAL NOT NULL,
      deadline INTEGER NOT NULL,
      votes_for REAL NOT NULL DEFAULT 0,
      votes_against REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS votes (
      agenda_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      shares REAL NOT NULL,
      vote TEXT NOT NULL,
      PRIMARY KEY (agenda_id, character_id),
      FOREIGN KEY (agenda_id) REFERENCES agendas(id),
      FOREIGN KEY (character_id) REFERENCES characters(id)
    );

    CREATE TABLE IF NOT EXISTS intel_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      company_id TEXT,
      is_fake INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intel_purchases (
      character_id TEXT NOT NULL,
      intel_id TEXT NOT NULL,
      purchased_at INTEGER NOT NULL,
      PRIMARY KEY (character_id, intel_id),
      FOREIGN KEY (character_id) REFERENCES characters(id),
      FOREIGN KEY (intel_id) REFERENCES intel_items(id)
    );

    CREATE TABLE IF NOT EXISTS season_medals (
      user_account_id TEXT NOT NULL,
      medal TEXT NOT NULL,
      season_number INTEGER NOT NULL,
      earned_at INTEGER NOT NULL,
      PRIMARY KEY (user_account_id, medal, season_number),
      FOREIGN KEY (user_account_id) REFERENCES user_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bonds (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      amount REAL NOT NULL,
      rate REAL NOT NULL,
      purchased_at INTEGER NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id)
    );
  `);
}

export const SYSTEM_ACCOUNTS = {
  CENTRAL_BANK: 'acct-central-bank',
  TREASURY: 'acct-treasury',
} as const;

export function ensureSystemAccounts(): void {
  const database = getDb();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO accounts (id, type, owner_id, balance)
    VALUES (?, ?, NULL, 0)
  `);
  insert.run(SYSTEM_ACCOUNTS.CENTRAL_BANK, 'central_bank');
  insert.run(SYSTEM_ACCOUNTS.TREASURY, 'treasury');
}
