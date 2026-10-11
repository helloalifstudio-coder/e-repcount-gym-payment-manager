# RepCount — Gym Membership & Renewal Manager

**Fork once per gym. Give every gym its own Supabase database, first Admin account and Vercel website.** Developed by Alif Growth Media.

RepCount tracks members, prepaid memberships, next billing dates, manual WhatsApp renewal reminders, receipt/payment history, and exceptional unpaid balances. React/Vite frontend, Supabase Auth + PostgreSQL (RLS), two Supabase Edge Functions, Vercel hosting.

## Start a new gym — 15–30 minute assisted setup

**You need:** the gym owner's GitHub, Supabase and Vercel accounts (created/controlled by the owner), Node.js/npm on your computer, and a new Supabase project. **No API secrets or passwords should be sent over chat or committed to GitHub.**

1. In the owner's GitHub account, **Fork** this repo. Open a terminal in the owner's fork after cloning it.
2. Create a new Supabase project in the owner's account. Note its **20-character project reference** from Project Settings → General.
3. Run the interactive installer:
   ```bash
   npm run setup:gym
   ```
   Type the gym name, owner's Admin email, and new Supabase project reference. The command generates four files in your local gitignored `.repcount-setup/` folder:
   - `01_create_database.sql` — **all 11** ordered, optimized schema/security migrations in one SQL Editor paste.
   - `02_create_first_admin.sql` — unique gym name and Admin assignment with no password inside.
   - `03_vercel_environment.txt` — exactly the three Vite variables to add in Vercel.
   - `04_setup_checklist.md` — an installation checklist specific to that gym.
4. Supabase **SQL Editor** → New query → paste/run `01_create_database.sql` on a **new empty Supabase project**.
5. Supabase **Authentication → Users → Add user** → create and *auto-confirm* the owner's email using a **new private strong password**. Then paste/run `02_create_first_admin.sql` in the SQL Editor **once**.
6. Deploy the required functions from the owner's fork:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_GYM_PROJECT_REF
   npx supabase functions deploy admin-users
   npx supabase functions deploy secure-login
   ```
7. Supabase **Authentication → Providers → Email**: disable public signups. **Authentication → URL Configuration**: after obtaining the Vercel production domain, set Site URL and allowlist `https://YOUR-DOMAIN/reset-password`. In Auth security settings, enable leaked-password protection if available. If using a custom domain, configure the Edge Function secret `APP_ALLOWED_ORIGINS` with its exact `https://` origin.
8. Vercel → **Add New → Project** → import this **owner's fork** as a Vite app. Under **Environment Variables → Production**, enter the values from `03_vercel_environment.txt`: your gym's **URL**, **publishable key** from Supabase Settings → API Keys, and `VITE_REPCOUNT_DEMO_MODE=false`. Deploy/redeploy.
9. From your terminal, create `.env.local` based on `.env.example` and enter the same values; run `npm run setup:check` or `npm run setup:check -- --remote` to verify local configuration and optional endpoint reachability. Then sign in using the owner-created Auth account and test a new plan, member, upfront renewal and Staff role.

**No local wizard?** The same optimized 11-migration SQL is also committed as [supabase/install.sql](supabase/install.sql), ready to paste into a **new empty** Supabase project. After creating the confirmed Auth user, open [supabase/bootstrap_admin.sql](supabase/bootstrap_admin.sql), replace its TWO placeholders (email and gym name), and run it once. The wizard is safer because it fills and SQL-escapes those details automatically.

**That's it.** No editing SQL by hand; the setup wizard creates the customized Admin script and concatenates the real indexed production migrations for you. An Admin password is never hardcoded or stored in the repository.

For screenshots, troubleshooting, aftercare and full safeguards: **[Gym setup guide](docs/GYM_SETUP.md)**.

**Already running a gym with thousands of members?** Do not reenter everyone manually. Use the private, offline CSV history importer described in [Import existing gym records](docs/HISTORY_IMPORT.md). Fill the five [empty CSV templates](templates/history-import), then run:

```bash
npm run import:prepare -- --source ./private-gym-csv --gym "Gym Name" --admin-email owner@example.com
```

The command validates records and generates owner-scoped SQL in a gitignored folder. It does not change Supabase until you review and run it. Never commit customer data or keys.

## What to configure for each client

| Item | Where | Belongs in frontend? |
|---|---|---|
| Supabase project URL | Supabase → Settings → API | Yes: `VITE_SUPABASE_URL` |
| Supabase publishable key (`sb_publishable_...`) | Supabase → Settings → API Keys | Yes: `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Demo toggle | Vercel | Yes: `VITE_REPCOUNT_DEMO_MODE=false` |
| Service-role / secret API key | Supabase Edge Functions managed server-side | **NO** |
| DB password / API access tokens / owner's Auth password | Account owner's password manager | **NO** |

**Important:** On the original Alif Growth Media showcase deployment, demo mode is enabled. On every client's production project, use `VITE_REPCOUNT_DEMO_MODE=false`. A public demo password is never a real gym Admin password.

## Advanced: use the Supabase CLI migration ledger instead

For developers managing many future schema updates, run `npx supabase link --project-ref <ref>` and `npx supabase db push` on a **new empty project** *instead of running the generated combined SQL*. This writes migrations to the CLI migration ledger; use the same generated `02_create_first_admin.sql` afterwards. Do not mix the one-paste SQL Editor initialization with a blind `db push` later—the former does not populate the CLI's migration history.

The local `supabase/config.toml` has a generic **local** project name; `supabase link --project-ref` chooses the real remote gym project.

## Useful commands

```bash
npm install
npm run setup:gym            # interactive gym installer
npm run setup:check          # validate frontend env configuration
npm run setup:check -- --remote  # also check API / Edge Function reachability
npm run dev                  # local development
npm test                     # demo, business logic and installation tests
npm run build                # production compilation
```

## Technical architecture and security

- Every gym's database is separate. Inside each DB, Postgres policies additionally scope records by the signed-in Admin/Manager/Staff's active gym membership.
- The SQL bundle contains the tables, constraints, fee reconciliation triggers, indexes for 10,000+ members and membership renewals, and RLS-invoker paginated member/ledger RPCs.
- `admin-users` checks the logged-in caller is a real Admin before provisioning users. `secure-login` checks Auth credentials and the server-side login rate limit. Deploy **both** functions; login cannot work without `secure-login`.
- Public self-signup is disabled. Set up the first Admin through Supabase Auth and the generated bootstrap file.
- Vite embeds `VITE_*` values in the compiled JavaScript. **Do not put service-role keys, tokens, database URLs with credentials or passwords into `VITE_*` variables.**
- Reminders open a **manual** prefilled WhatsApp message; they are not automatically delivered.
- Supabase handles live records. The optional standalone showcase uses entirely fictional, browser-local sample data; those records do not persist in Supabase.

For deeper performance work see [10,000+ member scaling notes](docs/scaling-10000-members.md). Tests verify pagination and search with 10,000 synthetic members and receipts under rolled-back transactions, but do not guarantee zero latency in every production environment.

**Ownership:** Ask the gym owner to create their own accounts and invite Alif Growth Media as a collaborator. Do not collect or retain the owner's Gmail/GitHub/Supabase/Vercel passwords.
