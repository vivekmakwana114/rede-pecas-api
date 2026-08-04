import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';
import {
  AdminUser,
  getAdminByEmail,
  getAdminByPhone,
  getAdminById,
  updateAdminProfile,
  updateAdminPassword,
  setResetCode,
  clearResetCode,
} from '../models/adminUser.model.js';
import { sendWhatsAppMessage } from './whatsapp.service.js';
import { revokeToken, isTokenRevoked } from './session.service.js';
import { t } from '../i18n/messages.js';

const RESET_CODE_TTL_MINUTES = 10;

export interface AdminProfile {
  id: number;
  name: string;
  email: string;
  phone: string;
}

/**
 * Maps a raw admin_users DB row down to the public profile shape
 * (id, name, email, phone) returned to API callers.
 */
function toProfile(admin: AdminUser): AdminProfile {
  return { id: admin.id, name: admin.name, email: admin.email, phone: admin.phone };
}

/**
 * Signs a short-lived JWT access token for an admin, embedding
 * their id, email and a fixed 'admin' role claim.
 */
function signAccessToken(admin: AdminUser): string {
  return jwt.sign(
    { id: admin.id, email: admin.email, role: 'admin' },
    config.jwt.secret,
    { expiresIn: `${config.jwt.accessExpirationMinutes}m` }
  );
}

/**
 * Signs a long-lived JWT refresh token for an admin, marked with
 * type: 'refresh' so authMiddleware can reject it as a bearer token elsewhere.
 */
function signRefreshToken(admin: AdminUser): string {
  return jwt.sign(
    { id: admin.id, email: admin.email, role: 'admin', type: 'refresh' },
    config.jwt.secret,
    { expiresIn: `${config.jwt.refreshExpirationDays}d` }
  );
}

/**
 * Authenticates an admin by email/password and, on success, issues a
 * fresh access token and refresh token pair alongside their profile.
 */
export async function login(
  email: string,
  password: string
): Promise<{ accessToken: string; refreshToken: string; admin: AdminProfile }> {
  const admin = await getAdminByEmail(email.toLowerCase().trim());
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    throw new ApiError(401, 'Incorrect email or password.');
  }

  return {
    accessToken: signAccessToken(admin),
    refreshToken: signRefreshToken(admin),
    admin: toProfile(admin),
  };
}

/**
 * Verifies a refresh token (signature, type, and revocation status) and
 * exchanges it for a brand-new access token, without rotating the refresh token itself.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; admin: AdminProfile }> {
  let decoded: any;
  try {
    decoded = jwt.verify(refreshToken, config.jwt.secret);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token.');
  }

  if (decoded.type !== 'refresh') {
    throw new ApiError(401, 'Invalid or expired refresh token.');
  }

  if (await isTokenRevoked(refreshToken)) {
    throw new ApiError(401, 'Invalid or expired refresh token.');
  }

  const admin = await getAdminById(decoded.id);
  if (!admin) throw new ApiError(401, 'Invalid or expired refresh token.');

  return { accessToken: signAccessToken(admin), admin: toProfile(admin) };
}

/**
 * Logs an admin out by revoking their access token, and their refresh
 * token too if one was supplied, so neither can be reused afterward.
 */
export async function logout(token: string, tokenExp: number, refreshToken?: string): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await revokeToken(token, tokenExp - nowSeconds);

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, config.jwt.secret) as any;
      if (decoded.type === 'refresh' && typeof decoded.exp === 'number') {
        await revokeToken(refreshToken, decoded.exp - nowSeconds);
      }
    } catch {
      // no-op
    }
  }
}

/**
 * Looks up an admin by id and returns their public profile, throwing
 * a 404 ApiError if the account no longer exists.
 */
export async function getProfile(adminId: number): Promise<AdminProfile> {
  const admin = await getAdminById(adminId);
  if (!admin) throw new ApiError(404, 'Admin account not found.');
  return toProfile(admin);
}

/**
 * Updates an admin's editable profile fields (name and/or email), rejecting
 * an email change if it's already taken by a different admin account.
 */
export async function changeProfile(
  adminId: number,
  fields: { name?: string; email?: string }
): Promise<AdminProfile> {
  const admin = await getAdminById(adminId);
  if (!admin) throw new ApiError(404, 'Admin account not found.');

  const updates: { name?: string; email?: string } = {};
  if (fields.name) updates.name = fields.name.trim();
  if (fields.email) {
    const email = fields.email.toLowerCase().trim();
    const existing = await getAdminByEmail(email);
    if (existing && existing.id !== adminId) {
      throw new ApiError(409, 'That email is already in use by another admin account.');
    }
    updates.email = email;
  }

  await updateAdminProfile(adminId, updates);
  return getProfile(adminId);
}

/**
 * Changes an admin's password after verifying their current password,
 * rejecting the change if the new password is identical to the old one.
 */
export async function changePassword(
  adminId: number,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const admin = await getAdminById(adminId);
  if (!admin) throw new ApiError(404, 'Admin account not found.');

  if (!(await bcrypt.compare(currentPassword, admin.password_hash))) {
    throw new ApiError(401, 'Current password is incorrect.');
  }

  if (newPassword === currentPassword) {
    throw new ApiError(400, 'New password must be different from your current password.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updateAdminPassword(adminId, passwordHash);
}

/**
 * Starts the password-reset flow for an admin identified by phone number:
 * generates a 6-digit code, stores its hash with a TTL, and sends it over WhatsApp.
 */
export async function forgotPassword(phone: string): Promise<void> {
  const admin = await getAdminByPhone(phone);
  if (!admin) return;

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000);

  await setResetCode(admin.id, codeHash, expiresAt);

  const sendTo = admin.phone.replace(/\D/g, '');

  try {
    await sendWhatsAppMessage(sendTo, t.adminAuth.resetCode(code));
  } catch (error: any) {
    logger.error(`Failed to send admin password-reset code to ${sendTo}`, error);
  }
}

/**
 * Completes the password-reset flow: validates the code sent via WhatsApp
 * against its stored hash and expiry, then sets the new password.
 */
export async function resetPassword(phone: string, code: string, newPassword: string): Promise<void> {
  const admin = await getAdminByPhone(phone);
  if (!admin || !admin.reset_code_hash || !admin.reset_code_expires_at) {
    throw new ApiError(400, 'Invalid or expired reset code.');
  }

  if (new Date(admin.reset_code_expires_at).getTime() < Date.now()) {
    await clearResetCode(admin.id);
    throw new ApiError(400, 'Invalid or expired reset code.');
  }

  if (!(await bcrypt.compare(code, admin.reset_code_hash))) {
    throw new ApiError(400, 'Invalid or expired reset code.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updateAdminPassword(admin.id, passwordHash);
}
