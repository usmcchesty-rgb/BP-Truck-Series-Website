# BP Recruit Scanner Desktop App

Local Electron GUI for the BP Recruit Scanner. This app runs **only on your machine** — it is not deployed to Vercel.

## Build Windows EXE

From the app folder:

```bash
cd tools/recruit-scanner-app
npm install
npm run dist
```

Other build scripts:

| Script | Purpose |
|--------|---------|
| `npm run build` | Unpacked app folder in `dist/win-unpacked` (fast local test) |
| `npm run pack` | Same as `build` — unpacked output in `dist/` |
| `npm run dist` | Portable EXE + NSIS installer in `dist/` |

### Output location

After `npm run dist`, artifacts are written to:

```
tools/recruit-scanner-app/dist/
```

Typical files:

- `BP-Recruit-Scanner-1.0.0-portable.exe` — portable EXE (no install; preferred)
- `BP-Recruit-Scanner-1.0.0-setup.exe` — optional NSIS installer
- `win-unpacked/` — unpacked app (from `build` / `pack`)

`npm run prepare-bundle` (run automatically before build scripts) copies shared scanner source from `tools/recruit-scanner` into `tools/recruit-scanner-app/recruit-scanner` for packaging. That folder is gitignored.

### Not packaged

The EXE does **not** include:

- `tools/recruit-scanner/.env` (Supabase secrets)
- `browser-profile/` (Playwright cookies/session)
- `node_modules` cache from the scanner repo
- Passwords, cookies, or saved iRacing session data from your dev machine

On first run, configure Supabase in Settings and log into iRacing in the embedded browser. All local config and session data are stored under Electron `userData` (writable; not inside Program Files).

Packaged local data paths (Windows example):

```
%APPDATA%/bp-recruit-scanner-app/scanner.env          — Supabase settings
%APPDATA%/bp-recruit-scanner-app/app-settings.json    — app UI settings
%APPDATA%/bp-recruit-scanner-app/Partitions/...       — embedded iRacing session
%APPDATA%/bp-recruit-scanner-app/browser-profile/     — external Playwright fallback only
```

## Embedded iRacing browser

By default, iRacing opens **inside the app** in the **iRacing Browser** panel using Electron `WebContentsView`. The panel is locked to its bordered rectangle and reclipped on resize, scroll, and layout changes so it does not overlap Live Logs or other controls.

- **Dedicated session:** `persist:bp-recruit-scanner` (not your personal Chrome profile)
- **Persistent cookies:** stored under Electron `userData` and reused between app restarts
- **Focus iRacing Browser:** scrolls the panel into view and recalculates bounds
- **Open Browser in Separate Window:** fallback window using the same saved session partition

Disable **Open iRacing Browser in App** in Settings to fall back to the external Playwright Chrome window (`tools/recruit-scanner/browser-profile/`).

## Session storage location

Embedded mode stores cookies/session data at:

```
%APPDATA%/bp-recruit-scanner-app/Partitions/persist_bp-recruit-scanner/
```

(Exact path varies by OS; see Settings load response `sessionStoragePath`.)

External Playwright fallback uses:

```
tools/recruit-scanner/browser-profile/
```

## Install

```bash
cd tools/recruit-scanner
npm install

cd ../recruit-scanner-app
npm install
```

## Run

```bash
cd tools/recruit-scanner-app
npm start
```

## First-time setup

1. Open **Settings** and enter `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
2. Ensure **Open iRacing Browser in App** is checked (default).
3. Click **Save Settings** (writes to Electron `userData`, not the install folder).
4. Click **Open iRacing Login** and sign in inside the **iRacing Browser** panel.
5. If the panel is hard to click, use **Focus iRacing Browser** or **Open Browser in Separate Window**.

When running from source (`npm start`), Supabase settings are saved to `tools/recruit-scanner/.env`.

When running the packaged EXE, settings are saved to `%APPDATA%/bp-recruit-scanner-app/scanner.env` (shown in the Settings panel).

## Test a Customer ID

1. Enter a Customer ID (e.g. `91227` or `329874`).
2. Click **Test Customer ID**.
3. The embedded browser opens:
   - License page → captures/parses license text
   - Stats page → captures raw text (`Stats not parsed yet`)
4. Results appear in **Test Preview** and **Live Logs**.
5. If a matching driver application exists, a license snapshot is saved to Supabase.

## Clear saved session

Click **Clear Saved iRacing Session**. This clears the embedded app session partition (or external `browser-profile/` when fallback mode is active).

Then use **Open iRacing Login** again.

## Terminal scanner

The CLI scanner in `../recruit-scanner` still works independently:

```bash
cd tools/recruit-scanner
npm start
```

It always uses the external Playwright browser profile.

## Security notes

- Never commit `tools/recruit-scanner/.env`
- Do not store iRacing usernames or passwords
- Cookies/session data stay local in the app session partition or scanner profile folder
