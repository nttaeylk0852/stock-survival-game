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
