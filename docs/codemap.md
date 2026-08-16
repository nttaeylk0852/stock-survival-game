# Code Map

> 자동 생성됨 — `npm run codemap` 으로 재생성. 시그니처 색인 전용.
> 모듈별 역할·config·주요 함수 설명은 `docs/modules/*.md` 를 볼 것.

생성 시각: 2026-08-15T12:40:50.095Z

## packages/server/src

### `packages/server/src/api/context.ts`
- `export interface GameContext {` — Built once in index.ts and passed to the API/WebSocket layers.

### `packages/server/src/api/http.ts`
- `export function ok<T>(res: Response, data: T): void {`
- `export function fail(res: Response, error: unknown, status = 400): void {`
- `export function handle(fn: (req: Request, res: Response) => void) {`

### `packages/server/src/api/routes-market.ts`
- `export function attachMarketRoutes(router: Router, ctx: GameContext): Router {`

### `packages/server/src/api/routes.ts`
- `export function createRouter(ctx: GameContext): Router {`

### `packages/server/src/api/ws.ts`
- `export class GameWebSocketServer {`

### `packages/server/src/core/bootstrap.ts`
- `export async function bootstrapGame(): Promise<GameContext> {` — Assumes the database is already initialised and migrated.

### `packages/server/src/core/config-loader.ts`
- `export function loadConfig<T>(filename: string): T {`
- `export interface EconomyConfig {`
- `export interface MarketConfig {`
- `export interface SurvivalConfig {`
- `export interface WorldConfig {`
- `export interface CompaniesConfig {`
- `export interface IntelConfig {`
- `export interface SectorsConfig {`
- `export interface ForceProfile {`
- `export interface ForcesConfig {`
- `export interface CentralBankConfig {`
- `export interface CommodityConfig {`
- `export type CommoditiesConfig = Record<string, CommodityConfig>;`
- `export type NewsEffects = Record<string, number>;`
- `export interface NewsChainStep {`
- `export interface NewsEvent {`
- `export interface NewsEventsConfig {`
- `export interface CompanySeed {`
- `export function loadAllConfig() {`
- `export type AppConfig = ReturnType<typeof loadAllConfig>;`

### `packages/server/src/core/event-bus.ts`
- `export class EventBus {`
- `export const eventBus = new EventBus();`

### `packages/server/src/core/module-registry.ts`
- `export interface GameModule {`
- `export class ModuleRegistry {`
- `export const moduleRegistry = new ModuleRegistry();`

### `packages/server/src/core/tick-loop.ts`
- `export class TickLoop {`

### `packages/server/src/db/index.ts`
- `export function getDb(): Database.Database {`
- `export function initDb(dbPath: string): Database.Database {`
- `export function runMigrations(): void {`
- `export const SYSTEM_ACCOUNTS = {`
- `export function ensureSystemAccounts(): void {`

### `packages/server/src/modules/companies/image.ts`
- `export function computeBrandMultiplier(brand: number, min: number, max: number): number {`
- `export function computeVolatilityFactor(`
- `export function computeGovernancePassFactor(`
- `export function computeRumorFakeRate(`

### `packages/server/src/modules/companies/index.ts`
- `export class CompaniesModule implements GameModule {`

### `packages/server/src/modules/companies/pricing.ts`
- `export interface PriceFactor {`
- `export function deriveProfit(` — profit = revenue × margin − 원자재비(materialIndex × materialSensitivity) − 이자(debt × 금리)
- `export function computeStatScore(stats: CompanyStats, weights: Record<string, number>): number {`
- `export function calculateFairPrice(`
- `export function applyStabilityFactor(`
- `export function historicalMedian(history: number[], window: number): number {`
- `export function largeCapIds(companies: Company[], topN: number): string[] {` — — companies·centralBank 공용 순수 헬퍼 (의존성 순환 방지를 위해 로컬 시총 계산).

### `packages/server/src/modules/companies/sectors.ts`
- `export class SectorsModule implements GameModule {`

### `packages/server/src/modules/economy/central-bank.ts`
- `export function computeMarketCap(company: Company): number {`
- `export function debtRevenueRatio(company: Company): number {`
- `export function shouldBailout(` — 시총 상위 N && 부채비율 > 위험선 && 고점대비 -X%
- `export function applyDilution(` — — 반환: 갱신된 { sharesOutstanding, currentPrice, debt }.
- `export class CentralBankModule implements GameModule {` — — 등록 순서: companies → intel → centralBank (최신 가격·뉴스 반영 후 판정).

### `packages/server/src/modules/economy/ledger.ts`
- `export class LedgerModule implements GameModule {`

### `packages/server/src/modules/economy/macro.ts`
- `export function computeTargetInterestRate(`
- `export function applyInterestStep(`
- `export class MacroModule implements GameModule {`

### `packages/server/src/modules/forces/index.ts`
- `export class ForcesModule implements GameModule {` — — 공매도는 sell(풀에 주식↑, 음수 포지션), 숏커버는 buy(풀에서 주식↓).

### `packages/server/src/modules/forces/strategies.ts`
- `export interface ForceSignal {`
- `export interface ValueParams {`
- `export interface MomentumParams {`
- `export interface ShortParams {`
- `export function valueStrategy(company: Company, fairPrice: number, params: ValueParams): ForceSignal {`
- `export function momentumStrategy(priceHistory: number[], params: MomentumParams): ForceSignal {`
- `export function shortStrategy(`

### `packages/server/src/modules/governance/index.ts`
- `export class GovernanceModule implements GameModule {`

### `packages/server/src/modules/intel/index.ts`
- `export class IntelModule implements GameModule {`

### `packages/server/src/modules/intel/news-events.ts`
- `export interface NewsState {`
- `export function isBiasConditionMet(`
- `export function computeEventWeight(`
- `export function selectNewsEvent(`
- `export interface HeadlineContext {`
- `export function renderHeadline(template: string, ctx: HeadlineContext): string {`

### `packages/server/src/modules/market/amm.ts`
- `export class AmmModule implements GameModule {`

### `packages/server/src/modules/market/circuit-breaker.ts`
- `export class CircuitBreaker {` — — 돈·주문을 건드리지 않는 순수 상태 머신.

### `packages/server/src/modules/market/influence.ts`
- `export class InfluenceModule implements GameModule {`

### `packages/server/src/modules/market/orderbook.ts`
- `export class OrderBookModule implements GameModule {`

### `packages/server/src/modules/players/daily-actions.ts`
- `export class DailyActionsModule implements GameModule {` — — 매 게임일 개장(09:00) 시 MarketSessionModule이 resetAll()로 초기화한다.

### `packages/server/src/modules/players/index.ts`
- `export class PlayersModule implements GameModule {`

### `packages/server/src/modules/survival/index.ts`
- `export class SurvivalModule implements GameModule {`

### `packages/server/src/modules/world/clock.ts`
- `export class WorldClockModule implements GameModule {`

### `packages/server/src/modules/world/market-session.ts`
- `export function isMarketOpen(gameTime: GameTime, openHour: number, closeHour: number): boolean {`
- `export function isSettlementWindow(`
- `export function isMainSession(gameTime: GameTime, mainSessionHours: number[]): boolean {`
- `export class MarketSession {` — — amm/orderBook은 개장 여부, intel은 뉴스 배율, companies는 변동성 배율을 읽는다.
- `export class MarketSessionModule implements GameModule {` — — 휴장(01:00) 전환 시 "내일 금리 발표" 예고 브로드캐스트(정산).

### `packages/server/src/modules/world/season.ts`
- `export class SeasonModule implements GameModule {`

### `packages/server/src/test/harness.ts`
- `export function assert(condition: boolean, message: string): void {`
- `export function assertEqual<T>(actual: T, expected: T, message: string): void {`
- `export function assertClose(actual: number, expected: number, tolerance: number, message: string): void {`
- `export function assertThrows(fn: () => unknown, message: string): void {`
- `export async function test(name: string, fn: () => void | Promise<void>): Promise<void> {`
- `export function summarize(): number {`

## packages/shared/src

### `packages/shared/src/index.ts`
- `export interface GameTime {`
- `export interface TickEvent {`
- `export interface CompanyStats {`
- `export type CompanyStatus = 'ACTIVE' | 'DELISTED' | 'BANKRUPT';`
- `export interface Company {`
- `export interface Character {`
- `export interface Account {`
- `export type LedgerReason =`
- `export interface LedgerEntry {`
- `export interface OrderSide {`
- `export interface Order extends OrderSide {`
- `export interface PortfolioEntry {`
- `export interface Agenda {`
- `export interface IntelItem {`
- `export interface MacroState {`
- `export interface SeasonInfo {`
- `export interface MarketSessionState {`
- `export interface DailyActionsState {`
- `export interface WorldState {`
- `export interface WsMessage {`
- `export interface ApiResponse<T = unknown> {`

