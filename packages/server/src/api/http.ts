import { Request, Response } from 'express';
import { ApiResponse } from '@stock-survival/shared';

/** Send a successful ApiResponse envelope. */
export function ok<T>(res: Response, data: T): void {
  const body: ApiResponse<T> = { ok: true, data };
  res.json(body);
}

/** Send a failed ApiResponse envelope. */
export function fail(res: Response, error: unknown, status = 400): void {
  const body: ApiResponse = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  res.status(status).json(body);
}

/** Wrap a sync handler so thrown errors become ApiResponse errors. */
export function handle(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try {
      fn(req, res);
    } catch (err) {
      fail(res, err);
    }
  };
}

/** 토큰을 확인한 뒤 핸들러를 부른다. 실패 시 401/403. */
export function handleAuth(
  getCharacterId: (req: Request) => string | undefined,
  verify: (characterId: string, token: string | undefined) => boolean,
  fn: (req: Request, res: Response) => void
) {
  return (req: Request, res: Response): void => {
    try {
      const characterId = getCharacterId(req);
      if (!characterId) throw new Error('characterId is required');
      const token = req.header('x-character-token') ?? undefined;
      if (!token) {
        fail(res, new Error('Missing character token'), 401);
        return;
      }
      if (!verify(characterId, token)) {
        fail(res, new Error('Character token mismatch'), 403);
        return;
      }
      fn(req, res);
    } catch (err) {
      fail(res, err);
    }
  };
}
