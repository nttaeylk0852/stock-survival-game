import { v4 as uuidv4 } from 'uuid';
import { LedgerReason } from '@stock-survival/shared';
import { getDb, SYSTEM_ACCOUNTS } from '../../db';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';

export class LedgerModule implements GameModule {
  name = 'ledger';
  private totalMinted = 0;

  constructor(private config: AppConfig) {}

  init(): void {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM system_state WHERE key = 'total_minted'`).get() as
      | { value: string }
      | undefined;
    this.totalMinted = row ? parseFloat(row.value) : 0;
  }

  mint(toAccountId: string, amount: number, reason: LedgerReason = 'CHARACTER_SPAWN'): string {
    if (amount <= 0) throw new Error('Mint amount must be positive');
    const db = getDb();
    const entryId = uuidv4();
    const now = Date.now();

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO ledger_entries (id, from_account_id, to_account_id, amount, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(entryId, SYSTEM_ACCOUNTS.CENTRAL_BANK, toAccountId, amount, reason, now);

      db.prepare(`UPDATE accounts SET balance = balance + ? WHERE id = ?`).run(amount, toAccountId);
      this.totalMinted += amount;
      db.prepare(
        `INSERT INTO system_state (key, value) VALUES ('total_minted', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(String(this.totalMinted));
    });
    tx();
    return entryId;
  }

  transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason: LedgerReason
  ): string {
    if (amount <= 0) throw new Error('Transfer amount must be positive');
    const db = getDb();
    const from = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(fromAccountId) as
      | { balance: number }
      | undefined;
    if (!from || from.balance < amount) {
      throw new Error('Insufficient balance');
    }

    const entryId = uuidv4();
    const now = Date.now();
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO ledger_entries (id, from_account_id, to_account_id, amount, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(entryId, fromAccountId, toAccountId, amount, reason, now);
      db.prepare(`UPDATE accounts SET balance = balance - ? WHERE id = ?`).run(amount, fromAccountId);
      db.prepare(`UPDATE accounts SET balance = balance + ? WHERE id = ?`).run(amount, toAccountId);
    });
    tx();
    return entryId;
  }

  seize(fromAccountId: string, amount: number): string {
    return this.transfer(fromAccountId, SYSTEM_ACCOUNTS.TREASURY, amount, 'CHARACTER_DEATH_SEIZE');
  }

  seizeAll(fromAccountId: string): number {
    const db = getDb();
    const row = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(fromAccountId) as
      | { balance: number }
      | undefined;
    const balance = row?.balance ?? 0;
    if (balance > 0) {
      this.seize(fromAccountId, balance);
    }
    return balance;
  }

  getBalance(accountId: string): number {
    const db = getDb();
    const row = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(accountId) as
      | { balance: number }
      | undefined;
    return row?.balance ?? 0;
  }

  getTotalSupply(): number {
    const db = getDb();
    const row = db.prepare(`SELECT COALESCE(SUM(balance), 0) as total FROM accounts`).get() as {
      total: number;
    };
    return row.total;
  }

  assertConservation(): { ok: boolean; totalSupply: number; totalMinted: number } {
    const totalSupply = this.getTotalSupply();
    const ok = Math.abs(totalSupply - this.totalMinted) < 0.01;
    if (!ok) {
      console.warn(
        `[ledger] Conservation violation: supply=${totalSupply}, minted=${this.totalMinted}`
      );
    }
    return { ok, totalSupply, totalMinted: this.totalMinted };
  }

  onTick(): void {
    this.assertConservation();
  }
}
