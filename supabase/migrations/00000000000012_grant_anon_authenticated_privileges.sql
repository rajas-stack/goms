-- supabase/migrations/00000000000012_grant_anon_authenticated_privileges.sql
--
-- Fixes a real Phase 1 gap: RLS policies (Task 12) control ROW visibility,
-- but require the role to already hold baseline TABLE-level GRANTs —
-- Postgres denies access before RLS is even evaluated otherwise.
--
-- The Supabase CLI's own bootstrap default privileges only cover tables
-- created by the `supabase_admin` role. Every table our own migrations
-- create runs as `postgres`, which has a separate, more restrictive default
-- ACL (confirmed via pg_default_acl: postgres's own default only grants
-- anon/authenticated TRUNCATE/REFERENCES/TRIGGER — never SELECT/INSERT/
-- UPDATE/DELETE). This was invisible throughout Phase 1 because every
-- verification query ran as the `postgres` superuser (`supabase db query`),
-- which bypasses grants entirely — only a real PostgREST/anon-key call
-- (Phase 2's first integration test) surfaces it.

grant usage on schema public to anon, authenticated, service_role;

do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
  end loop;
end $$;

-- Future tables created by later migrations (still running as `postgres`)
-- get the same grants automatically — this step never needs repeating.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant all on tables to service_role;

-- Postgres functions (RPCs, e.g. allocate_boq_number) need EXECUTE granted
-- explicitly too — same root cause.
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
