-- ============================================================
-- Shared budgets: workspaces, members, shared budgets, shared
-- transactions, and invite links.
-- Roles: owner + member. Granularity: workspace OR budget-level.
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member')),
  display_email text,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.shared_budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  icon text not null default '🏷️',
  monthly_budget numeric not null default 0,
  color text default '#0F766E',
  rollover_start_key text default '2026-4',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_members (
  budget_id uuid not null references public.shared_budgets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member')),
  display_email text,
  joined_at timestamptz not null default now(),
  primary key (budget_id, user_id)
);

create table if not exists public.shared_transactions (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.shared_budgets(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_email text,
  amount numeric not null check (amount > 0),
  description text not null,
  occurred_on date not null default current_date,
  month_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invites (
  token text primary key,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  inviter_email text,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  budget_id uuid references public.shared_budgets(id) on delete cascade,
  role text not null check (role in ('owner','member')) default 'member',
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((workspace_id is not null) or (budget_id is not null))
);

create index if not exists shared_budgets_workspace_idx on public.shared_budgets(workspace_id);
create index if not exists shared_transactions_budget_idx on public.shared_transactions(budget_id);
create index if not exists shared_transactions_month_idx on public.shared_transactions(budget_id, month_key);
create index if not exists invites_expires_idx on public.invites(expires_at);
create index if not exists invites_inviter_idx on public.invites(inviter_id);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);
create index if not exists budget_members_user_idx on public.budget_members(user_id);

-- updated_at triggers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists shared_budgets_set_updated_at on public.shared_budgets;
create trigger shared_budgets_set_updated_at
before update on public.shared_budgets
for each row execute function public.set_updated_at();

drop trigger if exists shared_transactions_set_updated_at on public.shared_transactions;
create trigger shared_transactions_set_updated_at
before update on public.shared_transactions
for each row execute function public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.shared_budgets enable row level security;
alter table public.budget_members enable row level security;
alter table public.shared_transactions enable row level security;
alter table public.invites enable row level security;

-- ---------- workspaces
drop policy if exists "workspaces_read" on public.workspaces;
create policy "workspaces_read"
on public.workspaces
for select
to authenticated
using (
  auth.uid() = owner_id
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id and wm.user_id = auth.uid()
  )
);

drop policy if exists "workspaces_insert" on public.workspaces;
create policy "workspaces_insert"
on public.workspaces
for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "workspaces_update_owner" on public.workspaces;
create policy "workspaces_update_owner"
on public.workspaces
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner"
on public.workspaces
for delete
to authenticated
using (owner_id = auth.uid());

-- ---------- workspace_members
drop policy if exists "wm_read" on public.workspace_members;
create policy "wm_read"
on public.workspace_members
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id and w.owner_id = auth.uid()
  )
);

drop policy if exists "wm_insert_owner_or_self" on public.workspace_members;
create policy "wm_insert_owner_or_self"
on public.workspace_members
for insert
to authenticated
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = auth.uid()
  )
  or user_id = auth.uid()
);

drop policy if exists "wm_delete_owner_or_self" on public.workspace_members;
create policy "wm_delete_owner_or_self"
on public.workspace_members
for delete
to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = auth.uid()
  )
  or user_id = auth.uid()
);

-- ---------- shared_budgets
drop policy if exists "sb_read" on public.shared_budgets;
create policy "sb_read"
on public.shared_budgets
for select
to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = shared_budgets.workspace_id and wm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.budget_members bm
    where bm.budget_id = shared_budgets.id and bm.user_id = auth.uid()
  )
);

drop policy if exists "sb_insert" on public.shared_budgets;
create policy "sb_insert"
on public.shared_budgets
for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "sb_update_owner" on public.shared_budgets;
create policy "sb_update_owner"
on public.shared_budgets
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "sb_delete_owner" on public.shared_budgets;
create policy "sb_delete_owner"
on public.shared_budgets
for delete
to authenticated
using (owner_id = auth.uid());

-- ---------- budget_members
drop policy if exists "bm_read" on public.budget_members;
create policy "bm_read"
on public.budget_members
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.shared_budgets sb
    where sb.id = budget_members.budget_id and sb.owner_id = auth.uid()
  )
);

drop policy if exists "bm_insert_owner_or_self" on public.budget_members;
create policy "bm_insert_owner_or_self"
on public.budget_members
for insert
to authenticated
with check (
  exists (
    select 1 from public.shared_budgets sb
    where sb.id = budget_id and sb.owner_id = auth.uid()
  )
  or user_id = auth.uid()
);

drop policy if exists "bm_delete_owner_or_self" on public.budget_members;
create policy "bm_delete_owner_or_self"
on public.budget_members
for delete
to authenticated
using (
  exists (
    select 1 from public.shared_budgets sb
    where sb.id = budget_id and sb.owner_id = auth.uid()
  )
  or user_id = auth.uid()
);

-- ---------- shared_transactions
drop policy if exists "stx_read" on public.shared_transactions;
create policy "stx_read"
on public.shared_transactions
for select
to authenticated
using (
  exists (
    select 1 from public.shared_budgets sb
    where sb.id = shared_transactions.budget_id and (
      sb.owner_id = auth.uid()
      or exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = sb.workspace_id and wm.user_id = auth.uid()
      )
      or exists (
        select 1 from public.budget_members bm
        where bm.budget_id = sb.id and bm.user_id = auth.uid()
      )
    )
  )
);

drop policy if exists "stx_insert_member" on public.shared_transactions;
create policy "stx_insert_member"
on public.shared_transactions
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.shared_budgets sb
    where sb.id = shared_transactions.budget_id and (
      sb.owner_id = auth.uid()
      or exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = sb.workspace_id and wm.user_id = auth.uid()
      )
      or exists (
        select 1 from public.budget_members bm
        where bm.budget_id = sb.id and bm.user_id = auth.uid()
      )
    )
  )
);

drop policy if exists "stx_update_self_or_owner" on public.shared_transactions;
create policy "stx_update_self_or_owner"
on public.shared_transactions
for update
to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1 from public.shared_budgets sb
    where sb.id = shared_transactions.budget_id and sb.owner_id = auth.uid()
  )
)
with check (
  created_by = auth.uid()
  or exists (
    select 1 from public.shared_budgets sb
    where sb.id = shared_transactions.budget_id and sb.owner_id = auth.uid()
  )
);

drop policy if exists "stx_delete_self_or_owner" on public.shared_transactions;
create policy "stx_delete_self_or_owner"
on public.shared_transactions
for delete
to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1 from public.shared_budgets sb
    where sb.id = shared_transactions.budget_id and sb.owner_id = auth.uid()
  )
);

-- ---------- invites (token IS the secret)
drop policy if exists "invites_read_any" on public.invites;
create policy "invites_read_any"
on public.invites
for select
to authenticated
using (true);

drop policy if exists "invites_insert_inviter" on public.invites;
create policy "invites_insert_inviter"
on public.invites
for insert
to authenticated
with check (inviter_id = auth.uid());

drop policy if exists "invites_claim" on public.invites;
create policy "invites_claim"
on public.invites
for update
to authenticated
using (used_at is null and expires_at > now())
with check (used_by = auth.uid());

drop policy if exists "invites_delete_inviter" on public.invites;
create policy "invites_delete_inviter"
on public.invites
for delete
to authenticated
using (inviter_id = auth.uid());
