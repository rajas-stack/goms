-- Phase 1's table list didn't include this — MergeAuditRecord needs its own
-- persistent home, distinct from employees itself, since it must survive
-- after the duplicate record it references is deleted.

create table public.merge_audit_records (
  id                uuid primary key default gen_random_uuid(),
  survivor_id       uuid not null references public.employees (id) on delete cascade,
  survivor_name     text not null,
  -- No FK to employees: the duplicate is deleted as part of the merge this
  -- row records — "the removed record's id no longer resolves to anything"
  -- is the whole point (MergeAuditRecord's own doc comment, types.ts).
  duplicate_id      uuid not null,
  duplicate_name    text not null,
  merged_at         timestamptz not null default now(),
  field_resolutions jsonb not null default '[]'::jsonb,
  transferred       jsonb not null default '{}'::jsonb
);

create index merge_audit_records_survivor_id_idx on public.merge_audit_records (survivor_id);

alter table public.merge_audit_records enable row level security;
create policy merge_audit_records_placeholder_allow_all on public.merge_audit_records for all using (true) with check (true);

create function public.merge_employees(p_survivor_id uuid, p_duplicate_id uuid, p_resolutions jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_survivor record;
  v_duplicate record;
  v_field text;
  v_resolved text;
  v_field_resolutions jsonb := '[]'::jsonb;
  v_timeline_moved integer;
  v_transfers_moved integer;
  v_direct_reports_moved integer;
  v_dept_headships_moved integer;
  v_charges_moved integer;
  v_visiting_cards_moved integer;
  v_audit_id uuid;
  v_mergeable_fields text[] := array[
    'name','designation','email','phone','company','address','website',
    'relationship_status','relationship_quality','relationship_type','introduced_by','notes'
  ];
begin
  select * into v_survivor from public.employees where id = p_survivor_id for update;
  select * into v_duplicate from public.employees where id = p_duplicate_id for update;
  if v_survivor is null or v_duplicate is null then
    raise exception 'Both records must exist to merge';
  end if;
  if p_survivor_id = p_duplicate_id then
    raise exception 'Cannot merge a record with itself';
  end if;

  foreach v_field in array v_mergeable_fields loop
    if p_resolutions ? v_field then
      v_resolved := p_resolutions ->> v_field;
      if v_resolved is distinct from (to_jsonb(v_survivor) ->> v_field) then
        execute format('update public.employees set %I = $1 where id = $2', v_field) using v_resolved, p_survivor_id;
        v_field_resolutions := v_field_resolutions || jsonb_build_object(
          'field', v_field,
          'kept', case when v_resolved = (to_jsonb(v_duplicate) ->> v_field) then 'duplicate' else 'survivor' end,
          'value', v_resolved
        );
      end if;
    elsif (to_jsonb(v_survivor) ->> v_field) = '' and (to_jsonb(v_duplicate) ->> v_field) is distinct from '' then
      execute format('update public.employees set %I = $1 where id = $2', v_field)
        using (to_jsonb(v_duplicate) ->> v_field), p_survivor_id;
      v_field_resolutions := v_field_resolutions || jsonb_build_object(
        'field', v_field, 'kept', 'duplicate', 'value', (to_jsonb(v_duplicate) ->> v_field)
      );
    end if;
  end loop;

  update public.employees s set
    preferred_comm = (select array(select distinct unnest(s.preferred_comm || v_duplicate.preferred_comm))),
    last_interaction_at = greatest(s.last_interaction_at, v_duplicate.last_interaction_at),
    follow_up_date = least(s.follow_up_date, v_duplicate.follow_up_date),
    important_contact = s.important_contact or v_duplicate.important_contact,
    connected = s.connected or v_duplicate.connected
  where s.id = p_survivor_id;

  select count(*) into v_charges_moved from public.charges where employee_id = p_duplicate_id;
  update public.charges set employee_id = p_survivor_id where employee_id = p_duplicate_id;

  select count(*) into v_visiting_cards_moved from public.visiting_cards where employee_id = p_duplicate_id;
  update public.visiting_cards set employee_id = p_survivor_id where employee_id = p_duplicate_id;

  select count(*) into v_timeline_moved from public.timeline_events where employee_id = p_duplicate_id;
  update public.timeline_events set employee_id = p_survivor_id where employee_id = p_duplicate_id;

  select count(*) into v_transfers_moved from public.transfers where employee_id = p_duplicate_id;
  update public.transfers set employee_id = p_survivor_id where employee_id = p_duplicate_id;

  select count(*) into v_direct_reports_moved from public.employees where manager_id = p_duplicate_id and id <> p_survivor_id;
  update public.employees set manager_id = p_survivor_id where manager_id = p_duplicate_id and id <> p_survivor_id;

  update public.employees set manager_id = v_duplicate.manager_id where id = p_survivor_id and manager_id = p_duplicate_id;
  update public.employees set manager_id = null where id = p_survivor_id and manager_id = p_survivor_id;

  select count(*) into v_dept_headships_moved from public.departments where metadata ->> 'deptHead' = p_duplicate_id::text;
  update public.departments set metadata = jsonb_set(metadata, '{deptHead}', to_jsonb(p_survivor_id::text))
    where metadata ->> 'deptHead' = p_duplicate_id::text;

  update public.employees set metadata = metadata - 'duplicateOf'
    where id = p_survivor_id and metadata ->> 'duplicateOf' = p_duplicate_id::text;
  update public.employees set metadata = jsonb_set(metadata, '{duplicateOf}', to_jsonb(p_survivor_id::text))
    where id <> p_survivor_id and metadata ->> 'duplicateOf' = p_duplicate_id::text;

  delete from public.employees where id = p_duplicate_id;

  insert into public.merge_audit_records (survivor_id, survivor_name, duplicate_id, duplicate_name, field_resolutions, transferred)
  values (
    p_survivor_id, v_survivor.name, p_duplicate_id, v_duplicate.name, v_field_resolutions,
    jsonb_build_object(
      'timelineEvents', v_timeline_moved, 'transfers', v_transfers_moved, 'directReports', v_direct_reports_moved,
      'departmentHeadships', v_dept_headships_moved, 'visitingCards', v_visiting_cards_moved, 'charges', v_charges_moved
    )
  ) returning id into v_audit_id;

  insert into public.timeline_events (employee_id, type, custom_label, title, event_date, note, source)
  values (
    p_survivor_id, 'custom', 'Merged duplicate',
    'Merged duplicate contact "' || coalesce(nullif(v_duplicate.name, ''), v_duplicate.designation) || '" into this record',
    current_date, '', 'system'
  );

  return jsonb_build_object('auditId', v_audit_id);
end;
$$;
