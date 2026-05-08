create table if not exists public.budget_sync_history (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  saved_at timestamptz not null default now()
);

alter table public.budget_sync_history enable row level security;

drop policy if exists "budget_sync_history_select_own" on public.budget_sync_history;

create policy "budget_sync_history_select_own"
on public.budget_sync_history
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.archive_budget_sync_before_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.budget_sync_history (user_id, data, saved_at)
  values (old.user_id, old.data, old.updated_at);

  if tg_op = 'UPDATE' then
    return new;
  end if;

  return old;
end;
$$;

drop trigger if exists archive_budget_sync_before_update on public.budget_sync;
drop trigger if exists archive_budget_sync_before_delete on public.budget_sync;

create trigger archive_budget_sync_before_update
before update on public.budget_sync
for each row
when (old.data is distinct from new.data)
execute function public.archive_budget_sync_before_change();

create trigger archive_budget_sync_before_delete
before delete on public.budget_sync
for each row
execute function public.archive_budget_sync_before_change();

insert into public.budget_sync_history (user_id, data, saved_at)
select b.user_id, b.data, b.updated_at
from public.budget_sync b
where not exists (
  select 1
  from public.budget_sync_history history
  where history.user_id = b.user_id
);
