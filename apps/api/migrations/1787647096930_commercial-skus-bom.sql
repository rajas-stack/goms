-- Up Migration

-- Every FK to commercial_masters is intentionally untyped by master_key
-- (matching edition_features' existing precedent) — the column name already
-- implies which kind of master row is expected.
CREATE TABLE commercial_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES commercial_masters(id),
  feature_id UUID NOT NULL REFERENCES commercial_masters(id),
  edition_id UUID NOT NULL REFERENCES commercial_masters(id),
  uom_id UUID NOT NULL REFERENCES commercial_masters(id),
  currency_id UUID NOT NULL REFERENCES commercial_masters(id),
  tax_class_id UUID NOT NULL REFERENCES commercial_masters(id),
  billing_type_id UUID NOT NULL REFERENCES commercial_masters(id),
  active_from DATE NOT NULL,
  active_till DATE,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','active','inactive','retired')),
  is_sellable BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,

  -- Cost Management — PCS-020..025
  base_software_cost NUMERIC NOT NULL DEFAULT 0,
  implementation_cost_per_mm NUMERIC NOT NULL DEFAULT 0,
  integration_cost NUMERIC NOT NULL DEFAULT 0,
  third_party_cost NUMERIC NOT NULL DEFAULT 0,
  hardware_cost NUMERIC NOT NULL DEFAULT 0,
  cloud_cost NUMERIC NOT NULL DEFAULT 0,
  support_cost NUMERIC NOT NULL DEFAULT 0,
  training_cost NUMERIC NOT NULL DEFAULT 0,

  -- Pricing Levels — PCS-026/027, all in this SKU's currency
  internal_price NUMERIC NOT NULL DEFAULT 0,
  floor_price NUMERIC NOT NULL DEFAULT 0,
  partner_price NUMERIC NOT NULL DEFAULT 0,
  government_price NUMERIC NOT NULL DEFAULT 0,
  enterprise_price NUMERIC NOT NULL DEFAULT 0,
  corporate_price NUMERIC NOT NULL DEFAULT 0,
  list_price NUMERIC NOT NULL DEFAULT 0,

  minimum_allowed_price NUMERIC NOT NULL,
  -- Fallback ceiling used only when a line has no active pricing level (or a
  -- level with no per-level override) — see selected_pricing_levels below.
  maximum_discount_percent NUMERIC NOT NULL DEFAULT 90,

  -- Levels an admin has explicitly enabled for this SKU via "Set Pricing
  -- Levels" — [{ level, maximumDiscountPercent }, ...]. Each entry's
  -- maximumDiscountPercent is independent of every other entry's — never a
  -- field shared between two different levels (2026-08-20 UI correction).
  selected_pricing_levels JSONB NOT NULL DEFAULT '[]',

  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commercial_skus_sku_code_idx ON commercial_skus (sku_code);
CREATE INDEX commercial_skus_feature_id_idx ON commercial_skus (feature_id);

-- Component links are RESTRICT (the default), never CASCADE: PCS-038 requires
-- a clean, explicit "still referenced" error on delete, not a silent
-- cross-table cascade — the router checks and throws before ever issuing the
-- DELETE, matching commercial_masters' own delete-guard precedent.
CREATE TABLE commercial_bom_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_sku_id UUID NOT NULL REFERENCES commercial_skus(id),
  component_sku_id UUID NOT NULL REFERENCES commercial_skus(id),
  mandatory BOOLEAN NOT NULL DEFAULT false,
  quantity NUMERIC NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX commercial_bom_items_parent_sku_id_idx ON commercial_bom_items (parent_sku_id);
CREATE INDEX commercial_bom_items_component_sku_id_idx ON commercial_bom_items (component_sku_id);

-- Down Migration

DROP TABLE commercial_bom_items;
DROP TABLE commercial_skus;
