# RepCount — Gym Payment Manager

RepCount is a mobile-first gym-owner workspace for membership plans, member records, fee cycles, payment receipts, renewals and collection follow-ups. The application is branded as **Powered by Alif Growth Media**.

## Backend migration status

This version removes the Apper SDK runtime and uses Supabase Auth, PostgreSQL, Storage, a server-side user-management function and a Supabase-backed query adapter.

**Active Supabase project:** `mnflpbdtfvksbxjdsvdf` (gym). On 2026-10-10, the missing six schema/security migrations were successfully applied, along with the one-time first-Admin bootstrap and reconciliation of constraints/internal helper privileges. The seven business tables now have 19 application RLS policies, and the `admin-users` and `secure-login` functions are deployed. An existing confirmed Auth account was assigned the first Admin role in a `RepCount Gym` workspace. Older-project data was **not** transferred. Vercel's production `VITE_SUPABASE_URL` and publishable key were verified to match this project. Live sign-in using the account's password still requires browser-level verification.

The old MemoryAdapter seed data and demo login seed are removed. Only `/login` is intended as a public sign-in page.

## Architecture

- **Frontend:** React + Vite; hosted on Vercel.
- **Identity:** Supabase Auth password sign-in; public self-sign-up is disabled in RepCount. Accounts created by an Admin are marked confirmed by a server-side function, so no Gmail verification link is required.
- **Database:** Supabase PostgreSQL with per-gym `gym_id` scopes, role rules and Row Level Security (RLS).
- **Roles:** Admin, Manager and Staff. Admin manages accounts and roles. Manager can manage membership operations. Staff can read gym records and record payments.
- **Payment consistency:** a PostgreSQL trigger recalculates fee-cycle paid amount, balance and status within the same transaction as payment inserts/updates/deletes.
- **User administration:** `supabase/functions/admin-users/index.ts` validates the caller's Supabase JWT and requires an active Admin role before creating confirmed accounts, assigning roles, listing accounts or deleting accounts. Privileged credentials remain server-side.
- **Login abuse controls:** `supabase/functions/secure-login/index.ts` checks a private database lock bucket before verifying credentials. Three failed attempts lock the account/network HMAC fingerprint for 24 hours. Rotating a browser ID or User-Agent does not reset this bucket. It stores only an HMAC fingerprint, never the email, password or raw IP address, and never logs credentials or returned tokens.

## First-time Supabase setup

Use the Supabase project intended for RepCount. Do not paste keys or passwords into this repository or into chat.

### 1. Apply the schema

Open the Supabase Dashboard → **SQL Editor** → **New query**. Run these migration files in order:

1. `supabase/migrations/202610100001_initial_schema.sql`
2. `supabase/migrations/202610100002_harden_function_privileges.sql`
3. `supabase/migrations/202610100003_move_tenant_helpers_private.sql`
4. `supabase/migrations/202610100004_fix_workspace_link_trigger.sql`

The initial schema creates the business tables, per-gym RLS policies, relationship checks, payment-reconciliation triggers and dashboard-summary RPC. The follow-up migrations harden function grants, keep tenant helpers outside the API-exposed `public` schema, fix relationship validation, add the private login lock table, add foreign-key indexes, and optimize row-level security policies. All six baseline migrations have been applied to the current `gym` project through Supabase's migration API. The idempotent reconciliation migration `20261010182500_reconcile_existing_table_security.sql` records additional hardening required because the tables predated the migration. On a **fresh** project, run the baseline migrations and reconciliation migration in order and verify them. Do not run the bootstrap again on the existing live workspace.

### 2. Create the first Admin (new installations only)

In Supabase Dashboard → **Authentication → Users → Add user**, create the first Admin login. Use a strong password and enable **Auto Confirm User** for this Admin. This account is the trusted initial administrator; do not use the old demo credentials.

Then open `supabase/bootstrap_admin.sql`, replace the two placeholder values (`REPLACE_WITH_FIRST_ADMIN_EMAIL` and `REPLACE_WITH_GYM_NAME`) with your Admin email and your gym/workspace name, and run that edited script in the SQL Editor **once only**. It creates the gym, user profile and Admin membership. Do not delete this account or run the bootstrap script twice.

### 3. Deploy the Admin user-management function (already active on the selected project)

Install the Supabase CLI and authenticate from a terminal:

```bash
npm install
npx supabase login
npx supabase link --project-ref mnflpbdtfvksbxjdsvdf
npx supabase functions deploy admin-users
npx supabase functions deploy secure-login
```

Supabase Edge Functions receive their project URL and privileged server environment from Supabase. Do not copy the service-role/secret key into a `VITE_*` variable, frontend source or GitHub. Keep the function's JWT verification enabled. The function additionally calls Supabase Auth to validate the signed-in user and checks their active Admin role.

### 4. Configure Supabase Auth

In Supabase Authentication settings, disable **Allow new users to sign up**. RepCount intentionally exposes only `/login`; create accounts and assign roles through the Admin-managed workflow. The `secure-login` function has gateway JWT verification disabled only because a user has no JWT before password sign-in; the function verifies the password through Supabase Auth and checks active workspace membership before returning tokens. Its CORS allow-list includes Vercel deployments and localhost for development. If using a custom domain, set the exact origin in the server-side `APP_ALLOWED_ORIGINS` Edge Function secret.

### 5. Set Vercel environment variables

In Vercel → RepCount → **Settings → Environment Variables**, set both variables for Production (and Preview if needed):

- `VITE_SUPABASE_URL` = `https://mnflpbdtfvksbxjdsvdf.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` = the Supabase project's current publishable key

Redeploy after saving these values. These are the only Supabase configuration values that belong in the browser bundle. **Never create a `VITE_SUPABASE_SERVICE_ROLE_KEY` or place a database connection string in a frontend variable.**

### 6. Test before merging to main

1. Sign in using the initial Supabase Admin created above.
2. Open Settings and create a second user with the Staff role.
3. Verify the second user can sign in without email verification.
4. Verify Staff can read members/plans/dues and create payments, but cannot open Settings, edit plans/members/dues, change roles or delete accounts.
5. Create a plan, member, due and payment. Refresh the browser and confirm the data persists.
6. Add multiple payments, edit/refund/delete a payment and confirm the fee-cycle balance follows the paid payment ledger.
7. Confirm a user in a different gym cannot access the first gym's rows, even by guessing record IDs.
8. Confirm the last active Admin and the currently signed-in account cannot be deleted/demoted through Settings.
9. In a staging project or with a disposable test account, verify three invalid sign-ins trigger a 24-hour lock. Do not intentionally lock the production Admin.

## Local development

Requirements: Node.js and npm.

1. Copy `.env.example` to `.env.local`.
2. Replace the placeholder publishable key using the Supabase dashboard.
3. Run `npm install`, then `npm run dev`.
4. Check production compilation with `npm run build`.

## Secrets and credential hygiene

- Real `.env`, `.env.local` and all other `.env.*` files are ignored by Git; only `.env.example` is committed.
- A publishable key is designed to be available to the browser, but RLS is still required.
- Secret/service-role keys and the database password stay server-side. Rotate the privileged keys and database password that were pasted into chat before deploying this migration, then use the new credentials only in the appropriate private Supabase configuration.
- Never commit login passwords, API secret keys, service-role keys or the database pooler connection string.

## Dashboard behaviour

The simplified home screen shows only three headline metrics: outstanding fees, collected today and members due today. Each card opens the matching filtered dues or payment page, and the dashboard includes a compact due-today member list.

## Migration notes

- The original Apper CDN script, MemoryAdapter and mock row-policy loader are removed from the migration branch.
- Account passwords are never stored in RepCount business tables.
- Business tables reference users only through Supabase Auth IDs and the private `gym_users` role mapping.
- Public signup and password-recovery pages are removed; user administration is server-side and role assignments are never accepted directly from the browser.
- Three failed sign-in attempts trigger a server-side 24-hour lock for the normalized account/network fingerprint. A browser identifier is not used as a security boundary. Local storage is only a usability aid; the database lock is the enforcement boundary. This complements Supabase's native rate limits. It does not revoke already-active sessions and cannot make the application invulnerable to every attack.

## Operational status and login troubleshooting (2026-10-10)

- Production application: https://e-repcount-gym-payment-manager-three.vercel.app/login
- Vercel production deployment is READY; Vercel Authentication is restricted to preview deployments. The website uses Supabase Auth for sign-in.
- Supabase project: `mnflpbdtfvksbxjdsvdf`. Both required Edge Functions are ACTIVE. Database checks show one gym, one active Admin membership, one profile, and 19 public-schema RLS policies.
- Onboarding: sign in using the existing confirmed Supabase Auth account and its original password. Do not share credentials or run the first-Admin bootstrap again. If the password is unknown, use Supabase Dashboard → Authentication → Users to initiate a secure reset for the authorized account.
- Security follow-up: enable Auth leaked-password protection in the Supabase dashboard. Verify public sign-ups are disabled and limit Vercel environment credentials to those required for this frontend-only project.
- Automated database role simulation confirmed the Admin sees its own workspace and the anonymous role sees no gym/profile/member rows. A real browser login, password reset, and cross-gym access test were not performed.
