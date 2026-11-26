# Setup and deployment

About an hour end to end. You need: a Supabase account, a Render account (or any Node host) for the web app, and an Expo account for the mobile builds. An Apple Developer account (USD 99/year) is needed only for iPhone installs.

## 1. Supabase (database, login, invoice storage)

1. Create a project at [supabase.com](https://supabase.com). Pick the region closest to Saudi Arabia (currently Frankfurt or Mumbai; there's no KSA region).
2. Apply the schema. Either:
   - **SQL editor:** open `supabase/migrations/20261126000001_init.sql`, paste the whole file into Supabase > SQL Editor, and run it; or
   - **CLI:** `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. Supabase > Authentication > Sign In / Providers: keep **Email** on and turn **off** "Allow new users to sign up". Finance adds users from the web app instead.
4. Supabase > Project Settings > API: copy the **Project URL**, the **anon / publishable key**, and the **service_role / secret key**. Keep the service key private.

The very first account created becomes the finance admin automatically. Create it in Supabase > Authentication > Users > Add user (tick "Auto confirm"). Everyone else is added from the web app's Users page.

### Demo data (optional, test projects only)

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
```

This creates four demo users (password `ExpressDemo#2026`), three wallets, projects, categories, top-ups, and expenses in every status. Demo rows can't be deleted afterwards, because the schema forbids deletes, so use a separate Supabase project for demos.

## 2. Web app

Local:

```bash
cp apps/web/.env.example apps/web/.env.local   # fill in the three values
npm install
npm run dev:web
```

Deploy on Render (the repo includes `render.yaml`):

1. Merge the code into `main` on GitHub. Render deploys from `main`.
2. Render > **New** > **Blueprint**, connect GitHub, and pick this repo (on GitHub it is still named `kuttiapp` until you rename it). Render reads `render.yaml`.
3. Render asks for three values. Paste them from Supabase > Project Settings > API: `NEXT_PUBLIC_SUPABASE_URL` (Project URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon / publishable key) and `SUPABASE_SERVICE_ROLE_KEY` (service_role / secret key).
4. Click **Apply**. The first build takes a few minutes. Render then gives you an address like `https://express-cash-web.onrender.com`.
5. In Supabase > Authentication > URL Configuration, set **Site URL** to that address.

`render.yaml` uses the Free plan. It sleeps after 15 minutes without visitors and takes about a minute to wake up. For an always-on app, change the plan to Starter (USD 7 a month at the time of writing) in Render. The `NEXT_PUBLIC_*` values are built into the pages, so after changing them use **Manual Deploy** > **Clear build cache & deploy**.

Any Node 22 host works the same way: `npm ci && npm run build -w @expresscash/web && npm run start -w @expresscash/web`.

## 3. Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env   # URL + anon key only, never the service key
npm run dev:mobile
```

Scan the QR code with **Expo Go** to try it on a phone. In Expo Go the microphone (voice input) isn't available, so the app falls back to typing. Voice needs a real build (below), or a development build: `npx eas-cli@latest build -p android --profile development`.

### Installable builds

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init                # links the app to your Expo account
npx eas-cli@latest env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR-PROJECT.supabase.co --environment preview --environment production
npx eas-cli@latest env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR-ANON-KEY --environment preview --environment production
```

- **Android APK** (install directly, no Play Store): `npx eas-cli@latest build -p android --profile preview`. EAS gives you a download link; send it to custodians.
- **iPhone via TestFlight**: `npx eas-cli@latest build -p ios --profile production`, then `npx eas-cli@latest submit -p ios`. Testers install it from TestFlight. This needs the Apple Developer account.
- Change `ios.bundleIdentifier` and `android.package` in `apps/mobile/app.json` (currently `com.expresscash.app`) to your company's domain **before** the first store build. They can't be changed after publishing.

## Your logo

The logo assets are generated from `design/express-cash-xc-icon.png` by `design/make-logo-assets.py` (needs Pillow). To use a new logo, replace that image, adjust the crop box in the script if needed, and run `python3 design/make-logo-assets.py`. It writes:

- `apps/web/public/logo.png` and `apps/mobile/assets/logo.png`: the transparent wordmark used in headers and on the login page.
- `apps/web/public/icon.png`: browser tab icon.
- `apps/mobile/assets/icon.png`, `splash.png` and the `android-icon-*.png` files: the phone's app icon and splash screen.

## 4. First-day checklist

1. Sign in to the web app as the finance admin.
2. **Settings**: set the invoice photo threshold.
3. **Users**: add each custodian and approver. Give them the temporary password.
4. **Projects** and **Categories**: add yours. Assign an approver to a project, or leave it empty so finance approves.
5. **Wallets**: one per Alinma card (with last 4 digits) and one per cash float.
6. **Top-ups**: enter each wallet's current balance with method "Opening balance", then record every transfer from then on.
7. Custodians install the app, sign in, and start submitting.
8. Weekly: **Reconciliation** with each card's balance from the Alinma app.

## Tests

- `npm run test:db` applies the migration to a throwaway local Postgres (with a small stand-in for Supabase's `auth` and `storage` schemas) and runs 30+ checks on balances, permissions, the approval workflow, reversals, and the audit log.
- `npm test` runs the shared unit tests (money parsing and formatting, ZATCA QR decoding).
- GitHub Actions runs both plus the web build, web lint, and mobile typecheck on every pull request.
