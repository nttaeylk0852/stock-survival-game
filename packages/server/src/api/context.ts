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
  clock: WorldClockModule;
  survival: SurvivalModule;
  season: SeasonModule;
}
