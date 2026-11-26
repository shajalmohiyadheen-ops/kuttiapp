# Express Cash

Petty cash and company card tracker. The Super Admin transfers money to staff cards (Alinma, SNB). Card holders record every payment, cash withdrawal and returned cash on their phone, with a photo of the bill, against a project. Accounts check the entries and match them to the weekly bank statement. Each month is downloaded for Odoo and then closed.

| Part | What it is |
| --- | --- |
| `apps/web` | Next.js app: admin screens on a laptop, the phone app at `/app` (installable, works offline) |
| `supabase/` | Postgres schema, security rules and functions, plus the tests |
| `packages/shared` | Money maths, Saudi e-invoice QR reader, bank statement reader, types and text |
| `scripts/weekly-email.mjs` | Sunday report email (GitHub Actions + Resend) |

- **Setup:** [docs/SETUP.md](docs/SETUP.md)
- **Guides:** [card holders](docs/guides/staff-quick-guide.md), [admin and accounts](docs/guides/admin-quick-guide.md)
- **Odoo plan:** [docs/ODOO-PHASE2.md](docs/ODOO-PHASE2.md)

## How the numbers work

There is one wallet per card holder: the card plus any cash they took out of it. Alinma and SNB have no API, so the balance is calculated:

```
wallet balance = brought forward + transfers in − expenses − cash handed to the office
on card        = brought forward card + transfers in − card expenses − cash withdrawn + cash put back
cash in hand   = brought forward cash + cash withdrawn − cash put back − cash handed over − cash expenses
```

- Every saved expense counts at once. There is no approval step. Accounts tick **Checked**; once checked, staff can no longer edit the entry.
- Nothing is blocked. A wallet may go below zero when a transfer has not been recorded yet; the app shows "transfer pending".
- Only the Super Admin records transfers, reverses entries and closes months.

## Controls

| Warning | When it is raised |
| --- | --- |
| Cash held too long | Cash withdrawn and not spent or returned after `cash_hold_days` (4). Ageing is first in, first out. |
| Entered late | A cash withdrawal entered in the app after the bank statement's date |
| In the bank, not in the app | A bank line with no matching entry (same amount, within 3 days for card, 10 for cash) |
| In the app, not in the bank | A card entry the uploaded statement does not show |
| Below zero | Wallet balance under 0 |

Warnings show behind the bell on the dashboard and, for their own wallet, on the card holder's phone. They are also in the Sunday email.

## Rules the database enforces

These hold for any client, including direct API calls:

- **Amounts:** all amounts are SAR, `numeric(14,2)`.
- **No deletes:** nothing financial can be deleted. Corrections are reversals, which keep the original row and need a reason.
- **Staff access:** staff only see and enter on their own wallet. They can correct an expense until it is checked. Cash entries can't be edited.
- **Bill photos:** a photo is required above the limit in Settings (SAR 100) for categories that need one. No-bill categories need remarks.
- **Month close:** a month can be closed only after its download is current. It erases the month's rows and files, including replaced bill photos, and carries every balance forward unchanged.
- **Audit:** every change to money and master data is in the audit log.
- **Odoo IDs:** every record has a stable `external_id` (`KE-`, `KT-`, `KC-`, `KW-`, `KP-`) for the Odoo sync later.

## Development

```bash
npm install
npm test                         # shared unit tests
npm run test:db                  # schema tests on a local Postgres 16
npm run dev:web                  # http://localhost:3000 (needs apps/web/.env.local)
npm run weekly-email -- --dry-run
```

GitHub Actions runs the database tests, the unit tests, the web build and lint on every pull request.
