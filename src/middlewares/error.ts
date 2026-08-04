import { Request, Response, NextFunction } from 'express';
import { config } from '../config/config.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Normalizes any thrown error into an ApiError before passing it on, so
 * downstream handling always deals with a consistent error shape.
 */
export function errorConverter(err: any, req: Request, res: Response, next: NextFunction) {
  let error = err;
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal Server Error';
    error = new ApiError(statusCode, message, false, err.stack);
  }
  next(error);
}

/**
 * Final error-handling middleware: logs the error, masks non-operational
 * production errors as a generic 500, and writes the standard error envelope
 * to the response.
 */
export function errorHandler(err: ApiError, req: Request, res: Response, _next: NextFunction) {
  let { statusCode, message } = err;
  if (config.env === 'production' && !err.isOperational) {
    statusCode = 500;
    message = 'Internal Server Error';
  }

  const logLine = `[Error Handler] ${statusCode} - ${message} - Stack: ${err.stack}`;
  if (err.isOperational && statusCode < 500) {
    logger.warn(logLine);
  } else {
    logger.error(logLine);
  }

  res.status(statusCode).json({
    success: false,
    message,
    code: statusCode,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
}
