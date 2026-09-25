# BFA Admin — finance & attendance dashboard

Internal administration app for Beirut Football Academy. It brings together:

- **Customer invoices and payments from Odoo** (`beirut-football-academy.odoo.com`)
- **Player and coach attendance from the BFA attendance app** (`app.bfa-lebanon.com`, source in `../teams.html`)

and links them player by player, so one search shows a player's team, invoices, payment status and attendance side by side.

## Features

| Area | What you get |
|---|---|
| Dashboard | Invoiced / paid / outstanding / unpaid / overdue KPIs, invoiced-vs-collected chart, payment-status breakdown, recent payments, player & coach attendance, weekly trend, attendance by branch and team, recent sessions, and "needs attention" lists (unpaid, low attendance, both). Period presets. |
| Players | Combined finance + attendance table with filters that all work together (search, branch, team, coach, payment status, attendance range, date range, invoiced / outstanding ranges, attendance status, linked / not linked), sorting and paging. Player profile with personal, team, financial and attendance details, invoices, monthly attendance and full history. |
| Coaches | Head coach and assistant attendance per coach, filterable by coach, branch, team and date range, with each coach's history. |
| Invoices | All customer invoices / credit notes with payment status, overdue days, linked players, totals for the filtered set. |
| Attendance | Sessions (with coach attendance and replacements), individual present/absent records, and rates by team and by branch. |
| Reports | 15 reports (financial, attendance, combined), each downloadable as **Excel** (formatted, filterable, with totals) or **PDF** (branded A4). Every list page also exports its current filters. |
| Unmatched records | Review suggested matches, link players and Odoo customers manually, see and undo existing links. |
| Sync | "Sync now" button, automatic sync on a configurable interval, sync logs with per-run counts (processed / added / updated / skipped / deleted / errors) and the error details. |
| Settings | Sync frequency, low-attendance threshold, matching rules, connection tests, full resync, password change, user management (administrator / viewer). |

## Architecture

- **Next.js 16** (App Router, server components, server actions) + **TypeScript**
- **PostgreSQL** via **Drizzle ORM** (SQL migrations in `drizzle/`)
- **Tailwind CSS v4** with BFA navy/red branding, light and dark mode, responsive layout
- **Recharts** (charts), **ExcelJS** (Excel), **jsPDF + autotable** (PDF)
- Integrations and the sync engine are plain server-side TypeScript in `src/lib/`, shared by the web app, the CLI scripts and the tests.

```
src/
  app/                  pages (app)/…, login, API routes (sync, cron, search, reports, health), server actions
  components/           UI kit, app shell (sidebar, search, Sync now), charts, filter bar
  lib/
    db/                 schema.ts (all tables + indexes), connection, change-aware upsert
    auth/               bcrypt passwords, DB sessions (hashed tokens), guards
    integrations/odoo/  external API client (JSON-RPC + JSON-2) and invoice/payment/customer sync
    integrations/bfa/   Firebase REST client (service-account auth) and attendance sync
    matching/           normalisation, similarity, matching engine, manual decisions
    sync/               runner (advisory lock, logs), scheduler, reporter
    queries/            SQL for pages and reports
    reports/            report catalogue, Excel and PDF renderers
scripts/                migrate, create-user, run-sync
tests/                  unit + integration tests (Vitest, real PostgreSQL), e2e tests (Playwright)
```

### Database

`branches`, `teams`, `coaches`, `team_coaches`, `players`, `attendance_sessions` (team × date), `attendance_records` (player × session), `coach_attendance_records` (session × role), `odoo_customers`, `invoices`, `payments`, `payment_invoices`, `record_links` (player ↔ Odoo customer, with status confirmed / suggested / rejected), `sync_runs`, `sync_errors`, `app_settings`, `users`, `sessions`.

External IDs are unique-indexed so re-syncing never creates duplicates. Records removed from a source system are **soft-deleted** (`deleted_at`) rather than erased, so history and links survive and reappearing records are restored. One Odoo customer (e.g. a parent) can be linked to several players (siblings); organisation-wide totals are always computed from the invoices themselves, so shared accounts are never double-counted.

## Integration findings

### Odoo

- Odoo Online at `https://beirut-football-academy.odoo.com`, database `beirut-football-academy` (Odoo Online names the database after the sub-domain).
- **API:** Odoo's official external API. The client auto-detects the version: it uses `/jsonrpc` (supported up to Odoo 19) and falls back to the **JSON-2 API** (`/json/2/<model>/<method>`, Odoo 19+, which replaces XML-RPC/JSON-RPC). The detected version is shown in Settings.
- **Authentication:** login + **API key** (Settings → Users → Account Security → New API Key). Use a dedicated user with read access to Accounting.
- **Data read:** `account.move` with `move_type` in (`out_invoice`, `out_refund`): `name`, `state`, `payment_state`, `invoice_date`, `invoice_date_due`, `amount_total/_residual/_untaxed`, `amount_*_signed`, `currency_id`, `partner_id`, `ref`, `invoice_origin`, `write_date`. `account.payment` (customer, inbound): `date`, `amount`, `state`, `reconciled_invoice_ids`, `memo`/`ref`. `res.partner`: `name`, `email`, `phone`, `mobile` (if present), `ref`, `parent_id`, `is_company`, `active`. Fields are checked with `fields_get`, so differences between Odoo versions are handled.
- **Incremental:** changes are read by `write_date` (with a 10-minute overlap); every invoice that is still open is re-read on every sync so payment status can never go stale; deletions are detected by comparing IDs.

### BFA attendance app

- The attendance app in this repository (`teams.html`) is a static single-page app. It has **no API or server of its own**: the browser reads and writes a **Firebase Realtime Database** (`bfa-sc-tracker`) under the root `bfaTeamsState`.
- The safest, supported integration is therefore the **Firebase Realtime Database REST API**, read-only, authenticated with a **Google service account** (OAuth2 JWT → access token). No scraping, no browser automation, nothing written back.
- Data used: `branches`, `teams` (`branchId`, `name`, `coach`, `assistant`), `players` (`branchId`, `teamId`, `name`), `attendance/<date>/<playerId> = present|absent`, `staffAttendance/<date>/<teamId>/{coach,assistant} = {status, replacement}`. The `auth` node (which holds the app's PIN codes) is **never** requested.
- A training session is a team on a date. Coaches are stored in the app as names on each team, so a coach is identified by their normalised name. Team categories (U8, U14…) are derived from team names.
- **Limitations of the source data:** the app does not store team history, so attendance is attributed to a player's *current* team; it records no player e-mail/phone (the dashboard reads them automatically if they are ever added as `email` / `phone` / `parentPhone`); coach attendance records who was assigned to the team at the time of the first sync of that session.

### Matching players to Odoo customers

In priority order: (1) player ID in the Odoo contact's Reference field (`ODOO_PLAYER_ID_FIELD`), (2) e-mail, (3) phone (Lebanese formats normalised), (4) identical name that is unique in both systems (can be disabled in Settings), (5) similar name — order-independent, accent-insensitive, typo-tolerant, and every part of the name must match. Only 1–4 are linked automatically, and only when unambiguous; everything else goes to **Unmatched records** for an administrator. Manual links and rejections are never overwritten by later syncs.

**Tip:** the most reliable way to get automatic matches is to put each player's BFA player ID (shown on the player's profile) into the *Reference* field of the paying contact in Odoo.

## Setup

Requirements: Node.js 20.12+ and PostgreSQL 14+.

```bash
cd dashboard
npm ci
cp .env.example .env          # then fill in the values (see below)
npm run db:migrate            # create the tables
npm run user:create -- --email you@bfa-lebanon.com --name "Your Name"   # prompts for a password
npm run build && npm start    # production (or: npm run dev)
```

Open the app, sign in, and press **Sync now**.

### Information needed to switch the integrations on

| Integration | What to provide (in `.env` / your host's secret store) |
|---|---|
| Odoo | `ODOO_URL`, `ODOO_DB`, `ODOO_LOGIN`, `ODOO_API_KEY` (API key of a user with read access to invoices, payments and contacts). |
| Attendance app | `BFA_FIREBASE_DATABASE_URL` and a service-account key in `BFA_FIREBASE_SERVICE_ACCOUNT_JSON` (Firebase console → Project settings → Service accounts → Generate new private key, project `bfa-sc-tracker`). Confirm `BFA_FIREBASE_ROOT_PATH` (`bfaTeamsState` for `teams.html`). |
| Hosting | A PostgreSQL database (`DATABASE_URL`), and HTTPS in production. |

The server must be allowed to reach `*.odoo.com`, `*.firebasedatabase.app` and `oauth2.googleapis.com`. Use **Settings → Test connection** to verify each integration.

### Synchronisation schedule

- Built-in scheduler: runs every *N* minutes (Settings → Automatic synchronisation; default `SYNC_INTERVAL_MINUTES`).
- External scheduler (serverless hosting): set `SYNC_SCHEDULER_ENABLED=false` and `CRON_SECRET`, then call
  `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/sync`.
- Command line: `npm run sync` (`--only odoo|bfa`, `--full`).

A PostgreSQL advisory lock ensures only one sync runs at a time, whichever way it was started.

## Free hosting (Vercel + Supabase)

- **Database:** Supabase project `bfa-admin` (free plan, Frankfurt). Tables are created, row-level security is on, Supabase's public REST API has no access, and the app connects as its own role `bfa_app` through the session pooler.
- **App:** Vercel Hobby (free). Import this repository at vercel.com/new, set **Root Directory** to `dashboard`, and add the environment variables below. Vercel runs `npm run vercel-build`, which applies any new database migrations and builds the app. Pushes to `main` redeploy automatically.
- **Automatic sync:** `.github/workflows/dashboard-sync.yml` calls `/api/cron/sync` every hour (free GitHub Actions). Add the repository secrets `DASHBOARD_URL` and `CRON_SECRET`.

Vercel environment variables:

| Name | Value |
|---|---|
| `DATABASE_URL` | `postgresql://bfa_app.<project-ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres` (session pooler; if the logs say the tenant is not found, use `aws-0-…` instead) |
| `DATABASE_SSL` | `no-verify` |
| `SYNC_SCHEDULER_ENABLED` | `false` |
| `CRON_SECRET` | a long random value (same as the GitHub secret) |
| `COOKIE_SECURE` | `true` |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` / `INITIAL_ADMIN_NAME` | your first administrator account (created on first start) |
| `ODOO_*`, `BFA_FIREBASE_*` | as in `.env.example` |

Check `https://<your-app>/api/health`: it returns `{"status":"ok"}` when the app can reach the database.

## Security

- Passwords hashed with bcrypt (cost 12); password policy; account lock after 5 failed sign-ins; per-IP rate limit.
- Server-side sessions: random 256-bit token in an `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookie; only its SHA-256 hash is stored. Password change signs out other devices.
- Every page, server action and API route verifies the session against the database; `proxy.ts` additionally blocks requests without a session cookie. Administrator-only actions (sync, linking, settings, users) are enforced on the server.
- CSRF: server actions check the origin (built into Next.js); state-changing API routes verify `Origin` matches the host; cookies are `SameSite=Lax`.
- All input validated with zod; all SQL parameterised (sort columns come from allow-lists).
- Strict security headers (CSP, `frame-ancestors 'none'`, `nosniff`, HSTS in production). No third-party scripts or fonts in the browser.
- Odoo and Firebase credentials exist only in server environment variables; the UI shows whether they are set, never their values. Errors shown to users are sanitised; details go to the server log and the sync log.

## Tests

```bash
npm test               # unit + integration tests against PostgreSQL (TEST_DATABASE_URL, default postgres://bfa:bfa_dev_pw@localhost:5432/bfa_test)
npm run test:e2e       # end-to-end browser tests (E2E_DATABASE_URL, default …/bfa_e2e); set PLAYWRIGHT_CHROMIUM_PATH if needed
npm run lint && npm run typecheck
```

The integration tests drive the real sync code with a simulated Odoo server (JSON-RPC) and data shaped exactly like the attendance app's Firebase data, then check imports, idempotency, updates, deletions, error handling (bad credentials, timeouts, unreachable server, missing permissions) and matching.
