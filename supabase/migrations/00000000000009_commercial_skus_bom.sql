-- supabase/migrations/00000000000009_commercial_skus_bom.sql

create table public.commercial_skus (
  id                          uuid primary key default gen_random_uuid(),
  sku_code                    text not null unique,
  name                        text not null,
  category_id                 uuid not null references public.commercial_sku_categories (id),
  feature_id                  uuid not null references public.commercial_features (id),
  edition_id                  uuid not null references public.commercial_product_editions (id),
  uom_id                      uuid not null references public.commercial_units_of_measure (id),
  currency_id                 uuid not null references public.commercial_currencies (id),
  tax_class_id                uuid not null references public.commercial_tax_classes (id),
  billing_type_id             uuid not null references public.commercial_billing_types (id),
  active_from                 date not null,
  active_till                 date,
  lifecycle_status            text not null default 'draft'
                                check (lifecycle_status in ('draft', 'active', 'inactive', 'retired')),
  is_sellable                 boolean not null default true,
  display_order               integer not null default 0,

  base_software_cost          numeric not null default 0,
  implementation_cost_per_mm  numeric not null default 0,
  integration_cost            numeric not null default 0,
  third_party_cost            numeric not null default 0,
  hardware_cost               numeric not null default 0,
  cloud_cost                  numeric not null default 0,
  support_cost                numeric not null default 0,
  training_cost                numeric not null default 0,

  internal_price              numeric not null default 0,
  floor_price                 numeric not null default 0,
  partner_price                numeric not null default 0,
  government_price            numeric not null default 0,
  enterprise_price            numeric not null default 0,
  corporate_price             numeric not null default 0,
  list_price                  numeric not null default 0,

  minimum_allowed_price       numeric not null default 0,
  maximum_discount_percent    numeric not null default 0,

  created_at                  timestamptz not null default now(),
  created_by                  uuid references auth.users (id)
);

create index commercial_skus_category_id_idx on public.commercial_skus (category_id);
create index commercial_skus_feature_id_idx on public.commercial_skus (feature_id);
create index commercial_skus_edition_id_idx on public.commercial_skus (edition_id);
create index commercial_skus_currency_id_idx on public.commercial_skus (currency_id);

create table public.commercial_bom_items (
  id                uuid primary key default gen_random_uuid(),
  parent_sku_id     uuid not null references public.commercial_skus (id),
  component_sku_id  uuid not null references public.commercial_skus (id),
  mandatory         boolean not null default false,
  quantity          numeric not null default 1,
  notes             text not null default '',
  check (parent_sku_id <> component_sku_id)
);

comment on table public.commercial_bom_items is
  'BOM "Option B": one level deep only, no recursion into a component''s own BOM — enforced in TypeScript (skuTotalUnitCostWithBom), not the database. The direct-self-reference CHECK is defense-in-depth, not full cycle prevention.';

create index commercial_bom_items_parent_sku_id_idx on public.commercial_bom_items (parent_sku_id);
create index commercial_bom_items_component_sku_id_idx on public.commercial_bom_items (component_sku_id);
