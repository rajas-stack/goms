-- supabase/migrations/00000000000001_node_types_and_departments.sql

create table public.node_types (
  key        text primary key,
  domain     text not null check (domain in ('geo', 'org', 'sales')),
  label      text not null,
  icon       text not null,
  level      integer not null,
  child_keys text[] not null default '{}'
);

comment on table public.node_types is
  'Shared type/config lookup for both departments and geo_nodes trees — a direct port of the existing NodeType/NODE_TYPE_MAP (src/lib/node-types.ts). Not a data table.';

create table public.departments (
  id          text primary key,
  parent_id   text references public.departments (id),
  state_code  integer,
  type_key    text not null references public.node_types (key),
  name        text not null,
  code        text,
  sort_order  integer not null default 0,
  status      text not null default 'active' check (status in ('active', 'archived')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.departments is
  'Self-referencing organization tree (department/branch/division/office/unit). Ports HierNode domain=''org'' (src/lib/types.ts).';

create index departments_parent_id_idx on public.departments (parent_id);
create index departments_state_code_idx on public.departments (state_code);
create index departments_type_key_idx on public.departments (type_key);
