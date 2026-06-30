# BP Recruit Scanner (Phase 2)

Local Node.js worker that listens for new Blazing Pedals driver application lookup jobs via Supabase Realtime. When a job is queued, the scanner opens the applicant's iRacing profile page in a persistent Playwright browser and confirms whether the page is accessible.

Phase 2 does **not** extract or store iRacing stats yet. It only verifies page access.

## Purpose

```
Website → Supabase → driver_applications
                          ↓ SQL trigger
                    iracing_lookup_jobs
                          ↓ Realtime
                    Local Recruit Scanner
                          ↓ Playwright
                    iRacing profile page
                          ↓
                    Updates Supabase
```

## Required environment variables

Create a `.env` file in this folder (copy from `env.example`):

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only; never commit) |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `HEADLESS` | `false` | Set to `true` to hide the browser window |
| `JOB_DELAY_MS` | `3000` | Delay between consecutive jobs |

Credentials stay in `.env` only. The scanner never stores iRacing usernames, passwords, cookies, or browser storage in code or logs.

## Install

```bash
cd tools/recruit-scanner
npm install
```

`npm install` runs `playwright install chromium` automatically.

If browser binaries are missing later, run:

```bash
npx playwright install chromium
```

## Run

```bash
npm start
```

Development mode (auto-restart on file changes):

```bash
npm run dev
```

### First run

1. The scanner opens a **headed** Chromium window using a persistent profile in `browser-profile/`.
2. If iRacing shows a login page, log in manually in that browser window.
3. The scanner stores the session in `browser-profile/` for future runs.
4. Future runs should reuse that session without logging in again.

If a job hits the login page, the scanner sets status to `needs_login`, logs a message, and keeps running. Log in manually, reset the job to `queued`, and rerun the scanner.

Expected startup output:

```
Browser started (headed — log into iRacing manually if prompted)
Connected to Supabase
Listening for lookup jobs...
```

When a job succeeds:

```
-----------------------------------
New Lookup Job
Application: <uuid>
Customer ID: <id>
-----------------------------------
New job received
Job processing
Opening iRacing profile page...
Job complete
```

When login is required:

```
Please log into iRacing in the opened browser, then rerun scanner.
Job paused: needs_login
```

## Database setup (manual)

Run these in the Supabase SQL editor if not already applied:

1. `supabase/iracing_lookup_jobs.sql` — creates the queue table and trigger
2. `supabase/iracing_lookup_jobs_status_migration.sql` — adds Phase 2 status values

Allowed job statuses:

- `queued`
- `processing`
- `completed`
- `failed`
- `needs_login`

## Testing with a queued job

1. Apply both SQL migrations in Supabase.
2. Create `.env` with Supabase credentials.
3. Start the scanner: `npm start`
4. Log into iRacing in the opened browser if prompted.
5. Insert a test application in Supabase SQL editor:

```sql
insert into driver_applications (
  iracing_display_name,
  iracing_customer_id,
  age_confirmed
) values (
  'Test Driver',
  '123456',
  true
);
```

6. Confirm the flow:

- Trigger creates `iracing_lookup_jobs` with `status = 'queued'`
- Scanner receives the Realtime event
- Browser opens `https://members-ng.iracing.com/web/racing/home/dashboard?cust_id=123456&tab=licenses`
- Job updates to `processing`, then either:
  - `completed` with note: `Profile page loaded successfully. Scraping not implemented yet.`
  - `needs_login` if the login page appears
  - `failed` if the page cannot be confirmed

### Retry a `needs_login` job

After logging in manually:

```sql
update iracing_lookup_jobs
set
  status = 'queued',
  error = null,
  started_at = null,
  completed_at = null,
  worker_name = null
where id = '<job-id>';
```

Restart or leave the scanner running; resetting a job to `queued` while the scanner is active will pick it up via Realtime.

## Current limitations (Phase 2)

- Confirms profile page access only — no stat extraction
- No scraped data written anywhere yet
- No website or Join page changes
- Single local worker only (`worker_name = 'Recruit Scanner'`)
- Requires manual iRacing login on first run (or when session expires)
- Requires SQL migrations and Realtime publication in Supabase
