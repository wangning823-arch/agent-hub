import { Request, Response, NextFunction } from 'express';

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3002',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3002',
];

export default () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-access-token, x-project-id');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
  };
};
