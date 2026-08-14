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
      ok(res, { character, balance: ctx.ledger.getBalance(character.accountId) });
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
      ok(res, { balance, stockValue, netWorth: balance + stockValue, entries });
    })
  );

  return attachMarketRoutes(router, ctx);
}
