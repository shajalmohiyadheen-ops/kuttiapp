# KuttiApp

Petty cash and company card tracker. Finance tops up Alinma cards and cash floats; custodians record what they spend, with an invoice photo, against a project; approvers approve; the dashboard shows where every riyal went and reconciles against the bank statement.

| Part | What it is | Who uses it |
| --- | --- | --- |
| `apps/web` | Next.js admin web app | Finance admins and project approvers |
| `apps/mobile` | Expo app for iOS and Android | Card and cash custodians |
| `supabase/` | Postgres schema, security rules, workflow functions | Both apps |
| `packages/shared` | Money maths, Saudi e-invoice QR reader, Arabic/English text, types | Both apps |

Setup and deployment: **[docs/SETUP.md](docs/SETUP.md)**. Odoo plan: [docs/ODOO-PHASE2.md](docs/ODOO-PHASE2.md).

## How balances work

Alinma has no public API for card balances, so KuttiApp **calculates** each wallet's balance:

```
balance = posted top-ups − every expense that isn't reversed
```

- KuttiApp is a record of what was spent and on what, not an enforcement tool. A card swipe has already left the bank, so an expense is deducted the moment it is submitted and stays deducted whether it is approved, rejected or waiting. Approval and rejection are for accounts and audit to classify the spend; the app takes no further action on a rejection.
- Only a **reversal** gives money back to the balance, for example a vendor refund or an entry made twice.
- Reconciliation is manual: on the Reconciliation page, enter the balance shown in the Alinma app or statement. KuttiApp stores the calculated balance at that date next to it and flags any difference.

## Rules the database enforces

These hold for every client, including someone calling the API directly:

- All amounts are SAR, `numeric(14,2)`.
- Top-ups and expenses can't be deleted. A posted top-up or approved expense can't be edited; it is **reversed** (with a reason), which keeps the original row.
- Expenses above the threshold in Settings (default SAR 100) need an invoice photo.
- Custodians only see and spend from their own wallets. Approvers only see and approve expenses on projects assigned to them, and never their own. Only finance admins record top-ups, reverse, reconcile, and manage users.
- Every change to financial and master data is written to the audit log.
- Each expense, top-up, wallet and project has a stable `external_id` (`KE-…`, `KT-…`, `KW-…`, `KP-…`) for the Odoo sync in Phase 2.

## Adding an expense on the phone

The flow is built for people who don't use apps much. It has one big button and four short steps:

1. **Photo of the bill.** If the bill has a Saudi e-invoice QR code, KuttiApp reads the total, VAT, vendor and date from the photo, so step 3 is skipped.
2. **"Which project?"** Hold the mic and say it ("ABB", "the Riyadh villa", "مشروع الرياض"). KuttiApp matches it against the project list and shows the best match as a big button. They can also tap a recent project or type.
3. **"How much?"** Hold the mic and say it ("two thousand three hundred", "ألفين وثلاثمية", "2300"), or type it.
4. **Check and send.** Every value can be tapped and changed. Category, card or cash, and an optional note are on this screen too.

Speech recognition uses the phone's own Apple or Google recogniser in Arabic (ar-SA) or English. It needs an installed build of the app, not Expo Go. If there's no microphone permission or no speech service, the app goes straight to typing.

## Saudi e-invoice QR

The mobile app's **Scan invoice QR** reads the ZATCA QR code printed on Saudi tax invoices and fills in vendor name, vendor VAT number, date, total, and VAT exactly. No OCR service or API key is needed. Invoices without a QR code are typed in by hand.

## Development

```bash
npm install
npm test            # shared package unit tests
npm run test:db     # schema tests on a local Postgres (needs psql + createdb)
npm run dev:web     # http://localhost:3000  (needs apps/web/.env.local)
npm run dev:mobile  # Expo dev server        (needs apps/mobile/.env)
```
