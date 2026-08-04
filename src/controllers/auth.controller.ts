import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';
import * as adminAuthService from '../services/adminAuth.service.js';

/**
 * Backs `POST /v1/admin/login` — verifies an admin's email/password and returns
 * a fresh access token plus a 30-day refresh token alongside the admin's profile.
 */
export const login = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const { accessToken, refreshToken, admin } = await adminAuthService.login(email, password);

  res.status(200).json({
    success: true,
    message: 'Login successful.',
    code: 200,
    data: { admin },
    accessToken,
    refreshToken,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `POST /v1/admin/refresh` — exchanges a valid refresh token for a new
 * access token, without rotating or revoking the refresh token itself.
 */
export const refresh = catchAsync(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  const { accessToken, admin } = await adminAuthService.refreshAccessToken(refreshToken);

  res.status(200).json({
    success: true,
    message: 'Access token refreshed.',
    code: 200,
    data: { admin },
    accessToken,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs the admin logout endpoint — invalidates the current access token and
 * the supplied refresh token so neither can be used again.
 */
export const logout = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { refreshToken } = req.body;
  await adminAuthService.logout(req.token as string, req.user.exp, refreshToken);

  res.status(200).json({
    success: true,
    message: 'Logged out successfully.',
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `GET /v1/admin/profile` — returns the authenticated admin's own profile
 * from `admin_users`, identified by the JWT payload's `id`.
 */
export const getProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const admin = await adminAuthService.getProfile(req.user.id);

  res.status(200).json({
    success: true,
    message: 'Profile retrieved.',
    code: 200,
    data: { admin },
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `PATCH /v1/admin/profile` — updates the authenticated admin's name and/or
 * email in `admin_users` and returns the updated profile.
 */
export const changeProfile = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { name, email } = req.body;
  const admin = await adminAuthService.changeProfile(req.user.id, { name, email });

  res.status(200).json({
    success: true,
    message: 'Profile updated.',
    code: 200,
    data: { admin },
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `POST /v1/admin/change/password` — verifies the admin's current password
 * and, if it matches, updates `admin_users.password_hash` to the new one.
 */
export const changePassword = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  await adminAuthService.changePassword(req.user.id, currentPassword, newPassword);

  res.status(200).json({
    success: true,
    message: 'Password changed successfully.',
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `POST /v1/admin/forgot/password` — looks up the admin by phone and, if
 * found, sends a 6-digit reset code over WhatsApp; always responds success to avoid leaking which phones are registered.
 */
export const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const { phone } = req.body;
  await adminAuthService.forgotPassword(phone);

  res.status(200).json({
    success: true,
    message: 'If that phone number is registered, a reset code has been sent via WhatsApp.',
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `POST /v1/admin/reset/password` — validates the WhatsApp-delivered reset
 * code for the given phone and, if it's correct and unexpired, sets the new password.
 */
export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const { phone, code, newPassword } = req.body;
  await adminAuthService.resetPassword(phone, code, newPassword);

  res.status(200).json({
    success: true,
    message: 'Password reset successfully.',
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});
