import { db } from '../config/db.js';

export interface VehicleSession {
  id: number;
  phone: string;
  vin: string | null;
  make: string;
  model: string;
  year: string;
  engine_number: string | null;
  license_plate: string | null;
  engine_size: string | null;
  fuel_type: string | null;
  source: string | null;
  status: string | null;
  attempted_vin: string | null;
  needs_review: boolean;
  needs_review_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ManualCollection {
  id: number;
  phone: string;
  status: string;
  attempted_vin: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  engine_number: string | null;
  needs_review: boolean;
  needs_review_reason: string | null;
  created_at: Date;
}

/**
 * Returns all confirmed `vehicles` rows for a phone (status null or 'complete'),
 * newest-updated first — the full set of vehicles a customer has on file.
 */
export async function getCustomerVehicles(phone: string): Promise<VehicleSession[]> {
  const { rows } = await db.query(
    `SELECT * FROM vehicles
     WHERE phone = $1
       AND (status IS NULL OR status = 'complete')
     ORDER BY updated_at DESC`,
    [phone]
  );
  return rows;
}

/**
 * Returns the single most recently updated confirmed `vehicles` row for a
 * phone, used e.g. to find the vehicle to delete when a customer rejects a just-confirmed vehicle.
 */
export async function getMostRecentVehicle(phone: string): Promise<VehicleSession | null> {
  const { rows } = await db.query(
    `SELECT * FROM vehicles
     WHERE phone = $1
       AND (status IS NULL OR status = 'complete')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [phone]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Looks up one confirmed `vehicles` row by id, scoped to the given phone so a
 * customer can only resolve their own vehicles.
 */
export async function getVehicleById(phone: string, id: number): Promise<VehicleSession | null> {
  const { rows } = await db.query(
    `SELECT * FROM vehicles
     WHERE id = $1 AND phone = $2
       AND (status IS NULL OR status = 'complete')`,
    [id, phone]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Saves vehicle identification data to `vehicles`, marking it 'complete' —
 * updates the given row in place (COALESCE-merging in whatever fields are provided) when an `id` is passed,
 * otherwise always inserts a brand-new row so existing vehicles are never overwritten.
 */
export async function saveVehicleSession(
  phone: string,
  data: Partial<VehicleSession>,
  id?: number
): Promise<void> {
  const source = data.license_plate ? 'document' : (data.vin ? 'vin' : 'manual');

  const values = [
    data.vin || null,
    data.make || null,
    data.model || null,
    data.year || null,
    data.engine_number || null,
    data.license_plate || null,
    data.engine_size || null,
    data.fuel_type || null,
    source,
  ];

  if (id) {
    await db.query(
      `UPDATE vehicles SET
         vin = COALESCE($2, vin),
         make = COALESCE($3, make),
         model = COALESCE($4, model),
         year = COALESCE($5, year),
         engine_number = COALESCE($6, engine_number),
         license_plate = COALESCE($7, license_plate),
         engine_size = COALESCE($8, engine_size),
         fuel_type = COALESCE($9, fuel_type),
         source = COALESCE($10, source),
         status = 'complete',
         updated_at = NOW()
       WHERE id = $1`,
      [id, ...values]
    );
    return;
  }

  await db.query(
    `INSERT INTO vehicles
       (phone, vin, make, model, year, engine_number, license_plate, engine_size, fuel_type, source, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'complete', NOW(), NOW())`,
    [phone, ...values]
  );
}

/**
 * Deletes a single `vehicles` row by id, used when a customer rejects a
 * just-confirmed vehicle.
 */
export async function clearVehicleSession(id: number): Promise<void> {
  await db.query("DELETE FROM vehicles WHERE id = $1", [id]);
}

/**
 * Caches a decoded VIN's make/model/year/etc into `nhtsa_vehicles`, keyed by
 * uppercased VIN, so future lookups of the same VIN can skip the NHTSA API call.
 */
export async function saveNhtsaVehicle(
  vin: string,
  data: {
    make: string;
    model: string;
    year: string;
    vehicle_type?: string | null;
    engine?: string | null;
    fuel_type?: string | null;
    manufacture_country?: string | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO nhtsa_vehicles (vin, make, model, year, vehicle_type, engine, fuel_type, manufacture_country)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (vin) DO NOTHING`,
    [
      vin.toUpperCase(),
      data.make,
      data.model,
      data.year,
      data.vehicle_type || null,
      data.engine || null,
      data.fuel_type || null,
      data.manufacture_country || null,
    ]
  );
}

/**
 * Looks up a previously cached VIN decode in `nhtsa_vehicles` by uppercased
 * VIN, to avoid re-calling the NHTSA API for a VIN seen before.
 */
export async function getNhtsaVehicle(vin: string): Promise<any | null> {
  const { rows } = await db.query(
    "SELECT * FROM nhtsa_vehicles WHERE vin = $1",
    [vin.toUpperCase()]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Inserts a new in-progress `vehicles` row (source 'manual') to kick off the
 * manual make/model/year/engine-number collection wizard, recording the failed VIN attempt if there was one.
 * Returns the new row's id.
 */
export async function startManualCollection(phone: string, status: string, attemptedVin: string | null = null): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO vehicles (phone, status, attempted_vin, source, created_at, updated_at)
     VALUES ($1, $2, $3, 'manual', NOW(), NOW())
     RETURNING id`,
    [phone, status, attemptedVin]
  );
  return rows[0].id;
}

/**
 * Finds the customer's in-progress manual vehicle-collection row (status set
 * and not 'complete') started within the last 30 minutes, or null if there's no active wizard session.
 */
export async function getActiveManualCollection(phone: string): Promise<ManualCollection | null> {
  const { rows } = await db.query(
    `SELECT * FROM vehicles
     WHERE phone = $1
       AND status IS NOT NULL AND status != 'complete'
       AND created_at > NOW() - INTERVAL '30 minutes'
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Dynamically updates whichever `ManualCollection` fields are present in
 * `fields` on the `vehicles` row for the given id, advancing the manual collection wizard step. No-ops if
 * `fields` is empty.
 */
export async function updateManualCollection(id: number, fields: Partial<ManualCollection>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;

  const setClauses = keys.map((key, index) => `"${key}" = $${index + 2}`).join(', ');
  const values = keys.map((key) => (fields as any)[key]);

  await db.query(
    `UPDATE vehicles SET ${setClauses} WHERE id = $1`,
    [id, ...values]
  );
}
