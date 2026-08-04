import { db } from '../config/db.js';

export interface AdminAlert {
  id: number;
  type: string;
  order_number: string | null;
  message: string;
  read_at: Date | null;
  created_at: Date;
}

/**
 * Inserts a new row into `admin_alerts` for the in-panel notification feed —
 * called on payment-proof-received and in-person-payment-requested events.
 */
export async function createAlert(type: string, orderNumber: string, message: string): Promise<void> {
  await db.query(
    `INSERT INTO admin_alerts (type, order_number, message) VALUES ($1, $2, $3)`,
    [type, orderNumber, message]
  );
}

/**
 * Fetches the newest 100 rows from `admin_alerts`, most recent first, for the
 * admin panel's alert feed.
 */
export async function getAlerts(): Promise<AdminAlert[]> {
  const { rows } = await db.query(
    `SELECT * FROM admin_alerts ORDER BY created_at DESC LIMIT 100`
  );
  return rows;
}

/**
 * Stamps `read_at` on the given `admin_alerts` row so it's treated as
 * dismissed by the panel.
 */
export async function markAlertRead(id: number): Promise<void> {
  await db.query(`UPDATE admin_alerts SET read_at = NOW() WHERE id = $1`, [id]);
}
