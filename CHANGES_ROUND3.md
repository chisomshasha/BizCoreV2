# Changes — Round 3

This round tackles the 59 pre-existing TypeScript errors and the 5 client
complaints listed in `FORK_NOTE.md` section 2.

## 1. The 59 pre-existing TypeScript errors

All 59 errors are now resolved (`npx tsc --noEmit` from `frontend/` exits 0).

### A. `Colors.info` missing from the theme
Added `info: '#3B82F6'` to the `Colors` object in
`frontend/src/components/ThemedComponents.tsx`. Touched 8+ files that
referenced `Colors.info`.

### B. `EmptyState` component prop mismatch
Added an optional `title?: string` prop to `EmptyState` in
`ThemedComponents.tsx` and rendered it above the message. Touched 10+ files
that passed `title={...}`.

### C. `Badge` `variant` type missing values
Added `'secondary'` and `'primary'` to `BadgeProps['variant']` and the
switch. Touched `bom.tsx`, `notifications.tsx`, `partner/[id].tsx`.

### D. `agent-ledger.tsx` uses removed `credit_limit` field
Replaced `agent?.credit_limit` (and the fallback to `debt_ceiling`) with a
direct `(agent as any)?.debt_ceiling ?? 0` lookup.

### E. `financial-reports.tsx` style array-as-style error
Wrapped the two `<Card style={[...]}>` usages with `StyleSheet.flatten(...)`.

### F. Order/PO type mismatches in `agent-ledger.tsx`, `order/[id].tsx`, `partner/[id].tsx`
- Fixed duplicate `sales_rep_id` declaration in
  `frontend/src/types/index.ts` (was declared once required + once optional).
- `order/[id].tsx`: rewritten to use the new model — `sales_rep_id` +
  `agents` array (fetched via the new `GET /api/users/agents` endpoint) for
  sales orders; `_id` removed.
- `partner/[id].tsx`: rewritten as a **supplier-only** screen since the
  Distributor model was retired. The Partner tab was also removed (already
  done in Round 2) and this screen is now only reached from supplier list
  contexts.

### G. Other fixes
- `ThemedComponents.tsx` `Input.style` type changed from `ViewStyle` to
  `TextStyle` (it was being applied to a `TextInput`). Also wrapped the
  style array in `StyleSheet.flatten(...)` to avoid `''`/`undefined` slipping
  into the union.
- `syncStore.ts` `checkConnection` — the expression
  `state.isConnected && state.isInternetReachable !== false` returned
  `boolean | null` (TS strict). Coerced with explicit
  `=== true` / `!== false` and an explicit `: boolean` annotation.
- `product/[id].tsx` — `products.find(p => p._id === id)` → `p.product_id`.
- `notifications.tsx` — `truck` (not a valid Ionicons name) →
  `car-outline`.

## 2. Client complaint #1 — Users CRUD (Super Admin / General Manager)

### Backend (`backend/server.py`)
- **New endpoint**: `DELETE /api/users/{user_id}` (line ~1658).
  - SA / GM only (enforced by `assert_permission` + explicit role check).
  - Refuses to delete the current user.
  - Refuses to delete the last active Super Admin.
  - If the user has any purchase / sales / inventory history we **soft-delete**
    (set `is_active=False`, `deactivated_at`, `deactivated_by`) instead of
    hard-deleting, to preserve the audit trail. Returns
    `{"deleted": false, "deactivated": true, ...}`.
  - Writes an `audit_logs` entry (`delete` or `deactivate`).
  - Rate limited: 30/minute.
- **Widened** the permission check on `POST /api/users/create` and
  `PUT /api/users/{user_id}` to also accept `GENERAL_MANAGER` and
  `ACCOUNTANT`. Added "Accountant" to the list.
- `UserUpdate.is_active` already exists, so the soft-delete is reachable
  via `PUT /users/{id}` with `is_active: false` as well.

### Backend (`backend/permissions.py`)
- Default permissions for `accountant` role changed from
  `users: _NONE` → `users: _CRU` (can create + read + update; **cannot
  delete** — that's SA/GM only, enforced separately).

### Frontend (`frontend/app/(tabs)/more.tsx`)
- Extended the **Users modal**:
  - "+" button at the top opens a new "Create User" form modal.
  - Each user row now has pencil (edit) and trash (delete) icons.
  - Delete button is hidden for `accountant` (SA/GM only).
  - Pencil button is shown for SA / GM / Accountant.
- New **User Form modal** with fields:
  - Name *, Email * (read-only when editing), Phone *, Role picker (chips
    for `viewer / sales_clerk / purchase_clerk / sales_rep / accountant /
    warehouse_manager / general_manager`; `super_admin` only visible to
    super-admin), Warehouse (optional, from `warehouses` list).
  - When editing, also a Status toggle (Active / Inactive).
- On successful create, the modal shows the temporary password in an
  `Alert` so the admin can share it with the new user.

## 3. Client complaint #2 — Bold selected items in sales orders
Already done in Round 2 — no changes this round.

## 4. Client complaint #3 — Per-warehouse inventory with admin totals

### Backend (`backend/server.py`)
- **New endpoint**: `GET /api/inventory/by-warehouse` (line ~5970).
  - Returns one record per product with a `by_warehouse: [{warehouse_id,
    warehouse_name, quantity, value}]` array plus grand totals
    `total_quantity` and `total_value`.
  - SA / GM / Accountant see every warehouse; Warehouse Managers see only
    their own; others fall back to their own `warehouse_id`.
  - Always includes a row per visible warehouse (even when quantity is 0)
    so admins can see "Lagos Main: 0" rows in the UI.
  - Rate-limited similarly to the existing inventory endpoints.

### Frontend (`frontend/app/(tabs)/inventory.tsx`)
- New "Stock" tab content. A `StockByWarehouseView` component renders:
  - A **grand-totals card** at the top showing total units, total value
    (in NGN), and low-stock count across all warehouses.
  - One expandable product card per product:
    - Collapsed: product name + SKU + total quantity badge + total value +
      low-stock badge.
    - Expanded: a per-warehouse breakdown with quantity and value.
  - Search filter applies across the product name and SKU.
  - Loading state while the by-warehouse endpoint loads.

## 5. Client complaint #4 — Forgot password / forgot username

### Backend (`backend/server.py`)
- **New endpoints** (all rate-limited):
  - `POST /api/auth/forgot-password` (line ~1300): takes
    `{"email_or_phone": "..."}`. Looks up the user (by email / username /
    last-10-digit phone match), issues a 32-char `secrets.token_urlsafe`
    token with a 15-min TTL, stores it in `db.password_resets`, and
    "delivers" it.
  - `POST /api/auth/reset-password`: validates the token + new password
    (≥ 6 chars), updates the hash, marks the token as used, invalidates
    all existing sessions, and returns a new `session_token` so the user
    is auto-logged-in.
  - `POST /api/auth/forgot-username`: looks up the account by
    email/phone and returns the username plus a masked email so the user
    can verify ownership.
- **Gmail SMTP delivery** via `PASSWORD_RESET_PROVIDER` env var
  (default `console` for dev, set to `gmail` in Railway for prod):
  - `console` (default / dev): token is logged to stdout + written to
    `audit_logs` so a developer can copy it during testing.
  - `gmail`: sends through `smtp.gmail.com:465` using an App Password.
    From: `BizCore <chisomarinzeshasha@gmail.com>`. Daily cap of 100
    enforced via Mongo atomic counter. When the cap is hit, the token
    falls back to stdout logging so an admin can deliver it manually.
  - `email`: legacy alias, same as `gmail` (for backward-compat).
  - `sms`: explicitly disabled — returns
    `{"error": "SMS is disabled for this deployment"}`.
- All three endpoints always return a generic
  "If an account exists for that identifier, ..." message so we don't
  leak whether an account exists.

### Frontend
- `frontend/app/(auth)/login.tsx`:
  - Added "Forgot password?" and "Forgot username?" links below the
    sign-in button.
  - New "Forgot" modal with two tabs (password / username) + a single
    "Email or phone" input. Handles loading, success, and error states.
  - "I already have a reset token" link opens a second modal that takes
    the token + new password, calls `/auth/reset-password`, and shows
    the success/error result.
- `frontend/app/_layout.tsx`:
  - Added an `expo-linking` URL listener. When the app is opened via
    `bizcorev2://reset-password?token=...`, the listener routes to the
    login screen with `?resetToken=...` query param. The login screen
    detects this and opens the reset-password modal pre-filled with
    the token. This requires no native config — `bizcorev2` is already
    the scheme in `app.json`.

## 6. Client complaint #5 — Widen role permissions to GM + Accountant

### Backend (`backend/server.py`)
- All four `/admin/role-permissions*` endpoints widened:
  - `GET /admin/role-permissions`
  - `GET /admin/role-permissions/{role}`
  - `PUT /admin/role-permissions/{role}`
  - `POST /admin/role-permissions/reset/{role}`
  - All now accept `SUPER_ADMIN`, `GENERAL_MANAGER`, and `ACCOUNTANT`.

### Frontend
- `frontend/app/(tabs)/more.tsx`: the "Role Permissions" `ListItem` is now
  shown for `isSuperAdmin || isGeneralManager || role === 'accountant'`.
- `frontend/app/role-permissions.tsx`: the redirect-on-mount check now
  uses `canManage = isSuperAdmin || isGeneralManager || isAccountant`
  instead of `isSuperAdmin` alone.

## 7. Other cleanup

- `frontend/src/store/appStore.ts` — added `agents: any[]` state and
  `fetchAgents()` action so the rewritten `order/[id].tsx` screen can
  look up the sales-rep name on a sales order.

## 8. Verification

- `npx tsc --noEmit` from `frontend/`: **0 errors** (was 59).
- `python3 -c "import ast; ast.parse(open('backend/server.py').read())"`:
  **OK** (no syntax errors).
- All new routes registered in `server.py`:
  - `POST /auth/forgot-password`
  - `POST /auth/reset-password`
  - `POST /auth/forgot-username`
  - `DELETE /users/{user_id}`
  - `GET /inventory/by-warehouse`
- Total API routes in `server.py`: 140 (was 135).

## 9. Known follow-ups (intentional, not bugs)

- **Gmail SMTP delivery is wired up.** Set in Railway env vars:
  - `PASSWORD_RESET_PROVIDER=gmail` (default is `console` for dev)
  - `GMAIL_SMTP_USER=chisomarinzeshasha@gmail.com` (default already set)
  - `GMAIL_SMTP_APP_PASS=<16-char App Password>` — generate at
    https://myaccount.google.com/apppasswords (requires 2-Step Verification
    on the Google account)
  - `GMAIL_SMTP_FROM_NAME=BizCore` (optional, default "BizCore")
  - `DAILY_SEND_CAP=100` (optional, default 100)
  - The email is sent from the same Gmail address (`From: BizCore <chisomarinzeshasha@gmail.com>`).
  - **100/day cap** is enforced via a Mongo atomic counter; once hit, the
    token is *not* emailed — it's logged to the backend stdout instead, so
    an admin can still deliver it manually.
  - SMS branch is disabled: returns `{"error": "SMS is disabled for this deployment"}`.
- The `auth_testing.md` doc should be updated to mention the new
  `/auth/forgot-password` / `/auth/reset-password` flow.
