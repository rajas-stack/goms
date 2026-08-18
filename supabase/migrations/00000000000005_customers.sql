-- supabase/migrations/00000000000005_customers.sql

create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  organization  text not null default '',
  address       text not null default '',
  gst           text not null default '',
  contact_name  text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.customers is
  'New entity — no Customer master exists in the current app. BOQ free-text customer fields are kept as a denormalized snapshot alongside this FK, not replaced by it, so a printed BOQ never changes if the customer record is edited later.';
