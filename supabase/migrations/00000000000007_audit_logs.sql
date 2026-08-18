-- supabase/migrations/00000000000007_audit_logs.sql

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   text not null,
  field       text not null default '',
  old_value   text not null default '',
  new_value   text not null default '',
  reason      text not null default '',
  action      text not null,
  changed_at  timestamptz not null default now(),
  changed_by  uuid references auth.users (id)
);

comment on table public.audit_logs is
  'Promoted from Commercial-Calculator-only (CommercialAuditLog) to a shared, cross-module table. Polymorphic (entity_type, entity_id) — no FK, matching the existing pattern.';

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_changed_at_idx on public.audit_logs (changed_at desc);
