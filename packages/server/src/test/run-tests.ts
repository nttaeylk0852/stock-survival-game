import { initDb, runMigrations, ensureSystemAccounts, getDb, SYSTEM_ACCOUNTS, closeDb } from '../db';
import { bootstrapGame } from '../core/bootstrap';
import { GameContext } from '../api/context';
import { assert, assertEqual, assertClose, assertThrows, test, summarize } from './harness';
import { deriveProfit } from '../modules/companies/pricing';
import {
  computeBrandMultiplier,
  computeVolatilityFactor,
  computeGovernancePassFactor,
  computeRumorFakeRate,
} from '../modules/companies/image';
import { computeTargetInterestRate, applyInterestStep } from '../modules/economy/macro';
import { NewsEvent } from '../core/config-loader';
import {
  NewsState,
  computeEventWeight,
  renderHeadline,
  selectNewsEvent,
} from '../modules/intel/news-events';
import { largeCapIds } from '../modules/companies/pricing';
import { computeMarketCap, shouldBailout, applyDilution } from '../modules/economy/central-bank';
import { CircuitBreaker } from '../modules/market/circuit-breaker';
import { Company, GameTime } from '@stock-survival/shared';
import { isMarketOpen, isSettlementWindow, isMainSession } from '../modules/world/market-session';
import { regularPay, partTimePay } from '../modules/players/jobs';

async function setup(): Promise<GameContext> {
  initDb(':memory:');
  runMigrations();
  ensureSystemAccounts();
  const ctx = await bootstrapGame();
  // 묶음 6: 테스트는 개장 상태(09:00 이후)에서 시작 — 기존 테스트는 거래 가능을 전제.
  ctx.marketSessionModule.onTick({
    type: 'TICK',
    gameTime: timeAt(10),
    tickCount: 0,
  });
  return ctx;
}

/** 특정 게임 시각의 GameTime을 만든다. */
function timeAt(hour: number): GameTime {
  return { year: 2026, month: 1, day: 1, hour, minute: 0, totalMinutes: hour * 60 };
}

/** 임의 게임 경과분의 GameTime을 만든다 (임기·게임일 계산용). */
function minutesAt(totalMinutes: number): GameTime {
  return { year: 2026, month: 1, day: 1, hour: 0, minute: 0, totalMinutes };
}

/** 시장 세션 모듈을 특정 시각으로 전진시킨다 (개장/휴장/리셋 판정용). */
function driveTime(ctx: GameContext, hour: number): void {
  ctx.marketSessionModule.onTick({
    type: 'TICK',
    gameTime: timeAt(hour),
    tickCount: 1,
  });
}

function newCharacter(ctx: GameContext, name: string) {
  const userId = ctx.players.createUser(`${name}-${Math.random().toString(36).slice(2, 8)}`);
  return ctx.players.createCharacter(userId, name);
}

async function runEconomyTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('deriveProfit matches the revenue/margin/material/interest formula', () => {
    const profit = deriveProfit(80, 0.3, 1.0, 10, 30, 0.05);
    assertEqual(
      profit,
      80 * 0.3 - 1.0 * 10 - 30 * 0.05,
      'profit = revenue*margin - materialIndex*materialSensitivity - debt*rate'
    );
  });

  await test('taylor target rate rises when inflation and growth overshoot', () => {
    const target = computeTargetInterestRate(0.05, 0.05, 0.02, 0.04, 0.02, 0.5, 0.1);
    assert(target > 0.05, 'target rate should exceed base rate when both overshoot');
  });

  await test('taylor target rate falls when inflation and growth undershoot', () => {
    const target = computeTargetInterestRate(0.05, 0.0, 0.02, -0.02, 0.02, 0.5, 0.1);
    assert(target < 0.05, 'target rate should fall below base rate when both undershoot');
  });

  await test('interest step uses big step beyond the gap threshold', () => {
    // gap 0.005 < threshold(0.01) → normal step (0.0025)
    const small = applyInterestStep(0.05, 0.055, 0.01, 0.0025, 0.005);
    assertClose(small, 0.05 + 0.0025, 1e-9, 'small gap moves by the normal step');
    // gap 0.02 > threshold(0.01) → big step (0.005)
    const big = applyInterestStep(0.05, 0.07, 0.01, 0.0025, 0.005);
    assertClose(big, 0.05 + 0.005, 1e-9, 'big gap moves by the big step');
  });

  await test('price tick derives profit and exposes named price factors', () => {
    const company = ctx.companies.getCompany(companyId)!;
    ctx.companies.onPriceTick({
      type: 'PRICE_TICK',
      gameTime: ctx.tickLoop.getGameTime(),
      tickCount: 1,
    });

    const updated = ctx.companies.getCompany(companyId)!;
    const brandMultiplier = computeBrandMultiplier(
      updated.stats.brand,
      ctx.config.companies.brandRevenueMultiplierMin,
      ctx.config.companies.brandRevenueMultiplierMax
    );
    const expected = deriveProfit(
      updated.stats.revenue * brandMultiplier,
      updated.stats.margin ?? ctx.config.companies.defaultMargin,
      ctx.macro.getMaterialIndex(),
      updated.stats.materialSensitivity ?? ctx.config.companies.defaultMaterialSensitivity,
      updated.stats.debt,
      ctx.macro.getInterestRate()
    );
    assertClose(updated.stats.profit, expected, 1e-9, 'stored profit must equal derived profit');

    const factors = ctx.companies.getPriceFactors(companyId);
    assert(factors.length > 0, 'price factors must be recorded after a tick');
    assert(
      factors.every((f) => typeof f.name === 'string' && f.name.length > 0),
      'every factor must expose a name'
    );
    assert(
      factors.every((f) => f.direction === '▲' || f.direction === '▼' || f.direction === '—'),
      'every factor must expose only a direction arrow'
    );
  });
}

function makeCompany(over: Partial<Company> = {}): Company {
  return {
    id: 'c1',
    name: 'TestCo',
    basePrice: 100,
    stats: { revenue: 100, profit: 10, debt: 250, rnd: 0, morale: 0, brand: 0 },
    sectors: ['technology'],
    supplySensitivity: 1,
    sharesOutstanding: 1000,
    currentPrice: 100,
    status: 'ACTIVE',
    lossStreakTicks: 0,
    ...over,
  };
}

async function runCentralBankTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('computeMarketCap = currentPrice × sharesOutstanding', () => {
    assertEqual(computeMarketCap(makeCompany()), 100 * 1000, 'market cap formula');
  });

  await test('largeCapIds returns top-N ids by market cap descending', () => {
    const big = makeCompany({ id: 'big', currentPrice: 100, sharesOutstanding: 1000 });
    const mid = makeCompany({ id: 'mid', currentPrice: 50, sharesOutstanding: 100 });
    const small = makeCompany({ id: 'small', currentPrice: 10, sharesOutstanding: 10 });
    const ids = largeCapIds([small, big, mid], 2);
    assertEqual(ids.length, 2, 'limited to topN');
    assertEqual(ids[0], 'big', 'largest market cap first');
    assertEqual(ids[1], 'mid', 'second largest next');
  });

  await test('shouldBailout only for large cap with high debt and deep drawdown', () => {
    const peak = [100, 100, 50];
    const risky = makeCompany({
      currentPrice: 50,
      stats: { revenue: 100, profit: 0, debt: 260, rnd: 0, morale: 0, brand: 0 },
    });
    assert(
      shouldBailout(risky, true, peak, 2.5, 0.4),
      'large cap + debt>2.5 + drawdown 50% should bailout'
    );
    assert(!shouldBailout(risky, false, peak, 2.5, 0.4), 'small/mid cap must not bailout');
    const lowDebt = makeCompany({
      currentPrice: 50,
      stats: { revenue: 100, profit: 0, debt: 200, rnd: 0, morale: 0, brand: 0 },
    });
    assert(!shouldBailout(lowDebt, true, peak, 2.5, 0.4), 'debt ratio 2.0 must not bailout');
    assert(
      !shouldBailout(makeCompany({ currentPrice: 90 }), true, [100, 100, 90], 2.5, 0.4),
      'small drawdown must not bailout'
    );
  });

  await test('applyDilution raises shares, lowers price and debt, preserves market cap', () => {
    const c = makeCompany({
      currentPrice: 100,
      sharesOutstanding: 1000,
      stats: { revenue: 100, profit: 0, debt: 200, rnd: 0, morale: 0, brand: 0 },
    });
    const d = applyDilution(c, 0.5, 1.5);
    assertClose(d.sharesOutstanding, 1500, 1e-9, 'shares × multiplier');
    assertClose(d.currentPrice, 100 / 1.5, 1e-9, 'price diluted');
    assertClose(d.debt, 100, 1e-9, 'debt relieved by ratio');
    assertClose(d.sharesOutstanding * d.currentPrice, 100 * 1000, 1e-9, 'market cap preserved');
  });

  await test('CircuitBreaker halts then reopens after ticks', () => {
    const cb = new CircuitBreaker();
    assert(!cb.isHalted(), 'starts open');
    cb.halt(2);
    assert(cb.isHalted(), 'halts on request');
    cb.tick();
    assert(cb.isHalted(), 'still halted after one tick');
    cb.tick();
    assert(!cb.isHalted(), 'reopens after ticks');
  });

  await test('large-cap clamp is tighter than default clamp', () => {
    assert(
      ctx.config.centralBank.largeCapStabilityMaxDrop < ctx.config.market.priceStabilityMaxDrop,
      'large-cap drop clamp must be narrower'
    );
  });

  await test('circuit breaker blocks trading until it reopens', () => {
    const character = newCharacter(ctx, 'Haltee');
    ctx.circuitBreaker.halt(3);
    assertThrows(
      () => ctx.amm.trade(character.id, companyId, 'buy', 1),
      'trade must throw while halted'
    );
    ctx.circuitBreaker.tick();
    ctx.circuitBreaker.tick();
    ctx.circuitBreaker.tick();
    ctx.amm.trade(character.id, companyId, 'buy', 1);
  });
}

async function runTimeDesignTests(ctx: GameContext, companyId: string): Promise<void> {
  const open = ctx.config.world.marketOpenHour;
  const close = ctx.config.world.marketCloseHour;
  const settlementEnd = ctx.config.world.settlementEndHour;

  await test('market open/close follows the 09:00–01:00 schedule', () => {
    assertEqual(isMarketOpen(timeAt(8), open, close), false, '08:00 should be closed');
    assertEqual(isMarketOpen(timeAt(9), open, close), true, '09:00 should be open');
    assertEqual(isMarketOpen(timeAt(23), open, close), true, '23:00 should be open');
    assertEqual(isMarketOpen(timeAt(0), open, close), true, '00:00 should be open');
    assertEqual(isMarketOpen(timeAt(1), open, close), false, '01:00 should be closed');
    assertEqual(isMarketOpen(timeAt(4), open, close), false, '04:00 should be closed');
  });

  await test('main session matches configured hours', () => {
    const hours = ctx.config.world.mainSessionHours;
    assertEqual(isMainSession(timeAt(hours[0]), hours), true, 'configured hour is a main session');
    assertEqual(isMainSession(timeAt(3), hours), false, 'off-session hour must not match');
  });

  await test('settlement window spans 01:00–05:00', () => {
    assertEqual(isSettlementWindow(timeAt(2), close, settlementEnd), true, '02:00 in settlement');
    assertEqual(isSettlementWindow(timeAt(6), close, settlementEnd), false, '06:00 out of settlement');
  });

  await test('trading is blocked while the market is closed', () => {
    const character = newCharacter(ctx, 'NightTrader');
    driveTime(ctx, 4);
    assertThrows(
      () => ctx.amm.trade(character.id, companyId, 'buy', 1),
      'trading during closed market must throw'
    );
  });

  await test('trading works while the market is open', () => {
    const character = newCharacter(ctx, 'DayTrader');
    driveTime(ctx, 10);
    const result = ctx.amm.trade(character.id, companyId, 'buy', 1);
    assertEqual(result.method, 'amm', 'market order should execute during open hours');
  });

  await test('daily intel purchase limit caps info buys', () => {
    const character = newCharacter(ctx, 'InfoHoarder');
    const limit = ctx.config.intel.dailyIntelPurchaseLimit;
    const rumors = Array.from({ length: limit + 1 }, () => ctx.intel.generateRumor(companyId));
    for (let i = 0; i < limit; i++) {
      ctx.intel.purchaseIntel(character.id, rumors[i].id);
    }
    assertThrows(
      () => ctx.intel.purchaseIntel(character.id, rumors[limit].id),
      'intel purchase beyond the daily limit must throw'
    );
  });

  await test('daily intel usage resets when the market reopens', () => {
    const character = newCharacter(ctx, 'Resetter');
    const rumor = ctx.intel.generateRumor(companyId);
    ctx.intel.purchaseIntel(character.id, rumor.id);
    assert(ctx.dailyActions.getState(character.id).intelUsed > 0, 'intel should be counted');
    driveTime(ctx, 4);
    driveTime(ctx, 9);
    assertEqual(
      ctx.dailyActions.getState(character.id).intelUsed,
      0,
      'daily intel usage should reset at market open'
    );
  });
}

async function runStopLossIntakeTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('stop-loss placement does not sell', () => {
    const character = newCharacter(ctx, 'StopIntake');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const stopPrice = ctx.companies.getCompany(companyId)!.currentPrice * 0.5;
    const cashBefore = ctx.ledger.getBalance(character.accountId);

    ctx.amm.trade(character.id, companyId, 'sell', 10, stopPrice, 'stop');

    assertEqual(
      ctx.orderBook.getPortfolioEntry(character.id, companyId).shares,
      10,
      'stop placement must not sell shares'
    );
    assertEqual(
      ctx.ledger.getBalance(character.accountId),
      cashBefore,
      'stop placement must not move cash'
    );
    const open = ctx.orderBook.getOpenOrdersForCharacter(character.id);
    assert(
      open.some((o) => o.type === 'stop' && o.status === 'open'),
      'stop order must be open in the character list'
    );
  });

  await test('stop-loss cancel keeps shares', () => {
    const character = newCharacter(ctx, 'StopCancel');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const stopPrice = ctx.companies.getCompany(companyId)!.currentPrice * 0.5;
    ctx.amm.trade(character.id, companyId, 'sell', 10, stopPrice, 'stop');

    const [order] = ctx.orderBook.getOpenOrdersForCharacter(character.id);
    ctx.orderBook.cancelOrder(order.id, character.id);

    assertEqual(
      ctx.orderBook.getOrder(order.id)!.status,
      'cancelled',
      'cancelled order must be marked cancelled'
    );
    assertEqual(
      ctx.orderBook.getPortfolioEntry(character.id, companyId).shares,
      10,
      'cancel must keep shares'
    );
  });

  await test('stop-loss buy is rejected', () => {
    const character = newCharacter(ctx, 'StopBuy');
    const price = ctx.companies.getCompany(companyId)!.currentPrice;
    assertThrows(
      () => ctx.amm.trade(character.id, companyId, 'buy', 1, price, 'stop'),
      'stop buy must be rejected'
    );
  });

  await test('stop-loss without shares is rejected', () => {
    const character = newCharacter(ctx, 'StopEmpty');
    const price = ctx.companies.getCompany(companyId)!.currentPrice;
    assertThrows(
      () => ctx.amm.trade(character.id, companyId, 'sell', 1, price, 'stop'),
      'stop sell without shares must be rejected'
    );
  });
}

async function runStopLossTriggerTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('stop-loss triggers market sell on drop', () => {
    const character = newCharacter(ctx, 'StopTrig');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const stopPrice = ctx.companies.getCompany(companyId)!.currentPrice * 0.5;
    ctx.amm.trade(character.id, companyId, 'sell', 10, stopPrice, 'stop');
    const [order] = ctx.orderBook.getOpenOrdersForCharacter(character.id);

    getDb().prepare(`UPDATE companies SET current_price = ? WHERE id = ?`).run(stopPrice - 1, companyId);
    ctx.amm.onPriceTick({ type: 'PRICE_TICK', gameTime: ctx.tickLoop.getGameTime(), tickCount: 1 });

    assertEqual(
      ctx.orderBook.getPortfolioEntry(character.id, companyId).shares,
      0,
      'stop-loss should have liquidated the position'
    );
    assertEqual(
      ctx.orderBook.getOrder(order.id)!.status,
      'filled',
      'triggered stop order must be marked filled'
    );
  });

  await test('stop-loss does not fire above trigger', () => {
    const character = newCharacter(ctx, 'StopNoTrig');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const stopPrice = ctx.companies.getCompany(companyId)!.currentPrice * 0.5;
    ctx.amm.trade(character.id, companyId, 'sell', 10, stopPrice, 'stop');
    const [order] = ctx.orderBook.getOpenOrdersForCharacter(character.id);

    getDb().prepare(`UPDATE companies SET current_price = ? WHERE id = ?`).run(stopPrice + 1, companyId);
    ctx.amm.onPriceTick({ type: 'PRICE_TICK', gameTime: ctx.tickLoop.getGameTime(), tickCount: 1 });

    assertEqual(
      ctx.orderBook.getPortfolioEntry(character.id, companyId).shares,
      10,
      'stop must not fire above the trigger price'
    );
    assertEqual(ctx.orderBook.getOrder(order.id)!.status, 'open', 'order must remain open');
  });

  await test('failed stop-loss stays open', () => {
    const character = newCharacter(ctx, 'StopFail');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const stopPrice = ctx.companies.getCompany(companyId)!.currentPrice * 0.5;
    ctx.amm.trade(character.id, companyId, 'sell', 10, stopPrice, 'stop');
    const [order] = ctx.orderBook.getOpenOrdersForCharacter(character.id);

    ctx.amm.sellToAmm(character.id, companyId, 10);
    getDb().prepare(`UPDATE companies SET current_price = ? WHERE id = ?`).run(stopPrice - 1, companyId);
    ctx.amm.onPriceTick({ type: 'PRICE_TICK', gameTime: ctx.tickLoop.getGameTime(), tickCount: 1 });

    assertEqual(
      ctx.orderBook.getOrder(order.id)!.status,
      'open',
      'failed stop execution must keep the order open'
    );
  });

  await test('stop-loss does not fire while closed', () => {
    const character = newCharacter(ctx, 'StopClosed');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const stopPrice = ctx.companies.getCompany(companyId)!.currentPrice * 0.5;
    ctx.amm.trade(character.id, companyId, 'sell', 10, stopPrice, 'stop');
    const [order] = ctx.orderBook.getOpenOrdersForCharacter(character.id);

    driveTime(ctx, 4);
    getDb().prepare(`UPDATE companies SET current_price = ? WHERE id = ?`).run(stopPrice - 1, companyId);
    ctx.amm.onPriceTick({ type: 'PRICE_TICK', gameTime: ctx.tickLoop.getGameTime(), tickCount: 1 });

    assertEqual(
      ctx.orderBook.getPortfolioEntry(character.id, companyId).shares,
      10,
      'stop must not fire while the market is closed'
    );
    assertEqual(ctx.orderBook.getOrder(order.id)!.status, 'open', 'order must remain open');
  });
}

async function runStopLossSessionTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('closed market rejects new stop', () => {
    driveTime(ctx, 4);
    const character = newCharacter(ctx, 'StopClosedNew');
    assertThrows(
      () => ctx.amm.trade(character.id, companyId, 'sell', 1, 100, 'stop'),
      'new stop order must be rejected while the market is closed'
    );
  });

  await test('existing stop survives close', () => {
    driveTime(ctx, 10);
    const character = newCharacter(ctx, 'StopSurvive');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const stopPrice = ctx.companies.getCompany(companyId)!.currentPrice * 0.5;
    ctx.amm.trade(character.id, companyId, 'sell', 10, stopPrice, 'stop');
    const [order] = ctx.orderBook.getOpenOrdersForCharacter(character.id);

    driveTime(ctx, 4);
    assertEqual(
      ctx.orderBook.getOrder(order.id)!.status,
      'open',
      'stop must survive the market close'
    );
  });

  await test('cancel works while closed', () => {
    driveTime(ctx, 10);
    const character = newCharacter(ctx, 'StopCancelClosed');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const stopPrice = ctx.companies.getCompany(companyId)!.currentPrice * 0.5;
    ctx.amm.trade(character.id, companyId, 'sell', 10, stopPrice, 'stop');
    const [order] = ctx.orderBook.getOpenOrdersForCharacter(character.id);

    driveTime(ctx, 4);
    ctx.orderBook.cancelOrder(order.id, character.id);
    assertEqual(
      ctx.orderBook.getOrder(order.id)!.status,
      'cancelled',
      'cancel must work while the market is closed'
    );
  });

  await test('stop fires after reopen', () => {
    driveTime(ctx, 10);
    const character = newCharacter(ctx, 'StopReopen');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const stopPrice = ctx.companies.getCompany(companyId)!.currentPrice * 0.5;
    ctx.amm.trade(character.id, companyId, 'sell', 10, stopPrice, 'stop');
    const [order] = ctx.orderBook.getOpenOrdersForCharacter(character.id);

    driveTime(ctx, 4);
    getDb().prepare(`UPDATE companies SET current_price = ? WHERE id = ?`).run(
      stopPrice - 1,
      companyId
    );
    driveTime(ctx, 10);
    ctx.amm.onPriceTick({ type: 'PRICE_TICK', gameTime: ctx.tickLoop.getGameTime(), tickCount: 1 });

    assertEqual(
      ctx.orderBook.getPortfolioEntry(character.id, companyId).shares,
      0,
      'stop must liquidate after the market reopens'
    );
    assertEqual(ctx.orderBook.getOrder(order.id)!.status, 'filled', 'reopened stop must be filled');
  });
}


async function runJobTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('regularPay matches the meal+rest times cpi plus allowance formula', () => {
    assertEqual(regularPay(1.0, 500, 200, 10000, 0.1), 1700, 'regularPay = (meal+rest)*cpi + starter*ratio');
  });

  await test('partTimePay matches the rest times cpi plus fixed extra formula', () => {
    assertEqual(partTimePay(1.0, 200, 50), 250, 'partTimePay = rest*cpi + extra');
  });

  await test('regularPay allowance ignores cpi', () => {
    assertEqual(regularPay(2, 500, 200, 10000, 0.1), 1400 + 1000, 'allowance must not scale with cpi');
  });

  await test('regular payday mints on market open', () => {
    const character = newCharacter(ctx, 'RegWorker');
    ctx.jobs.takeJob(character.id, 'regular', ctx.tickLoop.getGameTime().totalMinutes);
    const before = ctx.ledger.getBalance(character.accountId);
    driveTime(ctx, 4);
    driveTime(ctx, 9);
    const expected = regularPay(
      ctx.macro.getCpiIndex(),
      ctx.config.survival.mealCostBase,
      ctx.config.survival.restCostBase,
      ctx.config.economy.starterCash,
      ctx.config.jobs.regularAllowanceRatio
    );
    assertEqual(
      ctx.ledger.getBalance(character.accountId),
      before + expected,
      'regular pay should be minted at market open'
    );
  });

  await test('parttime payday mints on market open', () => {
    const character = newCharacter(ctx, 'PartWorker');
    ctx.jobs.takeJob(character.id, 'parttime', ctx.tickLoop.getGameTime().totalMinutes);
    const before = ctx.ledger.getBalance(character.accountId);
    driveTime(ctx, 4);
    driveTime(ctx, 9);
    const expected = partTimePay(
      ctx.macro.getCpiIndex(),
      ctx.config.survival.restCostBase,
      ctx.config.jobs.partTimeExtra
    );
    assertEqual(
      ctx.ledger.getBalance(character.accountId),
      before + expected,
      'parttime pay should be minted at market open'
    );
  });

  await test('having a job does not block trades', () => {
    const character = newCharacter(ctx, 'WorkerTrader');
    ctx.jobs.takeJob(character.id, 'regular', ctx.tickLoop.getGameTime().totalMinutes);
    const result = ctx.amm.trade(character.id, companyId, 'buy', 1);
    assertEqual(result.method, 'amm', 'market buy should succeed while employed');
    assertEqual(
      ctx.orderBook.getPortfolioEntry(character.id, companyId).shares,
      1,
      'should hold 1 share after trading while employed'
    );
  });

  await test('regular ends after 7 game days with no mint that day', () => {
    const character = newCharacter(ctx, 'RegExpiry');
    ctx.jobs.takeJob(character.id, 'regular', ctx.tickLoop.getGameTime().totalMinutes);
    const before = ctx.ledger.getBalance(character.accountId);
    getDb()
      .prepare(`UPDATE characters SET job_started_total_minutes = ? WHERE id = ?`)
      .run(540 - 7 * 1440, character.id);
    driveTime(ctx, 4);
    driveTime(ctx, 9);
    assertEqual(ctx.jobs.getJob(character.id), null, 'regular should end after 7 game days');
    assertEqual(
      ctx.ledger.getBalance(character.accountId),
      before,
      'no mint on the day regular ends'
    );
    assertThrows(
      () => ctx.jobs.takeJob(character.id, 'regular', ctx.tickLoop.getGameTime().totalMinutes),
      'regular rehire must be rejected this season'
    );
  });

  await test('regular ends at independence threshold', () => {
    const character = newCharacter(ctx, 'RegIndep');
    ctx.jobs.takeJob(character.id, 'regular', ctx.tickLoop.getGameTime().totalMinutes);
    ctx.amm.buyFromAmm(character.id, companyId, 1);
    getDb().prepare(`UPDATE companies SET current_price = ? WHERE id = ?`).run(20000, companyId);
    assert(
      ctx.orderBook.getNetWorth(character.id) >=
        ctx.config.economy.starterCash * ctx.config.jobs.regularIndependenceMultiple,
      'netWorth should reach the independence threshold'
    );
    driveTime(ctx, 4);
    driveTime(ctx, 9);
    assertEqual(ctx.jobs.getJob(character.id), null, 'regular should end at independence');
  });

  await test('parttime is allowed after regular ends', () => {
    const character = newCharacter(ctx, 'RegThenPart');
    ctx.jobs.takeJob(character.id, 'regular', ctx.tickLoop.getGameTime().totalMinutes);
    ctx.jobs.quitJob(character.id);
    assertThrows(
      () => ctx.jobs.takeJob(character.id, 'regular', ctx.tickLoop.getGameTime().totalMinutes),
      'regular rehire must be rejected after quitting'
    );
    const job = ctx.jobs.takeJob(character.id, 'parttime', ctx.tickLoop.getGameTime().totalMinutes);
    assertEqual(job.kind, 'parttime', 'parttime should be allowed after regular ends');
  });
}

async function runRankingTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('ranking orders three characters by cash with names', () => {
    const a = newCharacter(ctx, 'RankLow');
    const b = newCharacter(ctx, 'RankHigh');
    const c = newCharacter(ctx, 'RankMid');
    ctx.ledger.mint(a.accountId, 100, 'JOB_INCOME');
    ctx.ledger.mint(b.accountId, 300, 'JOB_INCOME');
    ctx.ledger.mint(c.accountId, 200, 'JOB_INCOME');

    const board = ctx.ranking
      .listLive()
      .filter((row) => [a.id, b.id, c.id].includes(row.characterId));

    assertEqual(board.length, 3, 'all three must be on the board');
    assertEqual(board[0].characterId, b.id, 'most cash ranks first');
    assertEqual(board[0].name, 'RankHigh', 'rank 1 name must match');
    assertEqual(board[1].characterId, c.id, 'middle cash ranks second');
    assertEqual(board[1].name, 'RankMid', 'rank 2 name must match');
    assertEqual(board[2].characterId, a.id, 'least cash ranks third');
    assertEqual(board[2].name, 'RankLow', 'rank 3 name must match');
  });

  await test('stock holdings outrank equal cash', () => {
    const cashOnly = newCharacter(ctx, 'CashOnly');
    const holder = newCharacter(ctx, 'EquityHolder');
    const price = ctx.companies.getCompany(companyId)!.currentPrice;
    getDb()
      .prepare(`INSERT INTO portfolio (character_id, company_id, shares) VALUES (?, ?, ?)`)
      .run(holder.id, companyId, 10);

    const board = ctx.ranking
      .listLive()
      .filter((row) => [cashOnly.id, holder.id].includes(row.characterId));

    assertEqual(board[0].characterId, holder.id, 'share holder must outrank cash-only');
    assertClose(board[0].netWorth, board[1].netWorth + price * 10, 1e-6, 'gap equals stock value');
  });

  await test('tie breaks by earlier created_at', () => {
    const earlier = newCharacter(ctx, 'TieEarly');
    const later = newCharacter(ctx, 'TieLate');
    getDb().prepare(`UPDATE characters SET created_at = ? WHERE id = ?`).run(1000, earlier.id);
    getDb().prepare(`UPDATE characters SET created_at = ? WHERE id = ?`).run(2000, later.id);

    const board = ctx.ranking
      .listLive()
      .filter((row) => [earlier.id, later.id].includes(row.characterId));

    assertEqual(board[0].characterId, earlier.id, 'earlier created_at must rank first on tie');
    assertEqual(board[0].netWorth, board[1].netWorth, 'tied characters have equal net worth');
  });

  await test('rankFor rank matches the board entry', () => {
    const character = newCharacter(ctx, 'RankSelf');
    ctx.ledger.mint(character.accountId, 500, 'JOB_INCOME');

    const result = ctx.ranking.rankFor(character.id);
    const mine = result.board.find((row) => row.characterId === character.id)!;

    assertEqual(result.rank, mine.rank, 'rankFor rank must match board rank');
    assertEqual(result.netWorth, mine.netWorth, 'rankFor netWorth must match board netWorth');
    assertEqual(result.total, result.board.length, 'total must equal board length');
  });

  await test('season kill empties the ranking board', () => {
    const character = newCharacter(ctx, 'SeasonEnd');
    ctx.season.onSeasonEnd();

    assertEqual(ctx.ranking.listLive().length, 0, 'total must be 0 after season kills everyone');
    assertThrows(() => ctx.ranking.rankFor(character.id), 'rankFor must throw for a dead character');
  });
}

async function runInstitutionTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('user institutions are disabled by default', () => {
    assertEqual(ctx.institution.enabled, false, 'committed flag must stay false');
    assertEqual(ctx.institution.getOverview().enabled, false, 'overview must report disabled');
  });

  // 이후 테스트에서만 config를 덮어쓴다. 커밋된 market.json은 false 유지.
  ctx.config.market.userInstitutionEnabled = true;

  await test('institution seat revokes a holder who loses eligibility', () => {
    ctx.season.onSeasonEnd();
    const holder = newCharacter(ctx, 'SeatHolder');
    ctx.ledger.mint(holder.accountId, 40000, 'JOB_INCOME');
    ctx.amm.buyFromAmm(holder.id, companyId, 1);

    ctx.institution.runCycle(minutesAt(0));
    let seat = ctx.institution.getSeat(companyId)!;
    assertEqual(seat.status, 'offered', 'empty seat should offer the eligible holder');
    assertEqual(seat.characterId, holder.id, 'holder should receive the offer');

    ctx.institution.accept(companyId, holder.id, 0);
    seat = ctx.institution.getSeat(companyId)!;
    assertEqual(seat.status, 'held', 'holder should hold the seat after accepting');

    ctx.amm.sellToAmm(holder.id, companyId, 1);
    ctx.institution.runCycle(minutesAt(1));
    seat = ctx.institution.getSeat(companyId)!;
    assertEqual(seat.status, 'empty', 'ineligible holder should be revoked');
    assertEqual(seat.characterId, null, 'seat should be vacated after revocation');
  });

  await test('refusing an offer cascades to the next candidate', () => {
    ctx.season.onSeasonEnd();
    const a = newCharacter(ctx, 'SeatA');
    const b = newCharacter(ctx, 'SeatB');
    const c = newCharacter(ctx, 'SeatC');
    ctx.ledger.mint(a.accountId, 50000, 'JOB_INCOME');
    ctx.ledger.mint(b.accountId, 40000, 'JOB_INCOME');
    ctx.ledger.mint(c.accountId, 30000, 'JOB_INCOME');
    for (const ch of [a, b, c]) ctx.amm.buyFromAmm(ch.id, companyId, 1);

    ctx.institution.runCycle(minutesAt(0));
    assertEqual(ctx.institution.getSeat(companyId)!.characterId, a.id, 'top candidate first');

    ctx.institution.refuse(companyId, a.id, 0);
    assertEqual(
      ctx.institution.getSeat(companyId)!.characterId,
      b.id,
      'second candidate after first refuse'
    );

    ctx.institution.refuse(companyId, b.id, 0);
    assertEqual(
      ctx.institution.getSeat(companyId)!.characterId,
      c.id,
      'third candidate after second refuse'
    );
  });

  await test('institution term ends after 30 game days to empty', () => {
    ctx.season.onSeasonEnd();
    const holder = newCharacter(ctx, 'TermHolder');
    ctx.ledger.mint(holder.accountId, 40000, 'JOB_INCOME');
    ctx.amm.buyFromAmm(holder.id, companyId, 1);

    ctx.institution.runCycle(minutesAt(0));
    ctx.institution.accept(companyId, holder.id, 0);
    assertEqual(ctx.institution.getSeat(companyId)!.status, 'held', 'holder should hold the seat');

    ctx.institution.runCycle(minutesAt(31 * 1440));
    const seat = ctx.institution.getSeat(companyId)!;
    assertEqual(seat.status, 'empty', 'term expiry should revoke the seat');
    assertEqual(seat.characterId, null, 'no next candidate leaves the seat empty');
  });
}

async function runSeasonTests(ctx: GameContext): Promise<void> {
  await test('season starts with its full length remaining', () => {
    const info = ctx.season.getSeasonInfo();
    assertEqual(
      info.remainingMinutes,
      ctx.config.world.seasonLengthDays * 1440,
      'a fresh season should have the full season length remaining'
    );
  });

  await test('crossing the season length rolls the season and wipes characters', () => {
    const character = newCharacter(ctx, 'SeasonVictim');
    const startNumber = ctx.season.getSeasonInfo().seasonNumber;

    ctx.season.onTick({
      type: 'TICK',
      gameTime: minutesAt(ctx.config.world.seasonLengthDays * 1440),
      tickCount: 1,
    });

    const info = ctx.season.getSeasonInfo();
    assertEqual(info.seasonNumber, startNumber + 1, 'season number should advance by one');
    assertEqual(
      info.startedTotalMinutes,
      ctx.config.world.seasonLengthDays * 1440,
      'startedTotalMinutes should reset to the end moment'
    );
    assertEqual(
      ctx.players.getCharacter(character.id)!.isAlive,
      false,
      'alive characters must be wiped when the season ends'
    );
    assertEqual(
      ctx.players.getCharacter(character.id)!.deathCause,
      'season_end',
      'season wipe must record season_end as the death cause'
    );
    assertEqual(ctx.ranking.listLive().length, 0, 'no live characters should remain');
  });
}

async function runDeathTests(ctx: GameContext): Promise<void> {
  await test('survivedGameDays is a non-negative integer', () => {
    const character = newCharacter(ctx, 'Survivor');
    const c = ctx.players.getCharacter(character.id)!;
    assert(Number.isInteger(c.survivedGameDays), 'survivedGameDays must be an integer');
    assert(c.survivedGameDays >= 0, 'survivedGameDays must be non-negative');
  });

  await test('peakNetWorth stays at or above current net worth after a survival tick', () => {
    const character = newCharacter(ctx, 'PeakTracker');
    ctx.survival.onSurvivalTick({
      type: 'SURVIVAL_TICK',
      gameTime: ctx.tickLoop.getGameTime(),
      tickCount: 1,
    });
    const after = ctx.players.getCharacter(character.id)!;
    const currentNetWorth = ctx.orderBook.getNetWorth(character.id);
    assert(
      after.peakNetWorth >= currentNetWorth,
      'peakNetWorth must be at least current net worth'
    );
  });
}

async function runAuthTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('new character has an auth token', () => {
    const character = newCharacter(ctx, 'AuthToken');
    const token = ctx.players.getAuthToken(character.id);
    assert(typeof token === 'string' && token.length >= 20, 'auth token should be a 20+ char string');
  });

  await test('correct token verifies', () => {
    const character = newCharacter(ctx, 'AuthVerify');
    const token = ctx.players.getAuthToken(character.id)!;
    assert(ctx.players.verifyAuthToken(character.id, token) === true, 'correct token should verify');
  });

  await test('wrong token is rejected', () => {
    const character = newCharacter(ctx, 'AuthWrong');
    assert(ctx.players.verifyAuthToken(character.id, 'nope') === false, 'wrong token should be rejected');
  });

  await test('missing token is rejected', () => {
    const character = newCharacter(ctx, 'AuthMissing');
    assert(
      ctx.players.verifyAuthToken(character.id, undefined) === false,
      'missing token should be rejected'
    );
  });

  await test('other character token is rejected', () => {
    const a = newCharacter(ctx, 'AuthA');
    const b = newCharacter(ctx, 'AuthB');
    const tokenA = ctx.players.getAuthToken(a.id)!;
    assert(
      ctx.players.verifyAuthToken(b.id, tokenA) === false,
      'another character token should be rejected'
    );
  });
}

async function main(): Promise<void> {
  console.log('Stock Survival — server test suite\n');
  const ctx = await setup();
  const companyId = ctx.companies.getAllCompanies()[0].id;

  await runEconomyTests(ctx, companyId);

  await test('character spawns with starter cash from config', () => {
    const character = newCharacter(ctx, 'Spawner');
    const balance = ctx.ledger.getBalance(character.accountId);
    assertEqual(balance, ctx.config.economy.starterCash, 'starter cash mismatch');
    assertEqual(character.health, ctx.config.survival.maxHealth, 'health should start at max');
    assertEqual(character.isAlive, true, 'character should be alive');
  });

  await test('AMM buy decreases cash and increases shares', () => {
    const character = newCharacter(ctx, 'Buyer');
    const before = ctx.ledger.getBalance(character.accountId);

    const result = ctx.amm.buyFromAmm(character.id, companyId, 10);
    assert(result.total > 0, 'trade total should be positive');

    const after = ctx.ledger.getBalance(character.accountId);
    assert(after < before, 'balance should decrease after buying');
    assertEqual(
      Math.round((before - after) * 100) / 100,
      Math.round(result.total * 100) / 100,
      'cash spent should equal trade total'
    );
    assertEqual(
      ctx.orderBook.getPortfolioEntry(character.id, companyId).shares,
      10,
      'should hold 10 shares'
    );
  });

  await test('AMM sell returns cash and reduces shares', () => {
    const character = newCharacter(ctx, 'Seller');
    ctx.amm.buyFromAmm(character.id, companyId, 10);
    const midBalance = ctx.ledger.getBalance(character.accountId);

    ctx.amm.sellToAmm(character.id, companyId, 4);
    assertEqual(
      ctx.orderBook.getPortfolioEntry(character.id, companyId).shares,
      6,
      'should hold 6 shares after selling 4'
    );
    assert(
      ctx.ledger.getBalance(character.accountId) > midBalance,
      'balance should increase after selling'
    );
  });

  await test('getPortfolio returns camelCase companyId for valuation', () => {
    const character = newCharacter(ctx, 'Holder');
    ctx.amm.buyFromAmm(character.id, companyId, 3);

    const entries = ctx.orderBook.getPortfolio(character.id);
    assertEqual(entries.length, 1, 'should have one holding');
    assertEqual(entries[0].companyId, companyId, 'companyId must be mapped from company_id');
    assertEqual(entries[0].characterId, character.id, 'characterId must be mapped');
    assertEqual(entries[0].shares, 3, 'shares should match');
  });

  await test('selling more shares than owned is rejected', () => {
    const character = newCharacter(ctx, 'Overseller');
    assertThrows(
      () => ctx.amm.sellToAmm(character.id, companyId, 5),
      'selling without holdings must throw'
    );
  });

  await test('limit buy order beyond balance is rejected at placement', () => {
    const character = newCharacter(ctx, 'Broke');
    assertThrows(
      () => ctx.orderBook.placeOrder(character.id, companyId, 'buy', 100, 100000),
      'insufficient balance must be caught when placing the order'
    );
  });

  await runSurvivalTests(ctx);
  await runGameplayTests(ctx, companyId);
  await runSectorEventTests(ctx);
  await runCentralBankTests(ctx, companyId);
  await runImageAxisTests(ctx, companyId);
  await runStopLossIntakeTests(ctx, companyId);
  await runStopLossTriggerTests(ctx, companyId);
  await runStopLossSessionTests(ctx, companyId);
  await runJobTests(ctx, companyId);
  await runRankingTests(ctx, companyId);
  await runTimeDesignTests(ctx, companyId);
  await runInstitutionTests(ctx, companyId);
  await runAuthTests(ctx, companyId);
  await runDeathTests(ctx);
  await runSeasonTests(ctx);

  await test('broadcastNews feeds getRecentNews', () => {
    ctx.intel.broadcastNews('테스트 헤드라인', '테스트 본문', companyId);
    const recent = ctx.intel.getRecentNews();
    assert(recent.length >= 1, 'recent news should remember a broadcast');
    assertEqual(recent[0].title, '테스트 헤드라인', 'latest news should come first');
  });

  const code = summarize();
  closeDb();
  process.exitCode = code;
}

async function runSurvivalTests(ctx: GameContext): Promise<void> {
  await test('starvation drains health and death seizes assets', () => {
    const character = newCharacter(ctx, 'Starver');
    const overdueMinutes = ctx.config.survival.hungerThresholdMinutes + 10;
    ctx.players.updateCharacter(character.id, {
      lastMealAt: Date.now() - overdueMinutes * 60 * 1000,
      health: ctx.config.survival.hungerDamagePerTick,
    });

    const treasuryBefore = ctx.ledger.getBalance(SYSTEM_ACCOUNTS.TREASURY);
    const playerCash = ctx.ledger.getBalance(character.accountId);

    ctx.survival.onSurvivalTick({
      type: 'SURVIVAL_TICK',
      gameTime: ctx.tickLoop.getGameTime(),
      tickCount: 1,
    });

    const after = ctx.players.getCharacter(character.id)!;
    assertEqual(after.health, 0, 'health should hit zero from hunger');
    assertEqual(after.isAlive, false, 'character should be dead');
    assertEqual(after.deathCause, 'starvation', 'deathCause must be starvation');
    assertEqual(
      ctx.ledger.getBalance(character.accountId),
      0,
      'dead character account must be emptied'
    );
    assertEqual(
      Math.round(ctx.ledger.getBalance(SYSTEM_ACCOUNTS.TREASURY)),
      Math.round(treasuryBefore + playerCash),
      'seized cash should land in the treasury'
    );
  });

  await test('eating restores health and costs CPI-adjusted cash', () => {
    const character = newCharacter(ctx, 'Eater');
    ctx.players.updateCharacter(character.id, { health: 50 });
    const before = ctx.ledger.getBalance(character.accountId);

    const result = ctx.survival.eat(character.id);
    assertEqual(
      result.health,
      50 + ctx.config.survival.mealHealthRestore,
      'meal should restore configured health'
    );
    assertEqual(
      Math.round(before - ctx.ledger.getBalance(character.accountId)),
      Math.round(result.cost),
      'meal cost should be deducted'
    );
  });
}

async function runGameplayTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('passed agenda changes company stats', () => {
    const character = newCharacter(ctx, 'Voter');
    ctx.amm.buyFromAmm(character.id, companyId, 50);

    const statBefore = ctx.companies.getCompany(companyId)!.stats.rnd;
    const agenda = ctx.governance.createAgenda(companyId, 'rnd', 5, 60);
    ctx.governance.vote(agenda.id, character.id, 'for');

    // Force the deadline into the past so resolveAgendas processes it now.
    getDb().prepare(`UPDATE agendas SET deadline = ? WHERE id = ?`).run(Date.now() - 1, agenda.id);
    ctx.governance.resolveAgendas();

    assertEqual(ctx.governance.getAgenda(agenda.id)!.status, 'passed', 'agenda should pass');
    assert(
      ctx.companies.getCompany(companyId)!.stats.rnd > statBefore,
      'passing agenda should raise the rnd stat'
    );
  });

  await test('intel purchase records ownership and charges cost', () => {
    const character = newCharacter(ctx, 'Spy');
    const rumor = ctx.intel.generateRumor(companyId);
    const before = ctx.ledger.getBalance(character.accountId);

    const bought = ctx.intel.purchaseIntel(character.id, rumor.id);
    assertEqual(bought.id, rumor.id, 'purchased intel id mismatch');
    assertEqual(
      Math.round(before - ctx.ledger.getBalance(character.accountId)),
      Math.round(rumor.cost),
      'intel cost should be deducted'
    );
    assert(
      !ctx.intel.getAvailableIntel(character.id).some((i) => i.id === rumor.id),
      'purchased intel should leave the available list'
    );
  });

  await test('price tick updates company price and history', () => {
    const historyBefore = ctx.companies.getPriceHistory(companyId).length;
    ctx.companies.onPriceTick({
      type: 'PRICE_TICK',
      gameTime: ctx.tickLoop.getGameTime(),
      tickCount: 1,
    });
    assert(
      ctx.companies.getPriceHistory(companyId).length > historyBefore,
      'price history should grow after a price tick'
    );
    assert(ctx.companies.getCompany(companyId)!.currentPrice > 0, 'price must stay positive');
  });

  await test('ledger conservation holds after all activity', () => {
    const conservation = ctx.ledger.assertConservation();
    assertEqual(conservation.ok, true, 'total supply must equal total minted');
  });
}

async function runSectorEventTests(ctx: GameContext): Promise<void> {
  await test('rateSensitivity: rate rise moves negative-sensitivity sectors down and finance up', () => {
    const before = ctx.sectors.getIndices();
    ctx.sectors.onInterestRateChange(ctx.macro.getInterestRate() + 0.01);
    const after = ctx.sectors.getIndices();
    assert(
      after.semiconductor < before.semiconductor,
      'semiconductor(-1.2) should fall when rates rise'
    );
    assert(after.finance > before.finance, 'finance(+0.8) should rise when rates rise');
  });

  await test('applySectorEffect clamps to [indexMin, indexMax]', () => {
    ctx.sectors.applySectorEffect('semiconductor', -100);
    assertClose(
      ctx.sectors.getIndices().semiconductor,
      ctx.config.sectors.indexMin,
      1e-9,
      'index must clamp to indexMin'
    );
    ctx.sectors.applySectorEffect('semiconductor', 1000);
    assertClose(
      ctx.sectors.getIndices().semiconductor,
      ctx.config.sectors.indexMax,
      1e-9,
      'index must clamp to indexMax'
    );
  });

  await test('selectNewsEvent reflects state bias via injected rand', () => {
    const config = ctx.config.newsEvents;
    const state: NewsState = {
      interestRate: 0.05,
      baseInterestRate: 0.05,
      inflationRate: 0,
      commodities: { silicon: 200 },
      commodityBasePrices: { silicon: 80 },
      sectorIndices: { semiconductor: 1.0 },
    };
    const biased = config.events.find((e) => e.bias?.['commoditySpike.silicon']);
    assert(biased !== undefined, 'an event with silicon spike bias should exist');
    const weight = computeEventWeight(biased!, state, config);
    assert(weight > biased!.baseWeight, 'active bias must inflate the event weight');

    const first = selectNewsEvent(config.events, state, config, () => 0);
    assert(first !== null, 'selection with rand=0 must return an event');
  });

  await test('renderHeadline substitutes {company}/{sector} slots', () => {
    const out = renderHeadline('[속보] {company} {sector} 지수 급락', {
      company: '삼성전자',
      sector: 'semiconductor',
    });
    assertEqual(out, '[속보] 삼성전자 semiconductor 지수 급락', 'slots must be substituted');
  });

  await test('chain fires after its configured tick delay', () => {
    const before = ctx.sectors.getIndices().technology;
    const event: NewsEvent = {
      id: 'test_chain',
      headlineVariants: ['테스트'],
      baseWeight: 1,
      effects: {},
      chain: [{ after: 2, effects: { 'sector.technology': -0.5 } }],
    };
    ctx.intel.fireEvent(event);
    ctx.intel.processPendingChain();
    assertClose(ctx.sectors.getIndices().technology, before, 1e-9, 'chain must not fire early');
    ctx.intel.processPendingChain();
    assert(
      ctx.sectors.getIndices().technology < before,
      'chained effect must apply after the delay'
    );
  });

  await test('company bankruptcy triggers sector contagion', () => {
    const sector = ctx.companies.getAllCompanies()[0].sectors[0];
    const before = ctx.sectors.getIndices()[sector];
    ctx.sectors.onCompanyBankrupt([sector]);
    assert(ctx.sectors.getIndices()[sector] < before, 'sector index must drop on bankruptcy');
  });
}

async function runImageAxisTests(ctx: GameContext, companyId: string): Promise<void> {
  await test('brand multiplier scales 0/50/100 within [min, max]', () => {
    assertClose(computeBrandMultiplier(0, 0.6, 1.4), 0.6, 1e-9, 'brand 0 → min');
    assertClose(computeBrandMultiplier(50, 0.6, 1.4), 1.0, 1e-9, 'brand 50 → midpoint');
    assertClose(computeBrandMultiplier(100, 0.6, 1.4), 1.4, 1e-9, 'brand 100 → max');
  });

  await test('low credibility widens the price volatility clamp', () => {
    const neutral = computeVolatilityFactor(50, 50, 0.6);
    const bad = computeVolatilityFactor(0, 50, 0.6);
    const good = computeVolatilityFactor(100, 50, 0.6);
    assertClose(neutral, 1.0, 1e-9, 'neutral credibility → factor 1');
    assert(bad > neutral, 'low credibility → wider clamp (more volatile)');
    assert(good < neutral, 'high credibility → tighter clamp (less volatile)');
  });

  await test('low credibility lowers the governance pass factor', () => {
    const neutral = computeGovernancePassFactor(50, 50, 1.0);
    const bad = computeGovernancePassFactor(0, 50, 1.0);
    const good = computeGovernancePassFactor(100, 50, 1.0);
    assertClose(neutral, 1.0, 1e-9, 'neutral credibility → factor 1');
    assert(bad < neutral, 'low credibility → harder to pass');
    assert(good > neutral, 'high credibility → easier to pass');
  });

  await test('low credibility raises the rumor fake rate', () => {
    const neutral = computeRumorFakeRate(0.2, 50, 50, 0.8);
    const bad = computeRumorFakeRate(0.2, 0, 50, 0.8);
    const good = computeRumorFakeRate(0.2, 100, 50, 0.8);
    assertClose(neutral, 0.2, 1e-9, 'neutral credibility → base rate');
    assert(bad > neutral, 'low credibility → more fake rumors');
    assert(good < neutral, 'high credibility → fewer fake rumors');
  });

  await test('seed company exposes both image axes', () => {
    const company = ctx.companies.getCompany(companyId)!;
    assert(typeof company.stats.brand === 'number', 'brand axis must exist');
    assert(
      typeof company.stats.managementCredibility === 'number',
      'management credibility axis must exist'
    );
  });
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  closeDb();
  process.exitCode = 1;
});

