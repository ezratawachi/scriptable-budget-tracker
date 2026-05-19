-- Allow the creator of a shared transaction, or the owner of its budget,
-- to soft-delete and restore it by updating deleted_at.
-- This replaces the older broad UPDATE policy with an explicit one so
-- shared budgets do not accidentally block a user's own expense edits.

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

create or replace function public.soft_delete_shared_transaction(tx_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  tx_row public.shared_transactions%rowtype;
begin
  select *
    into tx_row
    from public.shared_transactions
    where id = tx_id;

  if not found then
    return false;
  end if;

  if tx_row.created_by <> auth.uid() and not public.is_budget_owner(tx_row.budget_id) then
    raise exception 'Not allowed to delete this transaction';
  end if;

  update public.shared_transactions
    set deleted_at = now()
    where id = tx_id;

  return true;
end;
$$;

create or replace function public.restore_shared_transaction(tx_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  tx_row public.shared_transactions%rowtype;
begin
  select *
    into tx_row
    from public.shared_transactions
    where id = tx_id;

  if not found then
    return false;
  end if;

  if tx_row.created_by <> auth.uid() and not public.is_budget_owner(tx_row.budget_id) then
    raise exception 'Not allowed to restore this transaction';
  end if;

  update public.shared_transactions
    set deleted_at = null
    where id = tx_id;

  return true;
end;
$$;

grant execute on function public.soft_delete_shared_transaction(uuid) to authenticated;
grant execute on function public.restore_shared_transaction(uuid) to authenticated;
