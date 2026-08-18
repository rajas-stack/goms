-- supabase/migrations/00000000000006_ownership.sql

create table public.pipeline_stages (
  key         text primary key,
  label       text not null,
  "order"     integer not null,
  probability numeric not null,
  is_closed   boolean not null default false,
  is_won      boolean not null default false
);

comment on table public.pipeline_stages is
  'Opportunity pipeline stages as data, not an enum — ports PipelineStageDef (src/data/pipeline-stages.ts).';

create table public.opportunities (
  id                uuid primary key default gen_random_uuid(),
  department_id     text not null references public.departments (id),
  customer_id       uuid references public.customers (id),
  stage_key         text not null references public.pipeline_stages (key),
  closed_on         date,
  opportunity_name  text not null default '',
  gem_tender_id     text not null default '',
  publish_date      date,
  submission_date   date,
  vertical          text not null default '',
  component         text[] not null default '{}',
  quantity          text not null default '',
  currency          text not null default '',
  value_amount      text not null default '',
  value_unit        text not null default '',
  budget_known      text not null default '',
  emd_amount        text not null default '',
  emd_unit          text not null default '',
  sales_person_id   uuid references public.sales_people (id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id)
);

comment on column public.opportunities.value_amount is
  'Free-text user-entered amount (not parsed numeric) — matches Opportunity.valueAmount: string in src/lib/types.ts. Same for quantity/emd_amount/budget_known.';
comment on column public.opportunities.sales_person_id is
  'Real FK, replacing the in-memory model''s TRANSITIONAL salesPersonEmail string field (src/lib/types.ts:179-186) now that sales_people exists as a real table.';

create index opportunities_department_id_idx on public.opportunities (department_id);
create index opportunities_customer_id_idx on public.opportunities (customer_id);
create index opportunities_stage_key_idx on public.opportunities (stage_key);
create index opportunities_sales_person_id_idx on public.opportunities (sales_person_id);

create table public.opportunity_stage_changes (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities (id) on delete cascade,
  from_stage_key  text references public.pipeline_stages (key),
  to_stage_key    text not null references public.pipeline_stages (key),
  changed_at      date not null,
  changed_by      uuid references auth.users (id),
  note            text not null default ''
);

create index opportunity_stage_changes_opportunity_id_idx on public.opportunity_stage_changes (opportunity_id);

create table public.ownership_assignments (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null,
  entity_id       text not null,
  sales_person_id uuid not null references public.sales_people (id),
  role            text not null,
  start_date      date not null,
  end_date        date,
  reason          text not null check (reason in (
                     'initial', 'transfer', 'delegation', 'reassignment', 'correction'
                   )),
  batch_id        text,
  note            text not null default '',
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id)
);

comment on table public.ownership_assignments is
  'Polymorphic (entity_type, entity_id) — no FK, resolved in the TypeScript service layer, matching the existing deliberate design (OWNABLE_ENTITY_MAP in src/data/ownership.ts). role stays plain text (not CHECK-constrained): ''owner''/''delegate'' today, ''collaborator'' reserved.';

create index ownership_assignments_entity_idx on public.ownership_assignments (entity_type, entity_id);
create index ownership_assignments_sales_person_id_idx on public.ownership_assignments (sales_person_id);

create table public.follow_ups (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   text not null,
  assignee_id uuid references public.sales_people (id),
  due_date    date not null,
  status      text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  note        text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id)
);

create index follow_ups_entity_idx on public.follow_ups (entity_type, entity_id);
create index follow_ups_assignee_id_idx on public.follow_ups (assignee_id);
