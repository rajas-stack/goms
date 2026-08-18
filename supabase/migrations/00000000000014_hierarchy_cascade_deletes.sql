-- Replicates deleteNode's in-memory cascade (department deletion removes
-- every employee/opportunity under it) at the database level instead of in
-- application code, so it keeps working unchanged once employees (Task 5)
-- and ownership (Task 8) make Postgres their live source of truth too.

alter table public.employees
  drop constraint employees_department_id_fkey,
  add constraint employees_department_id_fkey
    foreign key (department_id) references public.departments (id) on delete cascade;

alter table public.opportunities
  drop constraint opportunities_department_id_fkey,
  add constraint opportunities_department_id_fkey
    foreign key (department_id) references public.departments (id) on delete cascade;
