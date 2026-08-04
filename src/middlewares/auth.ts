import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { ApiError } from '../utils/ApiError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { isTokenRevoked } from '../services/session.service.js';

export interface AuthenticatedRequest extends Request {
  user?: any;
  token?: string;
}

/**
 * Verifies the bearer JWT on an incoming request, rejecting missing, malformed,
 * expired, refresh-typed, or revoked tokens, and attaches the decoded payload
 * and raw token to the request when valid.
 */
async function verifyToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return next(new ApiError(401, 'Unauthorized. Missing token.'));
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return next(new ApiError(401, 'Unauthorized. Invalid token format.'));
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, config.jwt.secret) as any;
  } catch {
    return next(new ApiError(401, 'Unauthorized. Invalid or expired token.'));
  }

  if (decoded.type === 'refresh') {
    return next(new ApiError(401, 'Unauthorized. Invalid token type.'));
  }

  if (await isTokenRevoked(token)) {
    return next(new ApiError(401, 'Unauthorized. Token has been revoked.'));
  }

  req.user = decoded;
  req.token = token;
  next();
}

export const authMiddleware = catchAsync(verifyToken);
