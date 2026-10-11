# Import Existing Gym Members and Payment History

An Alif Growth Media-assisted, **offline** migration. Obtain the gym owner's explicit authorization to migrate member names, phone numbers, subscriptions and payment records. Back up the source spreadsheet and destination database. **Never upload client CSV files or generated SQL to GitHub.**

## Step 1 - Prepare CSV files

Copy the five empty header-only templates in [templates/history-import](../templates/history-import) to a private local folder. Use unique, stable external IDs from the original system, not generated Supabase UUIDs. All cross-file references must match the original ID.

1. **plans.csv** - id, name, duration, price, active, description
2. **members.csv** - id, name, phone, email, plan_id, joined_on, next_renewal_on, status, notes. This file is required.
3. **dues.csv** - id, name, member_id, plan_id, due_on, amount, period_start, period_end, notes. OPTIONAL; only for real pay-later dues.
4. **payments.csv** - id, receipt, member_id, due_id, amount, paid_on, method, status, notes. OPTIONAL; prepaid receipts have a blank due_id.
5. **renewals.csv** - id, member_id, plan_id, payment_id, started_on, next_renewal_on. OPTIONAL; only for periods backed by a real Paid receipt.

Use dates in YYYY-MM-DD format; rupee amounts as numbers without currency symbols. Plan durations are between 1 and 36 months (e.g. 1 month / 3 months). Payment methods: UPI, Cash, Card, Bank transfer. Member statuses: Active, Inactive, Due soon, Overdue. Payment statuses: Paid, Pending, Refunded.

**No fabricated history:** Import the actual next billing date from the verified owner records. Historic payment receipts alone never extend the billing date; that field is stored separately in members.csv. If an old system didn't record exact past renewal periods, leave renewals.csv empty. A member due to renew is not automatically an unpaid debtor.

## Step 2 - Validate and generate SQL without credentials

From the fork's terminal, execute:

    npm run import:prepare -- --source ./private-gym-csv --gym "Actual Gym Name" --admin-email owner@example.com

The offline validator checks ID uniqueness, referenced plans/members/payments, calendar dates, amounts, malformed CSV, duplicate receipts and inconsistent renewal periods. The command does NOT contact Supabase or mutate any records.

Output is written to the gitignored .repcount-setup/import/ folder:

- 00_READ_ME_FIRST.txt - record counts and instructions
- 01_plans.sql
- 02_members.sql
- 03_dues.sql, 04_payments.sql, 05_renewals.sql when provided

Each generated file contains the exact gym name and Admin-email check, inserts in chunks of 250 records, uses stable deterministic IDs to allow safe reruns of unchanged files, and commits as one transaction. Existing IDs are skipped rather than overwritten. Historical corrections require a separate reviewed procedure.

## Step 3 - Apply and reconcile

1. Check record totals and sample source rows before executing any SQL.
2. Verify that the Vercel gym project is connected to the same newly configured Supabase database, and that the first Admin account already exists.
3. Open the gym's Supabase SQL Editor; run the numbered import SQL files in order.
4. For 10,000+ records or longer imports, use a verified psql connection to the owner's Supabase Postgres endpoint rather than relying on the Dashboard SQL Editor timeout. Run each file with the psql ON_ERROR_STOP=1 option. Keep Postgres credentials private, not in GitHub, shell history, or a browser VITE_ variable.
5. Count imported rows and reconcile a sample of receipts, member membership plans, next billing dates, and historic unpaid exceptions with the legacy register.
6. Open the real gym RepCount site (DEMO_MODE=false), inspect Members, Renewals and Payments, and confirm the owner can find records across multiple pages.

SQL guards abort on the wrong gym, missing active Admin or multiple gyms in one Supabase project. File-level transactions mean one failed file rolls back itself, though earlier completed import files remain. Stable IDs avoid duplicating unchanged rows on retry. Database constraints and balance triggers remain active.

## Privacy and limitations

Treat all raw CSV and generated SQL as confidential member and financial records. Use owner-authorized encrypted storage, restrict access, delete temporary files after agreed retention, and keep an owner-approved reconciliation log. This tool **prepares** imports; it does not connect to or select the owner's Supabase project automatically, compute historical renewal dates, run automatic WhatsApp reminders or audit imported receipts. Complex old refunds or inconsistent records may need manual accounting review.

The importer is tested with 10,000 synthetic member rows, but a real customer migration still requires a backup, human validation and a complete live acceptance test.

Related: [gym deployment checklist](GYM_SETUP.md) and [scaling guide](scaling-10000-members.md).
