-- ============================================================
-- Safeguards against accidental destructive deletes of shared
-- budgets and transactions.
--
-- - Add deleted_at to shared_budgets and shared_transactions.
-- - Drop the CASCADE on shared_transactions.budget_id so a
--   budget delete no longer permanently destroys the related
--   transaction rows in one shot.
-- - Update read policies to ignore soft-deleted rows for
--   non-owners; owners can still see their own soft-deleted
--   budgets (so a restore is possible).
-- ============================================================

alter table public.shared_budgets
  add column if not exists deleted_at timestamptz;

alter table public.shared_transactions
  add column if not exists deleted_at timestamptz;

-- Drop CASCADE on the budget_id FK (keep the FK, lose the cascade)
alter table public.shared_transactions
  drop constraint if exists shared_transactions_budget_id_fkey;
alter table public.shared_transactions
  add constraint shared_transactions_budget_id_fkey
  foreign key (budget_id)
  references public.shared_budgets(id)
  on delete restrict;

-- Same for budget_members: don't cascade-destroy memberships when a
-- budget is soft-deleted; the membership row is meaningful audit info
alter table public.budget_members
  drop constraint if exists budget_members_budget_id_fkey;
alter table public.budget_members
  add constraint budget_members_budget_id_fkey
  foreign key (budget_id)
  references public.shared_budgets(id)
  on delete cascade;
-- (We keep CASCADE on budget_members because the membership row is
-- only meaningful when the budget exists; if an owner does a real
-- delete, kicking out memberships is the right behavior.)

-- ---------- Recreate helper to respect deleted_at ----------
create or replace function public.can_access_shared_budget(b_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.shared_budgets sb
    where sb.id = b_id
      and sb.deleted_at is null
      and (
        sb.owner_id = auth.uid()
        or (sb.workspace_id is not null and public.is_workspace_member(sb.workspace_id))
        or public.is_budget_member(sb.id)
      )
  );
$$;

-- ---------- shared_budgets SELECT: members only see non-deleted ----------
drop policy if exists "sb_read" on public.shared_budgets;
create policy "sb_read"
on public.shared_budgets
for select
to authenticated
using (
  -- Owner sees everything (including soft-deleted, for restore)
  owner_id = auth.uid()
  or (
    deleted_at is null and (
      (workspace_id is not null and public.is_workspace_member(workspace_id))
      or public.is_budget_member(id)
    )
  )
);

-- ---------- shared_transactions SELECT: hide soft-deleted ----------
drop policy if exists "stx_read" on public.shared_transactions;
create policy "stx_read"
on public.shared_transactions
for select
to authenticated
using (
  deleted_at is null
  and public.can_access_shared_budget(budget_id)
);

-- Owners and tx authors can update / delete their tx (unchanged), but
-- updates now also accept setting deleted_at. The existing policies
-- already allow update of any column for these users; no rewrite needed.

create index if not exists shared_budgets_deleted_at_idx
  on public.shared_budgets (owner_id)
  where deleted_at is not null;
