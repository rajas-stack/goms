-- supabase/migrations/00000000000010_commercial_boqs.sql

create table public.commercial_boq_number_seq (
  year     integer primary key,
  next_seq integer not null default 1
);

comment on table public.commercial_boq_number_seq is
  'Backs BOQ-{year}-{6-digit-seq} numbering (never reset per year once started). Allocate atomically via allocate_boq_number(), not a max()+1 read.';

create function public.allocate_boq_number(p_year integer)
returns text
language plpgsql
as $$
declare
  v_seq integer;
begin
  insert into public.commercial_boq_number_seq (year, next_seq)
    values (p_year, 2)
    on conflict (year) do update set next_seq = commercial_boq_number_seq.next_seq + 1
    returning next_seq - 1 into v_seq;
  return 'BOQ-' || p_year || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

comment on function public.allocate_boq_number(integer) is
  'Atomic year-scoped counter: the INSERT ... ON CONFLICT ... RETURNING is a single statement, so concurrent callers can never receive the same sequence number, unlike an in-app read-then-write max()+1.';

create table public.commercial_boqs (
  id                     uuid primary key default gen_random_uuid(),
  boq_number             text not null unique,
  opportunity_name       text not null default '',
  department_id          text not null references public.departments (id),
  customer_id            uuid references public.customers (id),
  customer_name          text not null default '',
  customer_organization  text not null default '',
  customer_address       text not null default '',
  customer_gst           text not null default '',
  customer_contact       text not null default '',
  vertical_id            uuid not null references public.commercial_verticals (id),

  budget_amount          text not null default '',
  budget_unit            text not null default '',
  budget_known           text not null default '',
  emd_amount             text not null default '',
  emd_unit               text not null default '',

  sales_person_id        uuid not null references public.sales_people (id),
  bu_sales_person_id     uuid references public.sales_people (id),
  pre_sales_id           uuid references public.commercial_pre_sales (id),

  status                 text not null default 'draft' check (status in (
                            'draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled', 'archived'
                          )),
  boq_version            integer not null default 1,
  revision_number        integer not null default 0,
  parent_boq_id          uuid references public.commercial_boqs (id),

  currency               text not null,
  grand_total            numeric not null default 0,

  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users (id),
  last_modified_at       timestamptz not null default now(),
  last_modified_by       uuid references auth.users (id)
);

comment on column public.commercial_boqs.customer_id is
  'Real FK, added alongside the free-text customer_* columns (kept as a print-stable snapshot) — see architecture spec §3.1/§3.2.';
comment on column public.commercial_boqs.currency is
  'ISO currency code snapshot, not an FK to commercial_currencies, by deliberate choice — a currency code rename must not retroactively alter historical BOQs. See architecture spec §3.2/§9.';
comment on column public.commercial_boqs.grand_total is
  'Persisted, not computed. While status=draft the TypeScript layer recomputes and overwrites this from live SKU pricing on every read (withLiveDraftPricing); once submitted, it is frozen. This mirrors current in-memory behavior exactly — no DB view/trigger is introduced for it.';

create index commercial_boqs_department_id_idx on public.commercial_boqs (department_id);
create index commercial_boqs_customer_id_idx on public.commercial_boqs (customer_id);
create index commercial_boqs_sales_person_id_idx on public.commercial_boqs (sales_person_id);
create index commercial_boqs_parent_boq_id_idx on public.commercial_boqs (parent_boq_id);
create index commercial_boqs_status_idx on public.commercial_boqs (status);

create table public.commercial_boq_line_items (
  id                uuid primary key default gen_random_uuid(),
  boq_id            uuid not null references public.commercial_boqs (id) on delete cascade,
  sku_id            uuid not null references public.commercial_skus (id),
  quantity          numeric not null default 1,
  unit_price        numeric not null default 0,
  discount_pct      numeric not null default 0,
  tax_pct           numeric not null default 0,
  approver_id       uuid references public.employees (id),
  approval_date     date,
  approval_remarks  text not null default '',
  approval_status   text not null default 'pending' check (approval_status in (
                       'auto_approved', 'pending', 'approved', 'rejected'
                     )),
  line_total        numeric not null default 0
);

comment on column public.commercial_boq_line_items.approver_id is
  'FK to employees, confirmed against the running app: the approver picker (ProposalDetail.tsx:393,422) is populated exclusively from useAllEmployees(), and CommercialBoqLineItem.approverId''s own doc comment (types.ts:211-216) states this FK target explicitly.';

create index commercial_boq_line_items_boq_id_idx on public.commercial_boq_line_items (boq_id);
create index commercial_boq_line_items_sku_id_idx on public.commercial_boq_line_items (sku_id);
create index commercial_boq_line_items_approver_id_idx on public.commercial_boq_line_items (approver_id);
