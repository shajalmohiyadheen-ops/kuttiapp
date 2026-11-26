# Setup guide (Super Admin)

About 45 minutes. At the end you have Express Cash running at your own web address, staff can install it on their phones, and a report email arrives every Sunday.

You need four free accounts: **GitHub** (you have it), **Supabase**, **Render** (you have it) and **Resend**. Use a laptop, not a phone.

| Service | What it does | Cost |
| --- | --- | --- |
| Supabase | Database, logins, bill photos | Free plan (500 MB database, 1 GB files) |
| Render | Runs the website and phone app | Free plan (sleeps when idle) or Starter USD 7/month |
| Resend | Sends the weekly email | Free (3,000 emails a month) |
| GitHub | Holds the code and sends the weekly email on schedule | Free |

Keep a notepad open. You will copy six values along the way:

```
SUPABASE URL         = https://xxxx.supabase.co
SUPABASE ANON KEY    = eyJ... (public, used by the app)
SUPABASE SERVICE KEY = eyJ... (SECRET: never share, never put in WhatsApp)
APP ADDRESS          = https://express-cash-web.onrender.com
RESEND API KEY       = re_... (SECRET)
REPORT EMAIL         = your email address
```

---

## Step 0. Merge the code (2 minutes)

Render installs the app from the `main` branch.

1. Open the pull request on GitHub (repository `kuttiapp`, pull request "Express Cash").
2. Click **Merge pull request**, then **Confirm merge**.

## Step 1. Supabase (15 minutes)

1. Go to [supabase.com](https://supabase.com) and click **Start your project**. Sign in with GitHub.
2. Click **New project**.
   - Name: `express-cash`
   - Database password: click **Generate**, then save it in your notepad (you will rarely need it).
   - Region: **Central EU (Frankfurt)**. There is no Saudi region; Frankfurt is the closest.
   - Click **Create new project** and wait about 2 minutes.
3. **Create the tables.** In the left menu, open **SQL Editor** and click **New query**.
   - On GitHub, open `supabase/migrations/20261126000001_init.sql`, click **Raw**, select everything (Ctrl+A) and copy (Ctrl+C).
   - Paste it into the Supabase query box and click **Run**. You should see "Success. No rows returned".
4. **Turn off public sign-up.** In the left menu, open **Authentication** and then **Sign In / Providers**.
   - Keep **Email** on.
   - Turn **off** "Allow new users to sign up". Only you add people.
   - Turn **off** "Confirm email". Then nobody has to click an email link.
   - Click **Save**.
5. **Create your own login.** Open **Authentication**, then **Users**, then **Add user**, then **Create new user**.
   - Enter your email and a strong password.
   - Tick **Auto Confirm User**.
   - The first account ever created automatically becomes **Super Admin**.
6. **Copy the keys.** Open **Project Settings** (the gear icon), then **API Keys**. If you see a "Legacy API keys" tab, use it. Copy these into your notepad:
   - **Project URL** (also under **Data API**): this is the SUPABASE URL.
   - **anon / public** key: this is the SUPABASE ANON KEY.
   - **service_role / secret** key: click **Reveal**. This is the SUPABASE SERVICE KEY.

## Step 2. Render (10 minutes)

1. Go to [dashboard.render.com](https://dashboard.render.com). Click **New +**, then **Blueprint**.
2. Connect GitHub if asked, and pick the `kuttiapp` repository. Render reads the `render.yaml` file in it.
3. Render asks for three values. Paste them from your notepad:
   - `NEXT_PUBLIC_SUPABASE_URL`: the SUPABASE URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the SUPABASE ANON KEY
   - `SUPABASE_SERVICE_ROLE_KEY`: the SUPABASE SERVICE KEY
4. Click **Apply**. The first build takes 3 to 5 minutes. When it says **Live**, copy the address at the top (like `https://express-cash-web.onrender.com`) into your notepad as the APP ADDRESS.
5. Back in Supabase, open **Authentication**, then **URL Configuration**. Set **Site URL** to the APP ADDRESS and click **Save**.
6. Open the APP ADDRESS and sign in with the email and password from Step 1.5.

**Free plan or Starter?** On the free plan, the app goes to sleep after 15 minutes with no visitors. The next person to open it waits about a minute. Staff do not lose anything, because entries wait on the phone, but it is annoying. To keep it always on, open the service in Render, then **Settings**, then **Instance Type**, and choose **Starter** (USD 7 a month).

## Step 3. Resend, for the weekly email (10 minutes)

1. Go to [resend.com](https://resend.com) and sign up.
2. Open **API Keys**, then **Create API Key**. Name it `express-cash`, keep **Sending access**, and click **Add**. Copy the key into your notepad as the RESEND API KEY. It is shown only once.
3. **Sender address:**
   - **Quick start:** without a domain, Resend only sends to the email you signed up with, from `onboarding@resend.dev`. That is enough if the report goes only to you.
   - **To send to more people (for example the accounts team):** open **Domains**, then **Add Domain**, and enter your company domain. Add the DNS records it shows at your domain provider. When the domain shows **Verified**, use a sender like `Express Cash <reports@yourcompany.com>`.

## Step 4. Turn on the Sunday email in GitHub (5 minutes)

1. On GitHub, open the `kuttiapp` repository. Go to **Settings**, then **Secrets and variables**, then **Actions**, then **New repository secret**.
2. Add these, one at a time:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | SUPABASE URL |
| `SUPABASE_SERVICE_ROLE_KEY` | SUPABASE SERVICE KEY |
| `RESEND_API_KEY` | RESEND API KEY |
| `REPORT_TO` | Your email. For several people, separate them with commas. |
| `REPORT_FROM` | Your sender address from Step 3. Leave it out for the quick start. |
| `APP_URL` | APP ADDRESS |

3. **Test it now:** open the **Actions** tab, click **Weekly email** on the left, then **Run workflow**, then **Run workflow** again. After about a minute, check your inbox (and spam).

From then on it arrives every **Sunday at 8:00 AM** Saudi time. The email shows each wallet's card and cash balance, everything that needs attention, and the week's entries as Excel.

## Step 5. First day in the app (15 minutes)

Sign in at the APP ADDRESS on a laptop.

1. **Settings:**
   - Bill photo limit: default SAR 100.
   - Cash may be held for: default 4 days.
   - Months kept open: default 5.
2. **Categories:** add yours, for example Materials, Fuel, Meals, Transport and Outside labour. Untick **bill photo needed** for things without a bill; staff then write remarks instead.
3. **Projects:** add the project names (up to 10).
4. **Users:** click **Invite user** for each person.
   - **Field Staff** hold a card and use the phone app.
   - **Accounts** see everything and tick expenses as checked.
   - Give each person a password of 8 characters or more. They can change it later from the phone menu.
5. **Wallets:** add one per card holder, with the holder, the bank (Alinma or SNB) and the last 4 digits of the card.
6. **Transfers in:** for each wallet, record what is on the card today, with method **Opening balance**. From then on, record every transfer on the day you make it.
7. **Invite staff:** pick a person, then show them the QR code or tap **Open WhatsApp**. Tell them their password by phone or in person. It is never put in the link.

## Every week

- **Accounts:** download each card's statement from Alinma or SNB as Excel and upload it under **Bank statements**. Then explain or chase anything in "Entered late", "In the bank, not in the app" and "In the app, not in the bank".
- **Super Admin:** read the Sunday email and check the bell on the dashboard.

## Every month (first week of the new month)

1. Open **Close month**. Click **Download Excel + invoices** for the oldest open month. Open the zip and check it, then keep it safe. It is your only copy, and it is what you import into Odoo.
2. Click **Close month** and type the month to confirm. The month is erased to free space. Every balance, including cash in hand, carries forward unchanged.
3. The dashboard warns you when bill photo storage reaches 80% of the free 1 GB.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| Render build failed | Open the service, then **Events**, then the failed deploy, and read the last lines. Usually a key was pasted with a space. Fix it under **Environment**, then **Manual Deploy**, then **Clear build cache & deploy**. |
| "Wrong email or password" | Reset the password on the **Users** page. |
| A staff member sees "No wallet is assigned to you" | Open **Wallets** and set them as the holder of a wallet. |
| The weekly email did not arrive | Open GitHub **Actions**, then **Weekly email**, then the latest run, and read the error. Without a verified domain, Resend only sends to your own signup email. |
| You changed a key in Render | Keys starting with `NEXT_PUBLIC_` are built into the app. Use **Manual Deploy**, then **Clear build cache & deploy**. |

## For developers

```bash
cp apps/web/.env.example apps/web/.env.local   # fill in the three values
npm install
npm run dev:web            # http://localhost:3000
npm test                   # shared unit tests
npm run test:db            # schema tests on a local Postgres 16
npm run weekly-email -- --dry-run   # writes the report to files instead of sending
```

Demo data, for a separate test project only, because rows can't be deleted afterwards: `SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed`.

Logo assets are generated from `design/express-cash-xc-logo-v2.png` by `python3 design/make-logo-assets.py` (needs Pillow and numpy).
