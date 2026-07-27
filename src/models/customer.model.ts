import { db } from '../config/db.js';

export interface Customer {
  phone: string;
  name: string | null;
  nif: string | null;
  address: string | null;
  email: string | null;
  registration_status: string;
  first_contact_at: Date;
  last_contact_at: Date;
  registered_at: Date | null;
  contact_count: number;
  active: boolean;
  needs_review: boolean;
  needs_review_reason: string | null;
}

/**
 * Fetches the `customers` row for a phone, then bumps `last_contact_at` and
 * increments `contact_count` on it — called whenever an inbound WhatsApp message arrives from a known customer.
 */
export async function getAndUpdateCustomer(phone: string): Promise<Customer | null> {
  const { rows } = await db.query(
    `SELECT * FROM customers WHERE phone = $1`,
    [phone]
  );
  if (!rows.length) return null;

  await db.query(
    `UPDATE customers
     SET last_contact_at = NOW(),
         contact_count = contact_count + 1
     WHERE phone = $1`,
    [phone]
  );

  return rows[0];
}

/**
 * Plain lookup of the `customers` row for a phone, with no side effects
 * (unlike `getAndUpdateCustomer`).
 */
export async function getCustomerByPhone(phone: string): Promise<Customer | null> {
  const { rows } = await db.query(
    `SELECT * FROM customers WHERE phone = $1`,
    [phone]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Inserts a new `customers` row for a first-time phone with the given starting
 * registration status, doing nothing if the phone already has a row.
 */
export async function createCustomerPreRegistration(phone: string, registrationStatus: string): Promise<void> {
  await db.query(
    `INSERT INTO customers (phone, registration_status, first_contact_at, last_contact_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (phone) DO NOTHING`,
    [phone, registrationStatus]
  );
}

/**
 * Dynamically updates whichever `Customer` fields are present in `fields` on
 * the `customers` row for the given phone. No-ops if `fields` is empty.
 */
export async function updateCustomer(phone: string, fields: Partial<Customer>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;

  const setClauses = keys.map((key, index) => `"${key}" = $${index + 2}`).join(', ');
  const values = keys.map((key) => (fields as any)[key]);

  await db.query(
    `UPDATE customers SET ${setClauses} WHERE phone = $1`,
    [phone, ...values]
  );
}

export interface CustomerListParams {
  page: number;
  limit: number;
  q?: string;
}

export interface CustomerVehicleSummary {
  make: string | null;
  model: string | null;
  year: string | null;
  plate: string | null;
}

export interface CustomerWithStats extends Customer {
  orders_count: number;
  total_spent: string;
  vehicles: CustomerVehicleSummary[];
}

const CUSTOMER_STATS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS orders_count,
      COALESCE(SUM(unit_price + COALESCE(service_price, 0)) FILTER (WHERE status = 'approved'), 0) AS total_spent
    FROM orders o
    WHERE o.customer_phone = c.phone
  ) order_stats ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(
      json_build_object('make', v.make, 'model', v.model, 'year', v.year, 'plate', v.license_plate)
      ORDER BY v.created_at
    ) AS vehicles
    FROM vehicles v
    WHERE v.phone = c.phone AND (v.status IS NULL OR v.status = 'complete')
  ) vehicle_stats ON true
`;
const CUSTOMER_STATS_COLUMNS = `c.*, order_stats.orders_count, order_stats.total_spent, COALESCE(vehicle_stats.vehicles, '[]'::json) AS vehicles`;

/**
 * Returns a paginated page of active `customers` rows (optionally filtered by
 * name/phone/NIF via `q`), each joined with its order stats and confirmed vehicles from `orders`/`vehicles`,
 * plus the total matching row count.
 */
export async function getAllCustomers({ page, limit, q }: CustomerListParams): Promise<{ customers: CustomerWithStats[]; total: number }> {
  const offset = (page - 1) * limit;
  const filters = ['c.active = true'];
  const values: unknown[] = [];

  if (q) {
    values.push(`%${q}%`);
    filters.push(`(c.name ILIKE $${values.length} OR c.phone ILIKE $${values.length} OR c.nif ILIKE $${values.length})`);
  }

  const where = `WHERE ${filters.join(' AND ')}`;

  const [{ rows: customers }, { rows: countRows }] = await Promise.all([
    db.query(
      `SELECT ${CUSTOMER_STATS_COLUMNS}
       FROM customers c
       ${CUSTOMER_STATS_JOIN}
       ${where}
       ORDER BY c.last_contact_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    ),
    db.query(`SELECT COUNT(*)::int AS count FROM customers c ${where}`, values),
  ]);

  return { customers, total: countRows[0].count };
}

/**
 * Looks up one active `customers` row by phone, joined with its order stats
 * and confirmed vehicles the same way `getAllCustomers` does.
 */
export async function getActiveCustomerByPhone(phone: string): Promise<CustomerWithStats | null> {
  const { rows } = await db.query(
    `SELECT ${CUSTOMER_STATS_COLUMNS}
     FROM customers c
     ${CUSTOMER_STATS_JOIN}
     WHERE c.phone = $1 AND c.active = true`,
    [phone]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Soft-deletes a customer by flipping `customers.active` to false for the given
 * phone. Returns whether a row was actually changed (false if already inactive or missing).
 */
export async function deactivateCustomer(phone: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE customers SET active = false WHERE phone = $1 AND active = true`,
    [phone]
  );
  return (rowCount ?? 0) > 0;
}
