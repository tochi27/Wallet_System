# Deploying PurpleWallet for free

A step-by-step guide to putting PurpleWallet online as a **public demo**, using only free plans. Every part runs on a different free service:

| Part | Service | Free allowance |
|---|---|---|
| Web app | **Netlify** | Static site with HTTPS |
| API (and its background workers) | **Render** (free web service, Frankfurt) | 512 MB, sleeps after 15 minutes without traffic, 750 hours a month |
| Database | **Supabase** | 500 MB Postgres. Pauses only after a week without activity |
| Queues, cache, locks | **Redis Cloud** | 30 MB, 30 connections |
| Email | **Gmail** (app password) | About 500 emails a day |
| AI insights and assistant | **Google Gemini** | Free tier (optional) |
| Payments | **Paystack test mode** | No real money moves |

Free plans change without notice, and none of them comes with guarantees. That's fine for a demo, but **don't use this setup for real customers or real money.**

> **Before you start:** keep a private note (a password manager is ideal) for the values you'll collect: database URL, Redis URL, API URL, web URL, the encryption key and the Gmail app password. Never commit them to Git.

---

## 1. Database: Supabase

1. Sign up at [supabase.com](https://supabase.com) and create a project.
   - **Region:** Frankfurt (`eu-central-1`), or the region closest to where your API will run. The API and database should be close together.
   - **Database password:** use a long random one and save it.
2. When the project is ready, click **Connect** at the top and choose **Session pooler**. This works from any host. The "direct connection" needs IPv6, which many free hosts don't have.
3. Copy the connection string. It looks like:
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```
   Replace `[YOUR-PASSWORD]` with your database password. This is your **`DATABASE_URL`**.

You don't need to create any tables: the API applies every migration itself when it starts. They've been tested on Postgres 17 as well as 18.

## 2. Redis: Redis Cloud

1. Sign up at [redis.io/try-free](https://redis.io/try-free) and create a **free (Essentials 30 MB)** database, in the same region as the database if you can.
2. Open the database → **Configuration**, and set **Data eviction policy** to **`noeviction`**. The job queues must never have their data thrown away to make room.
3. From the database page, copy the **public endpoint** (`host:port`) and the **default user's password**. Your **`REDIS_URL`** is:
   ```
   redis://default:<password>@<host>:<port>
   ```
   If the database requires TLS, use `rediss://` (two s's) instead; the API supports both.

## 3. Email: Gmail

1. Use a Gmail account **just for this app** (not your personal one), with **2-step verification** turned on.
2. Create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), named "PurpleWallet". Copy the 16 letters.
3. Your settings are `EMAIL_PROVIDER=gmail`, `GMAIL_USER=<that address>` and `GMAIL_APP_PASSWORD=<the 16 letters>`.

To check them before deploying, put the same three lines in `apps/api/.env.development` and run:
```bash
npm run email:test -w apps/api -- your-main-address@gmail.com
```

## 4. The encryption key

ID photos and ID numbers (for Tier 2 upgrades) are encrypted with this key. Generate it once:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

This is your **`KYC_ENCRYPTION_KEY`**. **Back it up.** If it's lost or changed, every stored ID document becomes unreadable. The API refuses to start in production without it.

## 5. The API

The API runs on **Render's free plan** from the Blueprint in [`render.yaml`](render.yaml). It builds the Docker image from `apps/api/Dockerfile`, which applies database migrations when it starts, so no separate migration step is needed.

1. **Check your plan:** in Render, under **Billing**, the workspace should be on **Hobby ($0)**.
2. **Commit and push** this repository: Render reads `render.yaml` from GitHub.
3. In Render, choose **New → Blueprint**, then pick the repository and the branch to deploy.
4. Render lists the `purplewallet-api` service. **Before applying, check it says "Free"**. If it shows a price, stop: `render.yaml` must say `plan: free`.
5. Render asks for every setting marked `sync: false`. Fill them in from the table below. `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` and `KYC_ENCRYPTION_KEY` are in your private `apps/api/.env.production.local`, if you prepared one. For `APP_URL`, `CORS_ORIGINS` and `PAYSTACK_CALLBACK_URL`, use a placeholder like `https://example.com` until the Netlify site exists (step 6), then come back and change them.
6. Apply. The first build takes a few minutes. Your API address is shown at the top of the service page, e.g. `https://purplewallet-api.onrender.com`.
7. **Automatic deploys:** `autoDeploy` is off, so Render doesn't build on every push. Instead, copy the service's **Deploy Hook** (service → **Settings**) into GitHub → repository → **Settings → Secrets and variables → Actions** as `RENDER_DEPLOY_HOOK_URL`. CI then redeploys after every push to `main` that passes the API and browser tests.

### API settings

Set these as environment variables on the host:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | From step 1 |
| `REDIS_URL` | From step 2 |
| `JWT_SECRET` | A long random string (at least 32 characters). Generate it like the encryption key. |
| `KYC_ENCRYPTION_KEY` | From step 4 |
| `EMAIL_PROVIDER` / `GMAIL_USER` / `GMAIL_APP_PASSWORD` | From step 3 |
| `APP_URL` | The web app's address from step 6, e.g. `https://purplewallet.netlify.app` (used for links in emails) |
| `CORS_ORIGINS` | The same web address (the browser may only call the API from there) |
| `PAYSTACK_SECRET_KEY` | Your Paystack **test** secret key (`sk_test_…`) |
| `PAYSTACK_CALLBACK_URL` | `<web address>/deposit/callback` |
| `DIRECT_FUNDING_ENABLED` | `false` |
| `GEMINI_API_KEY` | Optional: your Gemini key, for AI insights and the assistant |
| `SUPPORT_EMAIL` | Optional: where "Help & support" points (defaults to `GMAIL_USER`) |

When it's running, open `<API address>/health`. It should say `"database":"ok"` and `"redis":"ok"`. The API docs are at `<API address>/api-docs`.

### Keeping it awake

Render's free plan puts the API to sleep after 15 minutes without traffic, and the first visitor then waits up to a minute. Create a free monitor at [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com) that opens `<API address>/health` every 10 minutes. It also warns you if the API goes down.

## 6. Web app: Netlify

1. Sign up at [netlify.com](https://www.netlify.com) and choose **Add new site → Import an existing project**, then pick this GitHub repository. The build settings come from `netlify.toml`, so leave them as they are.
2. Under **Site configuration → Environment variables**, add:

   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | The API's address from step 5 (no trailing slash) |
   | `VITE_DEMO_MODE` | `true`: shows the demo login and the "don't upload a real ID" notice |
   | `VITE_DEMO_PASSWORD` / `VITE_DEMO_PIN` | Only if you changed them when seeding (step 8). The defaults are `Password123` and `2580`. |

3. **Deploy.** Vite builds these values into the site, so after changing any of them, trigger a new deploy.
4. Your site's address (e.g. `https://purplewallet.netlify.app`) goes into the API's `APP_URL`, `CORS_ORIGINS` and `PAYSTACK_CALLBACK_URL`. You can rename the site under **Site configuration → Site details**.

## 7. Paystack (test mode)

In the Paystack dashboard, with **Test mode** on, go to **Settings → API Keys & Webhooks** and set the **Test Webhook URL** to:
```
<API address>/api/payments/paystack/webhook
```
Deposits then work with Paystack's [test cards](https://paystack.com/docs/payments/test-payments). Withdrawals fail with "temporarily unavailable" until the Paystack account is a registered business. That's expected for the demo.

## 8. Your admin account and the demo accounts

There's usually no shell on a free host, so run these **from your own computer**, pointed at the live database. Use the Supabase `DATABASE_URL` from step 1.

**PowerShell (Windows):**
```powershell
$env:DATABASE_URL = "<the Supabase DATABASE_URL>"

# Demo accounts: a customer with three months of history, and a read-only Viewer admin
npm run seed:demo -w apps/api -- --showcase

# Make yourself the Owner (sign up on the live site first, with your own email)
npm run admin:grant -- you@gmail.com "Site owner"

Remove-Item Env:DATABASE_URL
```

**macOS / Linux:** put `DATABASE_URL="…"` in front of each command instead.

The seed prints:
- **The demo customer:** `demo@purplewallet.demo`, password `Password123`, PIN `2580`. The login page offers these to visitors. To use different ones, set `DEMO_PASSWORD` / `DEMO_PIN` before seeding, and the matching `VITE_DEMO_*` values on Netlify.
- **The Viewer admin:** `viewer@purplewallet.demo` with a **random password, printed once**. A Viewer can see every visitor's name and email, though never their ID photos, so share this login **privately**, e.g. when walking a client through the admin console.

Demo accounts never receive email, and their password and PIN can't be changed or locked by visitors. **Re-run the seed any time to reset the demo** (and to get a new Viewer password). Earlier demo accounts are archived, never deleted, because the ledger keeps every money movement.

## 9. Smoke test

- [ ] `<API address>/health` shows the database and Redis as `ok`
- [ ] The web app loads, and refreshing `/settings` doesn't give a 404
- [ ] **Use the demo account** logs in, and the home page shows the demo transactions
- [ ] Send ₦500 from the demo account to `friend@purplewallet.demo` with PIN `2580`
- [ ] Sign up with your own email, and the verification email arrives (check spam the first time)
- [ ] Add money with a Paystack test card, and the wallet is credited
- [ ] As the Owner, open **Admin → Reconciliation**: it shows "The books balance."

---

## Good to know

- **Database size:** ID photos are stored, encrypted, in the database. They're cleaned to at most 2000px, roughly 100–300 KB per upgrade request. Photos from rejected requests are deleted after 30 days. 500 MB is plenty for a demo.
- **Redis connections:** the API opens about 20 of Redis Cloud's 30 free connections. A deploy briefly runs the old and new API side by side and can pass the limit for a minute; that's harmless.
- **Updating:** pushing to `main` redeploys the web app on Netlify. The API redeploys through CI once the tests pass, and new migrations run on start-up.
- **Render's free hours:** a free service kept awake all month uses about 730 of the workspace's 750 free hours, so keep this the **only** free web service in that Render workspace.
- **Secrets:** if a key or password ever leaks, change it on the host (and in Google, Supabase or Redis Cloud). The only exception is `KYC_ENCRYPTION_KEY`, which must stay the same while ID documents exist.
