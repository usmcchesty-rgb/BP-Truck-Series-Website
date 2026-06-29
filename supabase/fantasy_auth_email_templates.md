# BP Fantasy — Supabase Auth Email Templates

Paste these into **Supabase Dashboard → Authentication → Email Templates**.

Also confirm **URL Configuration**:

| Setting | Value |
|---------|--------|
| **Site URL** | `https://www.blazingpedalsracing.com` |
| **Redirect URLs** | `https://www.blazingpedalsracing.com/fantasy/login.html` |
| | `https://www.blazingpedalsracing.com/fantasy/signup.html` |
| | `https://www.blazingpedalsracing.com/fantasy/dashboard.html` |
| | `https://www.blazingpedalsracing.com/fantasy/lineup.html` |
| | `https://blazingpedals.vercel.app/fantasy/login.html` (Vercel preview) |

Client signup sets `emailRedirectTo` to `{origin}/fantasy/login.html`.

---

## Confirm signup

**Subject:** Confirm your BP Fantasy account — Blazing Pedals Racing

**Body (HTML):**

```html
<h2>Welcome to BP Fantasy</h2>
<p>Thanks for signing up with <strong>Blazing Pedals Racing</strong>.</p>
<p>Confirm your email to save lineups and compete each race week in the BP Truck Series fantasy game.</p>
<p><a href="{{ .ConfirmationURL }}">Confirm BP Fantasy Account</a></p>
<p>After confirming, log in at <a href="https://www.blazingpedalsracing.com/fantasy/login.html">blazingpedalsracing.com/fantasy/login.html</a>.</p>
<p>BP Fantasy is a salary-cap fantasy picks game — not official race predictions.</p>
<p>If you did not create this account, you can ignore this email.</p>
<p>— Blazing Pedals Racing<br><a href="https://www.blazingpedalsracing.com">https://www.blazingpedalsracing.com</a></p>
```

---

## Reset password

**Subject:** Reset your BP Fantasy password — Blazing Pedals Racing

**Body (HTML):**

```html
<h2>BP Fantasy password reset</h2>
<p>We received a request to reset the password for your <strong>Blazing Pedals Racing</strong> BP Fantasy account.</p>
<p><a href="{{ .ConfirmationURL }}">Reset Password</a></p>
<p>After resetting, log in at <a href="https://www.blazingpedalsracing.com/fantasy/login.html">blazingpedalsracing.com/fantasy/login.html</a>.</p>
<p>If you did not request a reset, you can ignore this email.</p>
<p>— Blazing Pedals Racing<br><a href="https://www.blazingpedalsracing.com">https://www.blazingpedalsracing.com</a></p>
```

---

## Magic link (if enabled)

**Subject:** Your BP Fantasy login link — Blazing Pedals Racing

**Body (HTML):**

```html
<h2>BP Fantasy login</h2>
<p>Use this link to sign in to your <strong>Blazing Pedals Racing</strong> BP Fantasy account:</p>
<p><a href="{{ .ConfirmationURL }}">Log In to BP Fantasy</a></p>
<p>— Blazing Pedals Racing<br><a href="https://www.blazingpedalsracing.com">https://www.blazingpedalsracing.com</a></p>
```

---

## Notes

- Supabase templates are configured in the dashboard only; no API route is required.
- Use `{{ .ConfirmationURL }}` — Supabase replaces it with the signed link including your redirect URL.
- Keep **Confirm email** enabled for production launch unless you intentionally allow instant access.
