# BP Recruit Scanner (Phase 3)

Local Node.js worker that listens for new Blazing Pedals driver application lookup jobs via Supabase Realtime. When a job is queued, the scanner opens the applicant's iRacing profile **Licenses** tab, extracts visible oval license data, and saves a snapshot to Supabase.

Phase 3 extracts **license/profile information**. Phase 4 adds **Oval career stats** from the Stats tab.

## Purpose

```
Website → Supabase → driver_applications
                          ↓ SQL trigger
                    iracing_lookup_jobs
                          ↓ Realtime
                    Local Recruit Scanner
                          ↓ Playwright + Chrome
                    iRacing Licenses tab
                          ↓
                    driver_application_iracing_snapshots
                          ↓
                    Updates iracing_lookup_jobs
```

## Browser profile

The scanner uses its **own** persistent profile at `browser-profile/`. This is separate from your personal Chrome profile — you can keep Chrome open while the scanner runs.

- **Chrome executable:** installed Google Chrome (not bundled Chromium)
- **Session storage:** cookies and login state live only in `browser-profile/`
- **No credentials in code:** usernames and passwords are never stored by the scanner

Optional env override:

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_EXECUTABLE_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe`, then `(x86)` fallback | Path to `chrome.exe` |
| `IRACING_LOGIN_URL` | `https://members.iracing.com/membersite/login.jsp` | iRacing login page (not Google) |
| `HEADLESS` | `false` | Set to `true` to hide the browser window |
| `JOB_DELAY_MS` | `3000` | Delay between consecutive jobs |

## Required environment variables

Create a `.env` file in this folder (copy from `env.example`):

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only; never commit) |

## Desktop app

A local Electron GUI is available in `../recruit-scanner-app`:

```bash
cd tools/recruit-scanner-app
npm install
npm start
```

See `tools/recruit-scanner-app/README.md` for setup and testing.

## Install

```bash
cd tools/recruit-scanner
npm install
```

Google Chrome must be installed locally. Playwright drives your system Chrome using the scanner's own profile folder.

## Run

```bash
npm start
```

Development mode (auto-restart on file changes):

```bash
npm run dev
```

### First login

On the **first run** (or after clearing the session):

1. Start the scanner: `npm start`
2. A Chrome window opens using `browser-profile/`
3. The scanner navigates directly to the **iRacing login page**
4. Log into iRacing manually in that window
5. The scanner waits until login succeeds, then saves the session in `browser-profile/`
6. Job processing begins automatically

You do not need to log in again unless iRacing expires the session.

### Session expired during a job

If a lookup hits the login page:

- The job is marked `needs_login`
- The browser stays open on the login page
- Log in manually in that window
- The scanner detects login automatically and re-queues the job
- Processing continues with the next queued job if automatic retry is not ready yet

Expected startup output (first run):

```
Browser started using scanner profile (browser-profile/)
First run — log into iRacing to save a session in browser-profile/.
Opening iRacing login page...
Waiting for first-run iRacing login — complete sign-in in the browser window.
iRacing session ready.
Connected to Supabase
Listening for lookup jobs...
```

Expected startup output (returning run):

```
Browser started using scanner profile (browser-profile/)
Reusing saved iRacing session from browser-profile/.
Connected to Supabase
Listening for lookup jobs...
```

## Clear the saved session

Stop the scanner, then delete the profile folder:

```bash
# From tools/recruit-scanner/
rm -rf browser-profile
```

On Windows PowerShell:

```powershell
Remove-Item -Recurse -Force browser-profile
```

The next `npm start` will treat it as a first run and open the iRacing login page again.

## Database setup (manual)

Run these in the Supabase SQL editor if not already applied:

1. `supabase/iracing_lookup_jobs.sql` — creates the queue table and trigger
2. `supabase/iracing_lookup_jobs_status_migration.sql` — adds job status values
3. `supabase/driver_application_iracing_snapshots.sql` — stores license snapshots (Phase 3)

Allowed job statuses:

- `queued`
- `processing`
- `completed`
- `failed`
- `needs_login`

## Testing with a queued job

1. Apply both SQL migrations in Supabase.
2. Create `.env` with Supabase credentials.
3. Complete the first iRacing login (see above).
4. Insert a test application in Supabase SQL editor:

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

5. Confirm the flow:

- Trigger creates `iracing_lookup_jobs` with `status = 'queued'`
- Scanner receives the Realtime event
- Chrome opens `https://members-ng.iracing.com/web/racing/profile?cust_id=123456&tab=licenses`
- Job updates to `processing`, then:
  - Snapshot saved with `scrape_status = 'completed'` when all required profile fields are present (`displayName`, `country`, `memberSince`, `oval.class`, `oval.safetyRating`, `oval.irating`)
  - Snapshot saved with `scrape_status = 'needs_manual_review'` only when one or more required fields are missing (job still `completed`)
  - `needs_login` if the login page appears (auto-retries after you log in)
  - `failed` only if the page cannot load or Supabase write fails

Scanner logs include: page loaded, profile DOM extracted, selector report, parsed values, snapshot saved.

## DOM extraction (Licenses tab)

The scanner injects `EXTRACT_PROFILE_DOM_SCRIPT` into the loaded profile page and reads specific elements instead of regex-parsing the full page text.

Structured profile JSON:

```json
{
  "displayName": "Mark Arthur",
  "country": "United States",
  "memberSince": "14 Years",
  "licenses": {
    "oval": {
      "class": "Class A",
      "safetyRating": "3.76",
      "irating": 5756
    }
  }
}
```

Selectors are defined in `dom-profile-extractor.js` (`PROFILE_DOM_SELECTORS`). Discovered selectors and individual misses are logged for each job. Text parsing runs **only** for fields where DOM selection fails.

| Field | Primary selectors |
|-------|-------------------|
| Display name | `#modal-as-screen .chakra-screen-billboard h2.chakra-heading` |
| Member since | `#modal-as-screen .chakra-screen-billboard span[aria-label*="Years"]` |
| Country | `#modal-as-screen .chakra-screen-billboard span.chakra-text__flair-name` |
| Licenses pane | `[id="modal-profile modal-member-licenses"]` |
| Oval class / SR / iR | `p.chakra-text` within the `Oval Racing` card (text-matched) |
| Oval fallback | `#member-profile-mpr-chart p.chakra-text` (`Oval: Class …`) |

### Retry a `needs_login` job

After signing in through the scanner browser, the job re-queues automatically. You can also reset manually:

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

## Current limitations (Phase 4)

- Extracts Oval career stats from the Career Stats table on the Stats tab
- License and stats snapshots are saved separately with independent scrape status
- Stats parsing failure does not downgrade a completed license snapshot
- Single local worker only (`worker_name = 'Recruit Scanner'`)
- Requires SQL migrations and Realtime publication in Supabase

## Phase 4 stats migration

Run in Supabase SQL editor:

4. `supabase/driver_application_iracing_stats_snapshots.sql` — stores Oval career stats snapshots

Stats DOM selectors live in `dom-stats-extractor.js`. Parsed via `parse-stats-snapshot.js`.
