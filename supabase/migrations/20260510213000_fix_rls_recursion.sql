-- ============================================================
-- Fix RLS infinite recursion by replacing self-referential
-- EXISTS subqueries with SECURITY DEFINER helper functions.
-- ============================================================

-- Helper: is the current user a member of this workspace?
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

-- Helper: is the current user the owner of this workspace?
create or replace function public.is_workspace_owner(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces
    where id = ws_id and owner_id = auth.uid()
  );
$$;

-- Helper: is the current user the owner of this shared budget?
create or replace function public.is_budget_owner(b_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.shared_budgets
    where id = b_id and owner_id = auth.uid()
  );
$$;

-- Helper: is the current user a direct member of this shared budget?
create or replace function public.is_budget_member(b_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.budget_members
    where budget_id = b_id and user_id = auth.uid()
  );
$$;

-- Helper: does the current user have any access to this shared budget?
-- (owner, workspace member, or direct budget member)
create or replace function public.can_access_shared_budget(b_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.shared_budgets sb
    where sb.id = b_id and (
      sb.owner_id = auth.uid()
      or (sb.workspace_id is not null and public.is_workspace_member(sb.workspace_id))
      or public.is_budget_member(sb.id)
    )
  );
$$;

-- ============================================================
-- Replace recursive policies
-- ============================================================

-- workspaces
drop policy if exists "workspaces_read" on public.workspaces;
create policy "workspaces_read"
on public.workspaces
for select
to authenticated
using (
  owner_id = auth.uid()
  or public.is_workspace_member(id)
);

-- workspace_members
drop policy if exists "wm_read" on public.workspace_members;
create policy "wm_read"
on public.workspace_members
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_workspace_owner(workspace_id)
  or public.is_workspace_member(workspace_id)
);

drop policy if exists "wm_insert_owner_or_self" on public.workspace_members;
create policy "wm_insert_owner_or_self"
on public.workspace_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  or public.is_workspace_owner(workspace_id)
);

drop policy if exists "wm_delete_owner_or_self" on public.workspace_members;
create policy "wm_delete_owner_or_self"
on public.workspace_members
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.is_workspace_owner(workspace_id)
);

-- shared_budgets
drop policy if exists "sb_read" on public.shared_budgets;
create policy "sb_read"
on public.shared_budgets
for select
to authenticated
using (
  owner_id = auth.uid()
  or (workspace_id is not null and public.is_workspace_member(workspace_id))
  or public.is_budget_member(id)
);

-- budget_members
drop policy if exists "bm_read" on public.budget_members;
create policy "bm_read"
on public.budget_members
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_budget_owner(budget_id)
  or public.is_budget_member(budget_id)
);

drop policy if exists "bm_insert_owner_or_self" on public.budget_members;
create policy "bm_insert_owner_or_self"
on public.budget_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  or public.is_budget_owner(budget_id)
);

drop policy if exists "bm_delete_owner_or_self" on public.budget_members;
create policy "bm_delete_owner_or_self"
on public.budget_members
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.is_budget_owner(budget_id)
);

-- shared_transactions
drop policy if exists "stx_read" on public.shared_transactions;
create policy "stx_read"
on public.shared_transactions
for select
to authenticated
using (public.can_access_shared_budget(budget_id));

drop policy if exists "stx_insert_member" on public.shared_transactions;
create policy "stx_insert_member"
on public.shared_transactions
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.can_access_shared_budget(budget_id)
);

drop policy if exists "stx_update_self_or_owner" on public.shared_transactions;
create policy "stx_update_self_or_owner"
on public.shared_transactions
for update
to authenticated
using (
  created_by = auth.uid()
  or public.is_budget_owner(budget_id)
)
with check (
  created_by = auth.uid()
  or public.is_budget_owner(budget_id)
);

drop policy if exists "stx_delete_self_or_owner" on public.shared_transactions;
create policy "stx_delete_self_or_owner"
on public.shared_transactions
for delete
to authenticated
using (
  created_by = auth.uid()
  or public.is_budget_owner(budget_id)
);
