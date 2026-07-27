import { db } from '../config/db.js';
import { logger } from '../config/logger.js';
import { getMatchingServicesByCategory, Service } from './service.model.js';

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

/**
 * Runs a full-text search against `products.search_vector` for in-stock, active
 * items matching `part`, then filters the top candidates down to those compatible with the customer's vehicle
 * (make/model/year) and returns the cheapest, highest-rated-supplier 3 results.
 */
export async function searchProductsInInventory({
  part,
  vehicle,
  excludeProductIds,
}: {
  part: string;
  vehicle?: SearchVehicle | null;
  excludeProductIds?: number[];
}): Promise<Product[]> {
  const { rows } = await db.query(
    `
    SELECT
      p.id,
      p.name,
      p.reference,
      p.price,
      p.quantity,
      p.service_category,
      p.vehicle_make,
      p.vehicle_model,
      p.year_start,
      p.year_end,
      p.supplier_id,
      s.name AS supplier,
      s.rating AS supplier_rating
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    WHERE
      p.quantity > 0
      AND p.active = true
      AND p.search_vector @@ ${OR_TSQUERY}
      AND ($2::int[] IS NULL OR NOT (p.id = ANY($2::int[])))
    ORDER BY
      p.price ASC,
      s.rating DESC
    LIMIT ${SEARCH_CANDIDATE_LIMIT}
    `,
    [part, excludeProductIds?.length ? excludeProductIds : null]
  );

  const compatible = vehicle
    ? rows.filter(
        (p: Product) =>
          vehicleFieldMatches(p.vehicle_make, vehicle.make) &&
          vehicleFieldMatches(p.vehicle_model, vehicle.model) &&
          vehicleYearMatches(p.year_start, p.year_end, vehicle.year)
      )
    : rows;

  const results = compatible.slice(0, 3);
  logger.debug(`[PRODUCT SEARCH] query="${part}" vehicle=${vehicle ? `${vehicle.make} ${vehicle.model} ${vehicle.year}` : 'none'} candidates=${rows.length} compatible=${compatible.length} returned=${results.length}`);
  return results;
}

/**
 * Inserts a `waitlist_requests` row linking a customer to an out-of-stock
 * product, so they can be notified on restock. No-ops if already waitlisted for that product.
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
 * Returns every `products` row (any active status) joined with its supplier's
 * name/rating/province/phone, newest-updated first, for the admin product list.
 */
export async function getAllProducts(): Promise<Product[]> {
  const { rows } = await db.query(
    `SELECT
      p.id,
      p.name,
      p.brand,
      p.reference,
      p.oem_reference,
      p.synonyms,
      p.description,
      p.category,
      p.subcategory,
      p.service_category,
      p.vehicle_make,
      p.vehicle_model,
      p.year_start,
      p.year_end,
      p.engine,
      p.delivery_time,
      p.engine_number,
      p.viscosity,
      p.engine_type,
      p.volume_liters,
      p.specification,
      p.interval_km,
      p.image_url,
      p.price,
      p.quantity,
      p.active,
      p.supplier_id,
      s.name AS supplier,
      s.rating AS supplier_rating,
      s.province AS supplier_address,
      s.phone AS supplier_phone
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    ORDER BY p.updated_at DESC`
  );
  return rows;
}

/**
 * Looks up a single active `products` row by id, joined with supplier details.
 * Returns null for inactive or missing products.
 */
export async function getProductById(id: number): Promise<Product | null> {
  const { rows } = await db.query(
    `SELECT
      p.id,
      p.name,
      p.brand,
      p.reference,
      p.oem_reference,
      p.synonyms,
      p.description,
      p.category,
      p.subcategory,
      p.service_category,
      p.vehicle_make,
      p.vehicle_model,
      p.year_start,
      p.year_end,
      p.engine,
      p.delivery_time,
      p.engine_number,
      p.viscosity,
      p.engine_type,
      p.volume_liters,
      p.specification,
      p.interval_km,
      p.image_url,
      p.price,
      p.quantity,
      p.active,
      p.supplier_id,
      s.name AS supplier,
      s.rating AS supplier_rating,
      s.province AS supplier_address,
      s.phone AS supplier_phone
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.id = $1 AND p.active = true`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Looks up a single `products` row by id regardless of active status, joined
 * with supplier details — used by the admin edit/view endpoints.
 */
export async function getProductByIdAnyStatus(id: number): Promise<Product | null> {
  const { rows } = await db.query(
    `SELECT
      p.id,
      p.name,
      p.brand,
      p.reference,
      p.oem_reference,
      p.synonyms,
      p.description,
      p.category,
      p.subcategory,
      p.service_category,
      p.vehicle_make,
      p.vehicle_model,
      p.year_start,
      p.year_end,
      p.engine,
      p.delivery_time,
      p.engine_number,
      p.viscosity,
      p.engine_type,
      p.volume_liters,
      p.specification,
      p.interval_km,
      p.image_url,
      p.price,
      p.quantity,
      p.active,
      p.supplier_id,
      s.name AS supplier,
      s.rating AS supplier_rating,
      s.province AS supplier_address,
      s.phone AS supplier_phone
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.id = $1`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Looks up a product's `service_category` and returns the matching active
 * services for it, used to offer a related service alongside a product search result.
 */
export async function getMatchingServicesForProduct(productId: number): Promise<Service[]> {
  const { rows } = await db.query('SELECT service_category FROM products WHERE id = $1', [productId]);
  if (!rows.length || !rows[0].service_category) return [];
  return getMatchingServicesByCategory(rows[0].service_category);
}

/**
 * Dynamically updates whichever `Product` fields are present in `fields` on
 * the `products` row for the given id, stamping `updated_at`. No-ops if `fields` is empty.
 */
export async function updateProduct(id: number, fields: Partial<Product>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;

  const setClauses = keys.map((key, index) => `"${key}" = $${index + 2}`).join(', ');
  const values = keys.map((key) => (fields as any)[key]);

  await db.query(
    `UPDATE products SET ${setClauses}, updated_at = NOW() WHERE id = $1`,
    [id, ...values]
  );
}

export type HardDeleteResult = 'deleted' | 'not_found' | 'still_active';

/**
 * Permanently deletes a `products` row by id, refusing to do so while the
 * product is still active. Returns 'not_found'/'still_active' instead of deleting when the row doesn't qualify.
 */
export async function hardDeleteProduct(id: number): Promise<HardDeleteResult> {
  const { rows } = await db.query('SELECT active FROM products WHERE id = $1', [id]);
  if (!rows.length) return 'not_found';
  if (rows[0].active) return 'still_active';

  await db.query('DELETE FROM products WHERE id = $1', [id]);
  return 'deleted';
}

/**
 * Full-text searches `products` for an active, out-of-stock (quantity = 0)
 * item matching `part`, used to check whether a "no stock" search should offer a restock waitlist instead of nothing.
 */
export async function findZeroQuantityProductMatch({
  part,
}: {
  part: string;
}): Promise<{ id: number; name: string } | null> {
  const { rows } = await db.query(
    `SELECT id, name
     FROM products
     WHERE quantity = 0
       AND active = true
       AND search_vector @@ ${OR_TSQUERY}
     ORDER BY updated_at DESC
     LIMIT 1`,
    [part]
  );
  return rows.length ? rows[0] : null;
}
