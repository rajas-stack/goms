-- The in-memory deleteSalesPerson hard-deletes matching ownershipAssignments
-- rows and never touches followUps (leaving them orphaned, tolerated because
-- arrays don't enforce referential integrity). Ported at the DB level:
-- ownership_assignments gets ON DELETE CASCADE (matches the hard-delete),
-- follow_ups.assignee_id and opportunities.sales_person_id get
-- ON DELETE SET NULL (closest DB-safe equivalent to "orphaned but tolerated"
-- — a dangling uuid reference isn't something Postgres allows by default).
-- commercial_boqs.sales_person_id is deliberately NOT touched — it's
-- NOT NULL, out of Phase 2 scope entirely (Commercial Calculator migrates in
-- Phase 3), and blocking deletion of a salesperson who owns a BOQ is
-- correct, not a regression.

alter table public.ownership_assignments
  drop constraint ownership_assignments_sales_person_id_fkey,
  add constraint ownership_assignments_sales_person_id_fkey
    foreign key (sales_person_id) references public.sales_people (id) on delete cascade;

alter table public.follow_ups
  drop constraint follow_ups_assignee_id_fkey,
  add constraint follow_ups_assignee_id_fkey
    foreign key (assignee_id) references public.sales_people (id) on delete set null;

alter table public.opportunities
  drop constraint opportunities_sales_person_id_fkey,
  add constraint opportunities_sales_person_id_fkey
    foreign key (sales_person_id) references public.sales_people (id) on delete set null;
