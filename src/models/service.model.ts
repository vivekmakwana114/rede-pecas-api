import { db } from '../config/db.js';

export interface ServiceProvider {
  id?: number;
  name: string;
  address?: string | null;
  province?: string | null;
  phone?: string | null;
  specialties?: string | null;
  rating?: number;
  response_time?: string | null;
  active?: boolean;
}

export interface Service {
  id?: number;
  provider_id: number;
  provider_name?: string;
  provider_address?: string | null;
  provider_province?: string;
  provider_phone?: string;
  provider_specialties?: string | null;
  provider_rating?: number;
  provider_response_time?: string | null;
  service_name: string;
  service_category: string;
  service_base_price: number;
  service_duration_h: number;
  available_at_home: boolean;
  base_travel_fee?: number | null;
  logistics_fee_notes?: string | null;
  active?: boolean;
}

export interface ImportServiceItem {
  providerId?: number;
  providerName?: string;
  providerAddress?: string;
  providerProvince?: string;
  providerPhone?: string;
  specialties?: string;
  rating?: number;
  responseTime?: string;
  serviceName: string;
  serviceCategory: string;
  serviceBasePrice: number;
  serviceDurationH: number;
  availableAtHome: boolean;
  baseTravelFee?: number;
  logisticsFeeNotes?: string;
}

/**
 * Finds an existing `service_providers` row by case-insensitive name match, or
 * inserts a new one with the given details if none exists. Returns the provider id either way.
 */
export async function getOrCreateServiceProviderByName(
  name: string,
  address?: string | null,
  province?: string | null,
  phone?: string | null,
  specialties?: string | null,
  rating?: number | null,
  responseTime?: string | null
): Promise<number> {
  const { rows } = await db.query('SELECT id FROM service_providers WHERE name ILIKE $1 LIMIT 1', [name]);
  if (rows.length) return rows[0].id;

  const inserted = await db.query(
    `INSERT INTO service_providers (name, address, province, phone, specialties, rating, response_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [name, address || null, province || null, phone || null, specialties || null, rating ?? null, responseTime || null]
  );
  return inserted.rows[0].id;
}

/**
 * Finds an existing `service_providers` row by name (excluding the service's
 * current provider), or inserts a new one, used when an admin edit changes a service's provider details.
 */
export async function resolveServiceProviderForEdit(
  name: string,
  address: string | null,
  province: string | null,
  phone: string | null,
  currentProviderId: number
): Promise<number> {
  const { rows } = await db.query(
    'SELECT id FROM service_providers WHERE name ILIKE $1 AND id != $2 LIMIT 1',
    [name, currentProviderId]
  );
  if (rows.length) return rows[0].id;

  const inserted = await db.query(
    'INSERT INTO service_providers (name, address, province, phone) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, address || null, province || null, phone || null]
  );
  return inserted.rows[0].id;
}

/**
 * Bulk-upserts a batch of service items into `services` (grouped by resolved
 * provider, creating providers as needed via `getOrCreateServiceProviderByName`), all inside one transaction.
 * Returns counts of inserted vs. updated rows.
 */
export async function importServicesBatch(
  items: ImportServiceItem[],
  defaultProviderId: number | null = null
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  const providerCache = new Map<string, number>();
  const byProvider = new Map<number, ImportServiceItem[]>();

  for (const item of items) {
    if (!item.serviceName || !item.serviceCategory) continue;

    let providerId = item.providerId ?? null;

    if (!providerId && item.providerName) {
      const cacheKey = item.providerName.toLowerCase();
      providerId = providerCache.get(cacheKey) ?? null;
      if (!providerId) {
        providerId = await getOrCreateServiceProviderByName(
          item.providerName,
          item.providerAddress,
          item.providerProvince,
          item.providerPhone,
          item.specialties,
          item.rating,
          item.responseTime
        );
        providerCache.set(cacheKey, providerId);
      }
    }

    if (!providerId) providerId = defaultProviderId;
    if (!providerId) continue;

    const group = byProvider.get(providerId) || [];
    group.push(item);
    byProvider.set(providerId, group);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const [providerId, providerItems] of byProvider) {
      for (const item of providerItems) {
        const result = await client.query(
          `INSERT INTO services (provider_id, service_name, service_category, service_base_price, service_duration_h, available_at_home, base_travel_fee, logistics_fee_notes, active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
           ON CONFLICT (provider_id, service_name)
           DO UPDATE SET
             service_category = EXCLUDED.service_category,
             service_base_price = EXCLUDED.service_base_price,
             service_duration_h = EXCLUDED.service_duration_h,
             available_at_home = EXCLUDED.available_at_home,
             base_travel_fee = EXCLUDED.base_travel_fee,
             logistics_fee_notes = EXCLUDED.logistics_fee_notes,
             active = true,
             updated_at = NOW()
           RETURNING (xmax = 0) AS was_inserted`,
          [
            providerId,
            item.serviceName,
            item.serviceCategory,
            item.serviceBasePrice,
            item.serviceDurationH,
            item.availableAtHome,
            item.baseTravelFee ?? null,
            item.logisticsFeeNotes ?? null,
          ]
        );

        if (result.rows[0]?.was_inserted) inserted++;
        else updated++;
      }
    }

    await client.query('COMMIT');
    return { inserted, updated };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SERVICE_SELECT = `
  SELECT
    sv.id,
    sv.provider_id,
    sv.service_name,
    sv.service_category,
    sv.service_base_price,
    sv.service_duration_h,
    sv.available_at_home,
    sv.base_travel_fee,
    sv.logistics_fee_notes,
    sv.active,
    sp.name AS provider_name,
    sp.address AS provider_address,
    sp.province AS provider_province,
    sp.phone AS provider_phone,
    sp.specialties AS provider_specialties,
    sp.rating AS provider_rating,
    sp.response_time AS provider_response_time
  FROM services sv
  JOIN service_providers sp ON sp.id = sv.provider_id
`;

/**
 * Returns every `services` row joined with its provider's details, newest-
 * updated first, for the admin service list.
 */
export async function getAllServices(): Promise<Service[]> {
  const { rows } = await db.query(`${SERVICE_SELECT} ORDER BY sv.updated_at DESC`);
  return rows;
}

/**
 * Looks up a single `services` row by id, joined with its provider's details.
 */
export async function getServiceById(id: number): Promise<Service | null> {
  const { rows } = await db.query(`${SERVICE_SELECT} WHERE sv.id = $1`, [id]);
  return rows.length ? rows[0] : null;
}

/**
 * Dynamically updates whichever `Service` fields are present in `fields` on
 * the `services` row for the given id, stamping `updated_at`. No-ops if `fields` is empty.
 */
export async function updateService(id: number, fields: Partial<Service>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;

  const setClauses = keys.map((key, index) => `"${key}" = $${index + 2}`).join(', ');
  const values = keys.map((key) => (fields as any)[key]);

  await db.query(`UPDATE services SET ${setClauses}, updated_at = NOW() WHERE id = $1`, [id, ...values]);
}

export type HardDeleteResult = 'deleted' | 'not_found' | 'still_active';

/**
 * Permanently deletes a `services` row by id, refusing to do so while the
 * service is still active. Returns 'not_found'/'still_active' instead of deleting when the row doesn't qualify.
 */
export async function hardDeleteService(id: number): Promise<HardDeleteResult> {
  const { rows } = await db.query('SELECT active FROM services WHERE id = $1', [id]);
  if (!rows.length) return 'not_found';
  if (rows[0].active) return 'still_active';

  await db.query('DELETE FROM services WHERE id = $1', [id]);
  return 'deleted';
}

/**
 * Returns active `services` rows in the given category, cheapest first, joined
 * with provider details — used to offer a related service for a matched product.
 */
export async function getMatchingServicesByCategory(serviceCategory: string): Promise<Service[]> {
  const { rows } = await db.query(
    `${SERVICE_SELECT} WHERE sv.active = true AND sv.service_category = $1 ORDER BY sv.service_base_price ASC`,
    [serviceCategory]
  );
  return rows;
}
