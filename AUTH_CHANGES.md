# BizCore V2 — Auth Audit & Fix Log

> **TL;DR:** Removed Supabase / Google OAuth entirely. Replaced with a direct
> username/email + password flow against your Railway-hosted FastAPI backend
> + MongoDB Atlas. Frontend login now has a username/password form with an
> eye-icon to toggle password visibility. The Google sign-in button is gone.

---

## Root cause: why login was broken after a build

You switched hosting to Railway + MongoDB Atlas, but the codebase was still
calling Supabase end-to-end. On a freshly built app that produced a hard
failure on every login attempt. The full issue map:

| # | File | What was wrong | Why it killed login |
|---|------|----------------|---------------------|
| 1 | `frontend/src/lib/supabase.ts` | Hard-coded Supabase project + a fake-looking anon key (`sb_publishable_…`) | Every Supabase call returned 401. There was no real Supabase project behind it. |
| 2 | `frontend/src/lib/supabase.ts` | `flowType: 'implicit'` + `persistSession: false` | The OAuth flow needs Supabase to mint a session; the fake key meant no session ever landed. |
| 3 | `frontend/app/(auth)/login.tsx` | Only "Continue with Google" button — no email/password fallback | The only available path was the broken Google flow. |
| 4 | `frontend/src/store/authStore.ts` | Stored `supabase_token` from Supabase; `checkAuth` re-validated it on every launch | Even after a "successful" login, the next cold-start 401'd and bounced the user to the login screen. |
| 5 | `frontend/src/store/authStore.ts` | `logout()` called `supabase.auth.signOut()` even though we never signed in | Threw an unhandled rejection that wiped the local session, then nothing could restore it. |
| 6 | `backend/server.py` | `get_current_user` called `supabase_client.auth.get_user(token)` for **every** protected request | Round-trip to a Supabase project that doesn't exist → 401 on every API call. |
| 7 | `backend/server.py` | The User model had no `password_hash` or `username` | There was no way for the backend to verify a password even if we wanted to. |
| 8 | `backend/requirements.txt` | Required `supabase` package; the app wouldn't even start without it | Build would fail on Railway. |
| 9 | `frontend/src/utils/api.ts` | Default backend URL was `https://bizcorev2.fly.dev` | Dev builds without `EXPO_PUBLIC_BACKEND_URL` hit a dead Fly URL and got network errors. |
| 10 | `frontend/app/(auth)/login.tsx` | Same Fly.io fallback URL inside the screen | Hard-coded into the `BACKEND_URL` constant. |
| 11 | `backend/server.py` | `TrustedHostMiddleware` only allowed `bizcore-v2.fly.dev` | The Railway hostname was rejected → 400 on every request. |
| 12 | `backend/server.py` | `HTTPSRedirectMiddleware` always on | Railway terminates TLS at the proxy; redirecting to HTTPS caused 307 loops. |
| 13 | `backend/server.py` | CORS allow-list only contained `bizcore-v2.fly.dev` and `bizcore://` | The mobile `bizcorev2://` scheme was missing too; cross-origin axios calls would have been blocked. |
| 14 | `backend/server.py` | `RequestValidationMiddleware` blocked origins not in the allow-list | Combined with #13, every mobile request was 403. |
| 15 | `backend/server_auth_patch.py` | A Google-OAuth patch file referenced everywhere but never wired in | Dead code that misled any developer reading the codebase. |
| 16 | `frontend/package.json` | `@supabase/supabase-js` was a hard dependency | Inflated bundle, potential import errors, useless in production. |
| 17 | `frontend/src/config/clientConfig.ts` | `enableGoogleAuth: true` | Feature flag still advertised Google sign-in even though the code couldn't use it. |
| 18 | `auth_testing.md` | Outdated instructions for a Supabase/Google flow | New developers would be sent down the wrong path. |

---

## What changed

### Backend (`backend/`)

**`server.py`**
- ❌ Removed: `from supabase import create_client`, the `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` constants, and the `supabase_client` global.
- ❌ Removed: the JWT, PyJWT, and httpx imports (no longer needed).
- ❌ Removed: `get_current_user`'s Supabase round-trip — now looks up
  the bearer token in `db.user_sessions` and loads the user.
- ✅ Added: `hash_password` / `verify_password` using
  **PBKDF2-HMAC-SHA256** (200 000 iterations, 16-byte random salt) from
  the Python stdlib — no extra dependency, NIST-recommended.
- ✅ Added: `_create_session` and `_issue_session_token` helpers.
- ✅ Added: `POST /api/auth/login` — accepts `{username, password}` where
  `username` may be either a username or an email. Returns
  `{ user, session_token, expires_at }`. Rate-limited at 10/minute.
- ✅ Added: `POST /api/auth/register` — only succeeds if the user
  collection is empty (first-run bootstrap). The first account is
  promoted to `super_admin`. Rate-limited at 5/minute.
- ✅ Added: `POST /api/auth/change-password` — requires the old
  password, invalidates other sessions, returns a fresh token.
- ✅ Re-implemented: `POST /api/auth/rotate-session` — works with both
  the Bearer header and the legacy `session_token` cookie.
- ✅ Re-implemented: `POST /api/auth/logout` — destroys the current
  session regardless of how the token was sent.
- ✅ Updated: `POST /api/users/create` — admin-supplied or
  auto-generated initial password, hashed before storage. Returns the
  initial password in the response so the admin can share it (one-time).
- ✅ Updated: `RequestValidationMiddleware` — allow-list now includes
  Railway hosts, `bizcorev2://`, Expo dev hosts, and the `ALLOWED_ORIGINS`
  env var.
- ✅ Updated: `TrustedHostMiddleware` — added Railway hosts, `0.0.0.0`,
  `localhost`, `127.0.0.1`.
- ✅ Updated: CORS — added Railway hosts, the mobile `bizcorev2://`
  scheme, and Expo dev ports (8081, 19006).
- ✅ Updated: `HTTPSRedirectMiddleware` is now **opt-in** via
  `ENABLE_HTTPS_REDIRECT=1` (default off — Railway/Fly terminate TLS
  at the proxy and the redirect causes 307 loops).
- ✅ Updated: DB startup now creates a **sparse unique index** on
  `users.username` so legacy documents without the field keep working.

**`requirements.txt`**
- ❌ Removed: `supabase`, `PyJWT`, `python-jose`.
- ✅ Documented that password hashing uses stdlib `hashlib` (no extra
  dependency required).

**`seed_admin.py`** (new)
- CLI tool to provision the first super-admin from the command line.
- Refuses to run if a super_admin already exists.
- Generates a strong random password if you don't pass `--password`.

**`server_auth_patch.py`** — deleted (Google OAuth patch no longer
needed; everything is consolidated into `server.py`).

---

### Frontend (`frontend/`)

**`app/(auth)/login.tsx`** (rewritten)
- ❌ Removed: Google sign-in button, `supabase.auth.signInWithOAuth`,
  `WebBrowser.openAuthSessionAsync`, `Linking` deep-link plumbing, all
  PKCE/implicit-flow handling.
- ✅ Added: **Sign in / Create account** mode toggle.
- ✅ Added: Username (or email) and password inputs.
- ✅ Added: **Eye icon** on the password field to toggle visibility
  (`eye-outline` ↔ `eye-off-outline` from `@expo/vector-icons`).
- ✅ Added: A `KeyboardAvoidingView` + `ScrollView` so the form behaves
  on small screens with the keyboard open.
- ✅ Added: Inline error and success banners styled to match the
  existing dark theme.
- ✅ Added: Self-registration form (name, email, phone) — usable only
  for the very first user (server returns 403 once any user exists).
- ✅ Kept: The animated hex logo, gradient backdrop, and overall
  visual identity.

**`src/store/authStore.ts`** (rewritten)
- ❌ Removed: `supabase.auth.signOut()` call from `logout()`.
- ❌ Removed: dependence on a `supabase_token` storage key.
- ✅ Added: `sessionToken` and `sessionExpiresAt` to the store.
- ✅ Added: `login(sessionToken, user, expiresAt?)` signature.
- ✅ Added: `checkAuth` now optimistically hydrates from the cached
  user (no UI flash), then validates the token against `/auth/me`.
- ✅ Added: 401 from `/auth/me` clears the local session and bounces
  to login via the existing `RootLayout` watcher.
- ✅ Added: `_persistSession` / `_clearPersistedSession` helpers so
  the storage keys stay consistent across login, logout, and 401
  handling.

**`src/utils/api.ts`**
- ❌ Removed: `https://bizcorev2.fly.dev` fallback.
- ✅ Default backend URL is now `https://bizcorev2-production.up.railway.app`.
- ✅ Axios interceptor reads `session_token` (was `supabase_token`).
- ✅ On 401 the interceptor clears the cached user and session.

**`src/lib/supabase.ts`** — deleted (the only place the fake Supabase
client was created).

**`src/config/clientConfig.ts`**
- `enableGoogleAuth: false` so future feature-flag reads aren't lied to.

**`package.json`**
- ❌ Removed: `@supabase/supabase-js`.

**`app.json` / `eas.json`** — no changes needed; the existing
`EXPO_PUBLIC_BACKEND_URL=https://bizcorev2-production.up.railway.app`
on EAS is exactly what we want.

**`auth_testing.md`** — rewritten to cover the new flow (no Supabase,
no Google).

---

## How to deploy & use

### 1. Deploy the backend to Railway
Push the updated `backend/` to your repo. Railway will pick up the new
code. The container command is already
`uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}`.

Make sure these env vars are set on Railway:

```
MONGO_URL=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
DB_NAME=bizcore_db
PORT=8080
ALLOWED_ORIGINS=https://bizcorev2-production.up.railway.app,bizcorev2://
```

### 2. Create the first super-admin
Once Railway has restarted the service, run the seeder **locally** (it
talks to Atlas via the same `MONGO_URL`):

```bash
cd backend
MONGO_URL='mongodb+srv://...' DB_NAME=bizcore_db \
  python seed_admin.py \
    --username admin \
    --email you@yourcompany.com \
    --password 'ChangeMe!2026' \
    --name 'Boss Person'
```

The script prints the credentials — keep them safe. The first
self-registration through the app is also possible (the UI has a
"Create account" tab) but it will work exactly once.

### 3. Rebuild the mobile app
```bash
cd frontend
npm install
eas build --platform android --profile production
```

`eas.json` already has `EXPO_PUBLIC_BACKEND_URL` pointing to your
Railway URL, so the built APK will talk to the right backend
out-of-the-box.

### 4. Sign in
Open the app → enter `admin` / `ChangeMe!2026` → land on the dashboard.
Use the **eye icon** to verify the password you typed.

### 5. Add more users
Once logged in as super-admin, go to **More → Users → Create user** to
invite the rest of your team. The API returns a one-time initial
password that you share with each new user; they can change it from
their profile.

---

## Security notes

- **Password hashing** is PBKDF2-HMAC-SHA256 with 200 000 iterations and
  a per-user random 16-byte salt, stored as
  `pbkdf2_sha256$200000$<salt_hex>$<hash_hex>`. This is NIST-recommended
  and built into the Python stdlib — no `bcrypt`/`passlib` extra
  dependency.
- **Timing attack mitigation**: even when a username doesn't exist, the
  login path runs a dummy `verify_password` so response time is similar
  to the "user exists, wrong password" path.
- **Username enumeration**: error messages are identical for "no such
  user" and "wrong password".
- **Constant-time compare**: `hmac.compare_digest` is used in
  `verify_password` to prevent timing side-channels.
- **Session cookies**: when the login is over HTTPS we set a
  `Secure; HttpOnly; SameSite=Lax` cookie alongside the Bearer token.
  The mobile client uses the Bearer header (cookies don't work in a
  WebView/Expo app).
- **Rate limiting**: `slowapi` is applied to every auth endpoint
  (10/min login, 5/min register, 5/min change-password).
- **Account disabled** check: even with a valid password, an
  `is_active: false` user gets 401.

---

## Files touched

```
backend/server.py                    — major rewrite of auth section
backend/requirements.txt             — drop Supabase / JWT deps
backend/seed_admin.py                — NEW
backend/server_auth_patch.py         — DELETED
frontend/app/(auth)/login.tsx        — full rewrite
frontend/src/store/authStore.ts      — full rewrite
frontend/src/utils/api.ts            — drop Fly.io fallback, fix key
frontend/src/lib/supabase.ts         — DELETED
frontend/src/config/clientConfig.ts  — enableGoogleAuth: false
frontend/package.json                — drop @supabase/supabase-js
frontend/auth_testing.md             — rewritten for the new flow
AUTH_CHANGES.md                      — this file
```
