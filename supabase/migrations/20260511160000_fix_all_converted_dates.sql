-- ============================================================
-- Generalized date fixup for shared transactions whose
-- occurred_on was wrongly set to the conversion-day (today) when
-- a local budget was converted to shared. Walks every owner's
-- most-recent budget_sync_history snapshot that contained a
-- local budget with a matching label, then re-derives the right
-- day-of-month from each local entry's `date` string.
--
-- Idempotent: skips rows whose occurred_on already matches the
-- computed date.
-- ============================================================

do $$
declare
  v_owner_id uuid;
  v_owner_email text;
  v_budget record;
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
  v_grand_total int := 0;
  v_per_budget int;
begin
  -- For each shared budget that has at least one transaction
  for v_budget in
    select sb.id, sb.owner_id, sb.label, sb.created_at
      from public.shared_budgets sb
      where sb.deleted_at is null
        and exists (select 1 from public.shared_transactions st where st.budget_id = sb.id)
      order by sb.created_at asc
  loop
    v_per_budget := 0;

    -- Find the owner's snapshot history for a matching local budget
    select bsh.data into v_snapshot
      from public.budget_sync_history bsh
      where bsh.user_id = v_budget.owner_id
        and exists (
          select 1
          from jsonb_array_elements(coalesce(bsh.data->'_settings'->'budgets','[]'::jsonb)) as b(b_obj)
          where lower(b_obj->>'label') = lower(v_budget.label)
        )
      order by bsh.saved_at desc
      limit 1;

    if v_snapshot is null then
      raise notice 'Date-fixup: no snapshot found for budget % (%) of owner %', v_budget.label, v_budget.id, v_budget.owner_id;
      continue;
    end if;

    select b_obj->>'id' into v_local_id
      from jsonb_array_elements(v_snapshot->'_settings'->'budgets') as b(b_obj)
      where lower(b_obj->>'label') = lower(v_budget.label)
      limit 1;

    -- Walk every month bucket in the snapshot
    for v_month_key, v_month_data in select key, value from jsonb_each(v_snapshot)
    loop
      if v_month_key = '_settings' then continue; end if;
      if jsonb_typeof(v_month_data) <> 'array' then continue; end if;

      begin
        v_year := split_part(v_month_key, '-', 1)::int;
        v_month := split_part(v_month_key, '-', 2)::int + 1;  -- JS 0-indexed → SQL 1-indexed
      exception when others then continue;
      end;

      for v_tx in select t from jsonb_array_elements(v_month_data) as a(t)
      loop
        if v_tx->>'cat' <> v_local_id then continue; end if;

        -- entry.date is a localized short string like "May 10". Pull the digits.
        v_day_text := regexp_replace(coalesce(v_tx->>'date',''), '[^0-9]', '', 'g');
        v_day := null;
        begin
          if v_day_text <> '' then
            v_day := v_day_text::int;
          end if;
        exception when others then v_day := null;
        end;

        if v_day is null or v_day < 1 or v_day > 31 then v_day := 1; end if;

        begin
          v_real_date := make_date(v_year, v_month, v_day);
        exception when others then
          v_real_date := make_date(v_year, v_month, 1);
        end;

        -- Only touch rows whose current occurred_on disagrees with the computed date
        update public.shared_transactions
        set occurred_on = v_real_date
        where budget_id = v_budget.id
          and month_key = v_month_key
          and description = coalesce(nullif(v_tx->>'desc',''), 'Expense')
          and amount = abs(coalesce((v_tx->>'amt')::numeric, 0))
          and occurred_on <> v_real_date;
        get diagnostics v_last_count = row_count;
        v_per_budget := v_per_budget + v_last_count;
      end loop;
    end loop;

    if v_per_budget > 0 then
      raise notice 'Date-fixup: budget % (% owned by %) — fixed % transactions',
        v_budget.label, v_budget.id, v_budget.owner_id, v_per_budget;
    end if;
    v_grand_total := v_grand_total + v_per_budget;
  end loop;

  raise notice 'Date-fixup: % transactions corrected total', v_grand_total;
end $$;
