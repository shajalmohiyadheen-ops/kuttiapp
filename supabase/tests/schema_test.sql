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
select pg_temp.eq((select confirmed_balance from wallet_balances), 5000.00::numeric(14,2), 'confirmed ignores pending');

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
update expenses set odoo_sync = 'queued' where id = '50000000-0000-0000-0000-000000000001';  -- Phase 2 sync columns stay writable
set role authenticated;
select pg_temp.expect_error($$update topups set amount = 1 where id = '40000000-0000-0000-0000-000000000001'$$, 'cannot be edited');
select pg_temp.expect_error($$select reverse_expense('50000000-0000-0000-0000-000000000003', 'x')$$, 'only approved');

select pg_temp.eq((select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001'),
  3570.00::numeric(14,2), 'balance = 5000 - 1150 approved - 280 pending (rejected 80 released)');

select reverse_expense('50000000-0000-0000-0000-000000000001', 'Refunded by vendor');
select pg_temp.eq((select available_balance from wallet_balances where wallet_id = '10000000-0000-0000-0000-000000000001'),
  4720.00::numeric(14,2), 'reversal restores balance');

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
select pg_temp.eq((select count(*) from spend_breakdown('project')), 1::bigint, 'breakdown by project');

-- reconciliation
select pg_temp.eq((record_statement_check('10000000-0000-0000-0000-000000000001', current_date, 4700)).difference, -20.00::numeric(14,2),
  'statement check flags a 20 SAR gap');

-- custodian cannot read audit log or statement checks
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.eq((select count(*) from audit_log), 0::bigint, 'custodian cannot read audit log');
select pg_temp.expect_error($$update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1'$$, 'row-level security');

-- storage policies
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('invoices', '00000000-0000-0000-0000-0000000000c2/2026/x.jpg')$$, 'row-level security');
insert into storage.objects (bucket_id, name) values ('invoices', '00000000-0000-0000-0000-0000000000c1/2026/x.jpg');

reset role;
\o
\echo 'ALL DATABASE TESTS PASSED'
