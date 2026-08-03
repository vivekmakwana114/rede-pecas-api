import { db } from '../config/db.js';
import { logger } from '../config/logger.js';
import { getMatchingServicesByCategory, Service } from './service.model.js';

// `Product.id` is `product_suppliers.id` (a specific supplier's offer of a
// part) throughout this app — orders, the waitlist, and search results all
// mean "this offer" when they say "this product". `products.id` (the
// shared catalog identity) is an internal detail of this file only — see
// the 2026-07-28 products/product_suppliers/product_vehicles split
// documented on the `products` table in db/schema.sql.
export interface Product {
  id?: number;
  name: string;
  reference: string;
  price: number;
  quantity: number;
  brand?: string | null;
  oem_reference?: string | null;
  synonyms?: string;
  category_keywords?: string | null;
  description?: string;
  unit?: string;
  category?: string;
  subcategory?: string;
  service_category?: string;
  product_type?: string | null;
  vehicle_make?: string;
  vehicle_model?: string | null;
  year_start?: number | null;
  year_end?: number | null;
  engine?: string | null;
  delivery_time?: string;
  engine_number?: string | null;
  viscosity?: string | null;
  engine_type?: string | null;
  volume_liters?: number | null;
  specification?: string | null;
  interval_km?: number | null;
  image_url?: string | null;
  active?: boolean;
  supplier?: string;
  supplier_id?: number;
  supplier_rating?: number;
  supplier_address?: string;
  supplier_phone?: string;
  // Every compatible-vehicle fit on file for this product (product_vehicles
  // can hold several rows per product) — vehicle_make/model/year_start/
  // year_end above are only the *first* of these, kept flat for the existing
  // single-fit admin edit form; this is the full list, for display only.
  vehicle_fits?: VehicleFit[];
}

const OR_TSQUERY = `to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', unaccent($1))), ' | '))`;

const SEARCH_CANDIDATE_LIMIT = 50;

/**
 * Checks whether a product's vehicle-restriction field (make/model, slash-
 * separated for multiple options) is compatible with the customer's vehicle value, treating a missing product
 * restriction, a missing customer value, or a universal/aftermarket option as always compatible.
 */
function vehicleFieldMatches(productValue: string | null | undefined, customerValue: string | null | undefined): boolean {
  if (!productValue) return true;
  if (!customerValue) return true;
  const options = productValue.split('/').map((s) => s.trim().toLowerCase());
  if (options.some((o) => o === 'various' || o === 'universal' || o === 'aftermarket')) return true;
  const target = customerValue.trim().toLowerCase();
  return options.some((o) => o === target || o.includes(target) || target.includes(o));
}

/**
 * Checks whether the customer's vehicle year falls within a product's
 * year_start/year_end range, treating an unparseable or missing customer year as always compatible.
 */
function vehicleYearMatches(yearStart: number | null | undefined, yearEnd: number | null | undefined, customerYear: string | null | undefined): boolean {
  const year = customerYear ? Number(customerYear) : NaN;
  if (Number.isNaN(year)) return true;
  if (yearStart != null && year < yearStart) return false;
  if (yearEnd != null && year > yearEnd) return false;
  return true;
}

export interface SearchVehicle {
  make: string;
  model: string;
  year: string;
}

export interface VehicleFit {
  make: string;
  model: string | null;
  year_start: number | null;
  year_end: number | null;
  engine?: string | null;
  engine_number?: string | null;
}

/**
 * Checks whether any of a product's compatible-vehicle fits matches the
 * customer's vehicle (make/model/year) — a product now has zero or more
 * fits (product_vehicles rows), so it's compatible if *any* one of them is.
 */
function anyFitMatches(fits: VehicleFit[] | null, vehicle: SearchVehicle): boolean {
  if (!fits || fits.length === 0) return true;
  return fits.some(
    (fit) =>
      vehicleFieldMatches(fit.make, vehicle.make) &&
      vehicleFieldMatches(fit.model, vehicle.model) &&
      vehicleYearMatches(fit.year_start, fit.year_end, vehicle.year)
  );
}

/**
 * Runs a full-text search against `products.search_vector` for in-stock, active
 * offers matching `part`, then filters the top candidates down to those compatible with the customer's vehicle
 * (make/model/year, checked against every vehicle this product is registered to fit) and returns the
 * cheapest, highest-rated-supplier 3 results.
 */
export async function searchProductsInInventory({
  part,
  vehicle,
  excludeProductIds,
  subcategory,
  productType,
}: {
  part: string;
  vehicle?: SearchVehicle | null;
  excludeProductIds?: number[];
  // Constrains results to the same catalog subcategory (e.g. 'Brakes') as
  // a known-good reference item — used by the "find an alternative for this
  // rejected/out-of-stock item" flows, where searching on the rejected
  // product's full display name alone (e.g. "Front Brake Pads Aftermarket
  // ESD7052") under this app's OR-joined full-text query can match on just
  // one common word like "front" and surface a completely unrelated part.
  // The plain customer free-text search (searchAndRespond) never sets this
  // — a customer's own short query doesn't have this failure mode.
  subcategory?: string | null;
  // The customer's order-wide part-type choice (OEM/Aftermarket/New/Second
  // Hand — see the part-type selection step). Soft filter: a row with
  // product_type IS NULL (every pre-existing catalog row, until re-imported
  // with the new CSV column) still matches regardless of the customer's
  // choice, so search never silently goes empty for un-backfilled catalog data.
  productType?: string | null;
}): Promise<Product[]> {
  const { rows } = await db.query(
    `
    SELECT
      ps.id,
      p.name,
      p.brand,
      p.reference,
      ps.price,
      ps.quantity,
      ps.delivery_time,
      p.service_category,
      p.product_type,
      ps.supplier_id,
      s.name AS supplier,
      s.rating AS supplier_rating,
      vf.fits AS vehicle_fits
    FROM products p
    JOIN product_suppliers ps ON ps.product_id = p.id
    JOIN suppliers s ON s.id = ps.supplier_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'make', pv.vehicle_make, 'model', pv.vehicle_model,
        'year_start', pv.year_start, 'year_end', pv.year_end
      )) AS fits
      FROM product_vehicles pv WHERE pv.product_id = p.id
    ) vf ON true
    WHERE
      ps.quantity > 0
      AND ps.active = true
      AND p.active = true
      AND p.search_vector @@ ${OR_TSQUERY}
      AND ($2::int[] IS NULL OR NOT (ps.id = ANY($2::int[])))
      AND ($3::text IS NULL OR p.subcategory = $3)
      AND ($4::text IS NULL OR p.product_type IS NULL OR p.product_type = $4)
    ORDER BY
      ps.price ASC,
      s.rating DESC
    LIMIT ${SEARCH_CANDIDATE_LIMIT}
    `,
    [part, excludeProductIds?.length ? excludeProductIds : null, subcategory ?? null, productType ?? null]
  );

  const compatible = vehicle
    ? rows.filter((p: any) => anyFitMatches(p.vehicle_fits, vehicle))
    : rows;

  const results = compatible.slice(0, 3).map(({ vehicle_fits, ...p }: any) => p as Product);
  logger.debug(`[PRODUCT SEARCH] query="${part}" vehicle=${vehicle ? `${vehicle.make} ${vehicle.model} ${vehicle.year}` : 'none'} candidates=${rows.length} compatible=${compatible.length} returned=${results.length}`);
  return results;
}

/**
 * Inserts a `waitlist_requests` row linking a customer to an out-of-stock
 * offer, so they can be notified on restock. No-ops if already waitlisted for that offer.
 */
export async function addToProductWaitlist(productId: number, phone: string): Promise<void> {
  await db.query(
    `INSERT INTO waitlist_requests (product_id, customer_phone)
     VALUES ($1, $2)
     ON CONFLICT (product_id, customer_phone) DO NOTHING`,
    [productId, phone]
  );
}

/**
 * Decrements a confirmed offer's on-hand quantity (`product_suppliers.quantity`,
 * `offerId` being the `product_suppliers.id` an order's `product_id`/item
 * `productId` actually references) by the ordered amount, floored at 0 so a
 * race between two concurrent orders for the last unit can't go negative.
 * Called once, at the moment admin confirms stock is actually available
 * (`confirmStockAndFinalizeOrder` / `finalizeMultiItemOrder`) — not at order
 * creation, since that's before anyone has physically checked the shelf.
 */
export async function decrementOfferStock(offerId: number, qty: number = 1): Promise<void> {
  await db.query(
    `UPDATE product_suppliers SET quantity = GREATEST(quantity - $2, 0), updated_at = NOW() WHERE id = $1`,
    [offerId, qty]
  );
}

const ADMIN_PRODUCT_SELECT = `
  SELECT
    ps.id,
    p.name,
    p.brand,
    p.reference,
    p.oem_reference,
    p.synonyms,
    p.description,
    p.category,
    p.subcategory,
    p.service_category,
    p.product_type,
    fit.vehicle_make,
    fit.vehicle_model,
    fit.year_start,
    fit.year_end,
    fit.engine,
    fit.engine_number,
    p.viscosity,
    p.engine_type,
    p.volume_liters,
    p.specification,
    p.interval_km,
    p.image_url,
    ps.price,
    ps.quantity,
    ps.delivery_time,
    ps.active,
    ps.supplier_id,
    s.name AS supplier,
    s.rating AS supplier_rating,
    s.province AS supplier_address,
    s.phone AS supplier_phone,
    fits.vehicle_fits
  FROM product_suppliers ps
  JOIN products p ON p.id = ps.product_id
  JOIN suppliers s ON s.id = ps.supplier_id
  LEFT JOIN LATERAL (
    SELECT vehicle_make, vehicle_model, year_start, year_end, engine, engine_number
    FROM product_vehicles pv
    WHERE pv.product_id = p.id
    ORDER BY pv.id
    LIMIT 1
  ) fit ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(json_build_object(
      'make', pv2.vehicle_make,
      'model', pv2.vehicle_model,
      'year_start', pv2.year_start,
      'year_end', pv2.year_end,
      'engine', pv2.engine,
      'engine_number', pv2.engine_number
    ) ORDER BY pv2.id), '[]'::json) AS vehicle_fits
    FROM product_vehicles pv2
    WHERE pv2.product_id = p.id
  ) fits ON true
`;

/**
 * Returns every `product_suppliers` row (any active status) joined with its
 * product's catalog fields, supplier's name/rating/province/phone, and its
 * product's first vehicle fit (a product can have several — the admin list
 * shows one as a summary; see CLAUDE.md/plan for the full-multi-fit admin UI
 * follow-up), newest-updated first, for the admin product list.
 */
export async function getAllProducts(): Promise<Product[]> {
  const { rows } = await db.query(`${ADMIN_PRODUCT_SELECT} ORDER BY ps.updated_at DESC`);
  return rows;
}

/**
 * Looks up a single active offer (`product_suppliers` row) by id, joined
 * with its product/supplier details and first vehicle fit. Returns null for
 * inactive or missing offers, or a product deactivated at the catalog level.
 */
export async function getProductById(id: number): Promise<Product | null> {
  const { rows } = await db.query(
    `${ADMIN_PRODUCT_SELECT} WHERE ps.id = $1 AND ps.active = true AND p.active = true`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Looks up a single offer (`product_suppliers` row) by id regardless of
 * active status, joined with its product/supplier details and first vehicle
 * fit — used by the admin edit/view endpoints.
 */
export async function getProductByIdAnyStatus(id: number): Promise<Product | null> {
  const { rows } = await db.query(`${ADMIN_PRODUCT_SELECT} WHERE ps.id = $1`, [id]);
  return rows.length ? rows[0] : null;
}

/**
 * Looks up an offer's `service_category` (via its product) and returns the
 * matching active services for it, used to offer a related service
 * alongside a product search result.
 */
export async function getMatchingServicesForProduct(offerId: number): Promise<Service[]> {
  const { rows } = await db.query(
    `SELECT p.service_category
     FROM product_suppliers ps JOIN products p ON p.id = ps.product_id
     WHERE ps.id = $1`,
    [offerId]
  );
  if (!rows.length || !rows[0].service_category) return [];
  return getMatchingServicesByCategory(rows[0].service_category);
}

const OFFER_FIELDS = new Set(['price', 'quantity', 'delivery_time', 'active', 'supplier_id']);
const VEHICLE_FIELDS = new Set(['vehicle_make', 'vehicle_model', 'year_start', 'year_end', 'engine', 'engine_number']);

/**
 * Dynamically updates whichever `Product` fields are present in `fields` on
 * the offer (`product_suppliers`), its product (`products`), or its first
 * vehicle fit (`product_vehicles`, created if none exists yet) — split by
 * which of the three tables each field actually lives on since the
 * 2026-07-28 catalog split. No-ops if `fields` is empty. Full multi-fit/
 * multi-supplier editing from the admin UI is a follow-up; this keeps the
 * existing single-offer, single-vehicle-fit edit form working.
 */
export async function updateProduct(id: number, fields: Partial<Product>): Promise<void> {
  const keys = Object.keys(fields) as (keyof Product)[];
  if (!keys.length) return;

  const offerKeys = keys.filter((k) => OFFER_FIELDS.has(k));
  const vehicleKeys = keys.filter((k) => VEHICLE_FIELDS.has(k));
  const productKeys = keys.filter((k) => !OFFER_FIELDS.has(k) && !VEHICLE_FIELDS.has(k) && k !== 'id');

  const { rows } = await db.query(`SELECT product_id FROM product_suppliers WHERE id = $1`, [id]);
  if (!rows.length) return;
  const productId = rows[0].product_id;

  if (offerKeys.length) {
    const setClauses = offerKeys.map((key, index) => `"${key}" = $${index + 2}`).join(', ');
    const values = offerKeys.map((key) => (fields as any)[key]);
    await db.query(`UPDATE product_suppliers SET ${setClauses}, updated_at = NOW() WHERE id = $1`, [id, ...values]);
  }

  if (productKeys.length) {
    const setClauses = productKeys.map((key, index) => `"${key}" = $${index + 2}`).join(', ');
    const values = productKeys.map((key) => (fields as any)[key]);
    await db.query(`UPDATE products SET ${setClauses}, updated_at = NOW() WHERE id = $1`, [productId, ...values]);
  }

  if (vehicleKeys.length) {
    const { rows: fitRows } = await db.query(
      `SELECT id FROM product_vehicles WHERE product_id = $1 ORDER BY id LIMIT 1`,
      [productId]
    );
    if (fitRows.length) {
      const setClauses = vehicleKeys.map((key, index) => `"${key}" = $${index + 2}`).join(', ');
      const values = vehicleKeys.map((key) => (fields as any)[key]);
      await db.query(`UPDATE product_vehicles SET ${setClauses} WHERE id = $1`, [fitRows[0].id, ...values]);
    } else {
      const columns = vehicleKeys.join(', ');
      const placeholders = vehicleKeys.map((_, index) => `$${index + 2}`).join(', ');
      const values = vehicleKeys.map((key) => (fields as any)[key]);
      await db.query(
        `INSERT INTO product_vehicles (product_id, ${columns}) VALUES ($1, ${placeholders})`,
        [productId, ...values]
      );
    }
  }
}

export type HardDeleteResult = 'deleted' | 'not_found' | 'still_active';

/**
 * Permanently deletes one offer (`product_suppliers` row) by id, refusing
 * to do so while it's still active. Returns 'not_found'/'still_active'
 * instead of deleting when the row doesn't qualify. Never touches the
 * shared `products`/`product_vehicles` rows — if this was the product's
 * last remaining offer, they're simply orphaned (harmless: search requires
 * a product_suppliers row, so an orphaned product never surfaces again).
 */
export async function hardDeleteProduct(id: number): Promise<HardDeleteResult> {
  const { rows } = await db.query('SELECT active FROM product_suppliers WHERE id = $1', [id]);
  if (!rows.length) return 'not_found';
  if (rows[0].active) return 'still_active';

  await db.query('DELETE FROM product_suppliers WHERE id = $1', [id]);
  return 'deleted';
}

/**
 * Full-text searches for an active, out-of-stock (quantity = 0) offer
 * matching `part`, used to check whether a "no stock" search should offer a
 * restock waitlist instead of nothing.
 */
export async function findZeroQuantityProductMatch({
  part,
  productType,
}: {
  part: string;
  // Same soft filter as searchProductsInInventory — a NULL product_type row
  // (pre-existing catalog data) still matches regardless of the customer's choice.
  productType?: string | null;
}): Promise<{ id: number; name: string } | null> {
  const { rows } = await db.query(
    `SELECT ps.id, p.name
     FROM product_suppliers ps
     JOIN products p ON p.id = ps.product_id
     WHERE ps.quantity = 0
       AND ps.active = true
       AND p.active = true
       AND p.search_vector @@ ${OR_TSQUERY}
       AND ($2::text IS NULL OR p.product_type IS NULL OR p.product_type = $2)
     ORDER BY ps.updated_at DESC
     LIMIT 1`,
    [part, productType ?? null]
  );
  return rows.length ? rows[0] : null;
}
