import { TickEvent } from '@stock-survival/shared';
import { AppConfig } from '../../core/config-loader';
import { GameModule } from '../../core/module-registry';
import { getDb } from '../../db';
import { LedgerModule } from '../economy/ledger';
import { PlayersModule } from '../players';
import { WorldClockModule } from '../world/clock';
import { MacroModule } from '../economy/macro';

export class SurvivalModule implements GameModule {
  name = 'survival';

  constructor(
    private config: AppConfig,
    private ledger: LedgerModule,
    private players: PlayersModule,
    private clock: WorldClockModule,
    private macro: MacroModule
  ) {}

  init(): void {}

  eat(characterId: string): { cost: number; health: number } {
    const character = this.players.getCharacter(characterId);
    if (!character || !character.isAlive) throw new Error('Character not alive');

    const cost = this.config.survival.mealCostBase * this.macro.getCpiIndex();
    const accountId = this.players.getAccountId(characterId);
    this.ledger.transfer(accountId, 'acct-treasury', cost, 'MEAL');

    const newHealth = Math.min(
      this.config.survival.maxHealth,
      character.health + this.config.survival.mealHealthRestore
    );
    this.players.updateCharacter(characterId, { health: newHealth, lastMealAt: Date.now() });

    return { cost, health: newHealth };
  }

  rest(characterId: string): { cost: number } {
    const character = this.players.getCharacter(characterId);
    if (!character || !character.isAlive) throw new Error('Character not alive');

    const cost = this.config.survival.restCostBase * this.macro.getCpiIndex();
    const accountId = this.players.getAccountId(characterId);
    this.ledger.transfer(accountId, 'acct-treasury', cost, 'REST');

    this.players.updateCharacter(characterId, { isHomeless: false });
    return { cost };
  }

  onSurvivalTick(event: TickEvent): void {
    const db = getDb();
    const characters = db
      .prepare(`SELECT id FROM characters WHERE is_alive = 1`)
      .all() as { id: string }[];

    const gameTime = event.gameTime;
    const isHarshWeather =
      this.clock.isWinter(gameTime) || this.clock.isSummer(gameTime);

    for (const { id } of characters) {
      const character = this.players.getCharacter(id)!;
      let health = character.health;
      const minutesSinceMeal = (Date.now() - character.lastMealAt) / 60000;

      if (minutesSinceMeal > this.config.survival.hungerThresholdMinutes) {
        health -= this.config.survival.hungerDamagePerTick;
      }

      if (character.isHomeless && isHarshWeather) {
        health -= this.config.survival.weatherDamagePerTick;
      }

      health = Math.max(0, health);
      this.players.updateCharacter(id, { health });

      if (health <= 0) {
        this.players.killCharacter(id);
        console.log(`[survival] Character ${id} died from survival conditions`);
      }
    }
  }
}
