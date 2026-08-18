-- supabase/migrations/00000000000003_employees.sql

create table public.employees (
  id                   uuid primary key default gen_random_uuid(),
  department_id        text references public.departments (id),
  manager_id           uuid references public.employees (id),
  name                 text not null default '',
  code                 text not null default '',
  designation          text not null default '',
  email                text not null default '',
  phone                text not null default '',
  company              text not null default '',
  address              text not null default '',
  website              text not null default '',
  photo_url            text,
  vacant               boolean not null default false,
  connected            boolean not null default false,
  relationship_status  text not null default 'new'
                         check (relationship_status in ('engaged', 'developing', 'dormant', 'new')),
  relationship_quality text not null default 'neutral'
                         check (relationship_quality in ('excellent', 'good', 'neutral', 'weak', 'poor')),
  relationship_type    text not null default '',
  introduced_by        text not null default '',
  important_contact    boolean not null default false,
  preferred_comm       text[] not null default '{}',
  last_interaction_at  date,
  follow_up_date       date,
  notes                text not null default '',
  metadata             jsonb not null default '{}'::jsonb,
  auth_user_id         uuid references auth.users (id),
  status               text not null default 'active' check (status in ('active', 'archived')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.employees is
  'Government contacts, including vacant seats (vacant=true, no name/email/phone). Ports Employee (src/lib/types.ts). Deliberately distinct from sales_people — never unified.';

create index employees_department_id_idx on public.employees (department_id);
create index employees_manager_id_idx on public.employees (manager_id);
create index employees_auth_user_id_idx on public.employees (auth_user_id);

create table public.charges (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees (id) on delete cascade,
  kind          text not null check (kind in ('acting', 'additional')),
  title         text not null default '',
  department_id text references public.departments (id),
  start_date    date,
  end_date      date,
  reason        text not null default ''
);

create index charges_employee_id_idx on public.charges (employee_id);

create table public.visiting_cards (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  front_path  text not null,
  front_name  text not null default '',
  back_path   text,
  back_name   text
);

comment on table public.visiting_cards is
  'front_path/back_path are Supabase Storage object paths in the attachments bucket, replacing the inline base64 data URLs VisitingCardItem used in-memory. Storage wiring is a Phase 6 task; this table exists from Phase 1.';

create index visiting_cards_employee_id_idx on public.visiting_cards (employee_id);

create table public.timeline_events (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  type         text not null check (type in (
                 'joined', 'promoted', 'transferred', 'meeting', 'inPerson', 'call', 'email',
                 'whatsapp', 'followup', 'note', 'document', 'custom'
               )),
  title        text not null default '',
  custom_label text,
  event_date   date not null,
  event_time   time,
  note         text not null default '',
  source       text not null check (source in ('manual', 'system')),
  attendees    text[] not null default '{}',
  attended     boolean
);

create index timeline_events_employee_id_idx on public.timeline_events (employee_id);

create table public.transfers (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references public.employees (id) on delete cascade,
  from_designation      text not null default '',
  to_designation        text not null default '',
  from_department_name  text not null default '',
  to_department_name    text not null default '',
  from_office_name      text not null default '',
  to_office_name        text not null default '',
  to_org_node_id        text references public.departments (id),
  from_manager_name     text not null default '',
  to_manager_name       text not null default '',
  effective_date        date not null,
  reason                text not null default '',
  remarks               text not null default ''
);

create index transfers_employee_id_idx on public.transfers (employee_id);
