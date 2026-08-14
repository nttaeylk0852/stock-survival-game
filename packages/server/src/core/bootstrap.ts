import { loadAllConfig } from './config-loader';
import { TickLoop } from './tick-loop';
import { moduleRegistry } from './module-registry';
import { GameContext } from '../api/context';
import { LedgerModule } from '../modules/economy/ledger';
import { MacroModule } from '../modules/economy/macro';
import { SectorsModule } from '../modules/companies/sectors';
import { CompaniesModule } from '../modules/companies';
import { InfluenceModule } from '../modules/market/influence';
import { PlayersModule } from '../modules/players';
import { OrderBookModule } from '../modules/market/orderbook';
import { AmmModule } from '../modules/market/amm';
import { GovernanceModule } from '../modules/governance';
import { IntelModule } from '../modules/intel';
import { WorldClockModule } from '../modules/world/clock';
import { SurvivalModule } from '../modules/survival';
import { SeasonModule } from '../modules/world/season';

/**
 * Builds every game module in dependency order and registers them.
 * Assumes the database is already initialised and migrated.
 */
export async function bootstrapGame(): Promise<GameContext> {
  const config = loadAllConfig();
  const tickLoop = new TickLoop(config);
  moduleRegistry.clear();

  // Dependency order: ledger -> players -> macro -> sectors -> companies ->
  // influence -> orderbook -> amm -> governance -> intel -> clock -> survival -> season
  const ledger = new LedgerModule(config);
  const players = new PlayersModule(config, ledger);
  const macro = new MacroModule(config, ledger, players);
  const sectors = new SectorsModule(config);
  const companies = new CompaniesModule(config, sectors);
  const influence = new InfluenceModule(config, companies);
  const orderBook = new OrderBookModule(config, ledger, players, companies, influence);
  const amm = new AmmModule(config, ledger, players, companies, orderBook, influence);
  const governance = new GovernanceModule(config, companies, orderBook, influence);
  const intel = new IntelModule(config, ledger, players, orderBook, companies);
  const clock = new WorldClockModule(config, tickLoop);
  const survival = new SurvivalModule(config, ledger, players, clock, macro);
  const season = new SeasonModule(config, ledger, players);

  for (const mod of [
    ledger,
    players,
    macro,
    sectors,
    companies,
    influence,
    orderBook,
    amm,
    governance,
    intel,
    clock,
    survival,
    season,
  ]) {
    moduleRegistry.register(mod);
  }

  await moduleRegistry.initAll();

  return {
    config,
    tickLoop,
    ledger,
    macro,
    sectors,
    companies,
    influence,
    players,
    orderBook,
    amm,
    governance,
    intel,
    clock,
    survival,
    season,
  };
}
