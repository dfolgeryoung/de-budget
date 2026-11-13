# Deploying D&E Budget

One repo on GitHub → Vercel builds and hosts it on every push → Neon holds the database.
Nothing runs on cPanel except one DNS record.

## One-time setup (phase 0)

1. **GitHub**: this repo (`dfolgeryoung/de-budget`), private.
2. **Vercel**: *Add New Project* → import `de-budget`. Framework is detected as Vite; leave the defaults.
   Settings → Environment Variables (Production + Preview):
   | name | value |
   |---|---|
   | `DATABASE_URL` | Neon *pooled* connection string |
   | `AUTH_SECRET` | output of `openssl rand -base64 32` |
   | `AUTH_URL` | `https://budget.davidfolgeryoung.com` |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud (below) |
   | `ALLOWED_EMAILS` | the two Google addresses, comma separated |
   | `CRON_SECRET` | any long random string (Vercel sends it with cron calls) |
3. **Neon**: project `de-budget`, region US East. Copy the pooled connection string into Vercel.
   Run the migrations once from your machine: `DATABASE_URL=... npm run db:migrate`.
4. **Google Cloud**: project *DE Budget* → OAuth consent screen (External; add both of you as test users) →
   Credentials → OAuth client ID (Web application):
   - Authorised JavaScript origin: `https://budget.davidfolgeryoung.com`
   - Authorised redirect URI: `https://budget.davidfolgeryoung.com/api/auth/callback/google`
   (For Vercel preview deployments add the `*.vercel.app` URL the same way.)
5. **cPanel** → DNS Zone Editor → add `CNAME  budget  →  cname.vercel-dns.com`.
   Vercel → Project → Settings → Domains → add `budget.davidfolgeryoung.com`.
6. Open the site, sign in with Google on phone and desktop. On the iPhone: Share → *Add to Home Screen*.

## Every day after that

- Push to `main` → Vercel deploys in about a minute. Pull requests get a preview URL.
- Schema change → `npm run db:generate` (writes `drizzle/*.sql`), commit, then `npm run db:migrate` against Neon.
- The daily job is `/api/cron/daily`, scheduled in `vercel.json` (Hobby plan: once a day, within an hour of 07:00 UTC).

## Local work

```
cp .env.example .env     # fill in a Neon branch URL, Google creds, AUTH_URL=http://localhost:5173
npm install
npx vercel dev           # API on :3000 (needs `npm i -g vercel` once)
npm run dev              # Vite on :5173, proxies /api to :3000
npm test                 # budget engine tests
```

## Migrations run on deploy

`npm run build` on Vercel runs `drizzle-kit migrate` against `DATABASE_URL` before building the client,
so a schema change is live as soon as its deploy finishes. Locally use `npm run build:local`.

## Sheet mirror (phase 3)

1. Google Cloud console → create (or reuse) a project → **APIs & Services → Enable APIs**: enable *Google Sheets API* and *Google Drive API*.
2. **IAM & Admin → Service accounts → Create**: any name (e.g. `de-budget-mirror`), no roles needed. Open it → **Keys → Add key → JSON**; a key file downloads.
3. Share the budget spreadsheet (and the backup folder, if you want backups) with the service account's email (`…@….iam.gserviceaccount.com`) as **Editor**.
4. Base64 the key file in one line and put it in Vercel as `GOOGLE_SERVICE_ACCOUNT_B64`:
   `base64 -i key.json | tr -d '\n'` (macOS). Add `SHEET_ID` (from the sheet's URL) or paste the link under Settings › Sheet mirror. Optional: `BACKUP_FOLDER_ID`.
5. Redeploy. Settings › Sheet mirror shows "connected"; "Mirror to the sheet now" writes immediately; the daily cron (07:00 UTC) mirrors, picks up the Inbox and takes a backup.

The sheet's own script can stay on: before each rewrite the app reads the Ledger back and adopts any entries it doesn't have (matched on the sheet's own row encoding), so rows typed in the sheet, via AppSheet, or in the app all converge. An entry edited in both places keeps the app's version.

## Notifications (phase 5)

Push (web push, works on iPhone once the app is added to the home screen):
1. Generate a key pair once, on your Mac: `npx web-push generate-vapid-keys`.
2. In Vercel add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@example.com`). Redeploy.
3. Each person turns push on per device under Settings › Notifications ("Send a test" confirms it).

Email (optional, for the Monday summary): create a Resend account, verify a sending domain (or use their onboarding sender for tests), add `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `D&E Budget <budget@yourdomain.com>`), redeploy, then tick "Email me the Monday summary".
