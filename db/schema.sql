-- ============================================================
-- Rede Peças — Database Schema (PostgreSQL)
-- Ported from the original prototype (rede-pecas-agent/schema.sql)
-- with identifiers translated to English. Data content (part names,
-- synonyms) was originally Portuguese, hence the original 'portuguese'
-- full-text search configuration — as of 2026-07-14 the project is being
-- built/tested in English for now (see CLAUDE.md "Language split"), so
-- search_vector below uses the 'english' config to match.
-- ============================================================

-- REQUIRED EXTENSIONS
CREATE EXTENSION IF NOT EXISTS unaccent;       -- accent-insensitive search
CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- text similarity (typos)

-- unaccent() is only STABLE, not IMMUTABLE, so Postgres refuses it inside a
-- GENERATED ALWAYS column expression. Wrap it so it can be declared IMMUTABLE
-- (safe here: the 'unaccent' dictionary is fixed, not session/config-dependent).
CREATE OR REPLACE FUNCTION immutable_unaccent(TEXT) RETURNS TEXT AS $$
  SELECT unaccent('unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- ============================================================
-- SUPPLIERS
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  nif           TEXT,                           -- Angolan tax ID
  province      TEXT,
  rating        NUMERIC(2,1) DEFAULT 5.0,       -- 0.0 to 5.0
  api_key       TEXT UNIQUE,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MINIFICATION: categories, the static vehicle-compatibility catalog
-- (formerly "vehicles"), and its join table "compatibilities" have zero
-- code references anywhere in the app (nothing populates or reads them
-- outside seed data) and are dropped entirely. Guarded so a database
-- already migrated to the new schema — where "vehicles" is the new
-- phone-keyed table created later in this file — is never affected.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'year_from'
  ) THEN
    DROP TABLE IF EXISTS compatibilities;
    DROP TABLE vehicles;
  END IF;
END $$;

DROP TABLE IF EXISTS compatibilities;

-- ============================================================
-- PRODUCTS (formerly "parts" — renamed for clarity; the auto-parts
-- domain vocabulary still calls them "peças" everywhere else)
-- ============================================================
ALTER TABLE IF EXISTS parts RENAME TO products;
ALTER INDEX IF EXISTS idx_parts_fts RENAME TO idx_products_fts;
ALTER INDEX IF EXISTS idx_parts_supplier RENAME TO idx_products_supplier;
ALTER INDEX IF EXISTS idx_parts_price RENAME TO idx_products_price;
ALTER INDEX IF EXISTS idx_parts_active RENAME TO idx_products_active;

-- ============================================================
-- PRODUCTS (2026-07-28: split into three tables — see product_suppliers/
-- product_vehicles below). A products row is now the part's IDENTITY only
-- (name, description, category, ...) — one row per real physical part,
-- keyed by `reference` alone (previously (supplier_id, reference), back
-- when a row conflated "this part" with "one supplier's listing of it").
-- Price/quantity/delivery_time (differ per supplier) live in
-- product_suppliers; vehicle fit (a part can fit several vehicles) lives in
-- product_vehicles. This is what lets the same physical part have multiple
-- suppliers and multiple compatible vehicles without duplicating the
-- product itself — see product.model.ts and supplier.model.ts's
-- importProductsBatch for the read/write side of this split.
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id               SERIAL PRIMARY KEY,

  -- Identification
  name             TEXT NOT NULL,               -- e.g. "Filtro de óleo Mann W712/75"
  brand            TEXT,                        -- e.g. "Mann", "Bosch", "Original" — also holds the catalog CSV's part_brand
  reference        TEXT NOT NULL UNIQUE,        -- e.g. "W712/75" — identifies the physical part, consistent across suppliers
  oem_reference    TEXT,                        -- original manufacturer reference
  synonyms         TEXT NOT NULL,                -- e.g. "filtro oleo, oil filter"
  category_keywords TEXT,                       -- free text for search
  description      TEXT NOT NULL,

  -- Catalog classification. `subcategory` is the fine-grained catalog value
  -- (Brakes, Engine, Filtration, Mechanical, Steering, Suspension,
  -- Transmission, Engine Oil, ...) — free text, no allow-list at the DB or
  -- app layer. `service_category` is no longer a derived 3-bucket grouping —
  -- it carries the same subcategory-vocabulary values directly (e.g.
  -- "Brakes"), because that's the literal join key against
  -- services.service_category — "which services are relevant to this
  -- product" is a plain equality match on it. In practice this column is
  -- set equal to `subcategory` at import/edit time.
  category         TEXT NOT NULL,               -- 'part' | 'lubricant'
  subcategory      TEXT NOT NULL,
  service_category TEXT NOT NULL,
  -- Part condition/origin, from the products CSV — free text (e.g. 'OEM',
  -- 'Aftermarket', 'New', 'Second Hand'), no allow-list. Nullable: existing
  -- catalog rows predate this column and stay NULL until re-imported;
  -- search treats NULL as a wildcard
  -- (see searchProductsInInventory) rather than excluding them.
  product_type     TEXT,

  -- Lubricant-only specs (populated only when category = 'lubricant') —
  -- describe the product itself (e.g. "5W-30 synthetic"), not a specific
  -- vehicle fit, so they stay here rather than moving to product_vehicles.
  viscosity        TEXT,
  engine_type      TEXT,
  volume_liters    NUMERIC(5,2),

  specification    TEXT,
  interval_km      INT,
  image_url        TEXT,

  -- Control
  active           BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  -- Full-text search index (auto-generated). Config is 'english' for now
  -- (2026-07-14) while catalog data is being entered in English — see the
  -- file header comment and CLAUDE.md "Language split".
  search_vector    TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english',
      immutable_unaccent(name) || ' ' ||
      immutable_unaccent(COALESCE(brand, '')) || ' ' ||
      immutable_unaccent(COALESCE(reference, '')) || ' ' ||
      immutable_unaccent(COALESCE(oem_reference, '')) || ' ' ||
      immutable_unaccent(COALESCE(synonyms, '')) || ' ' ||
      immutable_unaccent(COALESCE(category_keywords, ''))
    )
  ) STORED
);

-- An existing database still has the old single-row-per-supplier shape —
-- drop the columns that moved out, and the old (supplier_id, reference)
-- unique constraint, before applying the new bare UNIQUE(reference) above
-- (already on the CREATE TABLE for a fresh install; ALTER here covers an
-- existing table where the column predates this change).
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_supplier_id_reference_key;
ALTER TABLE products DROP COLUMN IF EXISTS supplier_id;
ALTER TABLE products DROP COLUMN IF EXISTS vehicle_make;
ALTER TABLE products DROP COLUMN IF EXISTS vehicle_model;
ALTER TABLE products DROP COLUMN IF EXISTS year_start;
ALTER TABLE products DROP COLUMN IF EXISTS year_end;
ALTER TABLE products DROP COLUMN IF EXISTS engine;
ALTER TABLE products DROP COLUMN IF EXISTS engine_number;
ALTER TABLE products DROP COLUMN IF EXISTS delivery_time;
ALTER TABLE products DROP COLUMN IF EXISTS price;
ALTER TABLE products DROP COLUMN IF EXISTS quantity;
ALTER TABLE products DROP COLUMN IF EXISTS unit;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_reference_key'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_reference_key UNIQUE (reference);
  END IF;
END $$;

-- ============================================================
-- PRODUCT_SUPPLIERS — one row per (product, supplier): that supplier's
-- price/quantity/delivery time for this part. A part sold by 3 suppliers
-- has 3 rows here, all pointing at the same products row. This is the
-- table search/orders/waitlist actually reference as "the thing being
-- bought" — see the product_id comment on orders/waitlist_requests below.
-- ============================================================
CREATE TABLE IF NOT EXISTS product_suppliers (
  id            SERIAL PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id   INT NOT NULL REFERENCES suppliers(id),
  price         NUMERIC(12,2) NOT NULL,      -- in Kwanzas (AOA)
  quantity      INT NOT NULL DEFAULT 0,
  delivery_time TEXT NOT NULL,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  -- Required by the supplier batch-import upsert
  UNIQUE (product_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_product_suppliers_product ON product_suppliers (product_id);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier ON product_suppliers (supplier_id);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_price ON product_suppliers (price);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_active ON product_suppliers (active) WHERE active = true;

-- ============================================================
-- PRODUCT_VEHICLES — one row per (product, compatible vehicle). A part
-- that fits 4 cars has 4 rows here. `engine`/`engine_number` describe the
-- vehicle's engine this fit applies to (not the customer's own vehicle —
-- see vehicles.engine_number for that).
-- ============================================================
CREATE TABLE IF NOT EXISTS product_vehicles (
  id             SERIAL PRIMARY KEY,
  product_id     INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vehicle_make   TEXT NOT NULL,
  vehicle_model  TEXT,
  year_start     INT,
  year_end       INT,
  engine         TEXT,
  engine_number  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_vehicles_product ON product_vehicles (product_id);
CREATE INDEX IF NOT EXISTS idx_product_vehicles_make ON product_vehicles (vehicle_make);

ALTER TABLE products DROP COLUMN IF EXISTS category_id;
-- Replaced by the waitlist_requests table below — a real table records who
-- joined and when, which an opaque array column couldn't.
ALTER TABLE products DROP COLUMN IF EXISTS waitlist_phones;
-- Retired as of the services-domain matching feature: a product's "attached
-- service" is no longer a static per-product field — it's now whichever
-- services table row(s) share this product's service_category (see the
-- services table below). orders.service_name/service_price (the accepted-
-- service snapshot on a placed order) are untouched — unrelated concept.
ALTER TABLE products DROP COLUMN IF EXISTS service_offered;
ALTER TABLE products DROP COLUMN IF EXISTS service_name;
ALTER TABLE products DROP COLUMN IF EXISTS service_price;

-- Catalog columns from the 2026-07 products CSV import (category, subcategory,
-- lubricant specs — see the products table comment above) so an existing
-- database can be backfilled before the NOT NULL constraints below are
-- applied. vehicle_make/vehicle_model/year_start/year_end/engine/
-- engine_number/delivery_time used to be added back here too — as of the
-- products/product_suppliers/product_vehicles split above, those columns
-- were dropped from products for good, so they're deliberately no longer
-- re-added in this block (re-adding them here would silently undo that
-- split on every migrate run).
ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS service_category TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS viscosity TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS engine_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_liters NUMERIC(5,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS specification TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS interval_km INT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Backfill placeholders for rows inserted before this migration (the CSV
-- importer always supplies real values for these — this only covers
-- pre-existing seed/manual rows so the SET NOT NULL below doesn't fail).
UPDATE products SET
  category         = COALESCE(category, 'part'),
  subcategory      = COALESCE(subcategory, 'Mechanical'),
  -- service_category tracks subcategory directly (see the column comment
  -- above) — fall back to whatever subcategory just got backfilled, not the
  -- old 3-bucket 'general_mechanics' default.
  service_category = COALESCE(service_category, subcategory, 'Mechanical'),
  synonyms         = COALESCE(synonyms, ''),
  description      = COALESCE(description, name)
WHERE category IS NULL OR subcategory IS NULL OR service_category IS NULL
   OR synonyms IS NULL OR description IS NULL;

ALTER TABLE products ALTER COLUMN category SET NOT NULL;
ALTER TABLE products ALTER COLUMN subcategory SET NOT NULL;
ALTER TABLE products ALTER COLUMN service_category SET NOT NULL;
ALTER TABLE products ALTER COLUMN synonyms SET NOT NULL;
ALTER TABLE products ALTER COLUMN description SET NOT NULL;

-- A generated column's expression can't be changed via ALTER COLUMN, so an
-- existing database (created before the 'portuguese' -> 'english' switch
-- above) needs search_vector dropped and re-added to pick up the new config.
-- Safe to re-run: once it matches, this whole block is a same-definition
-- drop+recreate (wasteful but harmless), not a no-op skip.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'search_vector'
  ) AND (
    SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef
    WHERE adrelid = 'products'::regclass
      AND adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = 'products'::regclass AND attname = 'search_vector')
  ) NOT LIKE '%english%' THEN
    ALTER TABLE products DROP COLUMN search_vector;
    ALTER TABLE products ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (
      to_tsvector('english',
        immutable_unaccent(name) || ' ' ||
        immutable_unaccent(COALESCE(brand, '')) || ' ' ||
        immutable_unaccent(COALESCE(reference, '')) || ' ' ||
        immutable_unaccent(COALESCE(oem_reference, '')) || ' ' ||
        immutable_unaccent(COALESCE(synonyms, '')) || ' ' ||
        immutable_unaccent(COALESCE(category_keywords, ''))
      )
    ) STORED;
  END IF;
END $$;

-- idx_products_supplier/idx_products_price used to live here — supplier_id
-- and price moved to product_suppliers (see idx_product_suppliers_supplier/
-- idx_product_suppliers_price above) along with the rest of the split.
CREATE INDEX IF NOT EXISTS idx_products_fts ON products USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_products_active ON products (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_products_service_category ON products (service_category);
DROP INDEX IF EXISTS idx_products_supplier;
DROP INDEX IF EXISTS idx_products_price;

-- ============================================================
-- DATA FIX (2026-07-22, moot as of the 2026-07-28 products split above):
-- produtos_rede_pecas_via_pecas_v3_EN.csv has ~90 rows (mostly branded
-- filters/brakes/shocks — NGK, KYB, Ashika, Blue Print, SAS, Hi-Q, FMSI,
-- CTR, GMB, Klaxcar, KBS, Blackstorm, Venol — plus all 47 "Yato" rows, which
-- are power tools, not vehicle parts at all) where a parts-brand name landed
-- in vehicle_make instead of brand, bumping the real vehicle make down into
-- vehicle_model and the real model down into engine. This silently broke
-- the vehicle hard-filter in searchProductsInInventory (product.model.ts)
-- — e.g. an "Ashika" oil filter that actually fits Hyundai/Kia never
-- matched a registered Hyundai/Kia customer, since vehicle_make held
-- "Ashika" instead of "Hyundai/Kia". One-time correction, idempotent — each
-- WHERE vehicle_make = '<brand>' stops matching anything once corrected, so
-- a second run is a no-op. vehicle_make/vehicle_model/engine no longer
-- exist on `products` after the split above (they're on product_vehicles
-- now), so this whole block is guarded to skip entirely on any database
-- that's been through that migration — kept only for a database migrating
-- straight from before 2026-07-22.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'vehicle_make'
  ) THEN
    -- Yato: a power-tools brand, not vehicle-specific — a wrench or drill
    -- fits any vehicle job, so these become a wildcard fit rather than a
    -- swapped make/model (their "vehicle_model" was actually a
    -- product-type placeholder — Tool/Equipment/Electric/Consumable/EPI —
    -- not a real vehicle model at all).
    UPDATE products SET
      brand = 'Yato', vehicle_make = 'Various', vehicle_model = NULL, engine = NULL
    WHERE vehicle_make = 'Yato';

    -- Generic swap for the branded-parts rows: real make was in
    -- vehicle_model, real model (when present) was in engine. Rows whose
    -- vehicle_model was 'Various' had no real make/model recorded at all
    -- (a generic part), so they collapse to a wildcard fit instead of a swap.
    UPDATE products SET
      brand = vehicle_make, vehicle_make = 'Various', vehicle_model = NULL, engine = NULL
    WHERE vehicle_make IN ('SAS','NGK','Blue Print','KYB','Ashika','Hi-Q (Sangsin)','Hi-Q','FMSI','CTR','Blackstorm','Venol','Klaxcar','KBS','GMB')
      AND vehicle_model = 'Various';

    UPDATE products SET
      brand = vehicle_make, vehicle_make = vehicle_model, vehicle_model = NULLIF(engine, 'Various'), engine = NULL
    WHERE vehicle_make IN ('SAS','NGK','Blue Print','KYB','Ashika','Hi-Q (Sangsin)','Hi-Q','FMSI','CTR','Blackstorm','Venol','Klaxcar','KBS','GMB')
      AND vehicle_model <> 'Various';

    -- AMG (Mercedes' performance division) and Baldwin/Mercedes (a filter
    -- brand) both implied a Mercedes fit that was never actually recorded as such.
    UPDATE products SET brand = 'AMG', vehicle_make = 'Mercedes', vehicle_model = NULL
    WHERE vehicle_make = 'AMG';

    UPDATE products SET brand = 'Baldwin', vehicle_make = 'Mercedes', vehicle_model = NULL
    WHERE vehicle_make = 'Baldwin/Mercedes';

    -- Motorcraft/Ford: vehicle_model ("F-150/Mustang") and engine ("V8")
    -- were already correct — only vehicle_make conflated the brand with
    -- the real make.
    UPDATE products SET brand = 'Motorcraft', vehicle_make = 'Ford'
    WHERE vehicle_make = 'Motorcraft/Ford';

    -- Plain typo in the source file (also fixed in product.service.ts's
    -- vehicleFieldMatches wildcard list going forward, but existing rows
    -- still needed this one-time correction).
    UPDATE products SET vehicle_make = 'Aftermarket' WHERE vehicle_make = 'AftermarkeDt';
  END IF;
END $$;

DROP TABLE IF EXISTS categories;

-- ============================================================
-- SERVICE_PROVIDERS — separate from `suppliers` (parts suppliers): a
-- provider offers home-visit repair/maintenance/diagnostic *services*, not
-- parts stock, and carries fields (specialties, response_time) with no
-- parts-supplier equivalent. Mirrors suppliers' shape/soft-delete pattern.
-- ============================================================
CREATE TABLE IF NOT EXISTS service_providers (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  address        TEXT,
  province       TEXT,
  phone          TEXT,
  specialties    TEXT,
  rating         NUMERIC(2,1) DEFAULT 5.0,
  response_time  TEXT,
  active         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_providers_active ON service_providers (active) WHERE active = true;

-- ============================================================
-- SERVICES — a provider's individual bookable services. service_category is
-- the literal join key against products.service_category above — "find
-- services relevant to this product" is
-- `WHERE services.service_category = products.service_category`. Not the
-- same concept as products.service_offered/service_name/service_price (the
-- existing *attached, product-bundled* installation-style service) — these
-- are standalone bookable services from a real provider catalog.
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id                    SERIAL PRIMARY KEY,
  provider_id           INT NOT NULL REFERENCES service_providers(id),
  service_name          TEXT NOT NULL,
  -- Same vocabulary as products.subcategory (e.g. "Brakes", "Engine") — no
  -- longer the old maintenance/general_mechanics/diagnostics 3-bucket
  -- scheme. Existing rows imported under the old scheme must be re-imported/
  -- edited to the new vocabulary or they'll stop matching any product.
  service_category      TEXT NOT NULL,
  service_base_price    NUMERIC(12,2) NOT NULL,
  service_duration_h    NUMERIC(4,2) NOT NULL,
  available_at_home     BOOLEAN NOT NULL DEFAULT false,
  base_travel_fee       NUMERIC(12,2),
  logistics_fee_notes   TEXT,
  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (provider_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_services_provider ON services (provider_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services (service_category);
CREATE INDEX IF NOT EXISTS idx_services_active ON services (active) WHERE active = true;

-- ============================================================
-- ORDERS
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'part_id'
  ) THEN
    ALTER TABLE orders RENAME COLUMN part_id TO product_id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS orders (
  id                      SERIAL PRIMARY KEY,
  number                  TEXT UNIQUE NOT NULL,  -- e.g. "RP-2026-00123"
  customer_phone          TEXT NOT NULL,
  -- References product_suppliers(id), not products(id) — as of the
  -- 2026-07-28 catalog split (see product_suppliers above), "the thing a
  -- customer orders" is a specific supplier's offer of a product, not the
  -- abstract product itself. Column name kept as `product_id` to avoid
  -- churning every reader/writer of it; only what it points at changed.
  product_id              INT REFERENCES product_suppliers(id),
  supplier_id             INT REFERENCES suppliers(id),
  quantity                INT DEFAULT 1,
  unit_price              NUMERIC(12,2),
  -- Status state machine: awaiting_payment (placeholder while the customer is
  -- still deciding on an attached service, if any — see product.service.ts)
  -- → awaiting_stock_confirmation (admin confirms availability with the
  -- supplier via the admin panel, not WhatsApp) → stock_unavailable (terminal,
  -- admin declines) | awaiting_payment_method → awaiting_bank_subtype (bank
  -- transfer/deposit only — Multicaixa Express and Mobile POS confirm directly,
  -- no subtype step) → awaiting_payment_proof → awaiting_proof_verification
  -- (transient, set for the duration of the Claude Vision validation call in
  -- processPaymentProof — reverts to awaiting_payment_proof if the proof is
  -- invalid) → payment_proof_received → approved | rejected. Mobile POS (the
  -- only method that doesn't require a proof) skips straight to
  -- awaiting_agent_confirmation, reviewed by the admin directly (approved |
  -- rejected) once payment is physically confirmed, instead of going through
  -- the proof-upload/verification path above.
  -- 'cancelled' is a legacy terminal status — no longer set by any code path
  -- (DELETE /orders/:number used to move an order here; as of 2026-07 that
  -- endpoint no longer touches status at all, see admin_hidden below). Kept
  -- in the exclusion list in getOrderAnalytics purely for any pre-existing
  -- rows, not because anything can produce a new one.
  status                  TEXT DEFAULT 'awaiting_payment',
  payment_method          TEXT,
  approved_by             TEXT,
  approved_at             TIMESTAMPTZ,
  customer_engine_number  TEXT,
  -- Payment proof (folded in from the former payment_proofs table —
  -- always a strict 1:1 with the order, so no benefit to a separate table)
  payment_proof_media_id  TEXT,
  payment_proof_media_type TEXT,
  -- Snapshot of the matched service the customer accepted on this order (see
  -- services table — matched to the product via service_category) — copied
  -- at accept-time, same idiom as unit_price, so a later catalog price
  -- change never alters a placed order. NULL means no matching service
  -- existed, or the customer declined every one offered.
  service_name            TEXT,
  service_price           NUMERIC(12,2),
  -- Set once the 20-minute "still confirming with the supplier" courtesy
  -- message has gone out, so the sweep in product.service.ts never resends it.
  stock_confirmation_courtesy_sent BOOLEAN DEFAULT false,
  -- Set once the 15-minute admin-reminder WhatsApp nudge has gone out for this
  -- order, so the sweep in product.service.ts never resends it.
  stock_confirmation_admin_reminder_sent BOOLEAN DEFAULT false,
  -- Purely an admin-panel display concern — hides an approved order from the
  -- admin grid (DELETE /admin/orders/:number, only ever allowed on an already-
  -- 'approved' order) without touching status, the customer's order, or
  -- sending any notification. The real order is untouched and still exists;
  -- this never gets set back to false from the UI today (no "restore" action).
  admin_hidden            BOOLEAN DEFAULT false,
  -- Multi-product "basket" orders (2026-07-27): when a customer names several
  -- distinct parts in one message, all of them land on ONE order instead of
  -- one order per product. product_id/unit_price/service_name/service_price
  -- above stay NULL for these orders; `items` holds the array instead, one
  -- entry per product: { itemId (1-based, stable for the order's lifetime —
  -- used in admin WhatsApp button ids), productId, productName, reference,
  -- supplierId, supplierName, quantity, unitPrice, serviceName, servicePrice,
  -- availabilityStatus ('pending' | 'available' | 'unavailable') }. NULL for
  -- every single-product order (the overwhelming majority) — an order is
  -- "multi-item" precisely when items IS NOT NULL, the only signal the code
  -- needs anywhere to pick between the legacy single-product path and this one.
  items                   JSONB,
  -- One part-type choice (OEM/Aftermarket/New/Second Hand) per order, asked
  -- once before search and applied to every part in it — not per line item.
  part_type               TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof_media_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof_media_type TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_price NUMERIC(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_hidden BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_confirmation_courtesy_sent BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_confirmation_admin_reminder_sent BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items JSONB;
-- One part-type choice (OEM/Aftermarket/New/Second Hand) per order, asked
-- once before search and applied to every part in it — not per line item.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS part_type TEXT;

-- Retarget orders.product_id's FK from products(id) to product_suppliers(id)
-- on an existing database — see the column comment above. Guarded so a
-- fresh install (whose CREATE TABLE already points at product_suppliers)
-- doesn't try to drop a constraint that was never created with this name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'orders' AND constraint_name = 'orders_product_id_fkey'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'orders_product_id_fkey' AND table_name = 'products'
  ) THEN
    ALTER TABLE orders DROP CONSTRAINT orders_product_id_fkey;
    ALTER TABLE orders ADD CONSTRAINT orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES product_suppliers(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders (customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

-- One-time data migration from payment_proofs, then drop it (idempotent: no-op once dropped)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_proofs') THEN
    UPDATE orders o
    SET payment_proof_media_id = pp.media_id,
        payment_proof_media_type = pp.media_type
    FROM payment_proofs pp
    WHERE pp.order_number = o.number;
  END IF;
END $$;

DROP TABLE IF EXISTS payment_proofs;

-- ============================================================
-- WAITLIST_REQUESTS — customers waiting for a restocked product. A real
-- table (not the earlier products.waitlist_phones array) so the admin panel
-- can list requests with who/which product/when, and notified_at tracks
-- whether the restock notification already went out for that request.
-- ============================================================
CREATE TABLE IF NOT EXISTS waitlist_requests (
  id             SERIAL PRIMARY KEY,
  -- References product_suppliers(id), not products(id) — same reasoning as
  -- orders.product_id above: a customer waitlists for a specific supplier's
  -- offer (the one that was out of stock), not the abstract product.
  product_id     INT NOT NULL REFERENCES product_suppliers(id),
  customer_phone TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  notified_at    TIMESTAMPTZ,
  UNIQUE (product_id, customer_phone)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_requests_product ON waitlist_requests (product_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_requests_notified ON waitlist_requests (notified_at);

-- Retarget waitlist_requests.product_id's FK from products(id) to
-- product_suppliers(id) on an existing database — see the column comment
-- above.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'waitlist_requests' AND constraint_name = 'waitlist_requests_product_id_fkey'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'waitlist_requests_product_id_fkey' AND table_name = 'products'
  ) THEN
    ALTER TABLE waitlist_requests DROP CONSTRAINT waitlist_requests_product_id_fkey;
    ALTER TABLE waitlist_requests ADD CONSTRAINT waitlist_requests_product_id_fkey FOREIGN KEY (product_id) REFERENCES product_suppliers(id);
  END IF;
END $$;

-- ============================================================
-- ADMIN_ALERTS — replaces the old "push a WhatsApp message to the admin's
-- own phone" pattern for payment-proof-received and in-person-payment-
-- requested events. Every SYSTEM → ADMIN notification now lives in the admin
-- panel as a queue the admin reads/marks read, not a WhatsApp push.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_alerts (
  id            SERIAL PRIMARY KEY,
  type          TEXT NOT NULL,              -- 'payment_proof' | 'in_person_payment' | 'order_status_request'
  order_number  TEXT REFERENCES orders(number),
  message       TEXT NOT NULL,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_read ON admin_alerts (read_at);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_created ON admin_alerts (created_at);

-- ============================================================
-- NHTSA vehicle cache (avoids repeated NHTSA API calls for the same VIN)
-- ============================================================
ALTER TABLE IF EXISTS vin_cache RENAME TO nhtsa_vehicles;

CREATE TABLE IF NOT EXISTS nhtsa_vehicles (
  vin                 CHAR(17) PRIMARY KEY,
  make                TEXT NOT NULL,
  model               TEXT NOT NULL,
  year                TEXT NOT NULL,
  vehicle_type        TEXT,
  engine              TEXT,
  fuel_type           TEXT,
  manufacture_country TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Order number counter per year (generates RP-2026-00001)
-- ============================================================
CREATE TABLE IF NOT EXISTS order_counters (
  year            INT PRIMARY KEY,
  last_number     INT NOT NULL DEFAULT 0
);

-- ============================================================
-- Supplier inventory sync log
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_logs (
  id                 SERIAL PRIMARY KEY,
  supplier_id        INT REFERENCES suppliers(id),
  inserted_count     INT DEFAULT 0,
  updated_count      INT DEFAULT 0,
  deactivated_count  INT DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_supplier ON sync_logs (supplier_id);

-- ============================================================
-- ADMIN_USERS — individual admin-panel accounts (replaces the single shared
-- ADMIN_PASSWORD login). `phone` is required so a forgotten password can be
-- reset via a WhatsApp-delivered code — no email/SMTP service exists in this
-- project. reset_code_hash/reset_code_expires_at hold a single pending reset
-- code at a time (bcrypt-hashed, not stored plain); NULL when none pending.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
  id                      SERIAL PRIMARY KEY,
  name                    TEXT NOT NULL,
  email                   TEXT NOT NULL UNIQUE,
  phone                   TEXT NOT NULL,
  password_hash           TEXT NOT NULL,
  reset_code_hash         TEXT,
  reset_code_expires_at   TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users (email);

-- ============================================================
-- CRM
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  phone                TEXT PRIMARY KEY,
  name                 TEXT,
  -- nif/address/customer_type used to be collected during registration
  -- (awaiting_nif/awaiting_nif_number/awaiting_address). As of the deferred-
  -- profile-capture change, they're captured per order (see
  -- orderProfile.service.ts), right after the order bucket is confirmed and
  -- before stock is checked — these columns now hold the customer's *last
  -- known* values, overwritten on every order, reused as a one-tap "use my
  -- saved details" shortcut for returning customers.
  nif                  TEXT,                    -- Angolan tax ID
  address              TEXT,
  customer_type        TEXT,                    -- 'individual' | 'company'
  email                TEXT,
  registration_status  TEXT DEFAULT 'new',      -- new, awaiting_name, complete (profile only — vehicle ID is tracked independently via the `vehicles` table; NIF/address/customer_type are tracked per-order, not here)
  first_contact_at     TIMESTAMPTZ DEFAULT NOW(),
  last_contact_at      TIMESTAMPTZ DEFAULT NOW(),
  registered_at        TIMESTAMPTZ,
  contact_count        INT DEFAULT 1,
  active               BOOLEAN DEFAULT true,
  needs_review         BOOLEAN DEFAULT false,   -- set when a profile field was accepted after exhausting validation retries
  needs_review_reason  TEXT                     -- which field(s) failed validation and why, for admin follow-up
);

-- Conversation locale used to be stamped here once from the customer's first
-- message and never re-evaluated (sticky) — removed as of 2026-07-17 in favor
-- of per-message detection cached in Redis session state (session.service.ts's
-- saveLocale/getLocale), so a customer switching language mid-conversation
-- gets answered in whatever they just typed instead of a frozen locale.
ALTER TABLE customers DROP COLUMN IF EXISTS locale;

-- Added 2026-07-27 — flags a profile field that was accepted with a
-- needs_review reason after exhausting validation retries (see validation.service.ts).
-- CREATE TABLE IF NOT EXISTS is a no-op on an already-existing table, so these
-- also need an explicit ALTER for installs that predate this change.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS needs_review_reason TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_status ON customers (registration_status);
CREATE INDEX IF NOT EXISTS idx_customers_last_contact ON customers (last_contact_at);
CREATE INDEX IF NOT EXISTS idx_customers_registered_at ON customers (registered_at);

DROP TABLE IF EXISTS campaign_sends;

-- ============================================================
-- VEHICLES — a customer can have multiple identified vehicles (see "add
-- another vehicle" in the message pipeline), so `id` is the primary key and
-- `phone` is a plain FK, not unique. `status` distinguishes a confirmed
-- vehicle (NULL/'complete', permanent — no expiry) from an in-progress
-- manual-entry wizard step (30-minute TTL via created_at) on that specific
-- row — at most one in-progress row per phone is enforced by application
-- logic, not a DB constraint. Must be created after `customers` (FK
-- dependency).
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id              SERIAL PRIMARY KEY,
  phone           TEXT NOT NULL REFERENCES customers(phone),
  vin             CHAR(17),
  make            TEXT,
  model           TEXT,
  year            TEXT,
  engine_number   TEXT,
  license_plate   TEXT,
  engine_size     TEXT,
  fuel_type       TEXT,
  source          TEXT,               -- 'vin' | 'manual' | 'document'
  status          TEXT,               -- NULL/'complete' = confirmed vehicle; other = in-progress manual wizard step
  attempted_vin   CHAR(17),           -- VIN that failed NHTSA decode before falling back to manual entry
  needs_review    BOOLEAN DEFAULT false, -- set when a vehicle field was accepted after exhausting validation retries
  needs_review_reason TEXT,           -- which field(s) failed validation and why, for admin follow-up
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Added 2026-07-27 — see the matching customers.needs_review ALTER above for why.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS needs_review_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_vehicles_phone ON vehicles (phone);
CREATE INDEX IF NOT EXISTS idx_vehicles_updated_at ON vehicles (updated_at);
CREATE INDEX IF NOT EXISTS idx_vehicles_status_created ON vehicles (status, created_at);

-- One-time shape migration: `vehicles.phone` used to be the primary key (one
-- vehicle per customer) before multi-vehicle support. Idempotent — a no-op
-- once the `id` column exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicles')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicles' AND column_name = 'id') THEN
    ALTER TABLE vehicles ADD COLUMN id SERIAL;
    ALTER TABLE vehicles DROP CONSTRAINT vehicles_pkey;
    ALTER TABLE vehicles ADD PRIMARY KEY (id);
  END IF;
END $$;

-- Customer registration and vehicle ID are now independent state machines (see
-- CLAUDE.md "The message pipeline") — 'awaiting_vehicle_id' no longer exists as a
-- registration_status value. Idempotent: a no-op once every row has been migrated.
UPDATE customers SET registration_status = 'complete' WHERE registration_status = 'awaiting_vehicle_id';

-- NIF/address/customer_type moved out of registration into the per-order
-- orderProfile flow (see the customers table comment above) — a customer
-- caught mid-way through the old awaiting_nif/awaiting_nif_number/
-- awaiting_address stages at deploy time is force-completed here rather than
-- left stuck on a stage that no longer exists. Idempotent: a no-op once every
-- row has been migrated.
UPDATE customers SET registration_status = 'complete'
WHERE registration_status IN ('awaiting_nif', 'awaiting_nif_number', 'awaiting_address');

DROP TABLE IF EXISTS vehicle_sessions;
DROP TABLE IF EXISTS manual_vehicle_collections;

-- ============================================================
-- CUSTOMER_DOCUMENTS — durable local copy of every file we ever receive
-- from (or generate for) a customer over WhatsApp: vehicle-ID photos,
-- payment-proof photos/PDFs, and generated proforma/invoice PDFs. Exists so
-- the app never has to re-hit Meta's Graph API to re-read a file it already
-- has, and so a file stays reachable past Meta's ~30-day media URL/id expiry
-- (previously a latent bug — nothing persisted bytes anywhere). Bytes live
-- on disk under storage/<phone>/ (see storage.service.ts); this table only
-- tracks where. Not a replacement for orders.payment_proof_media_id/
-- payment_proof_media_type (kept as-is) — those record the *original* Meta
-- media identity, this records our own durable copy of the bytes.
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_documents (
  id            SERIAL PRIMARY KEY,
  phone         TEXT NOT NULL REFERENCES customers(phone),
  kind          TEXT NOT NULL,     -- 'vehicle_photo' | 'payment_proof' | 'proforma_pdf' | 'invoice_pdf'
  order_number  TEXT REFERENCES orders(number),  -- NULL for vehicle_photo (not order-scoped)
  media_id      TEXT,              -- originating WhatsApp media id, when the file came from an inbound message
  file_path     TEXT NOT NULL,     -- local path, e.g. storage/<phone>/<kind>-<timestamp>.<ext>
  mime_type     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_documents_phone ON customer_documents (phone);
CREATE INDEX IF NOT EXISTS idx_customer_documents_order ON customer_documents (order_number);

-- ============================================================
-- PRODUCT_SUBCATEGORIES / PRODUCT_TYPES were a brief experiment (FK-backed
-- lookup tables for products.subcategory/service_category/product_type,
-- services.service_category, orders.part_type) — reverted: those columns
-- are plain free-text again, no allow-list at either the DB or app layer.
-- Idempotent teardown for any database that already picked up the FKs/tables.
-- ============================================================
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_subcategory_fkey;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_service_category_fkey;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_fkey;
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_service_category_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_part_type_fkey;
DROP TABLE IF EXISTS product_subcategories;
DROP TABLE IF EXISTS product_types;
