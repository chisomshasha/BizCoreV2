# One-file-at-a-time migration (no merge conflicts, no shell quoting)

If the full zip extraction didn't replace the files in your working tree, do this.
Five files. Copy/paste each block. Should take 60 seconds.

Run all commands from your repo root: `cd ~/workspaces/BizcoreV2`

---

## Step 1 — Back up what you have (so you can roll back if anything's weird)

```bash
mkdir -p .old-auth
cp "frontend/app/(auth)/login.tsx"          .old-auth/login.tsx.OLD
cp "frontend/src/store/authStore.ts"        .old-auth/authStore.ts.OLD
cp "frontend/src/utils/api.ts"              .old-auth/api.ts.OLD
cp "backend/server.py"                      .old-auth/server.py.OLD
cp "backend/requirements.txt"               .old-auth/requirements.txt.OLD
cp "frontend/package.json"                  .old-auth/package.json.OLD
echo "Backups saved to .old-auth/"
```

---

## Step 2 — Delete the files that should be gone

```bash
rm -f "frontend/src/lib/supabase.ts"
rmdir "frontend/src/lib" 2>/dev/null   # only removes the dir if empty
rm -f "backend/server_auth_patch.py"
rm -f "frontend/app/(auth)/login.tsx.backup"
rm -f "frontend/src/store/authStore.ts.backup"
echo "Obsolete files removed"
```

---

## Step 3 — Re-extract the zip into a temp folder, then copy the changed files over

```bash
# 3a) extract to a clean temp location
TMP=$(mktemp -d)
cd "$TMP"
unzip -q ~/Downloads/BizcoreV2-master.zip     # adjust path if your zip is elsewhere
# Should produce: "$TMP/BizcoreV2-master/..."

# 3b) verify the new files are actually inside
echo "Files in the freshly-extracted zip:"
ls -la "$TMP/BizcoreV2-master/frontend/app/(auth)/login.tsx"
ls -la "$TMP/BizcoreV2-master/backend/seed_admin.py"
ls -la "$TMP/BizcoreV2-master/AUTH_CHANGES.md"

# 3c) copy the 5 changed files into your repo, overwriting
cd ~/workspaces/BizcoreV2       # <-- your real repo path
cp "$TMP/BizcoreV2-master/frontend/app/(auth)/login.tsx"  "frontend/app/(auth)/login.tsx"
cp "$TMP/BizcoreV2-master/frontend/src/store/authStore.ts" "frontend/src/store/authStore.ts"
cp "$TMP/BizcoreV2-master/frontend/src/utils/api.ts"      "frontend/src/utils/api.ts"
cp "$TMP/BizcoreV2-master/frontend/src/config/clientConfig.ts" "frontend/src/config/clientConfig.ts"
cp "$TMP/BizcoreV2-master/backend/server.py"              "backend/server.py"
cp "$TMP/BizcoreV2-master/backend/requirements.txt"       "backend/requirements.txt"
cp "$TMP/BizcoreV2-master/frontend/package.json"          "frontend/package.json"
cp "$TMP/BizcoreV2-master/frontend/eas.json"              "frontend/eas.json"

# 3d) copy the 3 brand-new files
cp "$TMP/BizcoreV2-master/backend/seed_admin.py"          "backend/seed_admin.py"
cp "$TMP/BizcoreV2-master/backend/reset_passwords.py"     "backend/reset_passwords.py"
cp "$TMP/BizcoreV2-master/AUTH_CHANGES.md"                "AUTH_CHANGES.md"
cp "$TMP/BizcoreV2-master/auth_testing.md"                "auth_testing.md"

echo "All files copied."
```

---

## Step 4 — Verify the copy actually happened

```bash
cd ~/workspaces/BizcoreV2

echo "=== Should all be present and big ==="
ls -la "frontend/app/(auth)/login.tsx" \
       "frontend/src/store/authStore.ts" \
       "backend/seed_admin.py" \
       "backend/reset_passwords.py" \
       "AUTH_CHANGES.md"

echo ""
echo "=== Should be ZERO Google references in login.tsx ==="
grep -c "logo-google\|signInWithOAuth\|Continue with Google" \
   "frontend/app/(auth)/login.tsx"

echo ""
echo "=== Should find Show password (eye icon) ==="
grep -c "Show password" "frontend/app/(auth)/login.tsx"

echo ""
echo "=== Should be ZERO supabase in package.json ==="
grep -c "@supabase" "frontend/package.json"
```

Expected output:
- All 5 files listed with positive sizes (login.tsx should be ~23 KB)
- `grep -c` for Google: `0`
- `grep -c` for Show password: `5` or higher
- `grep -c` for @supabase in package.json: `0`

If any of those don't match, **stop and paste the output here** — something is still off.

---

## Step 5 — Clean rebuild

```bash
cd frontend
rm -rf node_modules .expo android/build android/app/build
rm -f package-lock.json
npm install --legacy-peer-deps
npx expo prebuild --clean
eas build --platform android --profile production --clear-cache
```

Bump `app.json` version to `2.0.1` first so the device picks up the new APK:
```json
{
  "expo": {
    "version": "2.0.1"
  }
}
```

---

## If cp says "No such file or directory" for `(auth)/login.tsx`

The parens are tripping up your shell. Force-quote it:

```bash
cp "$TMP/BizcoreV2-master/frontend/app/(auth)/login.tsx" \
   "frontend/app/(auth)/login.tsx"
```

Both ends need the quotes. If still failing, copy by absolute path:
```bash
cp "$TMP/BizcoreV2-master/frontend/app/(auth)/login.tsx" \
   "$(pwd)/frontend/app/(auth)/login.tsx"
```

Or use rsync-style (single-file copy with full path):
```bash
install -m 644 "$TMP/BizcoreV2-master/frontend/app/(auth)/login.tsx" \
               "frontend/app/(auth)/login.tsx"
```
