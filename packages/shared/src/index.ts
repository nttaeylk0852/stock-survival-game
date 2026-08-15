export interface GameTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  totalMinutes: number;
}

export interface TickEvent {
  type: 'TICK' | 'PRICE_TICK' | 'SURVIVAL_TICK' | 'SEASON_END';
  gameTime: GameTime;
  tickCount: number;
}

export interface CompanyStats {
  revenue: number;
  profit: number;
  debt: number;
  rnd: number;
  morale: number;
  brand: number;
  margin?: number;
  materialSensitivity?: number;
  managementCredibility?: number;
}

export type CompanyStatus = 'ACTIVE' | 'DELISTED' | 'BANKRUPT';

export interface Company {
  id: string;
  name: string;
  basePrice: number;
  stats: CompanyStats;
  sectors: string[];
  supplySensitivity: number;
  sharesOutstanding: number;
  currentPrice: number;
  status: CompanyStatus;
  lossStreakTicks: number;
}

export interface Character {
  id: string;
  accountId: string;
  name: string;
  health: number;
  lastMealAt: number;
  isHomeless: boolean;
  isAlive: boolean;
  createdAt: number;
}

export interface Account {
  id: string;
  type: 'player' | 'central_bank' | 'treasury' | 'amm_pool';
  ownerId: string | null;
  balance: number;
}

export type LedgerReason =
  | 'CHARACTER_SPAWN'
  | 'CHARACTER_DEATH_SEIZE'
  | 'TRADE'
  | 'MEAL'
  | 'REST'
  | 'INFO_PURCHASE'
  | 'BOND_BUY'
  | 'BOND_SELL'
  | 'JOB_INCOME'
  | 'AMM_TRADE'
  | 'FORCE_CAPITAL';

export interface LedgerEntry {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  reason: LedgerReason;
  createdAt: number;
}

export interface OrderSide {
  characterId: string;
  companyId: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
}

export interface Order extends OrderSide {
  id: string;
  type: 'limit' | 'stop';
  createdAt: number;
  status: 'open' | 'filled' | 'cancelled';
}

export interface PortfolioEntry {
  characterId: string;
  companyId: string;
  shares: number;
}

export interface Agenda {
  id: string;
  companyId: string;
  statKey: keyof CompanyStats;
  delta: number;
  deadline: number;
  votesFor: number;
  votesAgainst: number;
  status: 'open' | 'passed' | 'rejected' | 'expired';
}

export interface IntelItem {
  id: string;
  title: string;
  body: string;
  companyId: string | null;
  isFake: boolean;
  cost: number;
  createdAt: number;
}

export interface MacroState {
  cpiIndex: number;
  interestRate: number;
  moneySupply: number;
  inflationRate: number;
  commodities: Record<string, number>;
  businessCycle: { phase: number; value: number };
  marketGrowthRate: number;
}

export interface SeasonInfo {
  seasonNumber: number;
  startedAt: number;
  endsAt: number;
  medals: string[];
}

export interface MarketSessionState {
  open: boolean;
  isMainSession: boolean;
  volatilityMultiplier: number;
  newsMultiplier: number;
}

export interface DailyActionsState {
  tradesUsed: number;
  tradeLimit: number;
  intelUsed: number;
  intelLimit: number;
}

export interface WorldState {
  gameTime: GameTime;
  tickCount: number;
  macro: MacroState;
  season: SeasonInfo;
  market: MarketSessionState;
}

export interface WsMessage {
  type: 'world_state' | 'character_update' | 'company_prices' | 'news' | 'error';
  payload: unknown;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
