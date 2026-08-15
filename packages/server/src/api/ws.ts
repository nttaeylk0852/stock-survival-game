import { Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { TickEvent, WorldState, WsMessage } from '@stock-survival/shared';
import { eventBus } from '../core/event-bus';
import { GameContext } from './context';

export class GameWebSocketServer {
  private wss: WebSocketServer;

  constructor(
    server: Server,
    private ctx: GameContext
  ) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (socket: WebSocket) => {
      // Send the current world snapshot right away so clients render immediately.
      this.send(socket, { type: 'world_state', payload: this.buildWorldState() });
      this.send(socket, {
        type: 'company_prices',
        payload: this.buildPricePayload(),
      });

      socket.on('error', (err) => {
        console.error('[ws] socket error:', err.message);
      });
    });

    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    eventBus.on('TICK', (_event: TickEvent) => {
      this.broadcast({ type: 'world_state', payload: this.buildWorldState() });
    });

    eventBus.on('PRICE_TICK', (_event: TickEvent) => {
      this.broadcast({ type: 'company_prices', payload: this.buildPricePayload() });
    });

    eventBus.on('SEASON_END', (_event: TickEvent) => {
      this.broadcast({
        type: 'news',
        payload: {
          title: 'Season ended',
          body: 'All characters were wiped. A new season has begun.',
          season: this.ctx.season.getSeasonInfo(),
        },
      });
    });
  }

  /** Push a freshly generated rumor to every connected client. */
  broadcastNews(title: string, body: string, companyId: string | null = null): void {
    this.broadcast({ type: 'news', payload: { title, body, companyId } });
  }

  broadcast(message: WsMessage): void {
    const raw = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  }

  getClientCount(): number {
    return this.wss.clients.size;
  }

  close(): void {
    this.wss.close();
  }

  private send(socket: WebSocket, message: WsMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private buildWorldState(): WorldState {
    return {
      gameTime: this.ctx.tickLoop.getGameTime(),
      tickCount: this.ctx.tickLoop.getTickCount(),
      macro: this.ctx.macro.getState(),
      season: this.ctx.season.getSeasonInfo(),
      market: this.ctx.marketSession.getState(),
    };
  }

  private buildPricePayload(): { id: string; name: string; price: number; status: string }[] {
    return this.ctx.companies.getAllCompanies().map((company) => ({
      id: company.id,
      name: company.name,
      price: company.currentPrice,
      status: company.status,
    }));
  }
}
