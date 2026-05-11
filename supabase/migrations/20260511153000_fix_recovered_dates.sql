-- ============================================================
-- Fix the recovered Restaurants transactions: my earlier recovery
-- migration synthesized occurred_on as the first of the month
-- because I overlooked the per-entry `date` field stored locally
-- (a short string like "May 10"). Re-parse that string to recover
-- the actual day-of-month and update each row.
-- ============================================================

do $$
declare
  v_user_id uuid;
  v_budget_id uuid;
  v_snapshot jsonb;
  v_local_id text;
  v_month_key text;
  v_month_data jsonb;
  v_tx jsonb;
  v_year int;
  v_month int;
  v_day_text text;
  v_day int;
  v_real_date date;
  v_last_count int;
  v_total_count int := 0;
begin
  select id into v_user_id
    from auth.users
    where lower(email) = 'ezratawachi@gmail.com'
    limit 1;
  if v_user_id is null then
    raise notice 'Date-fix: user not found';
    return;
  end if;

  select id into v_budget_id
    from public.shared_budgets
    where owner_id = v_user_id
      and lower(label) like '%restaur%'
      and deleted_at is null
    order by created_at desc
    limit 1;
  if v_budget_id is null then
    raise notice 'Date-fix: no Restaurants shared budget found';
    return;
  end if;
  raise notice 'Date-fix: targeting budget %', v_budget_id;

  -- Same snapshot the recovery used
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
    raise notice 'Date-fix: no source snapshot found';
    return;
  end if;

  select b_obj->>'id' into v_local_id
    from jsonb_array_elements(v_snapshot->'_settings'->'budgets') as b(b_obj)
    where lower(b_obj->>'label') like '%restaur%'
    limit 1;
  raise notice 'Date-fix: local id %', v_local_id;

  for v_month_key, v_month_data in select key, value from jsonb_each(v_snapshot)
  loop
    if v_month_key = '_settings' then continue; end if;
    if jsonb_typeof(v_month_data) <> 'array' then continue; end if;

    -- month_key is "YYYY-M" (JS getMonth is 0-indexed)
    begin
      v_year := split_part(v_month_key, '-', 1)::int;
      v_month := split_part(v_month_key, '-', 2)::int + 1;
    exception when others then continue;
    end;

    for v_tx in select t from jsonb_array_elements(v_month_data) as a(t)
    loop
      if v_tx->>'cat' <> v_local_id then continue; end if;

      -- entry.date in the snapshot is "May 10" or "10 May" or just digits.
      -- Strip everything non-digit to get the day. Fall back to day 1.
      v_day_text := regexp_replace(coalesce(v_tx->>'date',''), '[^0-9]', '', 'g');
      v_day := null;
      begin
        if v_day_text <> '' then
          v_day := v_day_text::int;
        end if;
      exception when others then v_day := null;
      end;

      begin
        v_real_date := make_date(v_year, v_month, coalesce(v_day, 1));
      exception when others then
        v_real_date := make_date(v_year, v_month, 1);
      end;

      update public.shared_transactions
      set occurred_on = v_real_date
      where budget_id = v_budget_id
        and month_key = v_month_key
        and description = coalesce(nullif(v_tx->>'desc',''), 'Expense')
        and amount = abs(coalesce((v_tx->>'amt')::numeric, 0))
        -- only correct rows we previously set to the first-of-month
        and occurred_on = make_date(v_year, v_month, 1);
      get diagnostics v_last_count = row_count;
      v_total_count := v_total_count + v_last_count;

      raise notice 'Date-fix: month=% desc=% amt=% -> day=% date=% updated=%',
        v_month_key, v_tx->>'desc', v_tx->>'amt', v_day, v_real_date, v_last_count;
    end loop;
  end loop;

  raise notice 'Date-fix: updated % transactions total', v_total_count;
end $$;
