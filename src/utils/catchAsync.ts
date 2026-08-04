import { Request, Response, NextFunction } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => unknown;

/**
 * Wraps an async Express handler so any rejected promise is forwarded to
 * `next`, sparing every route from a repeated try/catch.
 */
export const catchAsync = (fn: AsyncRequestHandler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch((err) => next(err));
};

export default catchAsync;
