# Stock Survival Architecture

Text-based survival stock roguelike with deep economic simulation. Mobile client (Expo) + authoritative Node.js server.

## Prerequisites

- Node.js 20+
- Docker (optional, for PostgreSQL) OR use built-in SQLite for local dev

## Quick Start

```bash
npm install
npm run db:migrate   # create data/game.db
npm run dev:server   # http://localhost:3000
npm test             # run the server test suite
```

Server: `http://localhost:3000` | WebSocket: `ws://localhost:3000/ws`

## API

All responses use the `ApiResponse` envelope: `{ ok, data?, error? }`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness + current tick |
| POST | `/api/users` | Create (or fetch) a user by `username` |
| POST | `/api/characters` | Create a character (`userId`, `name`) |
| GET | `/api/characters/:id` | Character state + cash balance |
| GET | `/api/characters/:id/portfolio` | Holdings, stock value, net worth |
| GET | `/api/companies` | All companies |
| GET | `/api/companies/:id` | Detail + price history + open orders |
| POST | `/api/trade` | Trade (`limitPrice` omitted → AMM market order) |
| DELETE | `/api/orders/:id` | Cancel an open limit order |
| POST | `/api/survival/eat` | Eat (costs `mealCostBase × CPI`) |
| POST | `/api/survival/rest` | Rest (removes homeless status) |
| GET | `/api/intel?characterId=` | Unpurchased intel (truth stays hidden) |
| POST | `/api/intel/:id/purchase` | Buy intel and reveal `isFake` |
| GET | `/api/agendas` | Open shareholder agendas |
| POST | `/api/agendas` | Propose an agenda |
| POST | `/api/agendas/:id/vote` | Vote weighted by shares held |
| GET | `/api/world` | Game time, macro state, season, sector indices |

WebSocket messages (`WsMessage`): `world_state` (every tick), `company_prices` (every price tick), `news` (rumors, season end).

## Structure

- `config/` — balance tuning (edit JSON, not code)
- `packages/shared/` — shared TypeScript types
- `packages/server/` — game server
- `packages/mobile/` — Expo app
- `docs/modules/` — per-module docs for AI-assisted fixes
