import { initDb, runMigrations, ensureSystemAccounts, getDb, SYSTEM_ACCOUNTS } from '../db';
import { bootstrapGame } from '../core/bootstrap';
import { GameContext } from '../api/context';
import { assert, assertEqual, assertThrows, test, summarize } from './harness';

async function setup(): Promise<GameContext> {
  initDb(':memory:');
  runMigrations();
  ensureSystemAccounts();
  return bootstrapGame();
}

function newCharacter(ctx: GameContext, name: string) {
  const userId = ctx.players.createUser(`${name}-${Math.random().toString(36).slice(2, 8)}`);
  return ctx.players.createCharacter(userId, name);
}

async function main(): Promise<void> {
  console.log('Stock Survival — server test suite\n');
  const ctx = await setup();
  const companyId = ctx.companies.getAllCompanies()[0].id;

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

  process.exit(summarize());
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

main().catch((err) => {
  console.error('test runner crashed:', err);
  process.exit(1);
});

