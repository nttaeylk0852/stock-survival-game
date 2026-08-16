import { Router } from 'express';
import { GameContext } from './context';
import { ok, handle } from './http';
import { attachMarketRoutes } from './routes-market';

export function createRouter(ctx: GameContext): Router {
  const router = Router();

  // ---------- users / characters ----------
  router.post(
    '/users',
    handle((req, res) => {
      const { username } = req.body as { username?: string };
      if (!username) throw new Error('username is required');

      const existing = ctx.players.getUserByUsername(username);
      if (existing) {
        ok(res, { userId: existing.id, username: existing.username, created: false });
        return;
      }
      const userId = ctx.players.createUser(username);
      ok(res, { userId, username, created: true });
    })
  );

  router.post(
    '/characters',
    handle((req, res) => {
      const { userId, name } = req.body as { userId?: string; name?: string };
      if (!userId || !name) throw new Error('userId and name are required');

      const character = ctx.players.createCharacter(userId, name);
      ok(res, { character, balance: ctx.ledger.getBalance(character.accountId) });
    })
  );

  router.get(
    '/characters/:id',
    handle((req, res) => {
      const character = ctx.players.getCharacter(req.params.id);
      if (!character) throw new Error('Character not found');
      ok(res, {
        character,
        balance: ctx.ledger.getBalance(character.accountId),
        job: ctx.jobs.getJob(req.params.id),
        netWorth: ctx.orderBook.getNetWorth(req.params.id),
      });
    })
  );

  router.get(
    '/characters/:id/portfolio',
    handle((req, res) => {
      const character = ctx.players.getCharacter(req.params.id);
      if (!character) throw new Error('Character not found');

      const entries = ctx.orderBook.getPortfolio(req.params.id).map((entry) => {
        const company = ctx.companies.getCompany(entry.companyId);
        const price = company?.currentPrice ?? 0;
        return {
          companyId: entry.companyId,
          companyName: company?.name ?? 'unknown',
          shares: entry.shares,
          currentPrice: price,
          value: entry.shares * price,
        };
      });

      const balance = ctx.ledger.getBalance(character.accountId);
      const stockValue = entries.reduce((sum, e) => sum + e.value, 0);
      ok(res, { balance, stockValue, netWorth: ctx.orderBook.getNetWorth(req.params.id), entries });
    })
  );

  router.get(
    '/characters/:id/orders',
    handle((req, res) => {
      const character = ctx.players.getCharacter(req.params.id);
      if (!character) throw new Error('Character not found');
      ok(res, { orders: ctx.orderBook.getOpenOrdersForCharacter(req.params.id) });
    })
  );

  // ---------- jobs ----------
  router.post(
    '/jobs',
    handle((req, res) => {
      const { characterId, kind } = req.body as { characterId?: string; kind?: 'regular' | 'parttime' };
      if (!characterId || !kind) throw new Error('characterId and kind are required');
      if (kind !== 'regular' && kind !== 'parttime') throw new Error('kind must be regular or parttime');
      const job = ctx.jobs.takeJob(characterId, kind, ctx.tickLoop.getGameTime().totalMinutes);
      ok(res, { job });
    })
  );

  router.delete(
    '/jobs',
    handle((req, res) => {
      const { characterId } = req.body as { characterId?: string };
      if (!characterId) throw new Error('characterId is required');
      ctx.jobs.quitJob(characterId);
      ok(res, { quit: true });
    })
  );

  // ---------- ranking ----------
  router.get(
    '/ranking',
    handle((req, res) => {
      const characterId = req.query.characterId as string | undefined;
      if (!characterId) {
        const board = ctx.ranking.listLive().map((row, index) => ({ rank: index + 1, ...row }));
        ok(res, { myRank: null, myNetWorth: null, total: board.length, board });
        return;
      }
      const result = ctx.ranking.rankFor(characterId);
      ok(res, {
        myRank: result.rank,
        myNetWorth: result.netWorth,
        total: result.total,
        board: result.board,
      });
    })
  );

  return attachMarketRoutes(router, ctx);
}
