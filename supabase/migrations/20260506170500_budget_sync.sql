create table if not exists public.budget_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.budget_sync enable row level security;

drop policy if exists "budget_sync_select_own" on public.budget_sync;
drop policy if exists "budget_sync_insert_own" on public.budget_sync;
drop policy if exists "budget_sync_update_own" on public.budget_sync;

create policy "budget_sync_select_own"
on public.budget_sync
for select
to authenticated
using (auth.uid() = user_id);

create policy "budget_sync_insert_own"
on public.budget_sync
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "budget_sync_update_own"
on public.budget_sync
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_budget_sync_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_budget_sync_updated_at on public.budget_sync;

create trigger set_budget_sync_updated_at
before update on public.budget_sync
for each row
execute function public.set_budget_sync_updated_at();
