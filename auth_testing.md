# Auth-Gated App Testing Playbook (BizCore V2 — Railway + MongoDB Atlas)

> **Migration note:** as of the latest release, BizCore no longer uses
> Supabase or Google OAuth. Authentication is a direct username/email +
> password flow against the FastAPI backend, which validates the password
> with PBKDF2-HMAC-SHA256 and issues a session token stored in
> `db.user_sessions` and returned to the mobile client as a Bearer token.

## 1. Provision the first super-admin

```bash
cd backend
MONGO_URL='mongodb+srv://<user>:<pass>@<cluster>.mongodb.net' \
DB_NAME='bizcore_db' \
python seed_admin.py \
  --username admin \
  --email admin@example.com \
  --password 'ChangeMe!2026' \
  --name 'Initial Admin'
```

The script will refuse to run if a super-admin already exists.

## 2. Login via REST

```bash
curl -X POST https://bizcorev2-production.up.railway.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"ChangeMe!2026"}'
```

Successful response:

```json
{
  "user": { "user_id": "...", "email": "...", "role": "super_admin", ... },
  "session_token": "sess_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "expires_at": "2026-06-15T14:00:00+00:00"
}
```

## 3. Authenticated requests

```bash
TOKEN="sess_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
curl https://bizcorev2-production.up.railway.app/api/auth/me \
  -H "Authorization: Bearer $TOKEN"

curl https://bizcorev2-production.up.railway.app/api/products \
  -H "Authorization: Bearer $TOKEN"
```

## 4. Logout

```bash
curl -X POST https://bizcorev2-production.up.railway.app/api/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

## 5. Debugging

```bash
# Inspect stored hashes / session tokens
mongosh "$MONGO_URL" --eval "
  use('bizcore_db');
  db.users.find({}, { password_hash: 1, email: 1, role: 1, is_active: 1 }).limit(3).pretty();
  db.user_sessions.find({}, { session_token: 1, user_id: 1, expires_at: 1 }).limit(3).pretty();
"

# Wipe test sessions
mongosh "$MONGO_URL" --eval "
  use('bizcore_db');
  db.user_sessions.deleteMany({ user_id: /test/ });
"
```

## Checklist

- [ ] User document has `user_id` and `username` (sparse-indexed, unique)
- [ ] User document has `password_hash` in `pbkdf2_sha256$...$...$...` format
- [ ] Session document has matching `user_id`
- [ ] All MongoDB queries use `{"_id": 0}` projection
- [ ] Mobile app stores `session_token` in AsyncStorage as Bearer
- [ ] All API calls go through `src/utils/api.ts` so the interceptor attaches the token

## Success indicators

✅ `/api/auth/login` returns 200 + `session_token`
✅ `/api/auth/me` returns the user record with the token
✅ Dashboard loads without redirecting to login
✅ Logout returns 200 and the token is rejected afterwards

## Failure indicators

❌ 401 "Invalid username or password" — check `password_hash` exists and verify_password matches
❌ 401 "Invalid or expired session" — token missing from `user_sessions` or `expires_at` in the past
❌ 403 "Origin not allowed" — add the host to `ALLOWED_ORIGINS` env var
❌ Redirect loop to login — make sure `EXPO_PUBLIC_BACKEND_URL` is set on EAS (Railway URL)
