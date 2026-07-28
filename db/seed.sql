-- ============================================================
-- Rede Peças — Sample data for development
-- Data values are in English for this dev/demo seed.
--
-- Safe to run repeatedly (npm run db:seed) — every statement is a guarded
-- insert or an upsert, so re-running always resets products back to their
-- canonical seed state instead of accumulating duplicates or leaving behind
-- whatever quantity a previous manual test left a row at.
-- ============================================================

-- Dev admin login: admin@redepecas.ao / admin123 (bcrypt hash below — change
-- the password immediately in any environment this seed reaches beyond local dev).
-- npm run db:seed
INSERT INTO admin_users (name, email, phone, password_hash) VALUES
  ('Admin', 'admin@redepecas.ao', '917987760774', '$2a$10$UVANI9fapZOKB5T8opdS4.FtEkSYk42ISUp0NQhSAeNvxQIrGZLt6')
ON CONFLICT (email) DO NOTHING;

-- suppliers.name has no unique constraint (a real supplier name isn't
-- guaranteed unique, and getOrCreateSupplierByName only does a plain ILIKE
-- lookup) — guard each seed row with NOT EXISTS instead so re-running this
-- file doesn't pile up duplicate rows the way a bare INSERT would.
INSERT INTO suppliers (name, province, rating)
SELECT 'Luanda Auto Parts', 'Luanda', 4.8
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'Luanda Auto Parts');

INSERT INTO suppliers (name, province, rating)
SELECT 'Angola Moto Parts', 'Luanda', 4.5
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'Angola Moto Parts');

INSERT INTO suppliers (name, province, rating)
SELECT 'Import Car Parts', 'Benguela', 4.2
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'Import Car Parts');

-- ============================================================
-- Products (2026-07-28 catalog split — see db/schema.sql): a `products` row
-- is the part's identity only, keyed by `reference`; who sells it (and at
-- what price/quantity) lives in `product_suppliers`; what it fits lives in
-- `product_vehicles`. Each part below is seeded across all three tables.
-- category/subcategory/service_category/synonyms/description are all NOT
-- NULL — see the products table comment in db/schema.sql. service_category
-- is the derived SUBCATEGORY_TO_SERVICE_CATEGORY grouping
-- (src/constants/serviceCategory.ts).
-- ============================================================
INSERT INTO products (name, brand, reference, synonyms, category_keywords, category, subcategory, service_category, description)
VALUES
  ('Mann Oil Filter W712/75',    'Mann',       'W712/75',     'oil filter lubricant filter', 'oil filter engine',          'lubricant', 'Filtration', 'maintenance',      'Mann Oil Filter W712/75'),
  ('Bosch Oil Filter P7153',     'Bosch',      'P7153',       'oil filter lubricant filter', 'oil filter engine',          'lubricant', 'Filtration', 'maintenance',      'Bosch Oil Filter P7153'),
  ('Mahle Oil Filter OC611',     'Mahle',      'OC611',       'oil filter original oem',     'oil filter engine',          'lubricant', 'Filtration', 'maintenance',      'Mahle Oil Filter OC611'),
  ('Original VW Oil Filter',     'VW OEM',     '06J115403Q',  'oil filter original oem',     'oil filter engine',          'lubricant', 'Filtration', 'maintenance',      'Original VW Oil Filter'),
  ('Hilux Front Shock Absorber', 'KYB',        'KYB334816',   'shock absorber front strut',  'suspension shock absorber',  'part',      'Suspension', 'general_mechanics', 'Hilux Front Shock Absorber'),
  ('Golf Front Brake Pads',      'Textar',     'TEX2369201',  'brake pads brake shoes',      'brakes brake pads',          'part',      'Brakes',     'general_mechanics', 'Golf Front Brake Pads'),
  ('Mann Oil Filter W712/75 Kit','Mann',       'W712/75-KIT', 'oil filter lubricant filter', 'oil filter engine',          'lubricant', 'Filtration', 'maintenance',      'Mann Oil Filter W712/75 Kit'),
  ('Continental Timing Belt CT1028', 'Continental', 'CT1028',  'timing belt distribution belt','timing belt engine',       'part',      'Engine',     'general_mechanics', 'Continental Timing Belt CT1028'),
  ('Fram Air Filter CA1234',     'Fram',       'CA1234',      'air filter engine filter',     'air filter engine',         'part',      'Filtration', 'maintenance',      'Fram Air Filter CA1234')
ON CONFLICT (reference) DO UPDATE SET
  name = EXCLUDED.name, brand = EXCLUDED.brand, synonyms = EXCLUDED.synonyms,
  category_keywords = EXCLUDED.category_keywords, category = EXCLUDED.category,
  subcategory = EXCLUDED.subcategory, service_category = EXCLUDED.service_category,
  description = EXCLUDED.description, active = true;

-- Who sells each part, and at what price/quantity/delivery time. Note
-- (product_id, supplier_id) is the upsert key — the same product could
-- appear here again under a different supplier without touching this row.
INSERT INTO product_suppliers (product_id, supplier_id, price, quantity, delivery_time)
VALUES
  ((SELECT id FROM products WHERE reference = 'W712/75'),     (SELECT id FROM suppliers WHERE name = 'Luanda Auto Parts'), 2500,  8, 'Today'),
  ((SELECT id FROM products WHERE reference = 'P7153'),       (SELECT id FROM suppliers WHERE name = 'Angola Moto Parts'), 3100, 12, 'Today'),
  ((SELECT id FROM products WHERE reference = 'OC611'),       (SELECT id FROM suppliers WHERE name = 'Luanda Auto Parts'), 3800,  5, 'Today'),
  ((SELECT id FROM products WHERE reference = '06J115403Q'),  (SELECT id FROM suppliers WHERE name = 'Import Car Parts'),  5200,  2, 'Today'),
  ((SELECT id FROM products WHERE reference = 'KYB334816'),   (SELECT id FROM suppliers WHERE name = 'Luanda Auto Parts'), 18500, 4, 'Today'),
  ((SELECT id FROM products WHERE reference = 'TEX2369201'),  (SELECT id FROM suppliers WHERE name = 'Angola Moto Parts'), 7200, 10, 'Today'),
  -- Sample product whose service_category has matching seeded services below
  -- (Filtration -> maintenance), to exercise the WhatsApp service-matching
  -- follow-up (see CLAUDE.md message pipeline / product.service.ts's
  -- startOrderForProduct -> getMatchingServicesForProduct).
  ((SELECT id FROM products WHERE reference = 'W712/75-KIT'), (SELECT id FROM suppliers WHERE name = 'Luanda Auto Parts'), 2500,  6, 'Today'),
  -- Out-of-stock offers (quantity = 0) — exercise the waitlist →
  -- restock-notification → "Order now" chain (see TESTING.md).
  ((SELECT id FROM products WHERE reference = 'CT1028'),      (SELECT id FROM suppliers WHERE name = 'Angola Moto Parts'), 9800,  0, 'Today'),
  ((SELECT id FROM products WHERE reference = 'CA1234'),      (SELECT id FROM suppliers WHERE name = 'Import Car Parts'),  4200,  0, 'Today')
ON CONFLICT (product_id, supplier_id) DO UPDATE SET
  price = EXCLUDED.price, quantity = EXCLUDED.quantity, delivery_time = EXCLUDED.delivery_time, active = true;

-- What each part fits. Guarded with NOT EXISTS (not a unique constraint —
-- see product_vehicles in db/schema.sql) so re-running this file doesn't
-- pile up duplicate fit rows.
INSERT INTO product_vehicles (product_id, vehicle_make)
SELECT p.id, v.vehicle_make
FROM (VALUES
  ('W712/75',     'Various'),
  ('P7153',       'Various'),
  ('OC611',       'Various'),
  ('06J115403Q',  'Volkswagen'),
  ('KYB334816',   'Toyota'),
  ('TEX2369201',  'Volkswagen'),
  ('W712/75-KIT', 'Various'),
  ('CT1028',      'Various'),
  ('CA1234',       'Various')
) AS v(reference, vehicle_make)
JOIN products p ON p.reference = v.reference
WHERE NOT EXISTS (
  SELECT 1 FROM product_vehicles pv
  WHERE pv.product_id = p.id AND pv.vehicle_make = v.vehicle_make AND pv.vehicle_model IS NULL
);

-- ============================================================
-- Services domain (new 2026-07 catalog) — one provider + a few services
-- spanning maintenance/general_mechanics, so local dev/TESTING.md has
-- something to exercise the products.service_category <-> services join
-- against (see db/schema.sql services table).
-- ============================================================
INSERT INTO service_providers (name, address, province, phone, specialties, rating, response_time)
SELECT 'Auto Drex', 'Home Maintenance Services', 'Luanda', '244923000000', 'Multi-brand, Preventive Maintenance at Home', 4.9, 'Today'
WHERE NOT EXISTS (SELECT 1 FROM service_providers WHERE name = 'Auto Drex');

INSERT INTO services (provider_id, service_name, service_category, service_base_price, service_duration_h, available_at_home, base_travel_fee, logistics_fee_notes)
VALUES
  ((SELECT id FROM service_providers WHERE name = 'Auto Drex'), 'Engine Oil and Filter Change (Oil, Air, AC) - Petrol Engines', 'maintenance', 15000, 1.0, true, 5000, 'Zone 1 (Talatona/Kilamba/Benfica): 5000 Kz | Zone 2 (Maianga/Alvalade/Viana): 8000 Kz | Zone 3 (Baixa/Mutamba/Cacuaco): 12000 Kz'),
  ((SELECT id FROM service_providers WHERE name = 'Auto Drex'), 'Front Brake Pad Replacement', 'general_mechanics', 15000, 1.0, true, 5000, 'Zone 1 (Talatona/Kilamba/Benfica): 5000 Kz | Zone 2 (Maianga/Alvalade/Viana): 8000 Kz | Zone 3 (Baixa/Mutamba/Cacuaco): 12000 Kz'),
  ((SELECT id FROM service_providers WHERE name = 'Auto Drex'), 'Computerized Electronic Diagnostics (Scanner)', 'diagnostics', 15000, 0.5, true, 5000, 'Zone 1 (Talatona/Kilamba/Benfica): 5000 Kz | Zone 2 (Maianga/Alvalade/Viana): 8000 Kz | Zone 3 (Baixa/Mutamba/Cacuaco): 12000 Kz')
ON CONFLICT (provider_id, service_name) DO UPDATE SET
  service_category = EXCLUDED.service_category, service_base_price = EXCLUDED.service_base_price,
  service_duration_h = EXCLUDED.service_duration_h, available_at_home = EXCLUDED.available_at_home,
  base_travel_fee = EXCLUDED.base_travel_fee, logistics_fee_notes = EXCLUDED.logistics_fee_notes,
  active = true;
