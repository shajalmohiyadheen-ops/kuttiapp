// Row types matching supabase/migrations. Numeric columns arrive from
// PostgREST as numbers or strings; always go through money.fromDb().

export type UserRole = 'admin' | 'accounts' | 'custodian';
export type PaymentMethod = 'card' | 'cash';
export type TopupStatus = 'posted' | 'reversed';
export type TopupMethod = 'bank_transfer' | 'cash' | 'opening_balance' | 'custodian_repayment' | 'other';
export type ExpenseStatus = 'recorded' | 'reversed';
type Num = number | string;

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  active: boolean;
}

/** One wallet per card holder: the card plus any cash withdrawn from it. */
export interface Wallet {
  id: string;
  external_id: string;
  name: string;
  custodian_id: string;
  bank_name: string | null;
  card_last4: string | null;
  active: boolean;
  opening_balance: Num;
}

/** One wallet row on the dashboard: opening + transferred - spent = balance (numbers come as strings). */
export interface WalletMonthSummary {
  wallet_id: string;
  name: string;
  card_last4: string | null;
  custodian_name: string | null;
  active: boolean;
  opening: string;
  transferred: string;
  spent: string;
  vat: string;
  balance: string;
}

export interface WalletBalance {
  wallet_id: string;
  external_id: string;
  name: string;
  card_last4: string | null;
  custodian_id: string;
  custodian_name: string;
  active: boolean;
  opening_balance: Num;
  topups_total: Num;
  spent_total: Num;
  spent_card: Num;
  spent_cash: Num;
  unchecked_count: number;
  available_balance: Num;
}

export interface Project {
  id: string;
  external_id: string;
  code: string | null;
  name: string;
  budget: Num | null;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  receipt_required: boolean;
  active: boolean;
}

export interface Topup {
  id: string;
  external_id: string;
  wallet_id: string;
  amount: Num;
  transfer_date: string;
  period_month: string;
  method: TopupMethod;
  reference: string | null;
  notes: string | null;
  attachment_path: string | null;
  status: TopupStatus;
  created_by: string;
  created_at: string;
  reversal_reason: string | null;
}

export interface Expense {
  id: string;
  external_id: string;
  client_id: string | null;
  wallet_id: string;
  project_id: string;
  category_id: string;
  paid_by: PaymentMethod;
  submitted_by: string;
  expense_date: string;
  period_month: string;
  vendor: string;
  vendor_vat_number: string | null;
  invoice_number: string | null;
  description: string | null;
  amount: Num;
  vat_amount: Num;
  invoice_path: string | null;
  status: ExpenseStatus;
  checked_by: string | null;
  checked_at: string | null;
  check_note: string | null;
  reversal_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface StatementCheck {
  id: string;
  wallet_id: string;
  statement_date: string;
  statement_balance: Num;
  calculated_balance: Num;
  difference: Num;
  notes: string | null;
  created_at: string;
}

export interface DashboardSummary {
  topups_total: Num;
  topups_count: number;
  spent_total: Num;
  spent_count: number;
  spent_vat: Num;
  spent_card: Num;
  spent_cash: Num;
  unchecked_total: Num;
  unchecked_count: number;
  net_movement: Num;
}

export interface SpendRow {
  key: string;
  label: string;
  spent: Num;
  expense_count: number;
}

export interface MonthOverview {
  month: string;
  expense_count: number;
  expense_total: Num;
  unchecked_count: number;
  topup_count: number;
  topup_total: Num;
  file_count: number;
  exported_at: string | null;
  export_current: boolean;
  accepts_entries: boolean;
}

export interface ClosedMonth {
  month: string;
  expense_count: number;
  expense_total: Num;
  topup_count: number;
  topup_total: Num;
  carried: Array<{ wallet_id: string; name: string; net: Num }>;
  files_pending: string[];
  closed_by: string;
  closed_at: string;
}

export interface StorageUsage {
  used_bytes: number;
  file_count: number;
  limit_bytes: number;
}

/** First day of the month for a YYYY-MM-DD date. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The months that accept entries: the current one and the (retention - 1) before it, newest first. */
export function openMonths(retention = 5, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, retention); i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-01" -> "Nov 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Storage path for a bill photo: <uid>/<yyyy>/<uuid>.jpg (enforced by storage RLS). */
export function invoicePath(userId: string, id: string, date = new Date(), ext = 'jpg'): string {
  return `${userId}/${date.getFullYear()}/${id}.${ext}`;
}
