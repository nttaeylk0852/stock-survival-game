import { getDb } from '../../db';
import { GameModule } from '../../core/module-registry';
import { PlayersModule } from './index';
import { OrderBookModule } from '../market/orderbook';

export interface RankingRow {
  characterId: string;
  name: string;
  netWorth: number;
}

export interface BoardRow extends RankingRow {
  rank: number;
}

export interface RankForResult {
  rank: number;
  netWorth: number;
  total: number;
  board: BoardRow[];
}

/**
 * 시즌 순자산 랭킹 (§묶음 11).
 * 살아있는 캐릭터의 지금 순자산 + 내 등수. 테이블·영구보드·뉴비보드 없음.
 */
export class RankingModule implements GameModule {
  name = 'players/ranking';

  constructor(private players: PlayersModule, private orderBook: OrderBookModule) {}

  init(): void {}

  /** is_alive=1, netWorth 내림차순, 동점이면 created_at 오름차순. */
  listLive(): RankingRow[] {
    const db = getDb();
    const rows = db
      .prepare(`SELECT id, name, created_at FROM characters WHERE is_alive = 1`)
      .all() as { id: string; name: string; created_at: number }[];

    return rows
      .map((row) => ({
        characterId: row.id,
        name: row.name,
        netWorth: this.orderBook.getNetWorth(row.id),
        createdAt: row.created_at,
      }))
      .sort((a, b) => b.netWorth - a.netWorth || a.createdAt - b.createdAt)
      .map(({ characterId, name, netWorth }) => ({ characterId, name, netWorth }));
  }

  rankFor(characterId: string): RankForResult {
    const character = this.players.getCharacter(characterId);
    if (!character || !character.isAlive) throw new Error('Character not alive');

    const board = this.listLive().map((row, index) => ({ ...row, rank: index + 1 }));
    const me = board.find((row) => row.characterId === characterId);
    if (!me) throw new Error('Character not alive');

    return { rank: me.rank, netWorth: me.netWorth, total: board.length, board };
  }
}
