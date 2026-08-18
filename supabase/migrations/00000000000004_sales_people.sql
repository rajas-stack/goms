-- supabase/migrations/00000000000004_sales_people.sql

create table public.sales_tiers (
  key    text primary key,
  label  text not null,
  rank   integer not null,
  active boolean not null default true
);

comment on table public.sales_tiers is
  'The sales role ladder as data, not an enum — ports SalesTierDef (src/data/sales-tiers.ts). Never narrow to a CHECK-constrained union: admins add tiers at runtime.';

create table public.sales_people (
  id             uuid primary key default gen_random_uuid(),
  employee_code  text not null default '',
  name           text not null,
  official_email text not null unique,
  personal_email text not null default '',
  mobile         text not null default '',
  alt_mobile     text not null default '',
  joined_on      date,
  left_on        date,
  status         text not null default 'active'
                   check (status in ('active', 'onLeave', 'resigned', 'inactive')),
  notes          text not null default '',
  metadata       jsonb not null default '{}'::jsonb,
  auth_user_id   uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id)
);

comment on table public.sales_people is
  'AMNEX internal staff. Ports SalesPerson (src/lib/types.ts). Deliberately distinct from employees — never unified.';

create index sales_people_auth_user_id_idx on public.sales_people (auth_user_id);

create table public.sales_postings (
  id             uuid primary key default gen_random_uuid(),
  sales_person_id uuid not null references public.sales_people (id) on delete cascade,
  designation    text not null default '',
  tier_key       text not null references public.sales_tiers (key),
  manager_id     uuid references public.sales_people (id),
  office         text not null default '',
  start_date     date,
  end_date       date,
  change_type    text not null check (change_type in (
                    'initial', 'promotion', 'demotion', 'lateralMove', 'reorg', 'correction'
                  )),
  reason         text not null default '',
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id)
);

comment on column public.sales_postings.start_date is
  'Half-open interval start. Nullable rather than NOT NULL because the source model allows an unknown/unrecorded start date (SalesPosting.startDate is "" for seeded historical postings) — see src/data/sales-roster-seed.ts.';

create index sales_postings_sales_person_id_idx on public.sales_postings (sales_person_id);
create index sales_postings_manager_id_idx on public.sales_postings (manager_id);
create index sales_postings_tier_key_idx on public.sales_postings (tier_key);
