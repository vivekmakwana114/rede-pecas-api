import { db } from '../config/db.js';

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  password_hash: string;
  reset_code_hash: string | null;
  reset_code_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Looks up a single row in `admin_users` by exact email match, used for the
 * admin login flow. Returns null if no matching account exists.
 */
export async function getAdminByEmail(email: string): Promise<AdminUser | null> {
  const { rows } = await db.query('SELECT * FROM admin_users WHERE email = $1', [email]);
  return rows.length ? rows[0] : null;
}

/**
 * Returns every row in `admin_users`, used to fan out WhatsApp admin-notification
 * pushes (stock confirmation, payment proof, in-person payment) to all staff accounts.
 */
export async function getAllAdmins(): Promise<AdminUser[]> {
  const { rows } = await db.query('SELECT * FROM admin_users');
  return rows;
}

/**
 * Looks up a row in `admin_users` by phone, comparing digits-only so formatting
 * differences don't matter — used to detect inbound WhatsApp messages from staff and for the phone-based password-reset flow.
 */
export async function getAdminByPhone(phone: string): Promise<AdminUser | null> {
  const digitsOnly = phone.replace(/\D/g, '');
  const { rows } = await db.query(
    "SELECT * FROM admin_users WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1",
    [digitsOnly]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Looks up a single row in `admin_users` by primary key id, used to resolve the
 * authenticated admin from a JWT payload.
 */
export async function getAdminById(id: number): Promise<AdminUser | null> {
  const { rows } = await db.query('SELECT * FROM admin_users WHERE id = $1', [id]);
  return rows.length ? rows[0] : null;
}

/**
 * Dynamically updates whichever of `name`/`email` are present in `fields` on the
 * `admin_users` row for the given id, stamping `updated_at`. No-ops if `fields` is empty.
 */
export async function updateAdminProfile(id: number, fields: Partial<Pick<AdminUser, 'name' | 'email'>>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;

  const setClauses = keys.map((key, index) => `"${key}" = $${index + 2}`).join(', ');
  const values = keys.map((key) => (fields as any)[key]);

  await db.query(
    `UPDATE admin_users SET ${setClauses}, updated_at = NOW() WHERE id = $1`,
    [id, ...values]
  );
}

/**
 * Sets a new `password_hash` on the `admin_users` row for the given id and
 * clears any pending reset code, used by both change-password and reset-password flows.
 */
export async function updateAdminPassword(id: number, passwordHash: string): Promise<void> {
  await db.query(
    `UPDATE admin_users
     SET password_hash = $2, reset_code_hash = NULL, reset_code_expires_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id, passwordHash]
  );
}

/**
 * Stores the hashed password-reset code and its expiry on the `admin_users` row
 * for the given id, part of the forgot-password WhatsApp flow.
 */
export async function setResetCode(id: number, codeHash: string, expiresAt: Date): Promise<void> {
  await db.query(
    `UPDATE admin_users SET reset_code_hash = $2, reset_code_expires_at = $3 WHERE id = $1`,
    [id, codeHash, expiresAt]
  );
}

/**
 * Clears any pending reset code/expiry on the `admin_users` row for the given
 * id, e.g. after a successful or abandoned password reset.
 */
export async function clearResetCode(id: number): Promise<void> {
  await db.query(
    `UPDATE admin_users SET reset_code_hash = NULL, reset_code_expires_at = NULL WHERE id = $1`,
    [id]
  );
}
