# Alif Growth Media — RepCount gym deployment playbook

**Goal:** one gym owner's GitHub fork → one brand-new Supabase project → one Vercel website. Each client owns their logins, data and ongoing billing. Alif Growth Media may be added as a collaborator, but should never ask for or hold a customer's Gmail/other passwords.

## Before you begin

Make sure the gym owner has GitHub, Supabase and Vercel accounts they control. Use a laptop with Node.js 22+ and npm. Fork this repository in their GitHub account, clone their fork, and create a new *empty* Supabase project. You need only its 20-character project reference (Settings → General).

## Step 1 — Generate the gym's database and configuration

From the fork, run **npm run setup:gym** and answer the prompts for gym name, confirmed owner email and Supabase project reference. A folder named **.repcount-setup** appears on your computer; Git ignores this folder.

The wizard prepares four files:

1. **01_create_database.sql** — all 11 production migrations in order (tables, tenant RLS, security constraints, renewal ledger, indexes, server-side pagination and authentication lockouts).
2. **02_create_first_admin.sql** — safely links the owner's future Supabase Auth user to a new gym as Admin.
3. **03_vercel_environment.txt** — public frontend URL, publishable key placeholder and required demo toggle.
4. **04_setup_checklist.md** — exact instructions customized for the gym.

Never commit the generated folder or email/password lists to GitHub.

## Step 2 — Create the database and owner account

Open the NEW Supabase project → SQL Editor → New query. Paste and execute the entire **01_create_database.sql** file. Do not run it against an existing gym database. Then open Authentication → Users → Add User, enter the owner's real email and a private, strong password, and enable Auto Confirm User. Confirm that the Auth account exists. Then paste and execute **02_create_first_admin.sql**. It refuses to add a second gym or use an unconfirmed Auth account.

Only two SQL Editor runs are needed. The real Admin's password is not in SQL or GitHub.

## Step 3 — Deploy the two required Supabase endpoints

From the fork's terminal, run these commands in order:

1. **npx supabase login**
2. **npx supabase link --project-ref YOUR_PROJECT_REF**
3. **npx supabase functions deploy admin-users**
4. **npx supabase functions deploy secure-login**

The first endpoint manages staff (requires a logged-in Admin). The second verifies credentials before login and enforces account/network rate limits. Its gateway JWT verification is deliberately disabled because it must accept requests *before* a user has a token; the function performs its own authentication checks. Both functions require a working Supabase project and standard Supabase-managed function secrets. Never put a service-role key in Vite or Vercel frontend variables.

Disable public self-signup in Supabase Authentication → Providers → Email, and enable leaked-password protection if available.

## Step 4 — Import the fork into Vercel

Vercel → Add New → Project → Import the owner's fork. Framework: **Vite**, root: **./**, build: **npm run build**, output: **dist**.

Before Deploy, set these Production environment variables from **03_vercel_environment.txt**:

| Name | Value |
|---|---|
| VITE_SUPABASE_URL | This gym's own Supabase project URL |
| VITE_SUPABASE_PUBLISHABLE_KEY | This gym's publishable key, from Supabase API Keys |
| VITE_REPCOUNT_DEMO_MODE | false |

The customer production site must not use demo mode. The public demo password has zero relevance to a real Supabase Auth account. NEVER enter service-role keys, DB passwords, personal access tokens or SMTP secrets as VITE_ variables.

Deploy, then open Supabase Auth → URL Configuration. Set Site URL to the real production website and allowlist **https://YOUR-DEPLOYED-DOMAIN/reset-password** for password recovery. Vercel variable edits require a redeployment.

For a custom domain (not the default Vercel domain), configure the Supabase Edge Function secret **APP_ALLOWED_ORIGINS=https://yourgym.example.com**, and update the Auth Site URL and redirects.

## Step 5 — Validate before customer handover

Create a local **.env.local** based on .env.example with the same public variables. Run **npm run setup:check** or **npm run setup:check -- --remote** to check variable format and optional connectivity. Checks cannot prove that an Admin password works; sign in as the real owner to verify that.

Acceptance checklist:

- [ ] Admin can sign in using their real Supabase Auth credentials.
- [ ] Admin can create one membership plan and a member with an upfront payment.
- [ ] Next renewal date and manual WhatsApp reminder are correct.
- [ ] Payment appears in Payments; reloading does not lose data.
- [ ] Admin can create Staff; Staff can sign in but cannot manage Admin roles.
- [ ] Forgot password redirects back to the gym website.
- [ ] No fake demo records appear in the production database.
- [ ] Delete temporary records before handing over the system.

## Troubleshooting

**Credentials work, but account has no workspace:** you did not run the Admin bootstrap, used a different email, or configured a different Supabase project. Check the exact project and confirmed email; do not promote an unverified account.

**Missing or failing secure-login endpoint:** deploy both Edge Functions and ensure the selected Supabase project matches the Vercel URL and publishable key. Avoid repeated wrong-password attempts; the server may lock the account/network temporarily.

**App shows fictional demo data:** the VITE_REPCOUNT_DEMO_MODE flag was set to true, or a previous deployment compiled with that value. Set false and redeploy.

**Forgot password does not work:** ensure the deployed reset-password URL is on Supabase's Auth redirect allowlist and the owner controls their email. Email provider limits may apply.

**Adding new migrations later:** Using the SQL Editor installer does **not** create CLI migration-history entries. Apply future migrations through the SQL Editor in order, or deliberately reconcile migration history before switching to the CLI. On NEW empty installations you may use **npx supabase db push** instead of SQL file 01 to maintain the CLI migration ledger from day one.

**Is 10,000+ members enough?** Server-side search and pagination, renewal indexes and controlled database writes have been tested with rolled-back synthetic 10,000-member and 10,000-payment datasets. Response times, concurrent users, backups and plan limits must still be checked in real production conditions. See [scalability guide](scaling-10000-members.md).

## Owner handover

Give the client their Vercel website, GitHub fork, Supabase project, training for Members → Renewals → Payments → Settings, and their own account recovery instructions. The client must own all three services; Alif Growth Media should request collaborator permissions only when needed. Keep customer records and private credentials out of the demo and GitHub.
