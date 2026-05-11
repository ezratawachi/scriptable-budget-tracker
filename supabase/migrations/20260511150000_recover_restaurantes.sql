-- ============================================================
-- One-time recovery: restore the "Restaurantes" shared budget that
-- was accidentally deleted by ezratawachi@gmail.com. We re-create
-- the shared budget from the most recent budget_sync_history
-- snapshot that contained it, and re-insert any transactions that
-- were under that local budget id at the time of conversion.
--
-- Transactions added AFTER the budget was converted to shared and
-- before the delete cannot be recovered from this archive (they
-- only lived in shared_transactions, which CASCADE-deleted).
-- ============================================================

do $$
declare
  v_user_id uuid;
  v_user_email text;
  v_workspace_id uuid;
  v_snapshot jsonb;
  v_budget_meta jsonb;
  v_local_id text;
  v_new_budget_id uuid;
  v_month_key text;
  v_month_data jsonb;
  v_tx jsonb;
  v_tx_count int := 0;
  v_already_exists int;
  v_year int;
  v_month int;
  v_synth_date date;
begin
  select id, email into v_user_id, v_user_email
    from auth.users
    where lower(email) = 'ezratawachi@gmail.com'
    limit 1;
  if v_user_id is null then
    raise notice 'Recovery: user ezratawachi@gmail.com not found, aborting';
    return;
  end if;
  raise notice 'Recovery: found user % (%)', v_user_id, v_user_email;

  -- Don't double-restore if a non-deleted Restaurantes already exists for this owner
  select count(*) into v_already_exists
    from public.shared_budgets
    where owner_id = v_user_id and lower(label) like '%restaur%';
  if v_already_exists > 0 then
    raise notice 'Recovery: % budget(s) named like Restaurantes already exist for user, skipping insert', v_already_exists;
    return;
  end if;

  select id into v_workspace_id
    from public.workspaces
    where owner_id = v_user_id
    order by created_at
    limit 1;
  raise notice 'Recovery: workspace id %', v_workspace_id;

  -- Most recent snapshot that contained a restaurantes-like budget locally
  select bsh.data into v_snapshot
    from public.budget_sync_history bsh
    where bsh.user_id = v_user_id
      and exists (
        select 1
        from jsonb_array_elements(coalesce(bsh.data->'_settings'->'budgets','[]'::jsonb)) as b(b_obj)
        where lower(b_obj->>'label') like '%restaur%'
      )
    order by bsh.saved_at desc
    limit 1;

  if v_snapshot is null then
    raise notice 'Recovery: no snapshot with "restaur*" budget found in history, aborting';
    return;
  end if;

  select b_obj into v_budget_meta
    from jsonb_array_elements(v_snapshot->'_settings'->'budgets') as b(b_obj)
    where lower(b_obj->>'label') like '%restaur%'
    limit 1;

  v_local_id := v_budget_meta->>'id';
  raise notice 'Recovery: budget meta %, local id %', v_budget_meta::text, v_local_id;

  insert into public.shared_budgets (
    workspace_id, owner_id, label, icon, monthly_budget, color, rollover_start_key
  )
  values (
    v_workspace_id,
    v_user_id,
    coalesce(v_budget_meta->>'label', 'Restaurantes'),
    coalesce(v_budget_meta->>'icon', '🍽️'),
    coalesce((v_budget_meta->>'budget')::numeric, 0),
    coalesce(v_budget_meta->>'color', '#0F766E'),
    '2026-4'
  )
  returning id into v_new_budget_id;
  raise notice 'Recovery: inserted shared_budget id %', v_new_budget_id;

  -- If standalone (no workspace), add an owner membership so RLS reads work
  if v_workspace_id is null then
    insert into public.budget_members (budget_id, user_id, role, display_email)
    values (v_new_budget_id, v_user_id, 'owner', v_user_email)
    on conflict do nothing;
  end if;

  -- Recover transactions: iterate all month keys in the snapshot, copy ones referencing v_local_id
  for v_month_key, v_month_data in select key, value from jsonb_each(v_snapshot)
  loop
    if v_month_key = '_settings' then continue; end if;
    if jsonb_typeof(v_month_data) <> 'array' then continue; end if;

    -- month_key is "YYYY-M" where M is 0-indexed (JS getMonth). Convert to a real date.
    begin
      v_year := split_part(v_month_key, '-', 1)::int;
      v_month := split_part(v_month_key, '-', 2)::int + 1;
      v_synth_date := make_date(v_year, v_month, 1);
    exception when others then
      v_synth_date := current_date;
    end;

    for v_tx in select t from jsonb_array_elements(v_month_data) as a(t)
    loop
      if v_tx->>'cat' = v_local_id then
        insert into public.shared_transactions (
          budget_id, created_by, created_by_email, amount, description,
          occurred_on, month_key
        )
        values (
          v_new_budget_id,
          v_user_id,
          v_user_email,
          abs(coalesce((v_tx->>'amt')::numeric, 0)),
          coalesce(nullif(v_tx->>'desc',''), 'Expense'),
          v_synth_date,
          v_month_key
        );
        v_tx_count := v_tx_count + 1;
      end if;
    end loop;
  end loop;

  raise notice 'Recovery: restored % transactions for budget %', v_tx_count, v_new_budget_id;
end $$;
