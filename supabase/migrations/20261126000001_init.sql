-- Express Cash: petty cash and company card spending record
-- Runs on Supabase Postgres (uses auth.users, auth.uid(), storage).
--
-- What it is
--   A record of what was spent from each company card or cash float, on which
--   project, with the bill photo. There is no approval step: a saved expense counts
--   straight away. Accounts and audit look through the entries, tick them as
--   "checked", and sort out questions outside the app.
--
-- Money rules
--   * Every amount is numeric(14,2) in SAR.
--   * A wallet's balance is CALCULATED: opening balance + posted top-ups minus every
--     expense that isn't reversed, minus cash handed back to the office. It is never
--     read from the bank.
--   * The wallet is split into what is on the card and the cash in hand. Staff log a
--     cash withdrawal (card -> cash) the same day; a deposit moves cash back to the
--     card; a handover returns cash to the office. Cash held longer than the
--     cash_hold_days setting (default 4, oldest cash first) is flagged.
--   * Weekly, accounts upload the card's bank statement. Its lines are matched to card
--     swipes, cash withdrawals, deposits and transfers; anything in the bank but not in
--     the app (or the other way round), and withdrawals entered after the bank date,
--     are flagged.
--   * Day to day nothing is deleted. A wrong entry is reversed by finance, which
--     keeps the row and records who and why. Staff can correct their own entry until
--     accounts has checked it.
--   * Monthly close: every row belongs to a period month. Once a month has been
--     exported (Excel + invoice zip, for Odoo) a finance admin closes it with
--     close_month(): each wallet's net movement goes into wallets.opening_balance,
--     then the month's rows and invoice files are erased. Only the current month and
--     the months inside the retention window (setting, default 5) accept entries.
--
-- Phase 2 (Odoo): every financial row carries a stable external_id plus odoo_*
-- columns for a sync job. Nothing writes them yet.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- admin: finance, everything. accounts: accounts / audit, sees every entry and
-- invoice and marks entries checked. custodian: staff holding a card or cash float.
create type public.user_role as enum ('admin', 'accounts', 'custodian');
create type public.payment_method as enum ('card', 'cash');   -- card swipe, or cash withdrawn from the card
create type public.cash_move_kind as enum ('withdrawal', 'deposit', 'handover');  -- card->cash, cash->card, cash->office
create type public.topup_status as enum ('posted', 'reversed');
create type public.expense_status as enum ('recorded', 'reversed');
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

create or replace function public.sees_everything()
returns boolean  -- admin or accounts: every wallet, entry, invoice and the audit log
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role_name() in ('admin', 'accounts'), false)
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
  id              uuid primary key default gen_random_uuid(),
  external_id     text not null unique default ('KW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  -- One wallet per holder: the company card plus any cash withdrawn from it.
  name            text not null,
  custodian_id    uuid not null references public.profiles (id),
  bank_name       text not null default 'Alinma' check (bank_name in ('Alinma', 'SNB', 'Other')),  -- picks the statement layout
  card_last4      text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  active          boolean not null default true,
  opening_balance numeric(14,2) not null default 0,  -- net of all closed (erased) months, set by close_month()
  opening_cash    numeric(14,2) not null default 0,  -- the cash-in-hand part of opening_balance
  odoo_journal_id integer,             -- Phase 2: Odoo journal this wallet maps to
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index wallets_one_active_per_holder on public.wallets (custodian_id) where active;

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  external_id   text not null unique default ('KP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  name          text not null unique,
  code          text unique,           -- optional short code; Phase 2 maps projects to Odoo
  budget        numeric(14,2) check (budget is null or budget >= 0),
  active        boolean not null default true,
  odoo_analytic_account_id integer,  -- Phase 2
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  -- false for spend that has no bill, e.g. cash paid to outside labour:
  -- the photo is then optional and remarks are required instead
  receipt_required boolean not null default true,
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
  ('invoice_required_above', '100'::jsonb),   -- SAR; bill photo mandatory above this (categories that need a bill)
  ('vat_rate', '0.15'::jsonb),
  ('retention_months', '5'::jsonb),           -- how many months (incl. the current one) accept entries
  ('storage_limit_mb', '1000'::jsonb),        -- file storage on the Supabase plan; dashboard warns at 80%
  ('cash_hold_days', '4'::jsonb),             -- cash in hand older than this is flagged
  ('bank_match_days', '3'::jsonb),            -- card swipes and transfers match bank lines within this many days
  ('bank_match_days_cash', '10'::jsonb),      -- cash withdrawals match within this window (so late entries are still found)
  ('bank_mapping', '{}'::jsonb);              -- the statement columns picked on the first upload

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
  period_month    date not null,      -- first day of the month this belongs to (defaults from transfer_date)
  method          text not null default 'bank_transfer' check (method in ('bank_transfer', 'cash', 'opening_balance', 'custodian_repayment', 'other')),
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
create index on public.topups (period_month);

-- ---------------------------------------------------------------------------
-- Money out: expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id               uuid primary key default gen_random_uuid(),
  external_id      text not null unique default ('KE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  client_id        uuid unique,       -- set by the phone app; makes offline resends idempotent
  wallet_id        uuid not null references public.wallets (id),
  project_id       uuid not null references public.projects (id),
  category_id      uuid not null references public.categories (id),
  paid_by          public.payment_method not null,   -- card swipe or cash; both come out of the wallet
  submitted_by     uuid not null default auth.uid() references public.profiles (id),
  expense_date     date not null default current_date,
  period_month     date not null,     -- first day of the month this belongs to (defaults from expense_date)
  vendor           text not null default '',
  vendor_vat_number text check (vendor_vat_number is null or vendor_vat_number ~ '^[0-9]{15}$'),
  invoice_number   text,
  description      text,              -- "Remarks" in the apps, e.g. "ABB project, paid to labour"
  amount           numeric(14,2) not null check (amount > 0),      -- total paid, VAT inclusive
  vat_amount       numeric(14,2) not null default 0 check (vat_amount >= 0),
  invoice_path     text,              -- storage path in the 'invoices' bucket
  status           public.expense_status not null default 'recorded',
  checked_by       uuid references public.profiles (id),   -- accounts / audit cross-check
  checked_at       timestamptz,
  check_note       text,
  reversed_by      uuid references public.profiles (id),
  reversed_at      timestamptz,
  reversal_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  odoo_sync        public.sync_status not null default 'not_synced',
  odoo_bill_id     integer,
  constraint vat_not_above_amount check (vat_amount <= amount),
  constraint checked_complete check ((checked_at is null) = (checked_by is null)),
  constraint reversal_complete check (
    (status = 'reversed') = (reversed_at is not null and reversed_by is not null and coalesce(reversal_reason, '') <> '')
  )
);
create index on public.expenses (wallet_id, status);
create index on public.expenses (project_id, expense_date);
create index on public.expenses (submitted_by, created_at desc);
create index on public.expenses (period_month, status);

-- ---------------------------------------------------------------------------
-- Cash moves inside a wallet: withdrawal (card -> cash), deposit (cash -> card),
-- handover (cash returned to the office, leaves the wallet)
-- ---------------------------------------------------------------------------
create table public.cash_moves (
  id              uuid primary key default gen_random_uuid(),
  external_id     text not null unique default ('KC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  client_id       uuid unique,
  wallet_id       uuid not null references public.wallets (id),
  kind            public.cash_move_kind not null,
  amount          numeric(14,2) not null check (amount > 0),
  move_date       date not null default current_date,
  period_month    date not null,
  notes           text,
  status          public.topup_status not null default 'posted',
  created_by      uuid not null default auth.uid() references public.profiles (id),
  created_at      timestamptz not null default now(),
  checked_by      uuid references public.profiles (id),
  checked_at      timestamptz,
  check_note      text,
  reversed_by     uuid references public.profiles (id),
  reversed_at     timestamptz,
  reversal_reason text,
  odoo_sync       public.sync_status not null default 'not_synced',
  odoo_move_id    integer,
  constraint checked_complete check ((checked_at is null) = (checked_by is null)),
  constraint reversal_complete check (
    (status = 'reversed') = (reversed_at is not null and reversed_by is not null and coalesce(reversal_reason, '') <> '')
  )
);
create index on public.cash_moves (wallet_id, move_date);
create index on public.cash_moves (period_month);

-- ---------------------------------------------------------------------------
-- Bank statement uploads, matched line by line against the app's entries
-- ---------------------------------------------------------------------------
create table public.bank_imports (
  id          uuid primary key default gen_random_uuid(),
  wallet_id   uuid not null references public.wallets (id),
  file_name   text not null,
  date_from   date,
  date_to     date,
  line_count  integer not null,
  new_lines   integer not null,
  created_by  uuid not null default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now()
);

create table public.bank_lines (
  id            uuid primary key default gen_random_uuid(),
  wallet_id     uuid not null references public.wallets (id),
  import_id     uuid not null references public.bank_imports (id),
  txn_date      date not null,
  amount        numeric(14,2) not null check (amount <> 0),   -- negative: out of the card; positive: into it
  description   text not null default '',
  line_hash     text not null,                                -- the same line uploaded twice is stored once
  kind          text not null check (kind in ('swipe', 'withdrawal', 'transfer_out', 'fee', 'deposit', 'transfer_in')),
  matched_type  text check (matched_type in ('expense', 'cash_move', 'topup')),
  matched_id    uuid,
  days_late     integer,       -- matched cash withdrawal: days between the bank date and the day it was entered
  resolved_by   uuid references public.profiles (id),
  resolved_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  unique (wallet_id, line_hash),
  constraint match_complete check ((matched_type is null) = (matched_id is null))
);
create unique index bank_lines_one_match on public.bank_lines (matched_type, matched_id) where matched_id is not null;
create index on public.bank_lines (wallet_id, txn_date);

-- ---------------------------------------------------------------------------
-- Manual reconciliation against the bank statement
-- ---------------------------------------------------------------------------
create table public.statement_checks (
  id                  uuid primary key default gen_random_uuid(),
  wallet_id           uuid not null references public.wallets (id),
  statement_date      date not null,
  statement_balance   numeric(14,2) not null,
  calculated_balance  numeric(14,2) not null,   -- snapshot at the time of the check
  difference          numeric(14,2) generated always as (statement_balance - calculated_balance) stored,
  notes               text,
  created_by          uuid not null default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now()
);
create index on public.statement_checks (wallet_id, statement_date desc);

-- ---------------------------------------------------------------------------
-- Monthly close: exports taken, and months already erased
-- ---------------------------------------------------------------------------
create table public.month_exports (
  id            bigint generated always as identity primary key,
  month         date not null check (month = date_trunc('month', month)::date),
  fingerprint   text not null,          -- month_fingerprint() when the export was taken
  expense_count integer not null,
  file_count    integer not null,
  exported_by   uuid not null default auth.uid() references public.profiles (id),
  exported_at   timestamptz not null default now()
);
create index on public.month_exports (month, exported_at desc);

create table public.closed_months (
  month          date primary key check (month = date_trunc('month', month)::date),
  expense_count  integer not null,
  expense_total  numeric(14,2) not null,
  topup_count    integer not null,
  topup_total    numeric(14,2) not null,
  carried        jsonb not null,       -- [{wallet_id, name, net}] added to each wallet's opening balance
  files_pending  text[] not null default '{}',  -- 'bucket/path' still to remove from storage
  closed_by      uuid not null references public.profiles (id),
  closed_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit log: every insert/update/delete on financial and master tables
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
  -- rows erased by close_month() are not logged one by one; the closed_months row is the record
  if tg_op = 'DELETE' and current_setting('xc.closing', true) = 'on' then return old; end if;
  insert into public.audit_log (table_name, record_id, action, actor_id, old_data, new_data)
  values (
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
             (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'month', '?'),
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
  foreach t in array array['profiles', 'wallets', 'projects', 'categories', 'settings', 'topups', 'expenses', 'cash_moves', 'bank_imports', 'statement_checks', 'closed_months']
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
-- The only way to delete is close_month(), which sets xc.closing for its own transaction.
create or replace function public.forbid_delete()
returns trigger language plpgsql as $$
begin
  if current_setting('xc.closing', true) = 'on' then return old; end if;
  raise exception '% rows cannot be deleted; reverse them instead (whole months are erased with Close month)', tg_table_name using errcode = 'P0001';
end $$;

create trigger no_delete_topups   before delete on public.topups   for each row execute function public.forbid_delete();
create trigger no_delete_expenses before delete on public.expenses for each row execute function public.forbid_delete();
create trigger no_delete_checks   before delete on public.statement_checks for each row execute function public.forbid_delete();
create trigger no_delete_closed   before delete on public.closed_months for each row execute function public.forbid_delete();
create trigger no_delete_audit    before delete on public.audit_log for each row execute function public.forbid_delete();
create trigger no_delete_cash     before delete on public.cash_moves for each row execute function public.forbid_delete();
create trigger no_delete_bank     before delete on public.bank_lines for each row execute function public.forbid_delete();
create trigger no_delete_imports  before delete on public.bank_imports for each row execute function public.forbid_delete();

-- KSA calendar day (the database clock is UTC)
create or replace function public.local_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;
create or replace function public.local_date(p_at timestamptz)
returns date language sql stable as $$ select (p_at at time zone 'Asia/Riyadh')::date $$;

-- Period month: defaults from the entry date, and must be an open month:
-- not closed, not in the future, and inside the retention window.
create or replace function public.open_month_from()
returns date language sql stable security definer set search_path = public as $$
  select (date_trunc('month', current_date) - make_interval(months => greatest(public.setting_numeric('retention_months', 5)::int, 1) - 1))::date
$$;

create or replace function public.set_period_month()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_date date := case tg_table_name when 'topups' then to_jsonb(new) ->> 'transfer_date'
                                    when 'cash_moves' then to_jsonb(new) ->> 'move_date'
                                    else to_jsonb(new) ->> 'expense_date' end;
begin
  new.period_month := date_trunc('month', coalesce(new.period_month, v_date, current_date))::date;
  if tg_op = 'INSERT' or new.period_month is distinct from old.period_month then
    if exists (select 1 from public.closed_months where month = new.period_month) then
      raise exception 'month % is closed', to_char(new.period_month, 'YYYY-MM') using errcode = 'P0001';
    end if;
    if new.period_month > date_trunc('month', current_date)::date then
      raise exception 'month % is in the future', to_char(new.period_month, 'YYYY-MM') using errcode = 'P0001';
    end if;
    if new.period_month < public.open_month_from() then
      raise exception 'month % is outside the open months (from %)', to_char(new.period_month, 'YYYY-MM'), to_char(public.open_month_from(), 'YYYY-MM') using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
-- named "a_..." so it runs before the other BEFORE triggers (Postgres fires them by name)
create trigger a_period_topups before insert or update on public.topups for each row execute function public.set_period_month();
create trigger a_period_expenses before insert or update on public.expenses for each row execute function public.set_period_month();
create trigger a_period_cash before insert or update on public.cash_moves for each row execute function public.set_period_month();

-- Cash moves: what was moved and when is fixed once saved (reverse and re-enter
-- instead); only the check mark, reversal and month can change.
create or replace function public.guard_cash_move()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'posted' or new.checked_by is not null then
      raise exception 'new cash entries start as posted and unchecked';
    end if;
    if not exists (select 1 from public.wallets where id = new.wallet_id and active) then
      raise exception 'this wallet is inactive';
    end if;
    if new.move_date > public.local_today() then
      raise exception 'the date cannot be in the future';
    end if;
    return new;
  end if;
  if old.status = 'reversed' and (to_jsonb(new) - 'odoo_sync' - 'odoo_move_id' - 'period_month')
                              <> (to_jsonb(old) - 'odoo_sync' - 'odoo_move_id' - 'period_month') then
    raise exception 'reversed cash entries are read only';
  end if;
  if (new.wallet_id, new.kind, new.amount, new.move_date, new.created_by, new.created_at, new.client_id)
     is distinct from (old.wallet_id, old.kind, old.amount, old.move_date, old.created_by, old.created_at, old.client_id) then
    raise exception 'cash entries cannot be edited; ask finance to reverse it and enter it again';
  end if;
  return new;
end $$;
create trigger guard_cash before insert or update on public.cash_moves for each row execute function public.guard_cash_move();

create or replace function public.guard_topup_update()
returns trigger language plpgsql as $$
begin
  if old.status = 'reversed'
     and (to_jsonb(new) - 'odoo_sync' - 'odoo_move_id' - 'period_month') <> (to_jsonb(old) - 'odoo_sync' - 'odoo_move_id' - 'period_month') then
    raise exception 'reversed top-ups are read only';
  end if;
  if (new.wallet_id, new.amount, new.transfer_date, new.method, new.created_by, new.created_at)
     is distinct from (old.wallet_id, old.amount, old.transfer_date, old.method, old.created_by, old.created_at) then
    raise exception 'posted top-ups cannot be edited; reverse and re-enter';
  end if;
  return new;
end $$;
create trigger guard_topup before update on public.topups for each row execute function public.guard_topup_update();

-- Expenses: the content may change until accounts has checked it (finance can
-- always correct it). Reversed rows are read only.
create or replace function public.guard_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_threshold numeric := public.setting_numeric('invoice_required_above', 100);
  v_category public.categories;
  -- everything except bookkeeping columns
  v_content_new jsonb := to_jsonb(new) - 'status' - 'checked_by' - 'checked_at' - 'check_note' - 'reversed_by' - 'reversed_at'
                         - 'reversal_reason' - 'odoo_sync' - 'odoo_bill_id' - 'updated_at' - 'period_month';
  v_content_old jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'recorded' or new.checked_by is not null then
      raise exception 'new expenses start as recorded and unchecked';
    end if;
    if not exists (select 1 from public.wallets where id = new.wallet_id and active) then
      raise exception 'this card or cash float is inactive';
    end if;
    if not exists (select 1 from public.projects where id = new.project_id and active) then
      raise exception 'project is inactive';
    end if;
  else
    v_content_old := to_jsonb(old) - 'status' - 'checked_by' - 'checked_at' - 'check_note' - 'reversed_by' - 'reversed_at'
                     - 'reversal_reason' - 'odoo_sync' - 'odoo_bill_id' - 'updated_at' - 'period_month';
    if old.status = 'reversed' and (to_jsonb(new) - 'odoo_sync' - 'odoo_bill_id' - 'updated_at' - 'period_month')
                                <> (to_jsonb(old) - 'odoo_sync' - 'odoo_bill_id' - 'updated_at' - 'period_month') then
      raise exception 'expense % is reversed, it is read only', old.external_id;
    end if;
    if new.submitted_by <> old.submitted_by or new.created_at <> old.created_at or new.client_id is distinct from old.client_id then
      raise exception 'submitter and created time are fixed';
    end if;
    if v_content_new = v_content_old then
      return new;   -- bookkeeping only (check mark, reversal, month, Odoo flags)
    end if;
    if old.checked_by is not null and not public.is_admin() then
      raise exception 'this expense has been checked by accounts; ask finance to correct it';
    end if;
    if new.wallet_id <> old.wallet_id and not exists (select 1 from public.wallets where id = new.wallet_id and active) then
      raise exception 'this card or cash float is inactive';
    end if;
  end if;

  select * into v_category from public.categories where id = new.category_id;
  if v_category.receipt_required and new.amount > v_threshold and coalesce(new.invoice_path, '') = '' then
    raise exception 'a bill photo is required for expenses above % SAR', v_threshold using errcode = 'P0001';
  end if;
  if not v_category.receipt_required and coalesce(trim(new.description), '') = '' then
    raise exception 'remarks are required for % (no bill), e.g. which project and who was paid', v_category.name using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_expense before insert or update on public.expenses for each row execute function public.guard_expense();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Accounts / audit tick an entry as checked (or untick it).
create or replace function public.set_checked(p_id uuid, p_checked boolean, p_note text default null)
returns public.expenses
language plpgsql security definer set search_path = public
as $$
declare e public.expenses;
begin
  if not public.sees_everything() then raise exception 'only accounts and finance can check entries' using errcode = '42501'; end if;
  update public.expenses set
    checked_by = case when p_checked then auth.uid() end,
    checked_at = case when p_checked then now() end,
    check_note = nullif(trim(p_note), '')
  where id = p_id
  returning * into e;
  if not found then raise exception 'expense not found'; end if;
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
  where id = p_id and status = 'recorded'
  returning * into e;
  if not found then raise exception 'expense not found or already reversed'; end if;
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

create or replace function public.set_cash_checked(p_id uuid, p_checked boolean, p_note text default null)
returns public.cash_moves
language plpgsql security definer set search_path = public
as $$
declare c public.cash_moves;
begin
  if not public.sees_everything() then raise exception 'only accounts and finance can check entries' using errcode = '42501'; end if;
  update public.cash_moves set
    checked_by = case when p_checked then auth.uid() end,
    checked_at = case when p_checked then now() end,
    check_note = nullif(trim(p_note), '')
  where id = p_id
  returning * into c;
  if not found then raise exception 'cash entry not found'; end if;
  return c;
end $$;

create or replace function public.reverse_cash_move(p_id uuid, p_reason text)
returns public.cash_moves
language plpgsql security definer set search_path = public
as $$
declare c public.cash_moves;
begin
  if not public.is_admin() then raise exception 'only finance admins can reverse' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  update public.cash_moves set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = trim(p_reason)
  where id = p_id and status = 'posted'
  returning * into c;
  if not found then raise exception 'cash entry not found or already reversed'; end if;
  -- a reversed entry no longer counts as matched to the bank
  update public.bank_lines set matched_type = null, matched_id = null, days_late = null where matched_type = 'cash_move' and matched_id = p_id;
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- Balances and reporting (security_invoker: callers only see what RLS allows)
-- ---------------------------------------------------------------------------
create view public.wallet_balances with (security_invoker = true) as
select
  w.id as wallet_id,
  w.external_id,
  w.name,
  w.card_last4,
  w.custodian_id,
  p.full_name as custodian_name,
  w.active,
  w.opening_balance,
  w.opening_cash,
  coalesce(t.total, 0)::numeric(14,2)  as topups_total,
  coalesce(e.spent, 0)::numeric(14,2)  as spent_total,
  coalesce(e.spent_card, 0)::numeric(14,2) as spent_card,
  coalesce(e.spent_cash, 0)::numeric(14,2) as spent_cash,
  coalesce(e.unchecked, 0)::integer    as unchecked_count,
  coalesce(c.withdrawn, 0)::numeric(14,2)   as withdrawn,
  coalesce(c.deposited, 0)::numeric(14,2)   as deposited,
  coalesce(c.handed_over, 0)::numeric(14,2) as handed_over,
  -- card + cash in hand
  (w.opening_balance + coalesce(t.total, 0) - coalesce(e.spent, 0) - coalesce(c.handed_over, 0))::numeric(14,2) as available_balance,
  -- what should be on the card (compare with the bank statement)
  (w.opening_balance - w.opening_cash + coalesce(t.total, 0) - coalesce(e.spent_card, 0)
     - coalesce(c.withdrawn, 0) + coalesce(c.deposited, 0))::numeric(14,2) as card_balance,
  -- what the holder should have in cash
  (w.opening_cash + coalesce(c.withdrawn, 0) - coalesce(c.deposited, 0) - coalesce(c.handed_over, 0)
     - coalesce(e.spent_cash, 0))::numeric(14,2) as cash_in_hand
from public.wallets w
left join public.profiles p on p.id = w.custodian_id
left join lateral (
  select sum(amount) as total from public.topups where wallet_id = w.id and status = 'posted'
) t on true
left join lateral (
  select sum(amount) filter (where status = 'recorded') as spent,
         sum(amount) filter (where status = 'recorded' and paid_by = 'card') as spent_card,
         sum(amount) filter (where status = 'recorded' and paid_by = 'cash') as spent_cash,
         count(*) filter (where status = 'recorded' and checked_by is null) as unchecked
  from public.expenses where wallet_id = w.id
) e on true
left join lateral (
  select sum(amount) filter (where kind = 'withdrawal') as withdrawn,
         sum(amount) filter (where kind = 'deposit') as deposited,
         sum(amount) filter (where kind = 'handover') as handed_over
  from public.cash_moves where wallet_id = w.id and status = 'posted'
) c on true;

-- One flat ledger of money in and out, for statements and exports.
create view public.ledger with (security_invoker = true) as
select
  'topup'::text      as entry_type,
  t.id, t.external_id, t.wallet_id, null::uuid as project_id, null::uuid as category_id,
  t.created_by       as person_id,
  t.transfer_date    as entry_date,
  t.period_month,
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
  e.submitted_by, e.expense_date, e.period_month,
  nullif(concat_ws(' - ', e.paid_by::text, nullif(e.vendor, ''), e.description), ''),
  0, e.amount, e.vat_amount, e.status::text, e.created_at
from public.expenses e
union all
select
  'cash_' || c.kind::text, c.id, c.external_id, c.wallet_id, null, null,
  c.created_by, c.move_date, c.period_month, c.notes,
  0, case when c.kind = 'handover' then c.amount else 0 end, 0, c.status::text, c.created_at
from public.cash_moves c;

-- Dashboard totals for a period month (or date range) and optional filters.
create or replace function public.dashboard_summary(
  p_from date default null,
  p_to date default null,
  p_wallet_id uuid default null,
  p_project_id uuid default null,
  p_custodian_id uuid default null,
  p_month date default null
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
      and (p_month is null or period_month = p_month)
      and (p_from is null or transfer_date >= p_from)
      and (p_to is null or transfer_date <= p_to)
  ),
  e as (
    select
      coalesce(sum(amount), 0) as spent,
      coalesce(sum(amount) filter (where paid_by = 'card'), 0) as spent_card,
      coalesce(sum(amount) filter (where paid_by = 'cash'), 0) as spent_cash,
      coalesce(sum(vat_amount), 0) as vat,
      count(*) as n,
      count(*) filter (where checked_by is null) as unchecked_n,
      coalesce(sum(amount) filter (where checked_by is null), 0) as unchecked
    from public.expenses
    where status = 'recorded' and wallet_id in (select id from w)
      and (p_project_id is null or project_id = p_project_id)
      and (p_month is null or period_month = p_month)
      and (p_from is null or expense_date >= p_from)
      and (p_to is null or expense_date <= p_to)
  )
  select jsonb_build_object(
    'topups_total', t.total, 'topups_count', t.n,
    'spent_total', e.spent, 'spent_count', e.n, 'spent_vat', e.vat,
    'spent_card', e.spent_card, 'spent_cash', e.spent_cash,
    'unchecked_total', e.unchecked, 'unchecked_count', e.unchecked_n,
    'net_movement', t.total - e.spent
  )
  from t, e
$$;

-- One row per wallet for the dashboard, so the figures always add up on screen:
--   opening + transferred - spent - returned = balance   (returned = cash handed back to the office)
-- With a month: opening is the balance at the start of that month, balance and cash at its end.
-- With no month: opening is what was brought forward from closed months; balance and cash are now.
create or replace function public.wallet_month_summary(p_month date default null)
returns table (
  wallet_id uuid, name text, card_last4 text, custodian_name text, active boolean,
  opening numeric, transferred numeric, spent numeric, vat numeric, returned numeric, balance numeric, cash_in_hand numeric
)
language sql stable security invoker set search_path = public
as $$
  select
    w.id, w.name, w.card_last4, p.full_name, w.active,
    (w.opening_balance + coalesce(t.before, 0) - coalesce(e.before, 0) - coalesce(c.ho_before, 0))::numeric(14,2),
    coalesce(t.inside, 0)::numeric(14,2),
    coalesce(e.inside, 0)::numeric(14,2),
    coalesce(e.vat, 0)::numeric(14,2),
    coalesce(c.ho_inside, 0)::numeric(14,2),
    (w.opening_balance + coalesce(t.before, 0) - coalesce(e.before, 0) - coalesce(c.ho_before, 0)
       + coalesce(t.inside, 0) - coalesce(e.inside, 0) - coalesce(c.ho_inside, 0))::numeric(14,2),
    (w.opening_cash + coalesce(c.cash_to_end, 0) - coalesce(e.cash_to_end, 0))::numeric(14,2)
  from public.wallets w
  left join public.profiles p on p.id = w.custodian_id
  left join lateral (
    select sum(amount) filter (where p_month is not null and period_month < p_month) as before,
           sum(amount) filter (where p_month is null or period_month = p_month) as inside
    from public.topups where wallet_id = w.id and status = 'posted'
  ) t on true
  left join lateral (
    select sum(amount) filter (where p_month is not null and period_month < p_month) as before,
           sum(amount) filter (where p_month is null or period_month = p_month) as inside,
           sum(vat_amount) filter (where p_month is null or period_month = p_month) as vat,
           sum(amount) filter (where paid_by = 'cash' and (p_month is null or period_month <= p_month)) as cash_to_end
    from public.expenses where wallet_id = w.id and status = 'recorded'
  ) e on true
  left join lateral (
    select sum(amount) filter (where kind = 'handover' and p_month is not null and period_month < p_month) as ho_before,
           sum(amount) filter (where kind = 'handover' and (p_month is null or period_month = p_month)) as ho_inside,
           sum(case kind when 'withdrawal' then amount else -amount end) filter (where p_month is null or period_month <= p_month) as cash_to_end
    from public.cash_moves where wallet_id = w.id and status = 'posted'
  ) c on true
  order by w.active desc, w.name
$$;

-- Cash in hand, oldest first: each withdrawal (and the cash brought forward) is used up
-- by cash spending, deposits and handovers in order. Whatever is left of a withdrawal
-- older than cash_hold_days is "held too long".
create or replace function public.cash_held()
returns table (wallet_id uuid, cash_in_hand numeric, held_too_long numeric, oldest_days integer)
language sql stable security invoker set search_path = public
as $$
  with ins as (
    select w.id as wallet_id, public.open_month_from() as d, w.opening_cash as amount, 0 as seq
      from public.wallets w where w.opening_cash > 0
    union all
    select c.wallet_id, c.move_date, c.amount, 1
      from public.cash_moves c where c.kind = 'withdrawal' and c.status = 'posted'
  ),
  outs as (
    select wallet_id, sum(amount) as total from (
      select wallet_id, amount from public.expenses where paid_by = 'cash' and status = 'recorded'
      union all
      select wallet_id, amount from public.cash_moves where kind in ('deposit', 'handover') and status = 'posted'
    ) x group by wallet_id
  ),
  layered as (
    select i.*, sum(i.amount) over (partition by i.wallet_id order by i.d, i.seq rows unbounded preceding) as cum_end
    from ins i
  ),
  left_over as (
    select l.wallet_id, l.d,
           greatest(0, least(l.amount, l.cum_end - coalesce(o.total, 0))) as remaining
    from layered l left join outs o on o.wallet_id = l.wallet_id
  )
  select b.wallet_id, b.cash_in_hand,
         coalesce((select sum(remaining) from left_over x where x.wallet_id = b.wallet_id and x.remaining > 0
                     and public.local_today() - x.d > public.setting_numeric('cash_hold_days', 4)), 0)::numeric(14,2),
         (select max(public.local_today() - x.d) from left_over x where x.wallet_id = b.wallet_id and x.remaining > 0)::integer
  from public.wallet_balances b
$$;

-- Spend grouped by a dimension, for the dashboard tables.
create or replace function public.spend_breakdown(
  p_group text,                -- 'project' | 'category' | 'wallet' | 'custodian' | 'month'
  p_from date default null,
  p_to date default null,
  p_wallet_id uuid default null,
  p_project_id uuid default null,
  p_month date default null
)
returns table (key text, label text, spent numeric, expense_count bigint)
language sql stable security invoker set search_path = public
as $$
  select
    case p_group
      when 'project' then pr.id::text when 'category' then c.id::text
      when 'wallet' then w.id::text when 'custodian' then pf.id::text
      else to_char(e.period_month, 'YYYY-MM') end as key,
    case p_group
      when 'project' then pr.name when 'category' then c.name
      when 'wallet' then w.name when 'custodian' then pf.full_name
      else to_char(e.period_month, 'YYYY-MM') end as label,
    sum(e.amount)::numeric(14,2),
    count(*)
  from public.expenses e
  join public.projects pr on pr.id = e.project_id
  join public.categories c on c.id = e.category_id
  join public.wallets w on w.id = e.wallet_id
  join public.profiles pf on pf.id = e.submitted_by
  where e.status = 'recorded'
    and (p_wallet_id is null or e.wallet_id = p_wallet_id)
    and (p_project_id is null or e.project_id = p_project_id)
    and (p_month is null or e.period_month = p_month)
    and (p_from is null or e.expense_date >= p_from)
    and (p_to is null or e.expense_date <= p_to)
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
  v_balance numeric; r public.statement_checks;
begin
  if not public.is_admin() then raise exception 'only finance admins can reconcile' using errcode = '42501'; end if;
  -- the bank statement shows the card, so compare with the card part of the wallet
  select w.opening_balance - w.opening_cash
       + coalesce((select sum(amount) from public.topups where wallet_id = w.id and status = 'posted' and transfer_date <= p_statement_date), 0)
       - coalesce((select sum(amount) from public.expenses where wallet_id = w.id and status = 'recorded' and paid_by = 'card' and expense_date <= p_statement_date), 0)
       - coalesce((select sum(case kind when 'withdrawal' then amount when 'deposit' then -amount else 0 end)
                     from public.cash_moves where wallet_id = w.id and status = 'posted' and move_date <= p_statement_date), 0)
    into v_balance
    from public.wallets w where w.id = p_wallet_id;
  if v_balance is null then raise exception 'wallet not found'; end if;
  insert into public.statement_checks (wallet_id, statement_date, statement_balance, calculated_balance, notes)
  values (p_wallet_id, p_statement_date, p_statement_balance, v_balance, p_notes)
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Bank statement matching
-- ---------------------------------------------------------------------------
-- What a statement line is, from its description (Alinma and SNB wording, English and Arabic).
create or replace function public.bank_line_kind(p_amount numeric, p_description text)
returns text language sql immutable as $$
  select case
    -- bank charges: SNB writes them as their own lines ("Transfer Fees", "VAT Charge");
    -- a transfer that merely mentions fees in its text is still a transfer
    when p_description ~* '^\s*(vat charge|transfer fees?|fees?|commission|charges?|رسوم|عمولة|ضريبة)' or p_description ~* '\m(vat charge|transfer fees?)\M' then 'fee'
    when p_amount < 0 and p_description ~* '(atm|cash withdrawal|سحب نقدي|صراف)' then 'withdrawal'
    when p_amount < 0 and p_description ~* '(transfer|حوالة|تحويل)' and p_description !~* '(\mpos\M|mada|مدى|نقاط البيع)' then 'transfer_out'
    when p_amount < 0 then 'swipe'
    when p_description ~* '(cash deposit|ايداع نقدي|إيداع نقدي)' then 'deposit'
    else 'transfer_in'
  end
$$;

-- Pair unmatched statement lines with the app's entries: same wallet, same amount,
-- nearest date inside the window. Cash withdrawals use a wider window, and the days
-- between the bank date and the day the withdrawal was entered are kept as days_late.
create or replace function public.match_bank(p_wallet_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  l record; v_id uuid; v_n integer := 0;
  v_days integer := public.setting_numeric('bank_match_days', 3)::int;
  v_cash_days integer := public.setting_numeric('bank_match_days_cash', 10)::int;
begin
  if not public.sees_everything() then raise exception 'only accounts and finance' using errcode = '42501'; end if;
  for l in select * from public.bank_lines where wallet_id = p_wallet_id and matched_id is null and kind <> 'fee' order by txn_date, id loop
    v_id := null;
    if l.kind = 'withdrawal' then
      select c.id into v_id from public.cash_moves c
       where c.wallet_id = l.wallet_id and c.kind = 'withdrawal' and c.status = 'posted' and c.amount = -l.amount
         and abs(c.move_date - l.txn_date) <= v_cash_days
         and not exists (select 1 from public.bank_lines b where b.matched_type = 'cash_move' and b.matched_id = c.id)
       order by abs(c.move_date - l.txn_date), c.created_at limit 1;
      if v_id is not null then
        update public.bank_lines set matched_type = 'cash_move', matched_id = v_id,
          days_late = greatest(0, (select public.local_date(created_at) from public.cash_moves where id = v_id) - l.txn_date)
        where id = l.id;
      end if;
    elsif l.kind = 'deposit' then
      select c.id into v_id from public.cash_moves c
       where c.wallet_id = l.wallet_id and c.kind = 'deposit' and c.status = 'posted' and c.amount = l.amount
         and abs(c.move_date - l.txn_date) <= v_cash_days
         and not exists (select 1 from public.bank_lines b where b.matched_type = 'cash_move' and b.matched_id = c.id)
       order by abs(c.move_date - l.txn_date), c.created_at limit 1;
      if v_id is not null then
        update public.bank_lines set matched_type = 'cash_move', matched_id = v_id where id = l.id;
      end if;
    elsif l.kind = 'transfer_in' then
      select t.id into v_id from public.topups t
       where t.wallet_id = l.wallet_id and t.status = 'posted' and t.amount = l.amount
         and abs(t.transfer_date - l.txn_date) <= v_days
         and not exists (select 1 from public.bank_lines b where b.matched_type = 'topup' and b.matched_id = t.id)
       order by abs(t.transfer_date - l.txn_date), t.created_at limit 1;
      if v_id is not null then
        update public.bank_lines set matched_type = 'topup', matched_id = v_id where id = l.id;
      end if;
    else  -- swipe or outgoing transfer: a card expense
      select e.id into v_id from public.expenses e
       where e.wallet_id = l.wallet_id and e.paid_by = 'card' and e.status = 'recorded' and e.amount = -l.amount
         and abs(e.expense_date - l.txn_date) <= v_days
         and not exists (select 1 from public.bank_lines b where b.matched_type = 'expense' and b.matched_id = e.id)
       order by abs(e.expense_date - l.txn_date), e.created_at limit 1;
      if v_id is not null then
        update public.bank_lines set matched_type = 'expense', matched_id = v_id where id = l.id;
      end if;
    end if;
    if v_id is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- Upload a statement: p_lines is [{date: 'YYYY-MM-DD', amount: -12.50, description: '...'}]
-- as read from the Excel file by the web app. Lines already uploaded are skipped.
create or replace function public.import_bank_lines(p_wallet_id uuid, p_file_name text, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_import uuid; v_new integer; v_matched integer; v_total integer := jsonb_array_length(coalesce(p_lines, '[]'));
begin
  if not public.sees_everything() then raise exception 'only accounts and finance can upload statements' using errcode = '42501'; end if;
  if not exists (select 1 from public.wallets where id = p_wallet_id) then raise exception 'wallet not found'; end if;
  if v_total = 0 then raise exception 'the file has no transactions'; end if;
  insert into public.bank_imports (wallet_id, file_name, date_from, date_to, line_count, new_lines)
  select p_wallet_id, coalesce(nullif(trim(p_file_name), ''), 'statement'), min((x ->> 'date')::date), max((x ->> 'date')::date), v_total, 0
    from jsonb_array_elements(p_lines) x
  returning id into v_import;

  with src as (
    select (x ->> 'date')::date as d, round((x ->> 'amount')::numeric, 2) as amount, coalesce(trim(x ->> 'description'), '') as descr
      from jsonb_array_elements(p_lines) x
     where coalesce((x ->> 'amount')::numeric, 0) <> 0
  ),
  numbered as (  -- two identical lines on the same day are two transactions
    select *, row_number() over (partition by d, amount, descr) as n from src
  ),
  ins as (
    insert into public.bank_lines (wallet_id, import_id, txn_date, amount, description, line_hash, kind)
    select p_wallet_id, v_import, d, amount, descr, md5(concat_ws('|', d, amount, descr, n)), public.bank_line_kind(amount, descr)
      from numbered
    on conflict (wallet_id, line_hash) do nothing
    returning 1
  )
  select count(*) into v_new from ins;
  update public.bank_imports set new_lines = v_new where id = v_import;
  v_matched := public.match_bank(p_wallet_id);
  return jsonb_build_object('import_id', v_import, 'lines', v_total, 'new_lines', v_new, 'matched', v_matched);
end $$;

-- Accounts mark a statement line as dealt with (e.g. "personal, staff repaid"), with a note.
create or replace function public.resolve_bank_line(p_id uuid, p_resolved boolean, p_note text default null)
returns public.bank_lines
language plpgsql security definer set search_path = public
as $$
declare r public.bank_lines;
begin
  if not public.sees_everything() then raise exception 'only accounts and finance' using errcode = '42501'; end if;
  update public.bank_lines set
    resolved_by = case when p_resolved then auth.uid() end,
    resolved_at = case when p_resolved then now() end,
    note = nullif(trim(p_note), '')
  where id = p_id returning * into r;
  if not found then raise exception 'statement line not found'; end if;
  return r;
end $$;

-- The statement check for one wallet, section by section:
--   matched, late (withdrawal entered after the bank date), bank_only (in the bank, not in
--   the app), app_only (in the app inside the statement's dates, not in the bank), fee.
create or replace function public.bank_report(p_wallet_id uuid)
returns table (section text, entry_date date, amount numeric, description text, line_id uuid,
               ref_type text, ref_id uuid, entered_on date, days_late integer, resolved boolean, note text)
language sql stable security definer set search_path = public
as $$
  with cover as (
    select min(date_from) as d_from, max(date_to) as d_to from public.bank_imports where wallet_id = p_wallet_id
  ),
  lines as (
    select b.*,
      case b.matched_type
        when 'expense' then (select public.local_date(created_at) from public.expenses where id = b.matched_id)
        when 'cash_move' then (select public.local_date(created_at) from public.cash_moves where id = b.matched_id)
        when 'topup' then (select public.local_date(created_at) from public.topups where id = b.matched_id)
      end as entered_on
    from public.bank_lines b where b.wallet_id = p_wallet_id
  )
  select case when kind = 'fee' then 'fee'
              when matched_id is null then 'bank_only'
              when coalesce(days_late, 0) > 0 then 'late'
              else 'matched' end,
         txn_date, amount, description, id, matched_type, matched_id, entered_on, days_late, resolved_at is not null, note
    from lines
   where public.sees_everything()
  union all
  select 'app_only', a.d, a.amount, a.descr, null, a.t, a.id, public.local_date(a.created_at), null, false, null
    from (
      select 'expense' as t, e.id, e.expense_date as d, -e.amount as amount, concat_ws(' · ', nullif(e.vendor, ''), e.description) as descr, e.created_at
        from public.expenses e where e.wallet_id = p_wallet_id and e.paid_by = 'card' and e.status = 'recorded'
      union all
      select 'cash_move', c.id, c.move_date, case c.kind when 'withdrawal' then -c.amount else c.amount end,
             case c.kind when 'withdrawal' then 'Cash withdrawal' else 'Cash deposited to card' end, c.created_at
        from public.cash_moves c where c.wallet_id = p_wallet_id and c.kind in ('withdrawal', 'deposit') and c.status = 'posted'
      union all
      select 'topup', t.id, t.transfer_date, t.amount, coalesce(t.reference, 'Transfer in'), t.created_at
        from public.topups t where t.wallet_id = p_wallet_id and t.status = 'posted'
    ) a, cover
   where public.sees_everything()
     and a.d between cover.d_from and cover.d_to - public.setting_numeric('bank_match_days', 3)::int
     and not exists (select 1 from public.bank_lines b where b.matched_type = a.t and b.matched_id = a.id)
  order by 2 desc
$$;

-- Everything that needs a look, for the dashboard and the alert email.
create or replace function public.attention_flags()
returns table (wallet_id uuid, wallet_name text, custodian_name text, kind text, message text, amount numeric, days integer)
language sql stable security definer set search_path = public
as $$
  with w as (select b.*, h.held_too_long, h.oldest_days from public.wallet_balances b join public.cash_held() h using (wallet_id))
  select w.wallet_id, w.name, w.custodian_name, 'cash_held',
         format('%s holds SAR %s cash for more than %s days (oldest %s days)', coalesce(w.custodian_name, w.name),
                to_char(w.held_too_long, 'FM999,999,990.00'), public.setting_numeric('cash_hold_days', 4)::int, w.oldest_days),
         w.held_too_long, w.oldest_days
    from w where w.held_too_long > 0
  union all
  select b.wallet_id, wl.name, p.full_name, 'late_entry',
         format('Cash withdrawal of SAR %s on %s was entered %s day%s late', to_char(-b.amount, 'FM999,999,990.00'),
                to_char(b.txn_date, 'DD Mon'), b.days_late, case when b.days_late = 1 then '' else 's' end),
         -b.amount, b.days_late
    from public.bank_lines b join public.wallets wl on wl.id = b.wallet_id left join public.profiles p on p.id = wl.custodian_id
   where b.matched_type = 'cash_move' and b.days_late > 0 and b.resolved_at is null
  union all
  select b.wallet_id, wl.name, p.full_name, 'bank_only',
         format('%s in the bank on %s but not in the app: %s', case when b.amount < 0 then 'SAR ' || to_char(-b.amount, 'FM999,999,990.00') || ' out' else 'SAR ' || to_char(b.amount, 'FM999,999,990.00') || ' in' end,
                to_char(b.txn_date, 'DD Mon'), left(b.description, 60)),
         abs(b.amount), public.local_today() - b.txn_date
    from public.bank_lines b join public.wallets wl on wl.id = b.wallet_id left join public.profiles p on p.id = wl.custodian_id
   where b.matched_id is null and b.kind <> 'fee' and b.resolved_at is null
  union all
  select w.wallet_id, w.name, w.custodian_name, 'negative',
         format('%s is below zero (SAR %s): a transfer may still need recording', w.name, to_char(w.available_balance, 'FM999,999,990.00')),
         w.available_balance, null
    from w where w.available_balance < 0
$$;

-- ---------------------------------------------------------------------------
-- Monthly close
-- ---------------------------------------------------------------------------
-- Changes whenever anything in the month changes, so an export taken earlier
-- can be told apart from the current data.
create or replace function public.month_fingerprint(p_month date)
returns text
language sql stable security definer set search_path = public
as $$
  select md5(
    coalesce((select string_agg(concat_ws('|', id, status, amount, vat_amount, paid_by, project_id, category_id, wallet_id, invoice_path, description, updated_at), ',' order by id)
                from public.expenses where period_month = p_month), '')
    || '#' ||
    coalesce((select string_agg(concat_ws('|', id, status, amount, wallet_id, attachment_path), ',' order by id)
                from public.topups where period_month = p_month), '')
    || '#' ||
    coalesce((select string_agg(concat_ws('|', id, status, kind, amount, wallet_id), ',' order by id)
                from public.cash_moves where period_month = p_month), '')
  )
$$;

-- One row per month that has data (plus the current month), for the Close month page.
create or replace function public.month_overview()
returns table (month date, expense_count bigint, expense_total numeric, unchecked_count bigint, topup_count bigint, topup_total numeric,
               file_count bigint, exported_at timestamptz, export_current boolean, accepts_entries boolean)
language sql stable security definer set search_path = public
as $$
  with months as (
    select period_month as m from public.expenses
    union select period_month from public.topups
    union select period_month from public.cash_moves
    union select date_trunc('month', current_date)::date
  )
  select
    m.m,
    (select count(*) from public.expenses e where e.period_month = m.m),
    (select coalesce(sum(amount), 0) from public.expenses e where e.period_month = m.m and status = 'recorded'),
    (select count(*) from public.expenses e where e.period_month = m.m and status = 'recorded' and checked_by is null),
    (select count(*) from public.topups t where t.period_month = m.m),
    (select coalesce(sum(amount), 0) from public.topups t where t.period_month = m.m and status = 'posted'),
    (select count(nullif(invoice_path, '')) from public.expenses e where e.period_month = m.m)
      + (select count(nullif(attachment_path, '')) from public.topups t where t.period_month = m.m),
    x.exported_at,
    coalesce(x.fingerprint = public.month_fingerprint(m.m), false),
    m.m >= public.open_month_from()
  from months m
  left join lateral (select exported_at, fingerprint from public.month_exports where month = m.m order by exported_at desc limit 1) x on true
  where public.sees_everything()
  order by m.m desc
$$;

-- Called by the web app once the Excel and the invoice zip have downloaded.
create or replace function public.record_month_export(p_month date, p_file_count integer)
returns public.month_exports
language plpgsql security definer set search_path = public
as $$
declare r public.month_exports; v_month date := date_trunc('month', p_month)::date;
begin
  if not public.sees_everything() then raise exception 'only accounts and finance can export a month' using errcode = '42501'; end if;
  insert into public.month_exports (month, fingerprint, expense_count, file_count)
  values (v_month, public.month_fingerprint(v_month), (select count(*) from public.expenses where period_month = v_month), coalesce(p_file_count, 0))
  returning * into r;
  return r;
end $$;

-- Erase a month. Requires: admin, typed confirmation "YYYY-MM", a month before the
-- current one, no older month still holding data, and an export taken after the
-- last change. Carries each wallet's net movement for the month into
-- wallets.opening_balance, so balances (and the bank reconciliation) are unchanged.
-- Returns the closed_months row; files_pending lists the storage files for the app to remove.
create or replace function public.close_month(p_month date, p_confirm text)
returns public.closed_months
language plpgsql security definer set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_expense_ids uuid[];
  v_topup_ids uuid[];
  v_cash_ids uuid[];
  v_files text[];
  v_carried jsonb;
  r public.closed_months;
  x record;
begin
  if not public.is_admin() then raise exception 'only finance admins can close a month' using errcode = '42501'; end if;
  if coalesce(trim(p_confirm), '') <> to_char(v_month, 'YYYY-MM') then
    raise exception 'type % to confirm', to_char(v_month, 'YYYY-MM');
  end if;
  if v_month >= date_trunc('month', current_date)::date then
    raise exception 'the current month cannot be closed';
  end if;
  if exists (select 1 from public.closed_months where month = v_month) then
    raise exception 'month % is already closed', to_char(v_month, 'YYYY-MM');
  end if;

  -- stop new entries and edits while we work
  lock table public.expenses, public.topups, public.cash_moves in share row exclusive mode;

  if exists (select 1 from public.expenses where period_month < v_month) or exists (select 1 from public.topups where period_month < v_month)
     or exists (select 1 from public.cash_moves where period_month < v_month) then
    raise exception 'close the older months first';
  end if;
  if not coalesce((select fingerprint = public.month_fingerprint(v_month) from public.month_exports
                    where month = v_month order by exported_at desc limit 1), false) then
    raise exception 'download the export for % first (or again: something changed since the last export)', to_char(v_month, 'YYYY-MM');
  end if;

  select coalesce(array_agg(id), '{}'), coalesce(array_agg('invoices/' || invoice_path) filter (where coalesce(invoice_path, '') <> ''), '{}')
    into v_expense_ids, v_files from public.expenses where period_month = v_month;
  select coalesce(array_agg(id), '{}'), v_files || coalesce(array_agg('attachments/' || attachment_path) filter (where coalesce(attachment_path, '') <> ''), '{}')
    into v_topup_ids, v_files from public.topups where period_month = v_month;
  select coalesce(array_agg(id), '{}') into v_cash_ids from public.cash_moves where period_month = v_month;

  -- net movement per wallet (top-ups minus expenses minus cash handed back), and the
  -- change in cash in hand, both carried into the wallet's opening figures
  select coalesce(jsonb_agg(jsonb_build_object('wallet_id', w.id, 'name', w.name, 'net', n.net, 'cash', n.cash) order by w.name), '[]')
    into v_carried
    from (
      select wallet_id, sum(net) as net, sum(cash) as cash from (
        select wallet_id, amount as net, 0 as cash from public.topups where period_month = v_month and status = 'posted'
        union all
        select wallet_id, -amount, case when paid_by = 'cash' then -amount else 0 end from public.expenses where period_month = v_month and status = 'recorded'
        union all
        select wallet_id, case when kind = 'handover' then -amount else 0 end, case when kind = 'withdrawal' then amount else -amount end
          from public.cash_moves where period_month = v_month and status = 'posted'
      ) m group by wallet_id
    ) n join public.wallets w on w.id = n.wallet_id;

  for x in select (j ->> 'wallet_id')::uuid as id, (j ->> 'net')::numeric as net, coalesce((j ->> 'cash')::numeric, 0) as cash
             from jsonb_array_elements(v_carried) j loop
    update public.wallets set opening_balance = opening_balance + x.net, opening_cash = opening_cash + x.cash where id = x.id;
  end loop;

  insert into public.closed_months (month, expense_count, expense_total, topup_count, topup_total, carried, files_pending, closed_by)
  values (
    v_month,
    cardinality(v_expense_ids),
    (select coalesce(sum(amount), 0) from public.expenses where period_month = v_month and status = 'recorded'),
    cardinality(v_topup_ids),
    (select coalesce(sum(amount), 0) from public.topups where period_month = v_month and status = 'posted'),
    v_carried, v_files, auth.uid()
  ) returning * into r;

  perform set_config('xc.closing', 'on', true);
  delete from public.expenses where id = any (v_expense_ids);
  delete from public.topups where id = any (v_topup_ids);
  delete from public.cash_moves where id = any (v_cash_ids);
  -- statement lines up to the end of the month go too (they hold the same information)
  delete from public.bank_lines where txn_date < (v_month + interval '1 month')::date;
  delete from public.bank_imports i where not exists (select 1 from public.bank_lines b where b.import_id = i.id)
    and i.date_to < (v_month + interval '1 month')::date;
  -- the per-row history would otherwise keep the erased data; the closed_months row
  -- (and its own audit entry) is the record that the month existed
  delete from public.audit_log where table_name = 'expenses' and record_id = any (select unnest(v_expense_ids)::text);
  delete from public.audit_log where table_name = 'topups' and record_id = any (select unnest(v_topup_ids)::text);
  delete from public.audit_log where table_name = 'cash_moves' and record_id = any (select unnest(v_cash_ids)::text);
  delete from public.month_exports where month = v_month;
  perform set_config('xc.closing', 'off', true);
  return r;
end $$;

-- The app reports which storage files it has removed after a close.
create or replace function public.mark_files_removed(p_month date, p_files text[])
returns public.closed_months
language plpgsql security definer set search_path = public
as $$
declare r public.closed_months;
begin
  if not public.is_admin() then raise exception 'only finance admins' using errcode = '42501'; end if;
  update public.closed_months set files_pending = array(select unnest(files_pending) except select unnest(p_files))
  where month = date_trunc('month', p_month)::date
  returning * into r;
  return r;
end $$;

-- Invoice and attachment storage in use, for the dashboard.
create or replace function public.storage_usage()
returns jsonb
language sql stable security definer set search_path = public, storage
as $$
  select case when public.sees_everything() then jsonb_build_object(
    'used_bytes', coalesce((select sum((metadata ->> 'size')::bigint) from storage.objects where bucket_id in ('invoices', 'attachments')), 0),
    'file_count', (select count(*) from storage.objects where bucket_id in ('invoices', 'attachments')),
    'limit_bytes', (public.setting_numeric('storage_limit_mb', 1000) * 1024 * 1024)::bigint
  ) end
$$;

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
alter table public.cash_moves        enable row level security;
alter table public.bank_imports      enable row level security;
alter table public.bank_lines        enable row level security;
alter table public.statement_checks  enable row level security;
alter table public.month_exports     enable row level security;
alter table public.closed_months     enable row level security;
alter table public.audit_log         enable row level security;

-- profiles: everyone signed in can read names; you edit your own name/locale; admins manage roles.
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_admin_write on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role_name() and active);

-- master data: wallets are private to their custodian; the rest is readable by all signed-in users. Admins write.
create policy wallets_read on public.wallets for select to authenticated
  using (public.sees_everything() or custodian_id = auth.uid());
create policy wallets_admin on public.wallets for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy projects_read on public.projects for select to authenticated using (true);
create policy projects_admin on public.projects for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy categories_read on public.categories for select to authenticated using (true);
create policy categories_admin on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_admin on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- top-ups: custodians see their own wallets; admins/accounts see all; admins insert.
create policy topups_read on public.topups for select to authenticated
  using (public.sees_everything() or exists (select 1 from public.wallets w where w.id = wallet_id and w.custodian_id = auth.uid()));
create policy topups_admin_insert on public.topups for insert to authenticated
  with check (public.is_admin() and status = 'posted' and created_by = auth.uid());
create policy topups_admin_update on public.topups for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- expenses
create policy expenses_read on public.expenses for select to authenticated
  using (
    public.sees_everything()
    or submitted_by = auth.uid()
    or exists (select 1 from public.wallets w where w.id = wallet_id and w.custodian_id = auth.uid())
  );
-- Staff record spend on a card or float they hold. Admins can record on anyone's.
create policy expenses_insert on public.expenses for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and (public.is_admin() or exists (select 1 from public.wallets w where w.id = wallet_id and w.custodian_id = auth.uid()))
  );
-- Staff correct their own entry until it's checked (the guard trigger enforces the rest).
create policy expenses_owner_update on public.expenses for update to authenticated
  using (submitted_by = auth.uid() and status = 'recorded' and checked_by is null)
  with check (submitted_by = auth.uid() and status = 'recorded' and checked_by is null
              and exists (select 1 from public.wallets w where w.id = wallet_id and w.custodian_id = auth.uid()));
-- Finance corrects anything (e.g. moves an entry to another month).
create policy expenses_admin_update on public.expenses for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- cash moves: staff log them on their own wallet; nobody edits (reverse instead); finance can log for anyone.
create policy cash_moves_read on public.cash_moves for select to authenticated
  using (public.sees_everything() or exists (select 1 from public.wallets w where w.id = wallet_id and w.custodian_id = auth.uid()));
create policy cash_moves_insert on public.cash_moves for insert to authenticated
  with check (created_by = auth.uid() and status = 'posted'
              and (public.is_admin() or exists (select 1 from public.wallets w where w.id = wallet_id and w.custodian_id = auth.uid())));
create policy cash_moves_admin_update on public.cash_moves for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- statements: accounts and finance only, written through the RPCs above
create policy bank_imports_read on public.bank_imports for select to authenticated using (public.sees_everything());
create policy bank_lines_read on public.bank_lines for select to authenticated using (public.sees_everything());

create policy statement_checks_read on public.statement_checks for select to authenticated using (public.sees_everything());
create policy month_exports_read on public.month_exports for select to authenticated using (public.sees_everything());
create policy closed_months_read on public.closed_months for select to authenticated using (public.sees_everything());
create policy audit_read on public.audit_log for select to authenticated using (public.sees_everything());

-- Only expose RPCs to signed-in users.
do $$
declare f text;
begin
  foreach f in array array[
    'set_checked(uuid, boolean, text)', 'reverse_expense(uuid, text)', 'reverse_topup(uuid, text)',
    'record_statement_check(uuid, date, numeric, text)', 'dashboard_summary(date, date, uuid, uuid, uuid, date)', 'wallet_month_summary(date)',
    'spend_breakdown(text, date, date, uuid, uuid, date)', 'month_fingerprint(date)', 'month_overview()',
    'record_month_export(date, integer)', 'close_month(date, text)', 'mark_files_removed(date, text[])', 'storage_usage()',
    'set_cash_checked(uuid, boolean, text)', 'reverse_cash_move(uuid, text)', 'cash_held()', 'match_bank(uuid)',
    'import_bank_lines(uuid, text, jsonb)', 'resolve_bank_line(uuid, boolean, text)', 'bank_report(uuid)', 'attention_flags()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Live updates: the web app listens for new and changed entries (Supabase Realtime;
-- RLS still decides who receives what).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.expenses, public.topups, public.cash_moves;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: bill photos and top-up proofs (private buckets)
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
      or public.sees_everything()
    )
  );
-- Close month removes the month's files through the Storage API.
create policy invoices_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'invoices' and public.is_admin());
create policy attachments_admin on storage.objects for all to authenticated
  using (bucket_id = 'attachments' and public.is_admin())
  with check (bucket_id = 'attachments' and public.is_admin());
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.sees_everything());
