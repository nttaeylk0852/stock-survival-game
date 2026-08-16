import http from 'http';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { ApiResponse } from '@stock-survival/shared';
import { initDb, runMigrations, ensureSystemAccounts } from './db';
import { bootstrapGame } from './core/bootstrap';
import { createRouter } from './api/routes';
import { GameWebSocketServer } from './api/ws';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? './data/game.db';

async function main(): Promise<void> {
  // 1. Database
  initDb(DB_PATH);
  runMigrations();
  ensureSystemAccounts();
  console.log(`[db] ready at ${DB_PATH}`);

  // 2. Game modules
  const ctx = await bootstrapGame();
  console.log(`[game] ${ctx.companies.getAllCompanies().length} companies loaded`);

  // 3. HTTP server
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    const body: ApiResponse<{ status: string; tick: number }> = {
      ok: true,
      data: { status: 'up', tick: ctx.tickLoop.getTickCount() },
    };
    res.json(body);
  });

  app.use(express.static(path.resolve(__dirname, '../../../packages/web/public')));
  app.use('/api', createRouter(ctx));

  app.use((_req, res) => {
    const body: ApiResponse = { ok: false, error: 'Not found' };
    res.status(404).json(body);
  });

  const server = http.createServer(app);

  // 4. WebSocket
  const wsServer = new GameWebSocketServer(server, ctx);
  ctx.intel.onRumor((item) => {
    wsServer.broadcastNews(item.title, item.body, item.companyId);
  });
  ctx.intel.onNews((news) => {
    wsServer.broadcastNews(news.title, news.body, news.companyId);
  });
  ctx.sectors.onBankruptcy((sectors) => {
    wsServer.broadcastNews('[Breaking] Bankruptcy contagion', `${sectors.join(', ')} sector indices fall`, null);
  });

  // 5. Tick loop
  ctx.tickLoop.start();
  console.log(
    `[tick] started (1 game minute per ${ctx.config.world.realSecondsPerGameMinute}s real time)`
  );

  server.listen(PORT, () => {
    console.log(`[server] http://localhost:${PORT} | ws://localhost:${PORT}/ws`);
  });

  const shutdown = (): void => {
    console.log('\n[server] shutting down...');
    ctx.tickLoop.stop();
    wsServer.close();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] fatal error:', err);
  process.exit(1);
});
