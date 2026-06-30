# BP Recruit Scanner (Phase 1)

Local Node.js worker that listens for new Blazing Pedals driver application lookup jobs via Supabase Realtime. When a job is queued, the scanner claims it, simulates processing, and marks it complete.

Phase 1 does **not** scrape iRacing profiles or use Playwright. It only detects new jobs and updates job status.

## Purpose

```
Website → Supabase → driver_applications
                          ↓ SQL trigger
                    iracing_lookup_jobs
                          ↓ Realtime
                    Local Recruit Scanner
                          ↓
                    Updates Supabase
```

When someone submits a driver application, a database trigger enqueues an `iracing_lookup_jobs` row. This scanner picks up queued jobs and advances them through `processing` → `completed`.

## Required environment variables

Create a `.env` file in this folder (copy from `env.example`):

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only; never commit) |

## Install

```bash
cd tools/recruit-scanner
npm install
```

## Run

```bash
npm start
```

Development mode (auto-restart on file changes):

```bash
npm run dev
```

Expected console output on startup:

```
Connected to Supabase
Listening for lookup jobs...
```

When a job is processed:

```
-----------------------------------
New Lookup Job
Application: <uuid>
Customer ID: <id>
-----------------------------------
New job received
Job processing
Job complete
```

## Database setup (manual)

Run the migration in the Supabase SQL editor **before** starting the scanner:

```
supabase/iracing_lookup_jobs.sql
```

This creates `iracing_lookup_jobs`, the enqueue trigger on `driver_applications`, and enables Realtime for the table.

## Testing without website changes

1. Start the scanner (`npm start`).
2. In Supabase SQL editor, insert a test application:

```sql
insert into driver_applications (
  iracing_display_name,
  iracing_customer_id,
  age_confirmed
) values (
  'Test Driver',
  '999999',
  true
);
```

3. Confirm:
   - A row appears in `iracing_lookup_jobs` with `status = 'queued'`
   - The scanner logs the job and updates status to `processing`, then `completed`

## Current limitations (Phase 1)

- No iRacing profile scraping
- No Playwright browser automation
- No website or Join page changes
- Single local worker only (`worker_name = 'Recruit Scanner'`)
- Simulated 5-second processing delay instead of real lookup work
- Requires the SQL migration and Realtime publication to be applied manually in Supabase
