# FORK NOTE — Round 3 Handoff

> **Purpose**: This note is the entry point for a new chat session that
> will fix the 59 pre-existing TypeScript errors + the 5 client
> complaints. It contains everything the new agent needs to hit the
> ground running without re-deriving context.

---

## 0. WHERE WE ARE

BizCore V2 — React Native (Expo 51) mobile app + FastAPI + MongoDB Atlas.

**Status:**
- ✅ Auth (login.tsx, authStore.ts, api.ts) — direct username/password, no Supabase
- ✅ Login screen — username/email + password + eye icon, no "Create account" tab
- ✅ Backend — direct password hash, session token, no Supabase
- ✅ Currency — NGN (₦) via `formatCurrency` from `clientConfig`
- ✅ Partners tab — removed
- ✅ Bold selected items in sales orders
- ✅ `ErrorBoundary` added so future crashes don't kill the app
- ✅ `appStore` had 9 missing implementations — fixed

**Round 2 zip**: `/workspace/deliverable/BizcoreV2-master.zip`

---

## 1. THE 59 PRE-EXISTING TYPESCRIPT ERRORS

The codebase you upload to the new chat should be the **post-Round-2**
state (so the 0 errors I introduced stay fixed). Run `npx tsc --noEmit`
from `frontend/` to see all 59 errors.

### Categories (from my scan before closing Round 2):

#### A. `Colors.info` is missing from the theme (8 files)
**Symptom**:
```
error TS2339: Property 'info' does not exist on type
'{ background: string; card: string; cardAlt: string; ...; success: string; }'
```

**Files affected**:
- `frontend/app/audit-logs.tsx` (line 87)
- `frontend/app/bom.tsx` (lines 187, 500, 501, 505)
- `frontend/app/delivery-notes.tsx` (line 83)
- more likely in: `notifications.tsx`, `grn.tsx`, etc.

**Fix**:
Open `frontend/src/components/ThemedComponents.tsx`, find the `Colors`
object, and add `info: '#3B82F6'` (or whatever the brand info-blue is).
Also add it to `clientConfig.ts` `theme.info`.

---

#### B. `EmptyState` component prop mismatch (10+ files)
**Symptom**:
```
error TS2322: Type '{ icon: "time-outline"; title: string; message: string; }'
is not assignable to type 'IntrinsicAttributes & { message: string; icon?: ... }'.
Property 'title' does not exist on type ...
```

**Affected files** (from my scan):
- `frontend/app/audit-logs.tsx` (line 179)
- `frontend/app/bom.tsx` (line 196)
- `frontend/app/delivery-notes.tsx` (line 144)
- `frontend/app/grn.tsx` (line 215)
- more likely in: `notifications.tsx`, `requisitions.tsx`, etc.

**Fix options**:
- Option 1: Add `title?: string` to `EmptyStateProps` in `ThemedComponents.tsx`
  and render it above the message.
- Option 2: Remove all `title={...}` props from `<EmptyState>` calls.
  (Less work but loses UI element.)

Recommend Option 1 — add the prop.

---

#### C. `Badge` `variant` type missing 'secondary' (4 files)
**Symptom**:
```
error TS2322: Type '"secondary" | "success"' is not assignable to
type '"default" | "danger" | "warning" | "success" | "info" | undefined'
```

**Files**: `frontend/app/bom.tsx` lines 217, 376

**Fix**: Either add `'secondary'` to the `BadgeProps['variant']` union,
or replace `'secondary'` with `'info'` or `'default'` in the call sites.

---

#### D. `agent-ledger.tsx` uses removed `credit_limit` field (1 file)
**Symptom**:
```
error TS2339: Property 'credit_limit' does not exist on type
'{ user_id: string; name: string; warehouse_id?: string; ...; debt_ceiling: number; is_flagged: boolean; }'
```

**Fix**: The agents model was migrated from `credit_limit` → `debt_ceiling`.
Replace `u.credit_limit` with `u.debt_ceiling` on line 109 of `agent-ledger.tsx`.

---

#### E. `financial-reports.tsx` style array-as-style error (2 occurrences)
**Symptom**:
```
error TS2559: Type '({ flexDirection: "row"; ...; } | { borderColor: string; backgroundColor: string; })[]'
has no properties in common with type 'ViewStyle'
```

**Lines**: 177, 270

**Fix**: The component is passing an array where a single `ViewStyle` is
expected. Either wrap in `StyleSheet.flatten([...])` or use a single
style object.

---

#### F. Order/PO type mismatches in `agent-ledger.tsx` etc.
**Symptom**:
```
error TS2339: Property 'supplier_id' does not exist on type 'SalesOrder'.
error TS2339: Property 'distributor_id' does not exist on type 'PurchaseOrder'.
error TS2339: Property 'po_number' does not exist on type 'SalesOrder'.
error TS2339: Property 'so_number' does not exist on type 'PurchaseOrder'.
error TS2339: Property 'total' does not exist on type 'PurchaseOrder'.
error TS2339: Property 'tax' does not exist on type 'PurchaseOrder'.
error TS2339: Property 'discount' does not exist on type 'PurchaseOrder'.
```

**Root cause**: The `SalesOrder`, `PurchaseOrder`, `Invoice`, etc. types
in `frontend/src/types/index.ts` were updated but the screens still
reference the old field names. Full type audit needed.

**Fix**: Grep each old field name across `frontend/app/`, then rename to
match the new model:
- `total` → `total_amount`
- `tax` → `tax_amount`
- `discount` → not present in new model (drop the references)
- `supplier_id` on SalesOrder → shouldn't exist (drop the references)
- `distributor_id` → renamed to `sales_rep_id` per the new agent model
- `po_number` on SalesOrder → these are separate orders; check carefully

**Watch out for**: `frontend/src/types/index.ts` line 182 has a
**duplicate `sales_rep_id` declaration** (once required, once optional)
in the `SalesOrder` interface. Fix that too.

---

## 2. THE 5 CLIENT COMPLAINTS (from the client feedback list)

The client is a Nigerian SME using BizCore for ERP. They asked for:

### #1. Users CRUD
**Requirement**: Super Admin / General Manager must be able to create,
edit, and delete users from the dashboard.

**Current state**:
- Backend: `POST /api/users/create` exists (from Round 1)
- Backend: `PUT /api/users/{user_id}` exists (from Round 1)
- Backend: `DELETE /api/users/{user_id}` does **NOT** exist
- Frontend: `more.tsx` has a "Users" list modal but it's read-only

**Work to do**:
1. Backend: add `DELETE /api/users/{user_id}` endpoint with proper
   permission check (super_admin or general_manager only, can't delete
   self, can't delete last super_admin)
2. Backend: extend `PUT /api/users/{user_id}` to accept `is_active: bool`
   so admins can deactivate users (soft delete option)
3. Frontend: extend the Users modal in `more.tsx` to show Edit and
   Delete buttons per row
4. Frontend: add a "Create User" form modal (name, email, phone, role,
   warehouse, initial password) — the backend returns the password
5. Frontend: add confirmation dialogs for delete + deactivation
6. Backend: add an `audit_logs` entry for every create/update/delete

**Est. effort**: 3-4 hours.

---

### #2. Bold selected items in sales orders
**Status**: ✅ **DONE in Round 2** — the product chip flips to bold +
checkmark + primary background when selected. Test it before considering
this closed.

---

### #3. Per-warehouse inventory with admin totals
**Requirement**: Super Admin, General Manager, and Accountant should see
inventory grouped by warehouse; a grand total across all warehouses
for the product.

**Current state**:
- Backend endpoint `GET /api/inventory` likely returns flat list with
  per-row `warehouse_id` (verify)
- Backend endpoint `GET /api/products?low_stock=true` likely aggregates
  per-warehouse (verify)
- Frontend: `inventory.tsx` shows a flat product list with one stock
  value per product

**Work to do**:
1. Read backend `inventory` endpoint — confirm shape
2. If it doesn't already group by warehouse, add a new endpoint
   `GET /api/inventory/by-warehouse?product_id=...` that returns
   `{ product_id, by_warehouse: [{ warehouse_id, warehouse_name, quantity, cost_price }], total_quantity, total_value }`
3. Frontend: rework `inventory.tsx` to expand a product card and show
   the per-warehouse breakdown
4. Cross-warehouse totals: probably already done if the endpoint returns
   `total_value`

**Est. effort**: 2-3 hours.

---

### #4. Forgot password / forgot username
**Requirement**: In case someone changes their phone, there must be a
"forgot password" and "forgot username" flow.

**Work to do** (needs provider decision):
1. **Provider pick** (ask the client):
   - Email: SendGrid / Resend / AWS SES (need API key)
   - SMS: Twilio / Termii (Africa-friendly) / AWS SNS
   - Both
   - Defer
2. Backend: add `POST /api/auth/forgot-password` that issues a
   short-lived (15-min) reset token, stores it in `db.password_resets`,
   and sends the token via email/SMS
3. Backend: add `POST /api/auth/reset-password` that validates the token
   and updates the password hash
4. Backend: add `POST /api/auth/forgot-username` that looks up the
   account by email/phone and emails/SMSes the username (and the email
   associated, so they can recover that too)
5. Frontend: add a "Forgot password?" link below the password field on
   `login.tsx`, open a new screen with email/phone + submit
6. Frontend: deep-link handler for `bizcorev2://reset-password?token=...`
   that opens the reset-password screen

**Est. effort**: 3-4 hours (assuming provider already configured in
Railway env vars).

---

### #5. GM + Accountant can access role permissions + add/edit users
**Requirement**: Currently only super_admin can access
`/role-permissions`. General Manager and Accountant should be able to
as well.

**Current state**:
- `more.tsx` line 232-238: `{(isSuperAdmin || isGeneralManager) && (
  <ListItem title="Role Permissions" ... href="/role-permissions" />)}`
  — already includes General Manager, but NOT Accountant
- `role-permissions.tsx`: read the file to see what permission check it
  does

**Work to do**:
1. Update `more.tsx` to also show the "Role Permissions" link for
   Accountants
2. Update `role-permissions.tsx` to also accept Accountants
3. If the backend role-permissions endpoint is gated to super_admin
   only, widen it on the backend too
4. Consider: should Accountants be able to add/edit users? The complaint
   says "both can add or edit new users" — so YES, Accountants should
   also be able to create users. Same as #1, just need to widen the
   `current_user.role` check in the backend's `POST /api/users/create`
   and `PUT /api/users/{user_id}` endpoints.

**Est. effort**: 1-2 hours.

---

## 3. RECOMMENDED ROUND 3 PLAN

In order of priority (highest first):

1. **Clean up the 59 TS errors** (1-2 hrs) — unblocks future work and
   makes subsequent changes less error-prone
2. **#1 Users CRUD** (3-4 hrs) — biggest usability gap right now
3. **#5 Widen role permissions** (1-2 hrs) — small but politically
   important for the client
4. **#3 Per-warehouse inventory** (2-3 hrs) — data visibility win
5. **#4 Forgot password** (3-4 hrs, blocks on provider config)

Total: ~10-15 hours. Likely 2-3 chat sessions of focused work.

---

## 4. ENVIRONMENT SETUP (so the new agent doesn't waste time)

### Repo state expected
- Frontend at: `frontend/`
- Backend at: `backend/`
- Both have a `node_modules/` and `__pycache__/` you can ignore
- `package-lock.json` and `pnpm-lock.yaml` should be regenerated on
  every install

### Required env vars on Railway (backend)
```
MONGO_URL=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
DB_NAME=bizcore_db
PORT=8080
ALLOWED_ORIGINS=https://bizcorev2-production.up.railway.app,bizcorev2://
ENABLE_HTTPS_REDIRECT=false   # IMPORTANT — Railway terminates TLS at proxy
```

### Required env vars on EAS (frontend)
```
EXPO_PUBLIC_BACKEND_URL=https://bizcorev2-production.up.railway.app
```

### Provisioning scripts
- `backend/seed_admin.py` — create the very first super_admin (refuses
  to run if one already exists)
- `backend/reset_passwords.py` — bulk-set new PBKDF2 hashes + temp
  passwords for legacy users, write to `passwords.csv`

### Auth flow (no third-party)
1. User opens app → `login.tsx` shows username/email + password form
2. POSTs to `/api/auth/login` → backend returns `{user, session_token, expires_at}`
3. App stores `session_token` in AsyncStorage, sets as Bearer header
4. Every protected request includes `Authorization: Bearer <token>`
5. Backend validates token against `db.user_sessions` collection

### Test the backend is the NEW one
```bash
curl -X POST https://bizcorev2-production.up.railway.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"nobody","password":"nobody"}'
```
- If response is `{"detail":"Invalid username or password"}` → NEW backend ✓
- If response mentions Supabase, OAuth, "User not found in database" → OLD
  backend, redeploy.

---

## 5. KEY FILES TO KNOW

| File | Purpose |
|---|---|
| `backend/server.py` | All FastAPI routes (~5900 lines). Auth section is around line 920-1290. |
| `backend/permissions.py` | Dynamic role-permission matrix |
| `backend/seed_admin.py` | First-super-admin CLI |
| `backend/reset_passwords.py` | Bulk password reset CLI |
| `frontend/app/(auth)/login.tsx` | Login screen, username/password + eye icon |
| `frontend/app/(tabs)/_layout.tsx` | Bottom tab bar (5 tabs, no Partners) |
| `frontend/app/(tabs)/index.tsx` | Dashboard with NGN currency, ErrorBoundary |
| `frontend/app/(tabs)/more.tsx` | More tab with all sub-menus + ErrorBoundary |
| `frontend/src/store/authStore.ts` | Zustand auth state, session_token storage |
| `frontend/src/store/appStore.ts` | Zustand app state, 9 actions added in Round 2 |
| `frontend/src/components/ErrorBoundary.tsx` | Catches render errors per-screen |
| `frontend/src/components/ThemedComponents.tsx` | Reusable UI components + Colors theme |
| `frontend/src/config/clientConfig.ts` | Theme, defaults (NGN), formatCurrency helper |
| `frontend/src/utils/api.ts` | Axios instance with Bearer interceptor |

---

## 6. STAY AWARE

- **Pre-existing `auth_testing.md`** is updated for the new auth flow
- **`AUTH_CHANGES.md`** (Round 1 changelog) and **`CHANGES_ROUND2.md`**
  (Round 2 changelog) are in the repo root — read them first for full
  history
- **Backend's `requirements.txt`** no longer has `supabase` or `PyJWT`
  — don't add them back
- **Frontend's `package.json`** no longer has `@supabase/supabase-js` —
  don't add it back
- The `clientConfig.ts` has NGN configured but several legacy screens
  still use the global `Colors` from `ThemedComponents.tsx` which is
  a SEPARATE theme object with `background`, `card`, `primary`, etc.
  but no `info` color. The 59 errors are mostly the result of this split
  theme system.
- The `app.json` `extra.eas.projectId` is `0b247176-96a2-470a-a9e6-4e4a03237543`
  — do NOT regenerate it or EAS will create a duplicate project

---

## 7. THE CHAT PROMPT TO PASTE INTO THE NEW SESSION

```
Read FORK_NOTE.md first — it has full context from a previous session
on this codebase. Then fix the 59 pre-existing TypeScript errors
(npx tsc --noEmit from frontend/) and implement the 5 client complaints
listed in section 2, in the order in section 3.
```

That should be enough for the new agent to dive in.
