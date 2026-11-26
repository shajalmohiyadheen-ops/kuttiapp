-- KuttiApp: petty cash and company card tracker
-- Phase 1 schema. Runs on Supabase Postgres (uses auth.users, auth.uid(), storage).
--
-- Money rules
--   * Every amount is numeric(14,2) in SAR.
--   * A wallet's balance is CALCULATED: posted top-ups minus approved and pending
--     expenses. It is never read from the bank. Reconciliation against the bank
--     statement is a manual step (statement_checks table).
--   * Posted top-ups and approved expenses are never deleted or edited. They are
--     reversed, which keeps the row and records who reversed it and why.
--
-- Phase 2 (Odoo): every financial row carries external_id (stable, unique) plus
-- odoo_* columns that the sync job will fill in. Nothing in Phase 1 writes them.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'approver', 'custodian');
create type public.wallet_kind as enum ('card', 'cash');
create type public.topup_status as enum ('posted', 'reversed');
create type public.expense_status as enum ('pending', 'changes_requested', 'approved', 'rejected', 'reversed');
create type public.sync_status as enum ('not_synced', 'queued', 'synced', 'failed');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  phone       text,
  role        public.user_role not null default 'custodian',
  locale      text not null default 'en' check (locale in ('en', 'ar')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Role helpers. SECURITY DEFINER so policies can call them without recursing
-- into the profiles policies.
create or replace function public.current_role_name()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

create or replace function public.is_staff()
returns boolean  -- admin or approver: can see across custodians
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role_name() in ('admin', 'approver'), false)
$$;

-- New auth user -> profile. The first user ever becomes admin so a fresh
-- install can be bootstrapped without SQL.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  else
    v_role := coalesce(nullif(new.raw_user_meta_data ->> 'role', '')::public.user_role, 'custodian');
  end if;
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email, v_role);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
create table public.wallets (
  id            uuid primary key default gen_random_uuid(),
  external_id   text not null unique default ('KW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  name          text not null,
  kind          public.wallet_kind not null,
  custodian_id  uuid not null references public.profiles (id),
  bank_name     text default 'Alinma',
  card_last4    text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  active        boolean not null default true,
  odoo_journal_id integer,           -- Phase 2: Odoo journal this wallet maps to
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint card_has_last4 check (kind = 'cash' or card_last4 is not null)
);

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  external_id   text not null unique default ('KP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  code          text not null unique,
  name          text not null,
  name_ar       text,
  approver_id   uuid references public.profiles (id),   -- optional project manager
  budget        numeric(14,2) check (budget is null or budget >= 0),
  active        boolean not null default true,
  odoo_analytic_account_id integer,  -- Phase 2
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  name_ar       text,
  active        boolean not null default true,
  odoo_account_code text,            -- Phase 2: expense GL account
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('invoice_required_above', '100'::jsonb),   -- SAR; invoice photo mandatory above this
  ('vat_rate', '0.15'::jsonb);

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------------
-- Money in: top-ups (bank transfer into a card, or cash handed to a custodian)
-- ---------------------------------------------------------------------------
create table public.topups (
  id              uuid primary key default gen_random_uuid(),
  external_id     text not null unique default ('KT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  wallet_id       uuid not null references public.wallets (id),
  amount          numeric(14,2) not null check (amount > 0),
  transfer_date   date not null default current_date,
  method          text not null default 'bank_transfer' check (method in ('bank_transfer', 'cash', 'opening_balance', 'custodian_repayment', 'other')),
  -- custodian_repayment: money a custodian pays back, e.g. for a rejected card swipe
  reference       text,               -- bank transfer reference
  notes           text,
  attachment_path text,               -- storage path in the 'attachments' bucket
  status          public.topup_status not null default 'posted',
  created_by      uuid not null default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now(),
  reversed_by     uuid references public.profiles (id),
  reversed_at     timestamptz,
  reversal_reason text,
  odoo_sync       public.sync_status not null default 'not_synced',
  odoo_move_id    integer,
  constraint reversal_complete check (
    (status = 'reversed') = (reversed_at is not null and reversed_by is not null and coalesce(reversal_reason, '') <> '')
  )
);
create index on public.topups (wallet_id, transfer_date);

-- ---------------------------------------------------------------------------
-- Money out: expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id               uuid primary key default gen_random_uuid(),
  external_id      text not null unique default ('KE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  client_id        uuid unique,       -- set by the mobile app; makes offline resubmits idempotent
  wallet_id        uuid not null references public.wallets (id),
  project_id       uuid not null references public.projects (id),
  category_id      uuid not null references public.categories (id),
  submitted_by     uuid not null default auth.uid() references public.profiles (id),
  expense_date     date not null default current_date,
  vendor           text not null default '',
  vendor_vat_number text check (vendor_vat_number is null or vendor_vat_number ~ '^[0-9]{15}$'),
  invoice_number   text,
  description      text,
  amount           numeric(14,2) not null check (amount > 0),      -- total paid, VAT inclusive
  vat_amount       numeric(14,2) not null default 0 check (vat_amount >= 0),
  invoice_path     text,              -- storage path in the 'invoices' bucket
  status           public.expense_status not null default 'pending',
  review_note      text,
  reviewed_by      uuid references public.profiles (id),
  reviewed_at      timestamptz,
  reversed_by      uuid references public.profiles (id),
  reversed_at      timestamptz,
  reversal_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  odoo_sync        public.sync_status not null default 'not_synced',
  odoo_bill_id     integer,
  constraint vat_not_above_amount check (vat_amount <= amount),
  constraint reversal_complete check (
    (status = 'reversed') = (reversed_at is not null and reversed_by is not null and coalesce(reversal_reason, '') <> '')
  )
);
create index on public.expenses (wallet_id, status);
create index on public.expenses (project_id, expense_date);
create index on public.expenses (submitted_by, created_at desc);
create index on public.expenses (status, created_at);

-- ---------------------------------------------------------------------------
-- Approval history: one row per decision, so "changes requested" -> resubmit
-- -> approve is all visible.
-- ---------------------------------------------------------------------------
create table public.expense_events (
  id          bigint generated always as identity primary key,
  expense_id  uuid not null references public.expenses (id),
  from_status public.expense_status,
  to_status   public.expense_status not null,
  note        text,
  actor_id    uuid references public.profiles (id),
  at          timestamptz not null default now()
);
create index on public.expense_events (expense_id, at);

-- ---------------------------------------------------------------------------
-- Manual reconciliation against the bank statement
-- ---------------------------------------------------------------------------
create table public.statement_checks (
  id                  uuid primary key default gen_random_uuid(),
  wallet_id           uuid not null references public.wallets (id),
  statement_date      date not null,
  statement_balance   numeric(14,2) not null,
  calculated_balance  numeric(14,2) not null,   -- snapshot at the time of the check
  pending_amount      numeric(14,2) not null,   -- pending expenses at that time
  difference          numeric(14,2) generated always as (statement_balance - calculated_balance) stored,
  notes               text,
  created_by          uuid not null default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now()
);
create index on public.statement_checks (wallet_id, statement_date desc);

-- ---------------------------------------------------------------------------
-- Audit log: every insert/update on financial and master tables
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text not null,
  action      text not null,
  actor_id    uuid,
  old_data    jsonb,
  new_data    jsonb,
  at          timestamptz not null default now()
);
create index on public.audit_log (table_name, record_id);
create index on public.audit_log (at desc);

create or replace function public.audit_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_log (table_name, record_id, action, actor_id, old_data, new_data)
  values (
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id', '?'),
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'wallets', 'projects', 'categories', 'settings', 'topups', 'expenses', 'statement_checks']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'wallets', 'projects', 'categories', 'expenses']
  loop
    execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Integrity guards (apply to everyone, including admins and the service role)
-- ---------------------------------------------------------------------------
create or replace function public.forbid_delete()
returns trigger language plpgsql as $$
begin
  raise exception '% rows cannot be deleted; reverse them instead', tg_table_name using errcode = 'P0001';
end $$;

create trigger no_delete_topups   before delete on public.topups   for each row execute function public.forbid_delete();
create trigger no_delete_expenses before delete on public.expenses for each row execute function public.forbid_delete();
create trigger no_delete_events   before delete on public.expense_events for each row execute function public.forbid_delete();
create trigger no_delete_checks   before delete on public.statement_checks for each row execute function public.forbid_delete();
create trigger no_delete_audit    before delete on public.audit_log for each row execute function public.forbid_delete();

create or replace function public.guard_topup_update()
returns trigger language plpgsql as $$
begin
  if old.status = 'reversed' then
    if (new.odoo_sync, new.odoo_move_id) is distinct from (old.odoo_sync, old.odoo_move_id)
       and (to_jsonb(new) - 'odoo_sync' - 'odoo_move_id') = (to_jsonb(old) - 'odoo_sync' - 'odoo_move_id') then
      return new;
    end if;
    raise exception 'reversed top-ups are read only';
  end if;
  if (new.wallet_id, new.amount, new.transfer_date, new.method, new.created_by, new.created_at)
     is distinct from (old.wallet_id, old.amount, old.transfer_date, old.method, old.created_by, old.created_at) then
    raise exception 'posted top-ups cannot be edited; reverse and re-enter';
  end if;
  return new;
end $$;
create trigger guard_topup before update on public.topups for each row execute function public.guard_topup_update();

-- Expenses: content may change only while pending / changes_requested.
-- Status may only move along the allowed paths.
create or replace function public.guard_expense()
returns trigger language plpgsql as $$
declare
  v_threshold numeric := public.setting_numeric('invoice_required_above', 100);
  v_wallet public.wallets;
begin
  if tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception 'new expenses start as pending';
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('rejected', 'reversed') then
      if (to_jsonb(new) - 'odoo_sync' - 'odoo_bill_id' - 'updated_at') <> (to_jsonb(old) - 'odoo_sync' - 'odoo_bill_id' - 'updated_at') then
        raise exception 'expense % is %, it is read only', old.external_id, old.status;
      end if;
      return new;
    end if;
    if old.status = 'approved' and new.status not in ('approved', 'reversed') then
      raise exception 'approved expenses can only be reversed';
    end if;
    if old.status = 'approved'
       and (to_jsonb(new) - 'status' - 'reversed_by' - 'reversed_at' - 'reversal_reason' - 'odoo_sync' - 'odoo_bill_id' - 'updated_at')
           <> (to_jsonb(old) - 'status' - 'reversed_by' - 'reversed_at' - 'reversal_reason' - 'odoo_sync' - 'odoo_bill_id' - 'updated_at') then
      raise exception 'approved expenses cannot be edited; reverse instead';
    end if;
    if old.status in ('pending', 'changes_requested') and new.status = 'reversed' then
      raise exception 'only approved expenses can be reversed; reject it instead';
    end if;
    if new.submitted_by <> old.submitted_by or new.created_at <> old.created_at then
      raise exception 'submitter and created time are fixed';
    end if;
  end if;

  if new.status in ('pending', 'approved') then
    select * into v_wallet from public.wallets where id = new.wallet_id;
    if not v_wallet.active then
      raise exception 'wallet % is inactive', v_wallet.name;
    end if;
    if new.amount > v_threshold and coalesce(new.invoice_path, '') = '' then
      raise exception 'an invoice photo is required for expenses above % SAR', v_threshold using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.projects where id = new.project_id and active) and (tg_op = 'INSERT' or new.project_id <> old.project_id) then
      raise exception 'project is inactive';
    end if;
  end if;
  return new;
end $$;
create trigger guard_expense before insert or update on public.expenses for each row execute function public.guard_expense();

-- Log every status change into expense_events.
create or replace function public.log_expense_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.expense_events (expense_id, from_status, to_status, actor_id)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.expense_events (expense_id, from_status, to_status, note, actor_id)
    values (new.id, old.status, new.status,
            case when new.status = 'reversed' then new.reversal_reason else new.review_note end,
            auth.uid());
  end if;
  return new;
end $$;
create trigger log_expense_status after insert or update on public.expenses for each row execute function public.log_expense_status();

-- ---------------------------------------------------------------------------
-- Who can approve what
-- ---------------------------------------------------------------------------
create or replace function public.can_approve(p_expense public.expenses)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or (
        public.current_role_name() = 'approver'
        and exists (select 1 from public.projects p where p.id = p_expense.project_id and p.approver_id = auth.uid())
        and p_expense.submitted_by <> auth.uid()      -- nobody approves their own spend
      )
$$;

-- ---------------------------------------------------------------------------
-- Workflow RPCs (the only way status changes from the apps)
-- ---------------------------------------------------------------------------
create or replace function public.review_expense(p_id uuid, p_decision text, p_note text default null)
returns public.expenses
language plpgsql security definer set search_path = public
as $$
declare
  e public.expenses;
begin
  select * into e from public.expenses where id = p_id for update;
  if not found then raise exception 'expense not found'; end if;
  if not public.can_approve(e) then raise exception 'not allowed to review this expense' using errcode = '42501'; end if;
  if e.status <> 'pending' then raise exception 'only pending expenses can be reviewed (this one is %)', e.status; end if;
  if p_decision not in ('approve', 'reject', 'request_changes') then raise exception 'unknown decision %', p_decision; end if;
  if p_decision in ('reject', 'request_changes') and coalesce(trim(p_note), '') = '' then
    raise exception 'a reason is required';
  end if;

  update public.expenses set
    status = case p_decision when 'approve' then 'approved'::public.expense_status
                             when 'reject' then 'rejected'::public.expense_status
                             else 'changes_requested'::public.expense_status end,
    review_note = nullif(trim(p_note), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_id
  returning * into e;
  return e;
end $$;

create or replace function public.reverse_expense(p_id uuid, p_reason text)
returns public.expenses
language plpgsql security definer set search_path = public
as $$
declare e public.expenses;
begin
  if not public.is_admin() then raise exception 'only finance admins can reverse' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  update public.expenses set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = trim(p_reason)
  where id = p_id and status = 'approved'
  returning * into e;
  if not found then raise exception 'only approved expenses can be reversed'; end if;
  return e;
end $$;

create or replace function public.reverse_topup(p_id uuid, p_reason text)
returns public.topups
language plpgsql security definer set search_path = public
as $$
declare t public.topups;
begin
  if not public.is_admin() then raise exception 'only finance admins can reverse' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  update public.topups set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = trim(p_reason)
  where id = p_id and status = 'posted'
  returning * into t;
  if not found then raise exception 'only posted top-ups can be reversed'; end if;
  return t;
end $$;

-- The submitter edits and resubmits after "changes requested".
create or replace function public.resubmit_expense(
  p_id uuid,
  p_amount numeric,
  p_vat_amount numeric,
  p_project_id uuid,
  p_category_id uuid,
  p_expense_date date,
  p_vendor text,
  p_vendor_vat_number text,
  p_invoice_number text,
  p_description text,
  p_invoice_path text
)
returns public.expenses
language plpgsql security definer set search_path = public
as $$
declare e public.expenses;
begin
  select * into e from public.expenses where id = p_id for update;
  if not found or e.submitted_by <> auth.uid() then raise exception 'expense not found'; end if;
  if e.status <> 'changes_requested' then raise exception 'only expenses with changes requested can be resubmitted'; end if;
  update public.expenses set
    amount = p_amount, vat_amount = coalesce(p_vat_amount, 0), project_id = p_project_id, category_id = p_category_id,
    expense_date = p_expense_date, vendor = coalesce(p_vendor, ''), vendor_vat_number = nullif(p_vendor_vat_number, ''),
    invoice_number = nullif(p_invoice_number, ''), description = p_description,
    invoice_path = coalesce(nullif(p_invoice_path, ''), invoice_path),
    status = 'pending', review_note = null, reviewed_by = null, reviewed_at = null
  where id = p_id
  returning * into e;
  return e;
end $$;

-- ---------------------------------------------------------------------------
-- Balances and reporting (security_invoker: callers only see what RLS allows)
-- ---------------------------------------------------------------------------
create view public.wallet_balances with (security_invoker = true) as
select
  w.id as wallet_id,
  w.external_id,
  w.name,
  w.kind,
  w.card_last4,
  w.custodian_id,
  p.full_name as custodian_name,
  w.active,
  coalesce(t.total, 0)::numeric(14,2)                              as topups_total,
  coalesce(e.approved, 0)::numeric(14,2)                           as approved_total,
  coalesce(e.pending, 0)::numeric(14,2)                            as pending_total,
  -- balance if every pending expense were rejected (upper bound)
  (coalesce(t.total, 0) - coalesce(e.approved, 0))::numeric(14,2)  as confirmed_balance,
  -- the balance the app shows, and what the bank statement should match:
  -- a card swipe has already left the bank whether or not it is approved yet
  (coalesce(t.total, 0) - coalesce(e.approved, 0) - coalesce(e.pending, 0))::numeric(14,2) as available_balance
from public.wallets w
left join public.profiles p on p.id = w.custodian_id
left join lateral (
  select sum(amount) as total from public.topups where wallet_id = w.id and status = 'posted'
) t on true
left join lateral (
  select
    sum(amount) filter (where status = 'approved') as approved,
    sum(amount) filter (where status in ('pending', 'changes_requested')) as pending
  from public.expenses where wallet_id = w.id
) e on true;

-- One flat ledger of money in and out, for statements and exports.
create view public.ledger with (security_invoker = true) as
select
  'topup'::text      as entry_type,
  t.id, t.external_id, t.wallet_id, null::uuid as project_id, null::uuid as category_id,
  t.created_by       as person_id,
  t.transfer_date    as entry_date,
  coalesce(t.reference, t.method) as description,
  t.amount           as amount_in,
  0::numeric(14,2)   as amount_out,
  0::numeric(14,2)   as vat_amount,
  t.status::text     as status,
  t.created_at
from public.topups t
union all
select
  'expense', e.id, e.external_id, e.wallet_id, e.project_id, e.category_id,
  e.submitted_by, e.expense_date,
  nullif(concat_ws(' - ', nullif(e.vendor, ''), e.description), ''),
  0, e.amount, e.vat_amount, e.status::text, e.created_at
from public.expenses e;

-- Dashboard totals for a period and optional filters.
create or replace function public.dashboard_summary(
  p_from date default null,
  p_to date default null,
  p_wallet_id uuid default null,
  p_project_id uuid default null,
  p_custodian_id uuid default null
)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with w as (
    select id from public.wallets
    where (p_wallet_id is null or id = p_wallet_id)
      and (p_custodian_id is null or custodian_id = p_custodian_id)
  ),
  t as (
    select coalesce(sum(amount), 0) as total, count(*) as n
    from public.topups
    where status = 'posted' and wallet_id in (select id from w)
      and p_project_id is null
      and (p_from is null or transfer_date >= p_from)
      and (p_to is null or transfer_date <= p_to)
  ),
  e as (
    select
      coalesce(sum(amount) filter (where status = 'approved'), 0) as approved,
      coalesce(sum(amount) filter (where status in ('pending', 'changes_requested')), 0) as pending,
      coalesce(sum(amount) filter (where status = 'rejected'), 0) as rejected,
      coalesce(sum(vat_amount) filter (where status = 'approved'), 0) as approved_vat,
      count(*) filter (where status = 'approved') as approved_n,
      count(*) filter (where status in ('pending', 'changes_requested')) as pending_n
    from public.expenses
    where wallet_id in (select id from w)
      and (p_project_id is null or project_id = p_project_id)
      and (p_from is null or expense_date >= p_from)
      and (p_to is null or expense_date <= p_to)
  )
  select jsonb_build_object(
    'topups_total', t.total, 'topups_count', t.n,
    'approved_total', e.approved, 'approved_count', e.approved_n, 'approved_vat', e.approved_vat,
    'pending_total', e.pending, 'pending_count', e.pending_n,
    'rejected_total', e.rejected,
    'disbursed_total', e.approved + e.pending,
    'net_movement', t.total - e.approved - e.pending
  )
  from t, e
$$;

-- Spend grouped by a dimension, for the dashboard tables.
create or replace function public.spend_breakdown(
  p_group text,                -- 'project' | 'category' | 'wallet' | 'custodian' | 'month'
  p_from date default null,
  p_to date default null,
  p_wallet_id uuid default null,
  p_project_id uuid default null
)
returns table (key text, label text, approved numeric, pending numeric, expense_count bigint)
language sql stable security invoker set search_path = public
as $$
  select
    case p_group
      when 'project' then pr.id::text when 'category' then c.id::text
      when 'wallet' then w.id::text when 'custodian' then pf.id::text
      else to_char(e.expense_date, 'YYYY-MM') end as key,
    case p_group
      when 'project' then pr.code || ' ' || pr.name when 'category' then c.name
      when 'wallet' then w.name when 'custodian' then pf.full_name
      else to_char(e.expense_date, 'YYYY-MM') end as label,
    coalesce(sum(e.amount) filter (where e.status = 'approved'), 0)::numeric(14,2),
    coalesce(sum(e.amount) filter (where e.status in ('pending', 'changes_requested')), 0)::numeric(14,2),
    count(*) filter (where e.status in ('approved', 'pending', 'changes_requested'))
  from public.expenses e
  join public.projects pr on pr.id = e.project_id
  join public.categories c on c.id = e.category_id
  join public.wallets w on w.id = e.wallet_id
  join public.profiles pf on pf.id = e.submitted_by
  where (p_wallet_id is null or e.wallet_id = p_wallet_id)
    and (p_project_id is null or e.project_id = p_project_id)
    and (p_from is null or e.expense_date >= p_from)
    and (p_to is null or e.expense_date <= p_to)
    and e.status in ('approved', 'pending', 'changes_requested')
  group by 1, 2
  order by 3 desc, 2
$$;

-- Record a statement check: snapshots the calculated balance as of the statement date.
create or replace function public.record_statement_check(
  p_wallet_id uuid, p_statement_date date, p_statement_balance numeric, p_notes text default null
)
returns public.statement_checks
language plpgsql security definer set search_path = public
as $$
declare
  v_in numeric; v_out numeric; v_pending numeric; r public.statement_checks;
begin
  if not public.is_admin() then raise exception 'only finance admins can reconcile' using errcode = '42501'; end if;
  select coalesce(sum(amount), 0) into v_in from public.topups
   where wallet_id = p_wallet_id and status = 'posted' and transfer_date <= p_statement_date;
  select coalesce(sum(amount) filter (where status = 'approved'), 0),
         coalesce(sum(amount) filter (where status in ('pending', 'changes_requested')), 0)
    into v_out, v_pending
    from public.expenses where wallet_id = p_wallet_id and expense_date <= p_statement_date;
  insert into public.statement_checks (wallet_id, statement_date, statement_balance, calculated_balance, pending_amount, notes)
  values (p_wallet_id, p_statement_date, p_statement_balance, v_in - v_out - v_pending, v_pending, p_notes)
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.wallets           enable row level security;
alter table public.projects          enable row level security;
alter table public.categories        enable row level security;
alter table public.settings          enable row level security;
alter table public.topups            enable row level security;
alter table public.expenses          enable row level security;
alter table public.expense_events    enable row level security;
alter table public.statement_checks  enable row level security;
alter table public.audit_log         enable row level security;

-- profiles: everyone signed in can read names; you edit your own name/locale; admins manage roles.
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_admin_write on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role_name() and active);

-- master data: read for all signed-in users, write for admins.
create policy wallets_read on public.wallets for select to authenticated
  using (public.is_staff() or custodian_id = auth.uid());
create policy wallets_admin on public.wallets for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy projects_read on public.projects for select to authenticated using (true);
create policy projects_admin on public.projects for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy categories_read on public.categories for select to authenticated using (true);
create policy categories_admin on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_admin on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- top-ups: custodians see their own wallets; admins/approvers see all; admins insert.
create policy topups_read on public.topups for select to authenticated
  using (public.is_staff() or exists (select 1 from public.wallets w where w.id = wallet_id and w.custodian_id = auth.uid()));
create policy topups_admin_insert on public.topups for insert to authenticated
  with check (public.is_admin() and status = 'posted' and created_by = auth.uid());
create policy topups_admin_update on public.topups for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- expenses
create policy expenses_read on public.expenses for select to authenticated
  using (
    public.is_admin()
    or submitted_by = auth.uid()
    or exists (select 1 from public.wallets w where w.id = wallet_id and w.custodian_id = auth.uid())
    or exists (select 1 from public.projects p where p.id = project_id and p.approver_id = auth.uid())
  );
-- A custodian submits against a wallet they hold. Admins can submit on anyone's wallet.
create policy expenses_insert on public.expenses for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and status = 'pending'
    and (public.is_admin() or exists (select 1 from public.wallets w where w.id = wallet_id and w.custodian_id = auth.uid() and w.active))
  );
-- Direct updates: the submitter may fix a pending expense (e.g. attach the invoice) before review.
create policy expenses_owner_update on public.expenses for update to authenticated
  using (submitted_by = auth.uid() and status = 'pending')
  with check (submitted_by = auth.uid() and status = 'pending' and reviewed_by is null);

create policy expense_events_read on public.expense_events for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id));  -- inherits expenses RLS

create policy statement_checks_admin_read on public.statement_checks for select to authenticated using (public.is_staff());

create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_admin());

-- Only expose RPCs to signed-in users.
revoke execute on function public.review_expense(uuid, text, text) from public, anon;
revoke execute on function public.reverse_expense(uuid, text) from public, anon;
revoke execute on function public.reverse_topup(uuid, text) from public, anon;
revoke execute on function public.resubmit_expense(uuid, numeric, numeric, uuid, uuid, date, text, text, text, text, text) from public, anon;
revoke execute on function public.record_statement_check(uuid, date, numeric, text) from public, anon;
grant execute on function public.review_expense(uuid, text, text) to authenticated;
grant execute on function public.reverse_expense(uuid, text) to authenticated;
grant execute on function public.reverse_topup(uuid, text) to authenticated;
grant execute on function public.resubmit_expense(uuid, numeric, numeric, uuid, uuid, date, text, text, text, text, text) to authenticated;
grant execute on function public.record_statement_check(uuid, date, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: invoice photos and top-up proofs (private buckets)
-- Path convention: <auth uid>/<yyyy>/<uuid>.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false) on conflict (id) do nothing;

create policy invoices_upload_own on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);
create policy invoices_read on storage.objects for select to authenticated
  using (
    bucket_id = 'invoices' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_staff()
    )
  );
create policy attachments_admin on storage.objects for all to authenticated
  using (bucket_id = 'attachments' and public.is_admin())
  with check (bucket_id = 'attachments' and public.is_admin());
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_staff());
