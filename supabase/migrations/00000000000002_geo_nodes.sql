-- supabase/migrations/00000000000002_geo_nodes.sql

create table public.geo_nodes (
  id          text primary key,
  parent_id   text references public.geo_nodes (id),
  type_key    text not null references public.node_types (key),
  state_code  integer,
  name        text not null,
  code        text,
  lgd_code    text,
  sort_order  integer not null default 0,
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.geo_nodes is
  'Self-referencing geography tree (country/state/district/taluka/village). Kept as one table, not four per-level tables, so the Repository interface''s id-polymorphic tree methods (getNode/listChildren/etc.) work identically to departments — see architecture spec §3.1/§6. Full village-level import deferred to Phase 6; Phase 1 seeds real states/districts/talukas plus a small village sample.';

create index geo_nodes_parent_id_idx on public.geo_nodes (parent_id);
create index geo_nodes_state_code_idx on public.geo_nodes (state_code);
create index geo_nodes_type_key_idx on public.geo_nodes (type_key);
create index geo_nodes_lgd_code_idx on public.geo_nodes (lgd_code);
