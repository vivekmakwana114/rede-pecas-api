import { db } from '../config/db.js';
import { Product } from './product.model.js';

export interface OrderInfo {
  number: string;
  customer: string;
  part: string;
  reference: string;
  supplier: string;
  price: number;
  quantity: number;
  created_at: Date;
  updated_at?: Date;
  time: string;
  has_proof: boolean;
  payment_proof_media_type?: string | null;
  payment_method?: string;
  requires_proof?: boolean;
  service_name?: string;
  service_price?: number;
  service_offered?: boolean;
  stock_status?: 'pending' | 'unavailable' | 'confirmed';
  verifying?: boolean;
  reviewable?: boolean;
  items?: OrderItemEntry[] | null;
}

export interface OrderItemEntry {
  itemId: number;
  productId: number;
  productName: string;
  reference: string;
  supplierId: number;
  supplierName: string;
  quantity: number;
  unitPrice: number;
  serviceName: string | null;
  servicePrice: number | null;
  // 'unavailable' means admin rejected it and it hasn't been resolved yet —
  // the customer still needs to be offered an alternative (or skip). Once
  // the customer explicitly skips, it becomes 'declined' — a distinct,
  // terminal state that (unlike 'unavailable') never triggers another
  // alternative-search round.
  availabilityStatus: 'pending' | 'available' | 'unavailable' | 'declined';
  // productIds already offered and rejected/skipped for this item slot, so a
  // later alternative search never re-offers the same one twice.
  excludedProductIds?: number[];
}

const STOCK_STATUS_CASE_SQL = `
    CASE
      WHEN o.status IN ('awaiting_payment', 'awaiting_stock_confirmation') THEN 'pending'
      WHEN o.status = 'stock_unavailable' THEN 'unavailable'
      ELSE 'confirmed'
    END AS stock_status`;

// Multi-item ("basket") orders keep product_id/unit_price/service_name/
// service_price NULL and store their line items in `items` instead (see
// db/schema.sql). These CASE expressions let every admin-facing query fall
// back transparently to the legacy single-product columns when `items` is
// NULL, so single-product orders (the overwhelming majority) are completely
// unaffected — only orders.items IS NOT NULL ever takes the multi-item branch.
const ITEMS_PRICE_CASE_SQL = `
    CASE
      WHEN o.items IS NOT NULL THEN (
        SELECT COALESCE(SUM((elem->>'unitPrice')::numeric + COALESCE((elem->>'servicePrice')::numeric, 0)), 0)
        FROM jsonb_array_elements(o.items) elem
        WHERE elem->>'availabilityStatus' = 'available'
      )
      ELSE (o.unit_price + COALESCE(o.service_price, 0))
    END AS price`;

const ITEMS_PART_CASE_SQL = `
    CASE
      WHEN o.items IS NOT NULL THEN
        (o.items->0->>'productName') ||
        CASE WHEN jsonb_array_length(o.items) > 1 THEN ' +' || (jsonb_array_length(o.items) - 1) || ' more' ELSE '' END
      ELSE p.name
    END AS part`;

const ITEMS_REFERENCE_CASE_SQL = `CASE WHEN o.items IS NOT NULL THEN (o.items->0->>'reference') ELSE p.reference END AS reference`;
const ITEMS_SUPPLIER_CASE_SQL = `CASE WHEN o.items IS NOT NULL THEN (o.items->0->>'supplierName') ELSE s.name END AS supplier`;

/**
 * Inserts a new `orders` row for a customer/product pair with status
 * `awaiting_payment`, quantity fixed at 1 and the unit price snapshotted from the product.
 */
export async function createOrder(
  orderNumber: string,
  phone: string,
  item: Product,
  partType: string | null = null
): Promise<void> {
  await db.query(
    `INSERT INTO orders (number, customer_phone, product_id, supplier_id, quantity, unit_price, part_type, status, created_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, 'awaiting_payment', NOW())`,
    [orderNumber, phone, item.id, item.supplier_id, item.price, partType]
  );
}

export interface MultiItemDraft {
  product: Product;
  service: { name: string; price: number } | null;
}

/**
 * Inserts a single "basket" `orders` row for a multi-product WhatsApp
 * request — `product_id`/`unit_price`/`service_name`/`service_price` stay
 * NULL, and every selected product (with its own supplier, price, and
 * optional attached service) is snapshotted into the `items` JSONB array
 * instead, one entry per product with a stable 1-based `itemId` and
 * `availabilityStatus` starting at 'pending'.
 */
export async function createMultiItemOrder(
  orderNumber: string,
  phone: string,
  items: MultiItemDraft[],
  partType: string | null = null
): Promise<void> {
  const entries: OrderItemEntry[] = items.map((draft, i) => ({
    itemId: i + 1,
    productId: draft.product.id!,
    productName: draft.product.name,
    reference: draft.product.reference,
    supplierId: draft.product.supplier_id!,
    supplierName: draft.product.supplier || '',
    quantity: 1,
    unitPrice: draft.product.price,
    serviceName: draft.service?.name ?? null,
    servicePrice: draft.service?.price ?? null,
    availabilityStatus: 'pending',
  }));

  await db.query(
    `INSERT INTO orders (number, customer_phone, items, part_type, status, created_at)
     VALUES ($1, $2, $3, $4, 'awaiting_payment', NOW())`,
    [orderNumber, phone, JSON.stringify(entries), partType]
  );
}

/**
 * Fetches the raw `orders` row (no joins) by order number — used where only
 * the order's own columns (notably `items`, to detect a multi-item "basket"
 * order) are needed, without pulling in `products`/`suppliers` fields that a
 * multi-item order wouldn't have via `product_id` anyway.
 */
export async function getOrderRaw(orderNumber: string): Promise<any | null> {
  const { rows } = await db.query(`SELECT * FROM orders WHERE number = $1`, [orderNumber]);
  return rows.length ? rows[0] : null;
}

/**
 * Computes an order's payable total: for a legacy single-product order,
 * `unit_price + service_price` exactly as today; for a multi-item order,
 * the sum of `unitPrice + servicePrice` across only the `items` entries
 * currently marked `availabilityStatus: 'available'` — unavailable items
 * never contribute to what the customer is asked to pay.
 */
export async function getOrderAmount(orderNumber: string): Promise<number> {
  const order = await getOrderRaw(orderNumber);
  if (!order) return 0;

  if (!order.items) {
    return Number(order.unit_price || 0) + Number(order.service_price || 0);
  }

  const entries: OrderItemEntry[] = order.items;
  return entries
    .filter((e) => e.availabilityStatus === 'available')
    .reduce((sum, e) => sum + Number(e.unitPrice || 0) + Number(e.servicePrice || 0), 0);
}

/**
 * Sets a single line item's availability on a multi-item order — reads
 * `items`, mutates the matching entry's `availabilityStatus` in JS, and
 * writes the whole array back. Never touches `items` on a legacy
 * single-product order (a no-op if `itemId` doesn't match anything there).
 */
export async function setOrderItemAvailability(
  orderNumber: string,
  itemId: number,
  available: boolean
): Promise<void> {
  const order = await getOrderRaw(orderNumber);
  if (!order?.items) return;

  const entries: OrderItemEntry[] = order.items;
  const updated = entries.map((e) =>
    e.itemId === itemId ? { ...e, availabilityStatus: available ? 'available' as const : 'unavailable' as const } : e
  );

  await db.query(`UPDATE orders SET items = $2, updated_at = NOW() WHERE number = $1`, [
    orderNumber,
    JSON.stringify(updated),
  ]);
}

export interface AlternativeProduct {
  id: number;
  name: string;
  reference: string;
  price: number;
  supplier_id: number;
  supplier?: string;
}

/**
 * Swaps a rejected line item's product for a customer-chosen alternative:
 * remembers the old product id in `excludedProductIds` (so it's never
 * re-offered for this slot), replaces the product/price/supplier fields with
 * the alternative's, and resets `availabilityStatus` back to 'pending' —
 * the alternative still needs its own admin stock confirmation, same as any
 * other item.
 */
export async function replaceOrderItemWithAlternative(
  orderNumber: string,
  itemId: number,
  product: AlternativeProduct
): Promise<void> {
  const order = await getOrderRaw(orderNumber);
  if (!order?.items) return;

  const entries: OrderItemEntry[] = order.items;
  const updated = entries.map((e) =>
    e.itemId === itemId
      ? {
          ...e,
          excludedProductIds: [...(e.excludedProductIds || []), e.productId],
          productId: product.id,
          productName: product.name,
          reference: product.reference,
          supplierId: product.supplier_id,
          supplierName: product.supplier || '',
          unitPrice: product.price,
          // The old service (if any) was matched/offered specifically for
          // the rejected product — it doesn't necessarily apply to this
          // replacement, so it's dropped rather than silently carried over.
          serviceName: null,
          servicePrice: null,
          availabilityStatus: 'pending' as const,
        }
      : e
  );

  await db.query(`UPDATE orders SET items = $2, updated_at = NOW() WHERE number = $1`, [
    orderNumber,
    JSON.stringify(updated),
  ]);
}

/**
 * Marks a line item 'declined' — the customer explicitly skipped it rather
 * than picking an offered alternative. Terminal: unlike 'unavailable', this
 * never triggers another alternative-search round, and the item is simply
 * left out of the order's proforma/total.
 */
export async function declineOrderItem(orderNumber: string, itemId: number): Promise<void> {
  const order = await getOrderRaw(orderNumber);
  if (!order?.items) return;

  const entries: OrderItemEntry[] = order.items;
  const updated = entries.map((e) => (e.itemId === itemId ? { ...e, availabilityStatus: 'declined' as const } : e));

  await db.query(`UPDATE orders SET items = $2, updated_at = NOW() WHERE number = $1`, [
    orderNumber,
    JSON.stringify(updated),
  ]);
}

/**
 * Attaches an add-on service (name + price) to an existing `orders` row by
 * order number, used when the customer accepts an offered related service.
 */
export async function addServiceToOrder(orderNumber: string, serviceName: string, servicePrice: number): Promise<void> {
  await db.query(
    `UPDATE orders SET service_name = $2, service_price = $3, updated_at = NOW() WHERE number = $1`,
    [orderNumber, serviceName, servicePrice]
  );
}

/**
 * Fetches the customer's most recent `orders` row whose status is one of the
 * given values, used to resolve the in-progress order for payment-flow steps.
 */
export async function getLatestOrderByStatus(phone: string, statuses: string[]): Promise<any | null> {
  const { rows } = await db.query(
    `SELECT * FROM orders
     WHERE customer_phone = $1
       AND status = ANY($2::text[])
     ORDER BY created_at DESC LIMIT 1`,
    [phone, statuses]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Updates an `orders` row's status, optionally also setting `approved_by`/
 * `approved_at` and/or `payment_method` when those are passed in `additionalFields`.
 */
export async function updateOrderStatus(orderNumber: string, status: string, additionalFields: any = {}): Promise<void> {
  const setClauses = [`status = $2`, `updated_at = NOW()`];
  const params: any[] = [orderNumber, status];

  if (additionalFields.approved_by) {
    setClauses.push(`approved_by = $${setClauses.length + 2}`);
    params.push(additionalFields.approved_by);
    setClauses.push(`approved_at = NOW()`);
  }

  if (additionalFields.payment_method) {
    setClauses.push(`payment_method = $${setClauses.length + 2}`);
    params.push(additionalFields.payment_method);
  }

  await db.query(
    `UPDATE orders SET ${setClauses.join(', ')} WHERE number = $1`,
    params
  );
}

export type HideOrderResult = 'hidden' | 'not_found' | 'not_approved';

/**
 * Sets `admin_hidden = true` on an approved `orders` row so it drops off the
 * admin grid. Returns 'not_found'/'not_approved' instead of hiding when the order doesn't qualify.
 */
export async function hideApprovedOrder(orderNumber: string): Promise<HideOrderResult> {
  const { rows } = await db.query('SELECT status FROM orders WHERE number = $1', [orderNumber]);
  if (!rows.length) return 'not_found';
  if (rows[0].status !== 'approved') return 'not_approved';

  await db.query(
    `UPDATE orders SET admin_hidden = true, updated_at = NOW() WHERE number = $1`,
    [orderNumber]
  );
  return 'hidden';
}

/**
 * Records the WhatsApp media id/type for a customer's uploaded payment-proof
 * photo/PDF on the `orders` row, without storing the file itself.
 */
export async function savePaymentProof(orderNumber: string, mediaId: string, mediaType: string | null = null): Promise<void> {
  await db.query(
    `UPDATE orders
     SET payment_proof_media_id = $2,
         payment_proof_media_type = $3,
         updated_at = NOW()
     WHERE number = $1`,
    [orderNumber, mediaId, mediaType]
  );
}

/**
 * Atomically increments the current year's counter in `order_counters` and
 * formats the result as an `RP-<year>-<seq>` order number.
 */
export async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await db.query(
    `INSERT INTO order_counters (year, last_number)
     VALUES ($1, 1)
     ON CONFLICT (year)
     DO UPDATE SET last_number = order_counters.last_number + 1
     RETURNING last_number`,
    [year]
  );
  const sequence = result.rows[0].last_number;
  return `RP-${year}-${String(sequence).padStart(5, "0")}`;
}

/**
 * Fetches `orders` still in any pre-approval status (from awaiting-payment
 * through payment-proof-received), joined with product/supplier details, for the admin panel's pending list.
 */
export async function getOrdersPendingApproval(): Promise<OrderInfo[]> {
  const { rows } = await db.query(`
    SELECT
      o.number, o.customer_phone AS customer,
      ${ITEMS_PRICE_CASE_SQL}, o.quantity, o.created_at, o.updated_at,
      o.service_name, o.service_price,
      (o.service_name IS NOT NULL) AS service_offered,
      ${ITEMS_PART_CASE_SQL}, ${ITEMS_REFERENCE_CASE_SQL},
      ${ITEMS_SUPPLIER_CASE_SQL},
      o.items,
      o.payment_method,
      to_char(o.created_at, 'DD/MM/YYYY HH24:MI') AS time,
      (o.payment_proof_media_id IS NOT NULL) AS has_proof,
      o.payment_proof_media_type,
      (o.payment_method = 'bank_transfer' OR o.payment_method = 'bank_deposit' OR o.payment_method = 'multicaixa_express') AS requires_proof,
      (o.status = 'awaiting_proof_verification') AS verifying,
      (o.status IN ('payment_proof_received', 'awaiting_agent_confirmation')) AS reviewable,${STOCK_STATUS_CASE_SQL}
    FROM orders o
    LEFT JOIN product_suppliers ps ON ps.id = o.product_id
    LEFT JOIN products p ON p.id = ps.product_id
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.status IN (
      'awaiting_payment', 'awaiting_payment_method', 'awaiting_bank_subtype',
      'awaiting_payment_proof', 'awaiting_proof_verification', 'awaiting_agent_confirmation', 'payment_proof_received'
    )
    ORDER BY o.created_at DESC
  `);
  return rows;
}

/**
 * Fetches `orders` awaiting stock confirmation, oldest first, joined with
 * product/supplier details and including each order's waiting time in minutes.
 * Also includes basket orders sitting at `awaiting_alternative_resolution`
 * (every currently-known item decided, but waiting on the customer to pick a
 * substitute for whatever was unavailable) — these stay visible in the admin
 * grid's stock-confirmation view (the frontend renders them as "waiting on
 * customer" via each item's `availabilityStatus`, not as actionable) rather
 * than disappearing from the admin's view entirely while nothing is pending.
 */
export async function getOrdersPendingStockConfirmation(): Promise<any[]> {
  const { rows } = await db.query(`
    SELECT
      o.number, o.customer_phone AS customer,
      ${ITEMS_PRICE_CASE_SQL}, o.quantity, o.created_at,
      o.service_name, o.service_price,
      (o.service_name IS NOT NULL) AS service_offered,
      ps.id AS product_id, ${ITEMS_PART_CASE_SQL}, ${ITEMS_REFERENCE_CASE_SQL},
      ${ITEMS_SUPPLIER_CASE_SQL},
      o.items,
      to_char(o.created_at, 'DD/MM/YYYY HH24:MI') AS time,
      'pending' AS stock_status,
      EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 60 AS waiting_minutes
    FROM orders o
    LEFT JOIN product_suppliers ps ON ps.id = o.product_id
    LEFT JOIN products p ON p.id = ps.product_id
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.status IN ('awaiting_stock_confirmation', 'awaiting_alternative_resolution')
    ORDER BY o.created_at ASC
  `);
  return rows;
}

/**
 * Finds `orders` still awaiting stock confirmation past `minMinutes` that
 * haven't yet received a courtesy "still checking" WhatsApp message.
 */
export async function getOrdersAwaitingCourtesyMessage(minMinutes: number): Promise<{ number: string; customer_phone: string }[]> {
  const { rows } = await db.query(
    `SELECT number, customer_phone FROM orders
     WHERE status = 'awaiting_stock_confirmation'
       AND stock_confirmation_courtesy_sent = false
       AND created_at < NOW() - ($1 || ' minutes')::interval`,
    [minMinutes]
  );
  return rows;
}

/**
 * Flags an `orders` row so the stock-confirmation courtesy message isn't sent
 * to the customer again.
 */
export async function markCourtesyMessageSent(orderNumber: string): Promise<void> {
  await db.query(
    `UPDATE orders SET stock_confirmation_courtesy_sent = true WHERE number = $1`,
    [orderNumber]
  );
}

/**
 * Finds `orders` still awaiting stock confirmation past `minMinutes` that
 * haven't yet triggered an admin reminder push, joined with product name and customer first name.
 */
export async function getOrdersAwaitingAdminReminder(minMinutes: number): Promise<{ number: string; product_name: string; customer_first_name: string }[]> {
  const { rows } = await db.query(
    `SELECT o.number,
            CASE
              WHEN o.items IS NOT NULL THEN
                (o.items->0->>'productName') ||
                CASE WHEN jsonb_array_length(o.items) > 1 THEN ' +' || (jsonb_array_length(o.items) - 1) || ' more' ELSE '' END
              ELSE p.name
            END AS product_name,
            COALESCE(split_part(c.name, ' ', 1), 'Cliente') AS customer_first_name
     FROM orders o
     LEFT JOIN product_suppliers ps ON ps.id = o.product_id
     LEFT JOIN products p ON p.id = ps.product_id
     LEFT JOIN customers c ON c.phone = o.customer_phone
     WHERE o.status = 'awaiting_stock_confirmation'
       AND o.stock_confirmation_admin_reminder_sent = false
       AND o.created_at < NOW() - ($1 || ' minutes')::interval`,
    [minMinutes]
  );
  return rows;
}

/**
 * Flags an `orders` row so the admin stock-confirmation reminder isn't sent
 * again.
 */
export async function markAdminReminderSent(orderNumber: string): Promise<void> {
  await db.query(
    `UPDATE orders SET stock_confirmation_admin_reminder_sent = true WHERE number = $1`,
    [orderNumber]
  );
}

/**
 * Fetches non-hidden approved `orders`, optionally restricted to today, joined
 * with product details, for the admin panel's approved list.
 */
export async function getOrdersApproved(range: 'today' | 'all' = 'all'): Promise<any[]> {
  const { rows } = await db.query(`
    SELECT
      o.number, o.customer_phone AS customer,
      ${ITEMS_PRICE_CASE_SQL}, o.quantity,
      o.service_name, o.service_price,
      (o.service_name IS NOT NULL) AS service_offered,
      ${ITEMS_PART_CASE_SQL},
      o.items,
      to_char(o.approved_at, 'DD/MM/YYYY HH24:MI') AS time,
      (o.payment_proof_media_id IS NOT NULL) AS has_proof,
      o.payment_proof_media_type,
      'confirmed' AS stock_status
    FROM orders o
    LEFT JOIN product_suppliers ps ON ps.id = o.product_id
    LEFT JOIN products p ON p.id = ps.product_id
    WHERE o.status = 'approved'
      AND o.admin_hidden = false
      ${range === 'today' ? "AND o.approved_at::date = CURRENT_DATE" : ''}
    ORDER BY o.approved_at DESC
  `);
  return rows;
}

/**
 * Fetches `orders` in a rejected or stock-unavailable status, optionally
 * restricted to today, joined with product details, for the admin panel's rejected list.
 */
export async function getOrdersRejected(range: 'today' | 'all' = 'all'): Promise<any[]> {
  const { rows } = await db.query(`
    SELECT
      o.number, o.customer_phone AS customer,
      ${ITEMS_PRICE_CASE_SQL}, o.quantity,
      o.service_name, o.service_price,
      (o.service_name IS NOT NULL) AS service_offered,
      ${ITEMS_PART_CASE_SQL},
      o.items,
      to_char(o.updated_at, 'DD/MM/YYYY HH24:MI') AS time,
      (o.payment_proof_media_id IS NOT NULL) AS has_proof,
      o.payment_proof_media_type,
      CASE WHEN o.status = 'stock_unavailable' THEN 'unavailable' ELSE 'confirmed' END AS stock_status
    FROM orders o
    LEFT JOIN product_suppliers ps ON ps.id = o.product_id
    LEFT JOIN products p ON p.id = ps.product_id
    WHERE o.status IN ('rejected', 'stock_unavailable')
      ${range === 'today' ? "AND o.updated_at::date = CURRENT_DATE" : ''}
    ORDER BY o.updated_at DESC
  `);
  return rows;
}

export type AnalyticsPeriod = 'daily' | 'monthly' | 'yearly';

export interface AnalyticsPoint {
  label: string;
  revenue: string;
  pending: number;
  approved: number;
  rejected: number;
  stockConfirmation: number;
}

const ANALYTICS_PERIOD_CONFIG: Record<AnalyticsPeriod, {
  rangeStartExpr: string;
  rangeEndExpr: string;
  step: string;
  truncUnit: string;
  labelFormat: string;
}> = {
  daily: {
    rangeStartExpr: `date_trunc('hour', NOW()) - interval '23 hours'`,
    rangeEndExpr: `date_trunc('hour', NOW())`,
    step: '1 hour',
    truncUnit: 'hour',
    labelFormat: 'HH24:00',
  },
  monthly: {
    rangeStartExpr: `date_trunc('day', NOW()) - interval '29 days'`,
    rangeEndExpr: `date_trunc('day', NOW())`,
    step: '1 day',
    truncUnit: 'day',
    labelFormat: 'DD Mon',
  },
  yearly: {
    rangeStartExpr: `date_trunc('month', NOW()) - interval '11 months'`,
    rangeEndExpr: `date_trunc('month', NOW())`,
    step: '1 month',
    truncUnit: 'month',
    labelFormat: 'Mon YYYY',
  },
};

/**
 * Buckets `orders` into fixed-width time slots (hourly/daily/monthly depending
 * on `period`) and returns per-bucket revenue and status counts for the admin dashboard chart.
 */
export async function getOrderAnalytics(period: AnalyticsPeriod): Promise<AnalyticsPoint[]> {
  const { rangeStartExpr, rangeEndExpr, step, truncUnit, labelFormat } = ANALYTICS_PERIOD_CONFIG[period];

  const { rows } = await db.query(
    `WITH buckets AS (
       SELECT generate_series(${rangeStartExpr}, ${rangeEndExpr}, $1::interval) AS bucket_start
     ),
     order_stats AS (
       SELECT date_trunc('${truncUnit}', created_at) AS bucket_start, status,
              CASE
                WHEN items IS NOT NULL THEN (
                  SELECT COALESCE(SUM((elem->>'unitPrice')::numeric + COALESCE((elem->>'servicePrice')::numeric, 0)), 0)
                  FROM jsonb_array_elements(items) elem
                  WHERE elem->>'availabilityStatus' = 'available'
                )
                ELSE (unit_price + COALESCE(service_price, 0))
              END AS total_price
       FROM orders
       WHERE created_at >= ${rangeStartExpr}
         AND created_at < ${rangeEndExpr} + $1::interval
     )
     SELECT
       to_char(b.bucket_start, $2) AS label,
       COALESCE(SUM(o.total_price) FILTER (WHERE o.status = 'approved'), 0) AS revenue,
       COUNT(*) FILTER (WHERE o.status = 'approved')::int AS approved,
       COUNT(*) FILTER (WHERE o.status = 'rejected')::int AS rejected,
       COUNT(*) FILTER (WHERE o.status = 'awaiting_stock_confirmation')::int AS "stockConfirmation",
       COUNT(*) FILTER (
         WHERE o.status NOT IN ('approved', 'rejected', 'awaiting_stock_confirmation', 'cancelled', 'stock_unavailable')
       )::int AS pending
     FROM buckets b
     LEFT JOIN order_stats o ON o.bucket_start = b.bucket_start
     GROUP BY b.bucket_start
     ORDER BY b.bucket_start`,
    [step, labelFormat]
  );

  return rows;
}

export interface OrderStats {
  totalOrders: number;
  approvedOrders: number;
  rejectedOrders: number;
  approvedRevenue: string;
}

/**
 * Aggregates overall `orders` totals — total count, approved/rejected counts,
 * and total approved revenue — across the whole table.
 */
export async function getOrderStats(): Promise<OrderStats> {
  const { rows } = await db.query(`
    SELECT
      COUNT(*)::int AS "totalOrders",
      COUNT(*) FILTER (WHERE status = 'approved')::int AS "approvedOrders",
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS "rejectedOrders",
      COALESCE(SUM(
        CASE
          WHEN items IS NOT NULL THEN (
            SELECT COALESCE(SUM((elem->>'unitPrice')::numeric + COALESCE((elem->>'servicePrice')::numeric, 0)), 0)
            FROM jsonb_array_elements(items) elem
            WHERE elem->>'availabilityStatus' = 'available'
          )
          ELSE (unit_price + COALESCE(service_price, 0))
        END
      ) FILTER (WHERE status = 'approved'), 0) AS "approvedRevenue"
    FROM orders
  `);
  return rows[0];
}

/**
 * Looks up a single `orders` row by its order number, joined with product name/
 * reference and supplier name.
 */
export async function getOrderByNumber(number: string): Promise<any | null> {
  const { rows } = await db.query(
    `SELECT o.*, p.name AS product_name, p.reference, s.name AS supplier_name
     FROM orders o
     LEFT JOIN product_suppliers ps ON ps.id = o.product_id
     LEFT JOIN products p ON p.id = ps.product_id
     LEFT JOIN suppliers s ON s.id = o.supplier_id
     WHERE o.number = $1`,
    [number]
  );
  return rows.length ? rows[0] : null;
}
