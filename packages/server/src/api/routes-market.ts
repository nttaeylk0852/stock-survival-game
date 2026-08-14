import { Router } from 'express';
import { CompanyStats, WorldState } from '@stock-survival/shared';
import { GameContext } from './context';
import { ok, handle } from './http';

/** Attaches company / trading / survival / intel / governance / world routes. */
export function attachMarketRoutes(router: Router, ctx: GameContext): Router {
  // ---------- companies ----------
  router.get(
    '/companies',
    handle((_req, res) => {
      ok(res, ctx.companies.getAllCompanies());
    })
  );

  router.get(
    '/companies/:id',
    handle((req, res) => {
      const company = ctx.companies.getCompany(req.params.id);
      if (!company) throw new Error('Company not found');
      ok(res, {
        company,
        fairPrice: ctx.companies.getFairPrice(company.id),
        priceHistory: ctx.companies.getPriceHistory(company.id),
        openOrders: ctx.orderBook.getOpenOrders(company.id),
        userInfluence: ctx.influence.getUserInfluence(company.id),
      });
    })
  );

  // ---------- trading ----------
  router.post(
    '/trade',
    handle((req, res) => {
      const { characterId, companyId, side, quantity, limitPrice } = req.body as {
        characterId?: string;
        companyId?: string;
        side?: 'buy' | 'sell';
        quantity?: number;
        limitPrice?: number;
      };
      if (!characterId || !companyId || !side || !quantity) {
        throw new Error('characterId, companyId, side and quantity are required');
      }
      if (side !== 'buy' && side !== 'sell') throw new Error('side must be buy or sell');

      const character = ctx.players.getCharacter(characterId);
      if (!character || !character.isAlive) throw new Error('Character not alive');

      const result = ctx.amm.trade(characterId, companyId, side, quantity, limitPrice);
      ok(res, {
        ...result,
        balance: ctx.ledger.getBalance(character.accountId),
        shares: ctx.orderBook.getPortfolioEntry(characterId, companyId).shares,
      });
    })
  );

  router.delete(
    '/orders/:id',
    handle((req, res) => {
      const { characterId } = req.body as { characterId?: string };
      if (!characterId) throw new Error('characterId is required');
      ctx.orderBook.cancelOrder(req.params.id, characterId);
      ok(res, { cancelled: true, orderId: req.params.id });
    })
  );

  // ---------- survival ----------
  router.post(
    '/survival/eat',
    handle((req, res) => {
      const { characterId } = req.body as { characterId?: string };
      if (!characterId) throw new Error('characterId is required');
      ok(res, ctx.survival.eat(characterId));
    })
  );

  router.post(
    '/survival/rest',
    handle((req, res) => {
      const { characterId } = req.body as { characterId?: string };
      if (!characterId) throw new Error('characterId is required');
      ok(res, ctx.survival.rest(characterId));
    })
  );

  return attachIntelRoutes(router, ctx);
}

/** Attaches intel / governance / world routes. */
function attachIntelRoutes(router: Router, ctx: GameContext): Router {
  // ---------- intel ----------
  router.get(
    '/intel',
    handle((req, res) => {
      const characterId = req.query.characterId as string | undefined;
      if (!characterId) throw new Error('characterId query param is required');
      // isFake stays hidden until the item is purchased.
      const items = ctx.intel.getAvailableIntel(characterId).map((item) => ({
        id: item.id,
        title: item.title,
        companyId: item.companyId,
        cost: item.cost,
        createdAt: item.createdAt,
      }));
      ok(res, items);
    })
  );

  router.post(
    '/intel/:id/purchase',
    handle((req, res) => {
      const { characterId } = req.body as { characterId?: string };
      if (!characterId) throw new Error('characterId is required');
      ok(res, ctx.intel.purchaseIntel(characterId, req.params.id));
    })
  );

  // ---------- governance ----------
  router.get(
    '/agendas',
    handle((_req, res) => {
      ok(res, ctx.governance.getOpenAgendas());
    })
  );

  router.post(
    '/agendas',
    handle((req, res) => {
      const { companyId, statKey, delta, deadlineMinutes } = req.body as {
        companyId?: string;
        statKey?: keyof CompanyStats;
        delta?: number;
        deadlineMinutes?: number;
      };
      if (!companyId || !statKey || delta === undefined) {
        throw new Error('companyId, statKey and delta are required');
      }
      ok(res, ctx.governance.createAgenda(companyId, statKey, delta, deadlineMinutes ?? 60));
    })
  );

  router.post(
    '/agendas/:id/vote',
    handle((req, res) => {
      const { characterId, vote } = req.body as { characterId?: string; vote?: 'for' | 'against' };
      if (!characterId || !vote) throw new Error('characterId and vote are required');
      if (vote !== 'for' && vote !== 'against') throw new Error('vote must be for or against');
      ctx.governance.vote(req.params.id, characterId, vote);
      ok(res, ctx.governance.getAgenda(req.params.id));
    })
  );

  // ---------- world ----------
  router.get(
    '/world',
    handle((_req, res) => {
      const state: WorldState = {
        gameTime: ctx.tickLoop.getGameTime(),
        tickCount: ctx.tickLoop.getTickCount(),
        macro: ctx.macro.getState(),
        season: ctx.season.getSeasonInfo(),
      };
      ok(res, { ...state, sectors: ctx.sectors.getIndices() });
    })
  );

  return router;
}
