-- One function per table, not one generic function parameterized by table
-- name — a dynamic-SQL table-name parameter is an injection surface for no
-- real benefit here, since there are only ever two node tables.

create function public.department_subtree_ids(p_id text)
returns setof text
language sql
stable
as $$
  with recursive subtree as (
    select id from public.departments where id = p_id
    union all
    select d.id from public.departments d join subtree s on d.parent_id = s.id
  )
  select id from subtree;
$$;

create function public.geo_node_subtree_ids(p_id text)
returns setof text
language sql
stable
as $$
  with recursive subtree as (
    select id from public.geo_nodes where id = p_id
    union all
    select g.id from public.geo_nodes g join subtree s on g.parent_id = s.id
  )
  select id from subtree;
$$;
