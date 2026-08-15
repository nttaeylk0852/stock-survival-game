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
import { CircuitBreaker } from '../modules/market/circuit-breaker';
import { CentralBankModule } from '../modules/economy/central-bank';
import { ForcesModule } from '../modules/forces';
import { MarketSession, MarketSessionModule } from '../modules/world/market-session';
import { DailyActionsModule } from '../modules/players/daily-actions';

/**
 * Builds every game module in dependency order and registers them.
 * Assumes the database is already initialised and migrated.
 */
export async function bootstrapGame(): Promise<GameContext> {
  const config = loadAllConfig();
  const tickLoop = new TickLoop(config);
  moduleRegistry.clear();

  // Dependency order: ledger -> players -> sectors -> macro -> companies ->
  // influence -> orderbook -> amm -> governance -> intel -> clock -> survival -> season
  const ledger = new LedgerModule(config);
  const players = new PlayersModule(config, ledger);
  const sectors = new SectorsModule(config);
  const macro = new MacroModule(config, ledger, players, sectors);
  const marketSession = new MarketSession(config);
  const dailyActions = new DailyActionsModule(config);
  const companies = new CompaniesModule(config, sectors, macro, marketSession);
  const influence = new InfluenceModule(config, companies);
  const circuitBreaker = new CircuitBreaker();
  const orderBook = new OrderBookModule(
    config,
    ledger,
    players,
    companies,
    influence,
    circuitBreaker,
    marketSession
  );
  const amm = new AmmModule(
    config,
    ledger,
    players,
    companies,
    orderBook,
    influence,
    circuitBreaker,
    marketSession,
    dailyActions
  );
  const governance = new GovernanceModule(config, companies, orderBook, influence);
  const intel = new IntelModule(
    config,
    ledger,
    players,
    orderBook,
    companies,
    sectors,
    macro,
    marketSession,
    dailyActions
  );
  const forces = new ForcesModule(config, ledger, amm, companies, intel);
  const centralBank = new CentralBankModule(config, companies, sectors, intel, circuitBreaker);
  const clock = new WorldClockModule(config, tickLoop);
  const marketSessionModule = new MarketSessionModule(
    config,
    marketSession,
    intel,
    dailyActions,
    macro
  );
  const survival = new SurvivalModule(config, ledger, players, clock, macro);
  const season = new SeasonModule(config, ledger, players);

  for (const mod of [
    ledger,
    players,
    dailyActions,
    macro,
    sectors,
    companies,
    influence,
    orderBook,
    amm,
    governance,
    intel,
    forces,
    centralBank,
    clock,
    marketSessionModule,
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
    forces,
    centralBank,
    circuitBreaker,
    clock,
    marketSession,
    marketSessionModule,
    dailyActions,
    survival,
    season,
  };
}
