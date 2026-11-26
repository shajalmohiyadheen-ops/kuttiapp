// Row types matching supabase/migrations. Numeric columns arrive from
// PostgREST as numbers or strings; always go through money.fromDb().

export type UserRole = 'admin' | 'approver' | 'custodian';
export type WalletKind = 'card' | 'cash';
export type TopupStatus = 'posted' | 'reversed';
export type TopupMethod = 'bank_transfer' | 'cash' | 'opening_balance' | 'custodian_repayment' | 'other';
export type ExpenseStatus = 'pending' | 'changes_requested' | 'approved' | 'rejected' | 'reversed';
export type ReviewDecision = 'approve' | 'reject' | 'request_changes';
type Num = number | string;

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  locale: 'en' | 'ar';
  active: boolean;
}

export interface Wallet {
  id: string;
  external_id: string;
  name: string;
  kind: WalletKind;
  custodian_id: string;
  bank_name: string | null;
  card_last4: string | null;
  active: boolean;
}

export interface WalletBalance {
  wallet_id: string;
  external_id: string;
  name: string;
  kind: WalletKind;
  card_last4: string | null;
  custodian_id: string;
  custodian_name: string;
  active: boolean;
  topups_total: Num;
  approved_total: Num;
  pending_total: Num;
  confirmed_balance: Num;
  available_balance: Num;
}

export interface Project {
  id: string;
  external_id: string;
  code: string;
  name: string;
  name_ar: string | null;
  approver_id: string | null;
  budget: Num | null;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  name_ar: string | null;
  active: boolean;
}

export interface Topup {
  id: string;
  external_id: string;
  wallet_id: string;
  amount: Num;
  transfer_date: string;
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
  submitted_by: string;
  expense_date: string;
  vendor: string;
  vendor_vat_number: string | null;
  invoice_number: string | null;
  description: string | null;
  amount: Num;
  vat_amount: Num;
  invoice_path: string | null;
  status: ExpenseStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
}

export interface ExpenseEvent {
  id: number;
  expense_id: string;
  from_status: ExpenseStatus | null;
  to_status: ExpenseStatus;
  note: string | null;
  actor_id: string | null;
  at: string;
}

export interface StatementCheck {
  id: string;
  wallet_id: string;
  statement_date: string;
  statement_balance: Num;
  calculated_balance: Num;
  pending_amount: Num;
  difference: Num;
  notes: string | null;
  created_at: string;
}

export interface DashboardSummary {
  topups_total: Num;
  topups_count: number;
  approved_total: Num;
  approved_count: number;
  approved_vat: Num;
  pending_total: Num;
  pending_count: number;
  rejected_total: Num;
  disbursed_total: Num;
  net_movement: Num;
}

export interface SpendRow {
  key: string;
  label: string;
  approved: Num;
  pending: Num;
  expense_count: number;
}

/** Storage path for an invoice photo: <uid>/<yyyy>/<uuid>.jpg (enforced by storage RLS). */
export function invoicePath(userId: string, id: string, date = new Date(), ext = 'jpg'): string {
  return `${userId}/${date.getFullYear()}/${id}.${ext}`;
}
