create function public.assign_owner(
  p_entity_type text, p_entity_id text, p_sales_person_id uuid, p_role text,
  p_start_date date, p_end_date date, p_reason text, p_note text
)
returns public.ownership_assignments
language plpgsql
as $$
declare
  v_incumbent record;
  v_row public.ownership_assignments;
begin
  if not exists (select 1 from public.sales_people where id = p_sales_person_id) then
    raise exception 'No such salesperson: %', p_sales_person_id;
  end if;
  if p_role = 'delegate' and p_end_date is null then
    raise exception 'A delegation must have an end date';
  end if;
  if p_end_date is not null and p_end_date <= p_start_date then
    raise exception 'An assignment cannot end on or before it starts';
  end if;

  if p_role = 'owner' then
    for v_incumbent in
      select * from public.ownership_assignments
      where entity_type = p_entity_type and entity_id = p_entity_id and role = 'owner' and end_date is null
      for update
    loop
      if p_start_date <= v_incumbent.start_date then
        raise exception 'The current owner''s assignment starts on %; a replacement must start after that.', v_incumbent.start_date;
      end if;
      update public.ownership_assignments set end_date = p_start_date where id = v_incumbent.id;
    end loop;
  end if;

  insert into public.ownership_assignments (entity_type, entity_id, sales_person_id, role, start_date, end_date, reason, note)
  values (p_entity_type, p_entity_id, p_sales_person_id, p_role, p_start_date, p_end_date, coalesce(p_reason, 'initial'), coalesce(p_note, ''))
  returning * into v_row;

  return v_row;
end;
$$;

create function public.transfer_book_of_business(p_from uuid, p_to uuid, p_effective_date date, p_note text)
returns setof public.ownership_assignments
language plpgsql
as $$
declare
  v_batch_id text := gen_random_uuid()::text;
  v_row record;
begin
  if not exists (select 1 from public.sales_people where id = p_from) then
    raise exception 'No such salesperson: %', p_from;
  end if;
  if not exists (select 1 from public.sales_people where id = p_to) then
    raise exception 'No such salesperson: %', p_to;
  end if;
  if p_from = p_to then
    raise exception 'Cannot transfer a book of business to the same person';
  end if;

  for v_row in
    select * from public.ownership_assignments
    where sales_person_id = p_from and role = 'owner' and end_date is null and start_date < p_effective_date
    for update
  loop
    update public.ownership_assignments set end_date = p_effective_date where id = v_row.id;
    return query
      insert into public.ownership_assignments (entity_type, entity_id, sales_person_id, role, start_date, end_date, reason, batch_id, note)
      values (v_row.entity_type, v_row.entity_id, p_to, 'owner', p_effective_date, null, 'transfer', v_batch_id, coalesce(p_note, ''))
      returning *;
  end loop;
end;
$$;
