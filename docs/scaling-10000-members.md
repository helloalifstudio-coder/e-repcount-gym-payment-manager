# RepCount — 10,000+ membership scaling

## Design goal
A gym with 10,000 or more member records must be able to navigate the directory, search names/phone numbers, see expiry counts, record upfront renewals, view historical receipts and use member selectors without downloading its entire membership directory.

## Bounded APIs and indexes
Migration `20261011120000_indexed_bounded_directory_api.sql` plus `20261011121500_fix_search_escaping.sql` add:

- Indexed `(gym_id, due_date_c, id)` member expiries, `(gym_id, phone_c)`, trigram-based name/phone searches, indexed payment date sort and member/plan/creator foreign keys.
- RLS-invoker `repcount_members_page(p_search,p_state,p_page,p_page_size,p_today)`, returning only 25 rows by default (maximum 100), **total matching rows**, and gym-specific renewal metrics.
- RLS-invoker `repcount_ledger_page(p_kind,p_search,p_status,p_period,p_page,p_page_size,p_today)`, supporting payments and exceptional fee cycles with server filtering, stable order and page size caps.
- Search wildcards (% and _) and backslashes are escaped as literal text; searches are case-insensitive. Every database row is filtered by the user's active gym and ordinary RLS.
- Anonymous roles cannot call these RPCs. No service-role key is used in browsers.

## Frontend
- **Home:** two small expiring/soon queries for 8 actionable reminders; counters computed in SQL (not 10k-row downloads).
- **Members:** 25-record pages, 250-ms debounced search, SQL state filters and correct global match totals.
- **Renewals:** 25-record pages, prefilled manual WhatsApp reminders and server-generated summary counts; payment recording uses existing transaction-safe renewal RPC.
- **Payments and Dues:** 25-record server-filtered pages. Searching a member no longer downloads the first 1000 member IDs.
- **Create payment / exceptional due:** shared `MemberPicker` with server-search for any member beyond the first 100. Due cycles are fetched only after a member is selected.
- **Member details:** at most 25 payment and due history rows per request, independently paginated.
- **Browser demo:** caches its seeded data in memory instead of repeatedly JSON-parsing localStorage; indexes ledger member lookups with a Map for performant demonstrations. Demo still uses browser-local fictional data, **not a 10k-user shared production database**.

## Verification
1. A synthetic 10,000-member insert within a **single BEGIN ... ROLLBACK** transaction was run under the actual Admin's `authenticated` role on Supabase project `mnflpbdtfvksbxjdsvdf`.
2. Database checks passed: page 1 contains 25 of 10,000, page 400 contains 25 of 10,000, exact literal search for member 09999 works, soon-filter pages are limited to 25, and ledger pages return at most 25.
3. Rollback confirmed that **zero** synthetic members remained in the database.
4. A second rolled-back Supabase transaction inserted 10,000 fictional payment receipts linked to 10,000 fictional members. The payments endpoint returned 25 receipts from the first and 400th pages, and a literal receipt-name search near record 9,999 found the expected payment. After rollback, zero test members and zero test payments remained.
5. A 10,000-member browser-local adapter harness passed first/last pages, member 9,999 lookup, and paged receipt retrieval. This is a functional benchmark, not evidence of production p95 latencies under concurrent users.
6. Supabase performance adviser was rerun and no longer reported the renewal table's three unindexed foreign keys. Existing unused-index INFO findings should be reassessed when there is representative production traffic.

## Operational limitations and next steps
These changes remove the **known full-fetch and 100/1000-member correctness limits**; they do not provide a guarantee of zero latency/errors on every browser or internet connection. For a real launch, benchmark with the expected number of **concurrent staff**, representative receipts/member, and phone/search distributions; track p95/p99 endpoint durations, Postgres CPU/IO, connection saturation, Supabase/PostgREST limits, browser errors and Vercel deployment health. Upgrade the Supabase compute and connection pool when observed resource usage requires it.

Offset pagination at 10k is practical; for several hundred thousand records or rapid concurrent inserts, consider keyset/cursor pagination with stable indexes. Avoid increasing Supabase global max-row response above 1000 as a workaround. Do not expose service-role credentials to clients. Payment and member mutations must continue under RLS and transaction-safe RPCs.

Use `node --test tests/*.test.mjs` for deterministic business-logic and synthetic demo-scale tests. The Vercel preview build is a compilation check, not a full interactive checkout or independent load test.
