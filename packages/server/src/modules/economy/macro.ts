import { MacroState, TickEvent } from '@stock-survival/shared';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { LedgerModule } from './ledger';
import { v4 as uuidv4 } from 'uuid';
import { getDb, SYSTEM_ACCOUNTS } from '../../db';
import { PlayersModule } from '../players';

export class MacroModule implements GameModule {
  name = 'economy/macro';
  private cpiIndex = 1.0;
  private interestRate: number;
  private inflationRate = 0;

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule
  ) {
    this.interestRate = config.economy.baseInterestRate;
  }

  init(): void {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM system_state WHERE key = 'cpi_index'`).get() as
      | { value: string }
      | undefined;
    if (row) this.cpiIndex = parseFloat(row.value);
  }

  getCpiIndex(): number {
    return this.cpiIndex;
  }

  getState(): MacroState {
    return {
      cpiIndex: this.cpiIndex,
      interestRate: this.interestRate,
      moneySupply: this.ledger.getTotalSupply(),
      inflationRate: this.inflationRate,
    };
  }

  setInterestRate(rate: number): void {
    this.interestRate = Math.max(0, Math.min(0.5, rate));
  }

  buyBond(characterId: string, amount: number): string {
    if (amount <= 0) throw new Error('Invalid bond amount');
    const db = getDb();
    const bondId = uuidv4();
    const accountId = this.players.getAccountId(characterId);
    // Bond purchase removes cash from circulation temporarily (held in treasury)
    this.ledger.transfer(accountId, SYSTEM_ACCOUNTS.TREASURY, amount, 'BOND_BUY');
    db.prepare(
      `INSERT INTO bonds (id, character_id, amount, rate, purchased_at) VALUES (?, ?, ?, ?, ?)`
    ).run(bondId, characterId, amount, this.config.economy.bondIssueRate, Date.now());
    return bondId;
  }

  onPriceTick(_event: TickEvent): void {
    const moneySupply = this.ledger.getTotalSupply();
    const targetSupply = this.config.economy.starterCash * 100;
    this.inflationRate = (moneySupply - targetSupply) / targetSupply;

    if (this.inflationRate > this.config.economy.targetInflationRate) {
      this.interestRate = Math.min(0.5, this.interestRate + 0.001);
    } else {
      this.interestRate = Math.max(0.01, this.interestRate - 0.0005);
    }

    this.cpiIndex *= 1 + this.inflationRate * 0.01;
    this.cpiIndex = Math.max(0.5, this.cpiIndex);

    const db = getDb();
    db.prepare(
      `INSERT INTO system_state (key, value) VALUES ('cpi_index', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(this.cpiIndex));

    if (this.inflationRate > this.config.economy.newbieChurnPenaltyThreshold) {
      console.log(
        `[macro] High inflation ${(this.inflationRate * 100).toFixed(1)}% — newbie churn penalty active`
      );
    }
  }
}
