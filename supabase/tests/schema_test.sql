-- Behaviour tests for the schema. Run with: npm run test:db  (see scripts/test-db.sh)
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

create or replace function pg_temp.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR matching "%" but statement succeeded: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' then raise; end if;
  if sqlerrm !~* p_pattern then
    raise exception 'wrong error for %: got "%", wanted "%"', p_sql, sqlerrm, p_pattern;
  end if;
  raise notice 'ok - error: %', p_pattern;
end $$;

create or replace function pg_temp.eq(p_got anyelement, p_want anyelement, p_label text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception 'FAIL %: got %, want %', p_label, p_got, p_want; end if;
  raise notice 'ok - %', p_label;
end $$;

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_id::text, ''), false);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- admin a, staff c1 c2, accounts d1; wallets w1 (c1), w2 (c2)
create temp table ids as select
  '00000000-0000-0000-0000-00000000000a'::uuid as admin,
  '00000000-0000-0000-0000-0000000000c1'::uuid as c1,
  '00000000-0000-0000-0000-0000000000c2'::uuid as c2,
  '00000000-0000-0000-0000-0000000000d1'::uuid as acc,
  date_trunc('month', current_date)::date as this_month,
  (date_trunc('month', current_date) - interval '1 month')::date as last_month,
  to_char(current_date - interval '1 month', 'YYYY-MM') as last_month_text;
grant select on ids to authenticated;

-- users: first signup becomes admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test', '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test', '{"full_name":"Staff One"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test', '{"full_name":"Staff Two"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'acc@test', '{"full_name":"Accounts","role":"accounts"}');

select pg_temp.eq((select role::text from profiles where email = 'admin@test'), 'admin', 'first user is admin');
select pg_temp.eq((select role::text from profiles where email = 'c1@test'), 'custodian', 'default role is staff');
select pg_temp.eq((select role::text from profiles where email = 'acc@test'), 'accounts', 'role from metadata');

-- ---------------------------------------------------------------- admin setup
set role authenticated;
select pg_temp.as_user((select admin from ids));

insert into wallets (id, name, custodian_id, card_last4) values
  ('10000000-0000-0000-0000-000000000001', 'Staff One wallet', '00000000-0000-0000-0000-0000000000c1', '1234'),
  ('10000000-0000-0000-0000-000000000002', 'Staff Two wallet', '00000000-0000-0000-0000-0000000000c2', null);
select pg_temp.expect_error($$insert into wallets (name, custodian_id) values ('second', '00000000-0000-0000-0000-0000000000c1')$$, 'wallets_one_active_per_holder');

insert into projects (id, code, name) values
  ('20000000-0000-0000-0000-000000000001', 'P-001', 'Riyadh fit-out'),
  ('20000000-0000-0000-0000-000000000002', 'P-002', 'Jeddah office');
insert into categories (id, name, receipt_required) values
  ('30000000-0000-0000-0000-000000000001', 'Fuel', true),
  ('30000000-0000-0000-0000-000000000002', 'Materials', true),
  ('30000000-0000-0000-0000-000000000003', 'Outside labour', false);

insert into topups (id, wallet_id, amount, reference) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 5000, 'TRF-1'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 1000, 'TRF-2');
select pg_temp.expect_error($$insert into topups (wallet_id, amount) values ('10000000-0000-0000-0000-000000000001', -5)$$, 'amount_check');

-- ---------------------------------------------------------------- staff
select pg_temp.as_user((select c1 from ids));
select pg_temp.eq((select count(*) from wallets), 1::bigint, 'staff sees only own wallet');
select pg_temp.eq((select count(*) from topups), 1::bigint, 'staff sees only own top-ups');
select pg_temp.expect_error($$insert into topups (wallet_id, amount) values ('10000000-0000-0000-0000-000000000001', 10)$$, 'row-level security');
select pg_temp.expect_error($$insert into projects (code, name) values ('X', 'x')$$, 'row-level security');

-- spend on someone else's wallet: blocked
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, paid_by, amount) values
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'card', 50)$$, 'row-level security');
-- card or cash is required
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, amount) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 50)$$, 'paid_by');
-- above threshold without a bill: blocked
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, paid_by, amount) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'card', 150)$$, 'bill photo is required');
-- no-bill category: remarks required instead
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, paid_by, amount) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'cash', 200)$$, 'remarks are required');
-- cannot insert as already checked
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, paid_by, amount, checked_by, checked_at) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'card', 50, '00000000-0000-0000-0000-0000000000c1', now())$$, 'unchecked');

insert into expenses (id, client_id, wallet_id, project_id, category_id, paid_by, amount, vat_amount, vendor, invoice_path, description) values
  ('50000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'card', 1150, 150, 'SASCO', '00000000-0000-0000-0000-0000000000c1/2026/a.jpg', null),
  ('50000000-0000-0000-0000-000000000002', null, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'cash', 80, 0, 'Shop', null, null),
  ('50000000-0000-0000-0000-000000000003', null, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'cash', 400, 0, '', null, 'Riyadh fit-out, paid to 2 labourers');
-- offline resend with the same client_id: rejected as duplicate
select pg_temp.expect_error($$insert into expenses (client_id, wallet_id, project_id, category_id, paid_by, amount) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'card', 10)$$, 'duplicate key');

select pg_temp.eq((select available_balance from wallet_balances), 3370.00::numeric(14,2), 'every saved expense counts straight away: 5000 - 1150 - 80 - 400');
select pg_temp.eq((select spent_card from wallet_balances), 1150.00::numeric(14,2), 'card spend split out');
-- spending more than the balance is allowed (the admin may record the transfer later); the balance goes negative.
-- Runs inside an exception block so the extra expense is rolled back afterwards.
do $$
begin
  insert into expenses (wallet_id, project_id, category_id, paid_by, amount, description) values
    ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'cash', 5000, 'paid before the transfer arrived');
  if (select available_balance from wallet_balances) <> -1630.00 then
    raise exception 'expected a negative balance of -1630.00, got %', (select available_balance from wallet_balances);
  end if;
  raise exception 'negative-ok';
exception when others then
  if sqlerrm <> 'negative-ok' then raise; end if;
end $$;
select pg_temp.eq((select spent_cash from wallet_balances), 480.00::numeric(14,2), 'cash spend split out');
select pg_temp.eq((select period_month from expenses where id = '50000000-0000-0000-0000-000000000002'), (select this_month from ids), 'period month defaults from the expense date');

-- staff fix their own unchecked entry
update expenses set amount = 90 where id = '50000000-0000-0000-0000-000000000002';
select pg_temp.eq((select amount from expenses where id = '50000000-0000-0000-0000-000000000002'), 90.00::numeric(14,2), 'staff corrects own entry before it is checked');
select pg_temp.expect_error($$update expenses set status = 'reversed' where id = '50000000-0000-0000-0000-000000000002'$$, 'row-level security|reversal_complete');
select pg_temp.expect_error($$select set_checked('50000000-0000-0000-0000-000000000002', true)$$, 'only accounts and finance');
select pg_temp.expect_error($$select reverse_expense('50000000-0000-0000-0000-000000000002', 'x')$$, 'only finance admins');

-- months
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, paid_by, amount, period_month) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'card', 10, (date_trunc('month', current_date) + interval '1 month')::date)$$, 'in the future');
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, paid_by, amount, period_month) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'card', 10, (date_trunc('month', current_date) - interval '5 months')::date)$$, 'outside the open months');
insert into expenses (id, wallet_id, project_id, category_id, paid_by, amount, description, period_month) values
  ('50000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'cash', 200,
   'late entry for last month', (select last_month from ids));

-- ---------------------------------------------------------------- accounts / audit
select pg_temp.as_user((select acc from ids));
select pg_temp.eq((select count(*) from wallets), 2::bigint, 'accounts sees every wallet');
select pg_temp.eq((select count(*) from expenses), 4::bigint, 'accounts sees every expense');
select pg_temp.eq((select count(*) > 0 from audit_log), true, 'accounts reads the audit log');
select pg_temp.eq((select checked_by from set_checked('50000000-0000-0000-0000-000000000001', true, 'matches bank')), (select acc from ids), 'accounts ticks an entry as checked');
update expenses set amount = 1 where id = '50000000-0000-0000-0000-000000000002';  -- no update policy: matches nothing
select pg_temp.eq((select amount from expenses where id = '50000000-0000-0000-0000-000000000002'), 90.00::numeric(14,2), 'accounts cannot edit entries');
select pg_temp.expect_error($$select close_month((date_trunc('month', current_date) - interval '1 month')::date, 'x')$$, 'only finance admins');

-- staff cannot change an entry once checked
select pg_temp.as_user((select c1 from ids));
update expenses set amount = 1 where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.eq((select amount from expenses where id = '50000000-0000-0000-0000-000000000001'), 1150.00::numeric(14,2), 'checked entry is locked for staff');
select pg_temp.eq((select unchecked_count from wallet_balances), 3, 'unchecked count');

-- ---------------------------------------------------------------- finance corrections
select pg_temp.as_user((select admin from ids));
reset role;
select pg_temp.expect_error($$delete from expenses where id = '50000000-0000-0000-0000-000000000002'$$, 'cannot be deleted');
select pg_temp.expect_error($$delete from topups where id = '40000000-0000-0000-0000-000000000001'$$, 'cannot be deleted');
select pg_temp.expect_error($$delete from audit_log$$, 'cannot be deleted');
set role authenticated;
select pg_temp.expect_error($$update topups set amount = 1 where id = '40000000-0000-0000-0000-000000000001'$$, 'cannot be edited');
select reverse_expense('50000000-0000-0000-0000-000000000002', 'Entered twice');
select pg_temp.eq((select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001'),
  3250.00::numeric(14,2), 'reversal gives the money back: 5000 - 1150 - 400 - 200');
select pg_temp.expect_error($$update expenses set amount = 5 where id = '50000000-0000-0000-0000-000000000002'$$, 'read only');
update expenses set amount = 1100, vat_amount = 100 where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.eq((select amount from expenses where id = '50000000-0000-0000-0000-000000000001'), 1100.00::numeric(14,2), 'finance corrects a checked entry');
select reverse_topup('40000000-0000-0000-0000-000000000002', 'Entered twice');
select pg_temp.eq((select topups_total from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000002'), 0.00::numeric(14,2), 'reversed top-up excluded');
select pg_temp.eq((select count(*) > 0 from audit_log where table_name = 'expenses' and action = 'update'), true, 'audit log written');

-- dashboard
select pg_temp.eq((dashboard_summary(p_month => (select this_month from ids)) ->> 'spent_total')::numeric, 1500::numeric, 'dashboard spent this month (1100 + 400)');
select pg_temp.eq((dashboard_summary() ->> 'spent_cash')::numeric, 600::numeric, 'dashboard cash spend');
select pg_temp.eq((select count(*) from spend_breakdown('month')), 2::bigint, 'breakdown by month');
select pg_temp.eq((select count(*) from wallet_month_summary((select this_month from ids)) where opening + transferred - spent <> balance), 0::bigint,
  'wallet summary adds up for a month: opening + transferred - spent = balance');
select pg_temp.eq((select count(*) from wallet_month_summary() where opening + transferred - spent <> balance), 0::bigint,
  'wallet summary adds up across all open months');
select pg_temp.eq((select balance from wallet_month_summary((select this_month from ids)) where wallet_id = '10000000-0000-0000-0000-000000000001'),
  (select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001'), 'balance at end of this month = balance now');
select pg_temp.eq((select balance from wallet_month_summary() where wallet_id = '10000000-0000-0000-0000-000000000001'),
  (select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001'), 'all-months balance = balance now');
select pg_temp.eq((select opening from wallet_month_summary((select this_month from ids)) where wallet_id = '10000000-0000-0000-0000-000000000001'),
  (select coalesce(sum(case when kind = 'in' then amount else -amount end), 0)::numeric(14,2) from (
     select 'in' as kind, amount from topups where wallet_id = '10000000-0000-0000-0000-000000000001' and status = 'posted' and period_month < (select this_month from ids)
     union all
     select 'out', amount from expenses where wallet_id = '10000000-0000-0000-0000-000000000001' and status = 'recorded' and period_month < (select this_month from ids)) x),
  'opening = everything before the month');

-- reconciliation
-- the bank shows the card only: 5000 in - 1100 card spend = 3900 (the 400 cash spend is not on the card)
select pg_temp.eq((record_statement_check('10000000-0000-0000-0000-000000000001', current_date, 3880)).difference, -20.00::numeric(14,2),
  'statement check compares the card part and flags a 20 SAR gap');

-- ---------------------------------------------------------------- cash in hand
-- admin sends 2000 to Staff Two's card
insert into topups (id, wallet_id, amount) values ('40000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000002', 2000);
select pg_temp.as_user((select c2 from ids));
insert into cash_moves (id, wallet_id, kind, amount, move_date) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'withdrawal', 800, current_date - 6),   -- logged today, withdrawn 6 days ago
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'withdrawal', 1000, current_date);
insert into expenses (wallet_id, project_id, category_id, paid_by, amount, description) values
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'cash', 300, 'site labour');
insert into expenses (wallet_id, project_id, category_id, paid_by, amount, vendor, expense_date) values
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'card', 70, 'Hardware shop', current_date - 5);
insert into cash_moves (wallet_id, kind, amount) values ('10000000-0000-0000-0000-000000000002', 'deposit', 200), ('10000000-0000-0000-0000-000000000002', 'handover', 100);
select pg_temp.eq((select cash_in_hand from wallet_balances), 1200.00::numeric(14,2), 'cash in hand: 800 + 1000 - 300 spent - 200 deposited - 100 handed back');
select pg_temp.eq((select card_balance from wallet_balances), 330.00::numeric(14,2), 'card: 2000 - 1800 withdrawn + 200 deposited - 70 swiped');
select pg_temp.eq((select available_balance from wallet_balances), 1530.00::numeric(14,2), 'total = card + cash; only the handover leaves the wallet');
select pg_temp.eq((select held_too_long from cash_held()), 200.00::numeric(14,2), 'oldest cash first: 200 left of the 6-day-old withdrawal is held too long');
select pg_temp.eq((select oldest_days from cash_held()), 6, 'oldest cash is 6 days old');
select pg_temp.expect_error($$insert into cash_moves (wallet_id, kind, amount) values ('10000000-0000-0000-0000-000000000001', 'withdrawal', 10)$$, 'row-level security');
select pg_temp.expect_error($$insert into cash_moves (wallet_id, kind, amount, move_date) values ('10000000-0000-0000-0000-000000000002', 'withdrawal', 10, current_date + 2)$$, 'future');
select pg_temp.expect_error($$select import_bank_lines('10000000-0000-0000-0000-000000000002', 'x', '[{"date":"2026-01-01","amount":-1,"description":"x"}]')$$, 'only accounts');
select pg_temp.eq((select count(*) from bank_lines), 0::bigint, 'staff cannot see statements');
select pg_temp.as_user((select admin from ids));
select pg_temp.expect_error($$update cash_moves set amount = 1 where id = '60000000-0000-0000-0000-000000000001'$$, 'cannot be edited');

-- ---------------------------------------------------------------- bank statement
select pg_temp.as_user((select acc from ids));
create temp table stmt as select jsonb_build_array(
  jsonb_build_object('date', current_date - 6, 'amount', -800, 'description', 'Cash withdrawal - Local ATM'),
  jsonb_build_object('date', current_date, 'amount', -1000, 'description', 'سحب نقدي صراف آلي'),
  jsonb_build_object('date', current_date, 'amount', 2000, 'description', 'Incoming Local transfer'),
  jsonb_build_object('date', current_date - 1, 'amount', -55.50, 'description', 'POS Purchase COFFEE HOUSE'),
  jsonb_build_object('date', current_date, 'amount', -5.75, 'description', 'VAT Charge'),
  jsonb_build_object('date', current_date, 'amount', 200, 'description', 'Cash deposit ATM')) as lines;
grant select on stmt to authenticated;
select pg_temp.eq((import_bank_lines('10000000-0000-0000-0000-000000000002', 'week.xlsx', (select lines from stmt)) ->> 'matched')::int, 4, 'two withdrawals, the transfer in and the deposit match');
select pg_temp.eq((import_bank_lines('10000000-0000-0000-0000-000000000002', 'week-again.xlsx', (select lines from stmt)) ->> 'new_lines')::int, 0, 'uploading the same lines again adds nothing');
select pg_temp.eq((select count(*) from bank_report('10000000-0000-0000-0000-000000000002') where section = 'late'), 1::bigint, 'withdrawal entered 6 days after the bank date is late');
select pg_temp.eq((select days_late from bank_report('10000000-0000-0000-0000-000000000002') where section = 'late'), 6, 'late by 6 days');
select pg_temp.eq((select count(*) from bank_report('10000000-0000-0000-0000-000000000002') where section = 'matched'), 3::bigint, 'three matched on time');
select pg_temp.eq((select amount from bank_report('10000000-0000-0000-0000-000000000002') where section = 'bank_only'), -55.50::numeric(14,2), 'card swipe in the bank but not in the app');
select pg_temp.eq((select amount from bank_report('10000000-0000-0000-0000-000000000002') where section = 'app_only'), -70.00::numeric(14,2), 'card expense in the app but not in the bank');
select pg_temp.eq((select count(*) from bank_report('10000000-0000-0000-0000-000000000002') where section = 'fee'), 1::bigint, 'bank fee kept apart');
select pg_temp.eq((select string_agg(kind, ',' order by kind) from attention_flags()), 'bank_only,cash_held,late_entry', 'dashboard flags');
select resolve_bank_line((select line_id from bank_report('10000000-0000-0000-0000-000000000002') where section = 'bank_only'), true, 'personal coffee, staff repaid');
select pg_temp.eq((select count(*) from attention_flags() where kind = 'bank_only'), 0::bigint, 'a resolved line is no longer flagged');
select pg_temp.eq((select count(*) from wallet_month_summary() where opening + transferred - spent - returned <> balance), 0::bigint,
  'wallet summary still adds up with cash handed back');
select pg_temp.eq((select cash_in_hand from wallet_month_summary() where wallet_id = '10000000-0000-0000-0000-000000000002'), 1200.00::numeric(14,2), 'summary shows cash in hand');
select pg_temp.as_user((select admin from ids));

-- ---------------------------------------------------------------- close month
insert into topups (id, wallet_id, amount, period_month, attachment_path) values
  ('40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 300, (select last_month from ids), '00000000-0000-0000-0000-00000000000a/2026/t.pdf');
create temp table bal_before as select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001';
grant select on bal_before to authenticated;
create temp table cash_before as select cash_in_hand, card_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000002';
grant select on cash_before to authenticated;

select pg_temp.expect_error($$select close_month((select last_month from ids), 'yes')$$, 'type .* to confirm');
select pg_temp.expect_error($$select close_month((select this_month from ids), to_char(current_date, 'YYYY-MM'))$$, 'current month cannot be closed');
select pg_temp.expect_error($$select close_month((select last_month from ids), (select last_month_text from ids))$$, 'download the export');
select record_month_export((select last_month from ids), 1);
select pg_temp.eq((select export_current from month_overview() where month = (select last_month from ids)), true, 'export is current');
-- a change after the export makes it stale
update expenses set description = 'late entry for last month, 2 labourers' where id = '50000000-0000-0000-0000-000000000010';
select pg_temp.eq((select export_current from month_overview() where month = (select last_month from ids)), false, 'a later change makes the export stale');
select pg_temp.expect_error($$select close_month((select last_month from ids), (select last_month_text from ids))$$, 'download the export');
select record_month_export((select last_month from ids), 1);

select pg_temp.eq((select files_pending from close_month((select last_month from ids), (select last_month_text from ids))),
  array['attachments/00000000-0000-0000-0000-00000000000a/2026/t.pdf'], 'close returns the files to remove');
select pg_temp.eq((select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001'), (select available_balance from bal_before), 'balance unchanged by close');
select pg_temp.eq((select (cash_in_hand, card_balance)::text from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000002'),
  (select (cash_in_hand, card_balance)::text from cash_before), 'cash in hand and card unchanged by close (cash carried forward)');
select pg_temp.eq((select opening_balance from wallets where id = '10000000-0000-0000-0000-000000000001'), 100.00::numeric(14,2), 'net of the month (300 in - 200 out) carried forward');
select pg_temp.eq((select count(*) from expenses where period_month = (select last_month from ids)), 0::bigint, 'month expenses erased');
select pg_temp.eq((select count(*) from topups where period_month = (select last_month from ids)), 0::bigint, 'month top-ups erased');
select pg_temp.eq((select count(*) from audit_log where record_id in ('50000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000010')), 0::bigint, 'erased rows leave no history');
select pg_temp.eq((select count(*) from audit_log where table_name = 'closed_months' and action = 'insert'), 1::bigint, 'the close itself is audited');
select pg_temp.eq((select expense_total from closed_months), 200.00::numeric(14,2), 'closed month keeps its totals');
select pg_temp.eq(cardinality((select files_pending from mark_files_removed((select last_month from ids),
  array['attachments/00000000-0000-0000-0000-00000000000a/2026/t.pdf']))), 0, 'files marked removed');
select pg_temp.expect_error($$insert into topups (wallet_id, amount, period_month) values ('10000000-0000-0000-0000-000000000001', 5, (select last_month from ids))$$, 'is closed');
select pg_temp.expect_error($$select close_month((select last_month from ids), (select last_month_text from ids))$$, 'already closed');
select pg_temp.eq(coalesce(nullif(current_setting('xc.closing', true), ''), 'off'), 'off', 'delete switch is off again');
reset role;
select pg_temp.expect_error($$delete from expenses where id = '50000000-0000-0000-0000-000000000001'$$, 'cannot be deleted');
set role authenticated;
select pg_temp.eq((storage_usage() ->> 'limit_bytes')::bigint, 1048576000::bigint, 'storage limit from settings');

-- ---------------------------------------------------------------- staff privacy
select pg_temp.as_user((select c2 from ids));
select pg_temp.eq((select count(*) from expenses where wallet_id <> '10000000-0000-0000-0000-000000000002'), 0::bigint, 'staff do not see other staff entries');
select pg_temp.eq((select count(*) from cash_moves where wallet_id <> '10000000-0000-0000-0000-000000000002'), 0::bigint, 'staff do not see other staff cash');
select pg_temp.eq((select count(*) from audit_log), 0::bigint, 'staff cannot read the audit log');
select pg_temp.eq(storage_usage(), null::jsonb, 'staff cannot see storage usage');
select pg_temp.eq((select count(*) from month_overview()), 0::bigint, 'staff see no month overview');
select pg_temp.expect_error($$update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c2'$$, 'row-level security');

-- storage policies
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('invoices', '00000000-0000-0000-0000-0000000000c1/2026/x.jpg')$$, 'row-level security');
insert into storage.objects (bucket_id, name) values ('invoices', '00000000-0000-0000-0000-0000000000c2/2026/x.jpg');
select pg_temp.as_user((select acc from ids));
select pg_temp.eq((select count(*) from storage.objects where bucket_id = 'invoices'), 1::bigint, 'accounts can read every invoice');

reset role;
\o
\echo 'ALL DATABASE TESTS PASSED'
