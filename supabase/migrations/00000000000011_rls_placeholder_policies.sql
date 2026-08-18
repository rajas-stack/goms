-- supabase/migrations/00000000000011_rls_placeholder_policies.sql
--
-- PLACEHOLDER POLICIES — Phase 1 through Phase 7.
-- Every policy below is intentionally permissive (`using (true)` / `with check (true)`).
-- This is NOT the production security model. Per architecture spec §8 (Phase 8 —
-- Production-Readiness / Security Gate), every one of these must be replaced with a
-- real per-role policy before this system is considered production-ready.

do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for all using (true) with check (true);',
      t || '_placeholder_allow_all', t
    );
  end loop;
end $$;
