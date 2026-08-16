import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@stock-survival/shared';

/** IP당 고정 윈도우 카운터. 프로세스 메모리만 쓴다. */
export function rateLimit(windowMs: number, max: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'GET') { next(); return; }

    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > max) {
      const body: ApiResponse = { ok: false, error: 'Too many requests' };
      res.status(429).json(body);
      return;
    }
    next();
  };
}
