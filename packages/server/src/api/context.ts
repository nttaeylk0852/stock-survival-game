import { AppConfig } from '../core/config-loader';
import { TickLoop } from '../core/tick-loop';
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
 * Aggregate of every constructed game module.
 * Built once in index.ts and passed to the API/WebSocket layers.
 */
export interface GameContext {
  config: AppConfig;
  tickLoop: TickLoop;
  ledger: LedgerModule;
  macro: MacroModule;
  sectors: SectorsModule;
  companies: CompaniesModule;
  influence: InfluenceModule;
  players: PlayersModule;
  orderBook: OrderBookModule;
  amm: AmmModule;
  governance: GovernanceModule;
  intel: IntelModule;
  forces: ForcesModule;
  centralBank: CentralBankModule;
  circuitBreaker: CircuitBreaker;
  clock: WorldClockModule;
  marketSession: MarketSession;
  marketSessionModule: MarketSessionModule;
  dailyActions: DailyActionsModule;
  survival: SurvivalModule;
  season: SeasonModule;
}
