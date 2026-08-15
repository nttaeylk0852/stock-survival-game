# Code Map

> 자동 생성됨 — `npm run codemap` 으로 재생성. AI 컨텍스트 파악용 요약.

생성 시각: 2026-08-15T04:10:40.943Z

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

### `packages/server/src/modules/companies/index.ts`
- `export class CompaniesModule implements GameModule {`

### `packages/server/src/modules/companies/pricing.ts`
- `export function calculateFairPrice(`
- `export function applyStabilityFactor(`
- `export function historicalMedian(history: number[], window: number): number {`

### `packages/server/src/modules/companies/sectors.ts`
- `export class SectorsModule implements GameModule {`

### `packages/server/src/modules/economy/ledger.ts`
- `export class LedgerModule implements GameModule {`

### `packages/server/src/modules/economy/macro.ts`
- `export class MacroModule implements GameModule {`

### `packages/server/src/modules/governance/index.ts`
- `export class GovernanceModule implements GameModule {`

### `packages/server/src/modules/intel/index.ts`
- `export class IntelModule implements GameModule {`

### `packages/server/src/modules/market/amm.ts`
- `export class AmmModule implements GameModule {`

### `packages/server/src/modules/market/influence.ts`
- `export class InfluenceModule implements GameModule {`

### `packages/server/src/modules/market/orderbook.ts`
- `export class OrderBookModule implements GameModule {`

### `packages/server/src/modules/players/index.ts`
- `export class PlayersModule implements GameModule {`

### `packages/server/src/modules/survival/index.ts`
- `export class SurvivalModule implements GameModule {`

### `packages/server/src/modules/world/clock.ts`
- `export class WorldClockModule implements GameModule {`

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
- `export interface WorldState {`
- `export interface WsMessage {`
- `export interface ApiResponse<T = unknown> {`

