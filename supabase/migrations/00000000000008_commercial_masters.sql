-- supabase/migrations/00000000000008_commercial_masters.sql

create table public.commercial_verticals (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0
);

create table public.commercial_products (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0,
  vertical_id   uuid not null references public.commercial_verticals (id)
);
create index commercial_products_vertical_id_idx on public.commercial_products (vertical_id);

create table public.commercial_modules (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0,
  product_id    uuid not null references public.commercial_products (id)
);
create index commercial_modules_product_id_idx on public.commercial_modules (product_id);

create table public.commercial_features (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0,
  module_id     uuid not null references public.commercial_modules (id),
  status        text not null check (status in ('existing', 'modified', 'new'))
);
create index commercial_features_module_id_idx on public.commercial_features (module_id);

create table public.commercial_sku_categories (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0
);

create table public.commercial_units_of_measure (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0
);

create table public.commercial_product_editions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0
);

create table public.commercial_billing_types (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0
);

create table public.commercial_tax_classes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0,
  rate_pct      numeric not null default 0
);

create table public.commercial_approval_matrix (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  name                  text not null,
  description           text not null default '',
  active                boolean not null default true,
  display_order         integer not null default 0,
  min_discount_pct      numeric not null,
  max_discount_pct      numeric not null,
  approval_level_label  text not null default '',
  allow_auto_approval   boolean not null default false
);

create table public.commercial_currencies (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  description      text not null default '',
  active           boolean not null default true,
  display_order    integer not null default 0,
  symbol           text not null,
  decimal_places   integer not null default 2,
  exchange_rate    numeric not null,
  is_base_currency boolean not null default false
);

create unique index commercial_currencies_one_base_idx
  on public.commercial_currencies (is_base_currency)
  where is_base_currency;

comment on index public.commercial_currencies_one_base_idx is
  'Enforces "exactly one base currency" at the DB level, backing up enforceSingleBaseCurrency() in src/modules/commercial-calculator/master-rules.ts.';

create table public.commercial_pre_sales (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  active        boolean not null default true,
  display_order integer not null default 0
);

create table public.commercial_product_edition_features (
  id            uuid primary key default gen_random_uuid(),
  edition_id    uuid not null references public.commercial_product_editions (id),
  feature_id    uuid not null references public.commercial_features (id),
  mandatory     boolean not null default false,
  display_order integer not null default 0,
  unique (edition_id, feature_id)
);
create index commercial_product_edition_features_edition_id_idx on public.commercial_product_edition_features (edition_id);
create index commercial_product_edition_features_feature_id_idx on public.commercial_product_edition_features (feature_id);
