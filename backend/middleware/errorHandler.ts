import { Request, Response, NextFunction } from 'express';

export default () => {
  return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Express] 未处理错误', err);
    res.status(500).json({ error: (err as any)?.message || 'internal_error' });
  };
};
