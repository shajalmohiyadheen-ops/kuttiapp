# Phase 2: Odoo Community sync (design only, not built)

## What already exists for it

| KuttiApp | Odoo | Column already in the schema |
| --- | --- | --- |
| Wallet (card or cash float) | Bank or cash journal | `wallets.odoo_journal_id` |
| Project | Analytic account | `projects.odoo_analytic_account_id` |
| Category | Expense GL account | `categories.odoo_account_code` |
| Approved expense | Vendor bill (`account.move`, `in_invoice`), paid from the wallet's journal | `expenses.odoo_bill_id`, `expenses.odoo_sync` |
| Top-up | Internal transfer, bank to card/cash journal | `topups.odoo_move_id`, `topups.odoo_sync` |
| Every record | Stable reference | `external_id` (`KE-…`, `KT-…`), unique and never reused |

Database triggers only allow the `odoo_*` columns to change on approved, rejected, or reversed rows, so the sync can mark rows as synced without breaking the "no edits after approval" rule.

## Proposed flow

1. A Supabase Edge Function (or a small scheduled worker) picks up `expenses` where `status = 'approved' and odoo_sync = 'not_synced'`, and `topups` where `status = 'posted'`.
2. It calls Odoo's XML-RPC / JSON-RPC API (`/xmlrpc/2/object`, available in Community) with an integration user:
   - finds or creates the vendor `res.partner` by VAT number (falls back to the name);
   - creates the vendor bill with `ref = external_id`, the category's account, the project's analytic distribution, and 15% VAT tax when `vat_amount > 0`;
   - attaches the invoice image (`ir.attachment`);
   - posts it and registers payment from the wallet's journal.
3. On success it stores the Odoo id and sets `odoo_sync = 'synced'`. On failure it sets `failed`, and the web app gets a "Sync errors" list.
4. A reversal in KuttiApp creates a credit note in Odoo (`ref = external_id + '-REV'`).
5. It's idempotent: before creating, the job searches Odoo for `ref = external_id`, so a retry never duplicates a bill.

## Decisions needed before building

- Bill per expense, or one journal entry per day per wallet? Per-expense bills are easier to audit; journal entries keep Odoo smaller.
- Which Odoo version, and is it reachable from the internet, or only over VPN?
- Should Odoo's approval replace KuttiApp's, or follow it? This design assumes KuttiApp approves and Odoo only records.
