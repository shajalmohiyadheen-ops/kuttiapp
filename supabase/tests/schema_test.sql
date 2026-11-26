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

-- users: first signup becomes admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test', '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test', '{"full_name":"Custodian One"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test', '{"full_name":"Custodian Two"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'pm@test', '{"full_name":"PM","role":"approver"}');

select pg_temp.eq((select role::text from profiles where email = 'admin@test'), 'admin', 'first user is admin');
select pg_temp.eq((select role::text from profiles where email = 'c1@test'), 'custodian', 'default role custodian');
select pg_temp.eq((select role::text from profiles where email = 'pm@test'), 'approver', 'role from metadata');

-- ---------------------------------------------------------------- admin setup
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

insert into wallets (id, name, kind, custodian_id, card_last4) values
  ('10000000-0000-0000-0000-000000000001', 'C1 Alinma card', 'card', '00000000-0000-0000-0000-0000000000c1', '1234'),
  ('10000000-0000-0000-0000-000000000002', 'C2 cash float', 'cash', '00000000-0000-0000-0000-0000000000c2', null);
select pg_temp.expect_error($$insert into wallets (name, kind, custodian_id) values ('bad', 'card', '00000000-0000-0000-0000-0000000000c1')$$, 'card_has_last4');

insert into projects (id, code, name, approver_id) values
  ('20000000-0000-0000-0000-000000000001', 'P-001', 'Riyadh fit-out', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-000000000002', 'P-002', 'Jeddah office', null);
insert into categories (id, name) values ('30000000-0000-0000-0000-000000000001', 'Fuel'), ('30000000-0000-0000-0000-000000000002', 'Materials');

insert into topups (id, wallet_id, amount, reference) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 5000, 'TRF-1'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 1000, 'CASH-1');
select pg_temp.expect_error($$insert into topups (wallet_id, amount) values ('10000000-0000-0000-0000-000000000001', -5)$$, 'amount_check');

-- ---------------------------------------------------------------- custodian
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.eq((select count(*) from wallets), 1::bigint, 'custodian sees only own wallet');
select pg_temp.eq((select count(*) from topups), 1::bigint, 'custodian sees only own top-ups');
select pg_temp.expect_error($$insert into topups (wallet_id, amount) values ('10000000-0000-0000-0000-000000000001', 10)$$, 'row-level security');
select pg_temp.expect_error($$insert into projects (code, name) values ('X', 'x')$$, 'row-level security');

-- spend on someone else's wallet: blocked
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, amount) values
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 50)$$, 'row-level security');
-- above threshold without invoice: blocked
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, amount) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 150)$$, 'invoice photo is required');
-- cannot self-approve on insert
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, amount, status) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 50, 'approved')$$, 'row-level security|start as pending');

insert into expenses (id, client_id, wallet_id, project_id, category_id, amount, vat_amount, vendor, invoice_path) values
  ('50000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1150, 150, 'SASCO', '00000000-0000-0000-0000-0000000000c1/2026/a.jpg'),
  ('50000000-0000-0000-0000-000000000002', null, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 80, 0, 'Shop', null),
  ('50000000-0000-0000-0000-000000000003', null, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 300, 39.13, 'Hardware', '00000000-0000-0000-0000-0000000000c1/2026/b.jpg');
-- offline resubmit with same client_id: rejected as duplicate
select pg_temp.expect_error($$insert into expenses (client_id, wallet_id, project_id, category_id, amount, invoice_path) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1150, 'x/y.jpg')$$, 'duplicate key');

select pg_temp.eq((select available_balance from wallet_balances), 3470.00::numeric(14,2), 'pending deducted from available right away');
select pg_temp.eq((select pending_total from wallet_balances), 1530.00::numeric(14,2), 'pending total shown separately');

-- custodian cannot approve
select pg_temp.expect_error($$select review_expense('50000000-0000-0000-0000-000000000001', 'approve')$$, 'not allowed');
-- custodian cannot change status directly
select pg_temp.expect_error($$update expenses set status = 'approved' where id = '50000000-0000-0000-0000-000000000002'$$, 'row-level security');
-- but can fix a pending one
update expenses set description = 'water' where id = '50000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------- other custodian
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.eq((select count(*) from expenses), 0::bigint, 'custodian 2 cannot see custodian 1 expenses');

-- ---------------------------------------------------------------- approver
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.eq((select count(*) from expenses), 2::bigint, 'approver sees only own projects');
select review_expense('50000000-0000-0000-0000-000000000001', 'approve', null);
select pg_temp.expect_error($$select review_expense('50000000-0000-0000-0000-000000000002', 'approve')$$, 'not found|not allowed');
select pg_temp.expect_error($$select review_expense('50000000-0000-0000-0000-000000000003', 'reject', '')$$, 'reason is required');
select review_expense('50000000-0000-0000-0000-000000000003', 'request_changes', 'Wrong category, use Materials receipt');
select pg_temp.expect_error($$select reverse_expense('50000000-0000-0000-0000-000000000001', 'oops')$$, 'only finance admins');

-- ---------------------------------------------------------------- resubmit
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select resubmit_expense('50000000-0000-0000-0000-000000000003', 280, 36.52, '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
  current_date, 'Hardware', null, 'INV-9', 'fixed', null);
select pg_temp.eq((select status::text from expenses where id = '50000000-0000-0000-0000-000000000003'), 'pending', 'resubmitted goes back to pending');
select pg_temp.eq((select invoice_path from expenses where id = '50000000-0000-0000-0000-000000000003'), '00000000-0000-0000-0000-0000000000c1/2026/b.jpg', 'resubmit keeps invoice');
update expenses set amount = 1 where id = '50000000-0000-0000-0000-000000000001';  -- RLS: matches zero rows
select pg_temp.eq((select amount from expenses where id = '50000000-0000-0000-0000-000000000001'), 1150.00::numeric(14,2), 'submitter cannot edit approved expense');

-- ---------------------------------------------------------------- admin reviews, reversals, immutability
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select review_expense('50000000-0000-0000-0000-000000000002', 'reject', 'Personal purchase');
-- integrity triggers hold even for a superuser / service role that bypasses RLS
reset role;
select pg_temp.expect_error($$update expenses set amount = 999 where id = '50000000-0000-0000-0000-000000000001'$$, 'cannot be edited');
select pg_temp.expect_error($$update expenses set status = 'pending' where id = '50000000-0000-0000-0000-000000000001'$$, 'can only be reversed');
select pg_temp.expect_error($$delete from expenses where id = '50000000-0000-0000-0000-000000000001'$$, 'cannot be deleted');
select pg_temp.expect_error($$delete from topups where id = '40000000-0000-0000-0000-000000000001'$$, 'cannot be deleted');
select pg_temp.expect_error($$update expenses set description = 'x' where id = '50000000-0000-0000-0000-000000000002'$$, 'read only');
update wallets set active = false where id = '10000000-0000-0000-0000-000000000001';
update expenses set odoo_sync = 'queued' where id = '50000000-0000-0000-0000-000000000001';  -- Phase 2 sync columns stay writable, even if the wallet was closed since
update wallets set active = true where id = '10000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.expect_error($$update topups set amount = 1 where id = '40000000-0000-0000-0000-000000000001'$$, 'cannot be edited');
select pg_temp.expect_error($$select reverse_expense('50000000-0000-0000-0000-000000000003', 'x')$$, 'only approved');

select pg_temp.eq((select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001'),
  3490.00::numeric(14,2), 'balance = 5000 - 1150 approved - 280 pending - 80 rejected (spent money still counts)');

select reverse_expense('50000000-0000-0000-0000-000000000001', 'Refunded by vendor');
select pg_temp.eq((select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001'),
  4640.00::numeric(14,2), 'reversal restores balance');

select reverse_topup('40000000-0000-0000-0000-000000000002', 'Entered twice');
select pg_temp.eq((select topups_total from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000002'), 0.00::numeric(14,2), 'reversed top-up excluded');

-- history
select pg_temp.eq((select string_agg(to_status::text, '>' order by id) from expense_events where expense_id = '50000000-0000-0000-0000-000000000003'),
  'pending>changes_requested>pending', 'expense history recorded');
select pg_temp.eq((select count(*) > 0 from audit_log where table_name = 'expenses' and action = 'update'), true, 'audit log written');

-- dashboard
select pg_temp.eq((dashboard_summary() ->> 'topups_total')::numeric, 5000::numeric, 'dashboard top-ups');
select pg_temp.eq((dashboard_summary() ->> 'pending_total')::numeric, 280::numeric, 'dashboard pending');
select pg_temp.eq((dashboard_summary() ->> 'approved_total')::numeric, 0::numeric, 'dashboard approved after reversal');
select pg_temp.eq((dashboard_summary() ->> 'disbursed_total')::numeric, 360::numeric, 'dashboard spent includes rejected (280 pending + 80 rejected)');
select pg_temp.eq((select count(*) from spend_breakdown('project')), 1::bigint, 'breakdown by project');

-- reconciliation
select pg_temp.eq((record_statement_check('10000000-0000-0000-0000-000000000001', current_date, 4620)).difference, -20.00::numeric(14,2),
  'statement check flags a 20 SAR gap');

-- ---------------------------------------------------------------- no-receipt categories
insert into categories (id, name, receipt_required) values ('30000000-0000-0000-0000-000000000003', 'Outside labour', false);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, amount) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 200)$$, 'remarks are required');
-- above the threshold with no photo is fine when the category needs no receipt
insert into expenses (id, wallet_id, project_id, category_id, amount, description, period_month) values
  ('50000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 200,
   'Riyadh fit-out, paid to 2 labourers', (date_trunc('month', current_date) - interval '1 month')::date);

-- ---------------------------------------------------------------- period months
select pg_temp.eq((select period_month from expenses where id = '50000000-0000-0000-0000-000000000002'), date_trunc('month', current_date)::date, 'period month defaults from the expense date');
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, amount, period_month) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 10, (date_trunc('month', current_date) + interval '1 month')::date)$$, 'in the future');
select pg_temp.expect_error($$insert into expenses (wallet_id, project_id, category_id, amount, period_month) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 10, (date_trunc('month', current_date) - interval '5 months')::date)$$, 'outside the open months');

-- ---------------------------------------------------------------- close month
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into topups (id, wallet_id, amount, method, period_month, attachment_path) values
  ('40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 300, 'bank_transfer', (date_trunc('month', current_date) - interval '1 month')::date, '00000000-0000-0000-0000-00000000000a/2026/t.pdf');
create temp table bal_before as select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001';
grant select on bal_before to authenticated;

select pg_temp.expect_error($$select close_month((date_trunc('month', current_date) - interval '1 month')::date, 'yes')$$, 'type .* to confirm');
select pg_temp.expect_error($$select close_month(date_trunc('month', current_date)::date, to_char(current_date, 'YYYY-MM'))$$, 'current month cannot be closed');
select pg_temp.expect_error($$select close_month((date_trunc('month', current_date) - interval '1 month')::date, to_char(current_date - interval '1 month', 'YYYY-MM'))$$, 'waiting for review');
select review_expense('50000000-0000-0000-0000-000000000010', 'approve');
select pg_temp.expect_error($$select close_month((date_trunc('month', current_date) - interval '1 month')::date, to_char(current_date - interval '1 month', 'YYYY-MM'))$$, 'download the export');
select record_month_export((date_trunc('month', current_date) - interval '1 month')::date, 1);
select pg_temp.eq((select export_current from month_overview() where month = (date_trunc('month', current_date) - interval '1 month')::date), true, 'export is current');
-- a change after the export makes it stale
select move_to_month('expense', '50000000-0000-0000-0000-000000000010', (date_trunc('month', current_date) - interval '2 months')::date);
select move_to_month('expense', '50000000-0000-0000-0000-000000000010', (date_trunc('month', current_date) - interval '1 month')::date);
select pg_temp.expect_error($$select close_month((date_trunc('month', current_date) - interval '1 month')::date, to_char(current_date - interval '1 month', 'YYYY-MM'))$$, 'download the export');
select record_month_export((date_trunc('month', current_date) - interval '1 month')::date, 1);

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.expect_error($$select close_month((date_trunc('month', current_date) - interval '1 month')::date, to_char(current_date - interval '1 month', 'YYYY-MM'))$$, 'only finance admins');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

select pg_temp.eq((select files_pending from close_month((date_trunc('month', current_date) - interval '1 month')::date, to_char(current_date - interval '1 month', 'YYYY-MM'))),
  array['attachments/00000000-0000-0000-0000-00000000000a/2026/t.pdf'], 'close returns the files to remove');
select pg_temp.eq((select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001'), (select available_balance from bal_before), 'balance unchanged by close');
select pg_temp.eq((select opening_balance from wallets where id = '10000000-0000-0000-0000-000000000001'), 100.00::numeric(14,2), 'net of the month (300 in - 200 out) carried forward');
select pg_temp.eq((select count(*) from expenses where id = '50000000-0000-0000-0000-000000000010'), 0::bigint, 'month expenses erased');
select pg_temp.eq((select count(*) from topups where id = '40000000-0000-0000-0000-000000000010'), 0::bigint, 'month top-ups erased');
select pg_temp.eq((select count(*) from audit_log where record_id in ('50000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000010')), 0::bigint, 'erased rows leave no history');
select pg_temp.eq((select count(*) from audit_log where table_name = 'closed_months' and action = 'insert'), 1::bigint, 'the close itself is audited');
select pg_temp.eq((select expense_total from closed_months), 200.00::numeric(14,2), 'closed month keeps its totals');
select pg_temp.eq(cardinality((select files_pending from mark_files_removed((date_trunc('month', current_date) - interval '1 month')::date,
  array['attachments/00000000-0000-0000-0000-00000000000a/2026/t.pdf']))), 0, 'files marked removed');
select pg_temp.expect_error($$insert into topups (wallet_id, amount, period_month) values ('10000000-0000-0000-0000-000000000001', 5, (date_trunc('month', current_date) - interval '1 month')::date)$$, 'is closed');
delete from expenses where id = '50000000-0000-0000-0000-000000000002';  -- no delete policy: matches nothing
select pg_temp.eq((select count(*) from expenses where id = '50000000-0000-0000-0000-000000000002'), 1::bigint, 'ordinary deletes still do nothing after a close');
select pg_temp.eq(coalesce(nullif(current_setting('kutti.closing', true), ''), 'off'), 'off', 'delete switch is off again');
select pg_temp.eq((storage_usage() ->> 'limit_bytes')::bigint, 1048576000::bigint, 'storage limit from settings');

-- ---------------------------------------------------------------- accounts role
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000d1', 'acc@test', '{"full_name":"Accounts","role":"accounts"}');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into expenses (id, wallet_id, project_id, category_id, amount) values
  ('50000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 40);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.eq((select count(*) from expenses where wallet_id = '10000000-0000-0000-0000-000000000001'), 4::bigint, 'accounts sees every expense');
select pg_temp.eq((select count(*) > 0 from audit_log), true, 'accounts reads the audit log');
select pg_temp.eq((select count(*) from wallets), 2::bigint, 'accounts sees every wallet');
select pg_temp.expect_error($$select review_expense('50000000-0000-0000-0000-000000000020', 'approve')$$, 'not allowed');
select pg_temp.expect_error($$select close_month((date_trunc('month', current_date) - interval '2 month')::date, 'x')$$, 'only finance admins');
select pg_temp.expect_error($$update profiles set can_review = true where id = '00000000-0000-0000-0000-0000000000d1'$$, 'row-level security');
select pg_temp.eq((select can_review from profiles where id = '00000000-0000-0000-0000-0000000000d1'), false, 'accounts cannot give itself review rights');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set can_review = true where id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.eq((select status::text from review_expense('50000000-0000-0000-0000-000000000020', 'approve')), 'approved', 'accounts with review rights approves');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- custodian cannot read audit log or statement checks
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.eq((select count(*) from audit_log), 0::bigint, 'custodian cannot read audit log');
select pg_temp.eq(storage_usage(), null::jsonb, 'custodian cannot see storage usage');
select pg_temp.expect_error($$update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1'$$, 'row-level security');

-- storage policies
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('invoices', '00000000-0000-0000-0000-0000000000c2/2026/x.jpg')$$, 'row-level security');
insert into storage.objects (bucket_id, name) values ('invoices', '00000000-0000-0000-0000-0000000000c1/2026/x.jpg');

reset role;
\o
\echo 'ALL DATABASE TESTS PASSED'
