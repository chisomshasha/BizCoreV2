# BizCore V2 — Code Audit & Remediation Report

**Scope:** `backend/` (FastAPI + MongoDB, 141 routes) and `frontend/` (Expo 51 / React Native, 20 screens)
**Method:** full source read, contract cross-check (frontend ↔ backend), runtime exercise of every route, adversarial authorization testing
**Date:** 2026-11-09

---

## 1. Executive summary

The codebase was functional in shape but **not functional in practice**. The audit found
**9 crash-class bugs** that made entire modules unusable, **11 missing authorization
checks**, **7 cross-tenant (IDOR) leaks**, and **12 data-integrity defects** — all of
which are now fixed and covered by an automated regression suite.

The most serious finding: **`POST /api/purchase-orders` and `POST /api/agent-quotations`
both returned HTTP 500 on every call.** Two undefined functions (`generate_po_number`,
`generate_agent_quotation_number`) were referenced but never written. Purchase Orders and
the entire agent sales workflow — the two revenue paths of the ERP — were dead on arrival.

| Metric | Before | After |
|---|---|---|
| Backend routes exercised in the functional sweep | 126 (9 crashed) | **141 (0 crash)** |
| Requests in the functional sweep | 441 (68 failures) | **536 (0 unexpected failures)** |
| Crash-class (5xx) defects | 9 | **0** |
| Quantity-type defects (string vs number) | 2 | **0** |
| Endpoints with no authorization check | 11 | **0** |
| Cross-tenant (IDOR) leaks | 7 | **0** |
| TypeScript errors (`tsc --noEmit`) | 1 | **0** |
| ESLint errors | 1 (config crashed) | **0** |
| Frontend↔backend contract mismatches | 2 | **0** |
| Unreachable screens | 4 | **0** |
| Screens that crash on an empty response | 3 | **0** |
| Automated regression tests | 0 | **98** backend + **67** mobile |

---

## 2. Critical findings — fixed

### 2.1 Two undefined functions broke both revenue paths
*`backend/server.py`*

`generate_po_number()` and `generate_agent_quotation_number()` were **called but never defined**.
Python raised `NameError` at request time.

- `POST /api/purchase-orders` → 500 on every call.
- `POST /api/agent-quotations` → 500 on every call (the sales-rep → manager → SO flow).

**Fix:** added a collision-safe counter-based generator (`_make_doc_number`) backed by an
atomic `find_one_and_update($inc)` on a `counters` collection. This also fixes a **latent
production bug**: every other number generator (`generate_so_number`,
`generate_invoice_number`, `generate_quotation_number`, `generate_delivery_number`,
`generate_transfer_number`, plus the inline GRN/requisition counters) used
`count_documents() + 1`. Two concurrent requests read the same count and produced the same
number, tripping the unique index on `po_number` / `so_number` / `invoice_number` → 500.
All nine generators now use the atomic counter.

### 2.2 The "distributor" concept was retired but never removed from the code
*`backend/server.py`*

`db.distributors` was retired (comment: *"Distributor collection retired — agents replace
this concept"*), but four code paths still referenced it:

| Location | Symptom |
|---|---|
| `create_quotation` → `qt_data.distributor_id` | `AttributeError` → **500** (Quotations module dead) |
| `convert_quotation_to_order` → `so_data.distributor_id` | `AttributeError` → **500** |
| `create_delivery_note` → `so["distributor_id"]` | `KeyError` → **500** (Delivery Notes dead) |
| `sync_pull` / `sync_status` → `db.distributors` | synced an always-empty collection |

**Fix:** mapped every reference onto the `sales_rep` model, added `sales_rep_id` /
`sales_rep_name` to `DeliveryNote` (keeping the legacy `distributor_*` aliases so the
existing UI keeps working), and added a real `GET /api/reports/agent-performance` endpoint
to replace the dead "Distributors" tab.

### 2.3 `POST /api/auth/logout` always returned 500
`get_optional_user(request)` called `get_current_user(request)`, passing a `Request`
object where a `str` was expected → `AttributeError: 'Request' object has no attribute
'startswith'`. **Users could never log out.** Fixed by extracting `_resolve_session(token)`
and `_extract_token(request)`; `get_current_user` and `get_optional_user` now share them.

### 2.4 `POST /api/auth/register` always returned 500
The handler referenced `body.phone`, but `RegisterRequest` had no `phone` field. First-run
bootstrap was broken. Added the field.

### 2.5 Five endpoints returned 500 as soon as any document existed
`GET /api/requisitions`, `GET /api/requisitions/{id}`, `GET /api/grn`,
`GET /api/grn/{id}` and `GET /api/three-way-match` returned the raw Mongo document,
including the `_id` `ObjectId`, which FastAPI cannot serialise → **500**.
The requisition list was broken from the first requisition; the GRN and 3-way-match
list endpoints were latent (they only worked while their collections were empty).
Fixed by projecting `{"_id": 0}` on every returning query.

### 2.6 `GET /api/reports/supplier-aging` always returned 500
MongoDB returns naive UTC datetimes; the handler subtracted them from an aware
`datetime.now(timezone.utc)` → `TypeError`. The customer-aging endpoint had the guard;
supplier-aging did not.

### 2.7 A route-shadowing bug made the Dispatch screen unusable
`GET /sales-orders/{so_id}` was registered before `GET /sales-orders/pending-dispatch`,
so FastAPI matched the literal path as a `so_id` → **404 on every dispatch-screen load**.
A systematic scan of all 141 routes confirmed this was the only shadowing conflict.
The static route has been moved above the parameterised one.

### 2.8 The Finance tab crashed on mount
`frontend/app/(tabs)/finance.tsx` called `useSafeAreaInsets()` at **module scope**, outside
the component. React throws *"Invalid hook call"* → the whole Finance tab crashed.
TypeScript could not catch this; ESLint's `rules-of-hooks` did.

### 2.9 Stock quantities rendered as "0 500" instead of "500"

*Reported after the first remediation pass — a real defect, now fixed.*

The Inventory screen showed a product with 500 pieces as **"0 500"**.

**Mechanism.** `frontend/app/product/[id].tsx` summed the stock rows with:

```js
.reduce((sum: number, i: any) => sum + i.quantity, 0);
```

When `i.quantity` is a **string**, `+` is string concatenation, not addition.
`0 + "500"` → `"0500"` — the leading `0` is the accumulator, `"500"` is the
stored value. The sibling screen `inventory.tsx` already used the guarded form
(`sum + (Number(s.quantity) || 0)`), which is how the author hit this before and
fixed only one of the two call sites.

**Where the string came from.** The backend had the same bug class. Stock
quantities were updated with `stock["quantity"] + delta`, which concatenates
whenever the stored quantity is a string:

```python
new_qty = stock["quantity"] + adjustment.quantity   # "500" + 5 -> "5005"
```

One such write poisons the row, and every later read hands a string to the
mobile client. The old `/api/sync/push` made it worse by storing the
client-supplied `quantity` verbatim, and the offline-sync order items still
arrived as raw client JSON.

**Fix — three layers:**

1. **Frontend:** `product/[id].tsx` and `quotations.tsx` now coerce with
   `Number(x) || 0` before any arithmetic.
2. **Backend reads:** every quantity leaves the API as a number (`_num()`
   coercion in `/api/inventory`, `/api/inventory/by-warehouse`,
   `/api/inventory/all-warehouses`, the stock-summary and valuation reports,
   the dashboard and the branch summary).
3. **Backend writes:** every stock movement computes
   `_num(stock["quantity"]) + delta`, so a legacy string self-heals instead of
   corrupting further. Client-supplied offline order items are rebuilt through
   `_sanitise_order_items()` with numeric quantity and unit price.
4. **Startup repair:** `_repair_string_quantities()` rewrites any remaining
   `inventory_stock` rows whose quantity was stored as a string, logging how
   many it repaired.

Two regression tests lock this in: the API must never return a string
quantity, and a stock movement against a legacy string row must produce
`495` — never `"5005"`.

---

## 3. Authorization defects — fixed

### 3.1 Eleven endpoints had no permission check at all

| Endpoint | Impact |
|---|---|
| `POST /api/sync/push` | **Any** authenticated user (incl. `viewer`) could inject sales orders, purchase orders and stock movements |
| `PUT /api/quotations/{id}/status` | Any user could accept/reject any quotation |
| `PUT /api/grn/{id}/status` | Any user could mark any GRN received |
| `DELETE /api/expenses/{id}` | Any user could delete expenses |
| `PUT /api/requisitions/{id}/submit` | Any user could submit any requisition |
| `POST /api/requisitions/{id}/convert-to-po` | Any user could create purchase orders |
| `GET /api/inventory/transactions` | Any user could read the full stock ledger |
| `GET /api/inventory/low-stock` | Any user could read stock levels |
| `GET /api/invoices/{id}/pdf` | Any user could download any invoice |
| `GET /api/invoices/{id}/pdf-base64` | Same |
| `GET /api/reports/*/pdf` | Any user could download any financial report |

All now go through `assert_permission(...)` with warehouse scoping where applicable.

### 3.2 Privilege escalation through user management

- **`POST /api/users/create`** accepted any `role` from the request body. An
  **Accountant could mint a `super_admin`**. Now blocked by a role-rank guard, mirrored
  in the frontend role picker (`more.tsx`).
- **`PUT /api/users/{id}`** had no check on the *target's* rank. A General Manager could
  rename, re-warehouse or **deactivate a Super Admin**. Now: you cannot modify a user
  whose role outranks your own, and the last active Super Admin cannot be deactivated
  (that guard previously existed only on `DELETE`).
- **Self-lockout**: a user could change their own role or deactivate their own account.
  Now blocked.
- **Tenancy**: a warehouse manager or accountant could edit users in *other* warehouses.
  Now scoped to their own warehouse.

### 3.3 Self-escalation through the permission matrix
`PUT /api/admin/role-permissions/{role}` let an **Accountant grant itself write access to
every module**. Now: you cannot edit your own role, nor the permissions of a role that
outranks you. (Client requirement #5 — "Accountant can view and manage role permissions" —
is preserved: read access and editing *subordinate* roles still work.)

### 3.4 Cross-tenant (IDOR) leaks — seven endpoints had no warehouse scoping
A warehouse-scoped user could read or modify **other branches' data**:

| Endpoint | Leak |
|---|---|
| `GET /api/inventory` | Read any branch's stock (or all branches by omitting the filter) |
| `POST /api/inventory/adjust` | Adjust stock in **any** warehouse |
| `GET /api/inventory/transactions` | Read the whole stock ledger |
| `GET /api/inventory/low-stock` | Cross-branch stock levels |
| `GET /api/reports/stock-summary` | Cross-branch valuation |
| `GET /api/reports/inventory-valuation` | Cross-branch valuation |
| `GET /api/inventory/all-warehouses` | A warehouse manager received **every** branch's numbers |

All now scoped. `assert_same_warehouse` was also tightened: a user with **no** warehouse
assigned is now denied rather than allowed everything.

### 3.5 `/api/sync/push` allowed mass assignment
The handler spread the client's JSON straight into Mongo (`insert_one({**data, ...})`),
so a client could set any field — `total_amount`, `status`, `created_by`, even the
primary key. The endpoint now rebuilds each document from an explicit whitelist and
propagates permission failures instead of swallowing them into a per-item error list.

### 3.6 Host-header validation was disabled
`TrustedHostMiddleware` was configured with `allowed_hosts=[..., "*"]`, which disables the
check entirely. The wildcard is removed; extra hosts come from a new `ALLOWED_HOSTS`
environment variable.

### 3.7 Brute-force protection was IP-only
The login endpoint was limited to 10 requests/minute **per IP**. On a mobile app behind
carrier-grade NAT — or a whole Nigerian office behind one router — that meant ten logins
per minute for *everyone*. Added a per-identifier throttle (`username + IP`, 8 failures
per 15 minutes) on top of the IP limit, and made the IP limit configurable via
`LOGIN_RATE_LIMIT` (default raised to 30/minute).

### 3.8 Missing limits allowed trivial denial-of-service
`limit` / `days` query parameters were unbounded: `?days=100000` on the sales chart ran
200,000 database queries; `?limit=10000000` loaded millions of documents into memory.
All are now bounded with `Query(..., ge=..., le=...)`.

---

## 4. Data-integrity defects — fixed

| Defect | Impact | Fix |
|---|---|---|
| `Invoice` stores `total`; the 3-way matcher and the trial/balance sheet read `total_amount` | Every 3-way match showed a false discrepancy; AR/AP were always **0**, so the balance sheet never balanced | Corrected the field name in 4 places |
| GRN and transfer upserts omitted `$setOnInsert` | New stock rows had **no `stock_id`** → later `KeyError` in adjust/release/produce | Added `$setOnInsert` with a generated `stock_id` |
| Receiving a PO twice added the stock twice | Stock inflation on a double tap | Idempotency guard → 400 |
| Delivering an SO twice deducted the stock twice | Same | Idempotency guard → 400 |
| `sanitize_string` stripped `+` from phone numbers | `+234801...` was stored as `234801...` | Added `sanitize_phone` |
| `adjust_inventory` allowed negative stock | Stock could go below zero | Guarded → 400 |
| `create_payment` accepted negative amounts | A negative payment *reduced* `paid_amount` | Guarded → 422 |
| `create_expense` / `create_purchase_order` accepted nonsense | Negative amounts, zero-quantity lines, empty orders | Validated → 422 |
| `release_goods` silently skipped a missing stock row | Stock and the agent ledger diverged (goods recorded as issued but never deducted) | Now raises with the available quantity |
| `confirm_warehouse_transfer` never re-checked stock | A transfer could drive the source branch negative | Re-checked at confirmation time |
| `create_grn` accepted any `warehouse_id` | Goods could be received into a branch the PO was not raised for | Must match the PO's warehouse |
| `generate_system_alerts` created a new notification on every poll | Notification list flooded | De-duplicated per product per day |

---

## 5. Frontend defects — fixed

| Defect | Impact |
|---|---|
| `useSafeAreaInsets()` called at module scope in `finance.tsx` | **The Finance tab crashed on mount** |
| `salesAnalysis.by_distributor` / `distributor_name` read, backend returns `by_sales_rep` / `sales_rep_name` | The **Sales Analysis report was always empty** |
| `GET /api/reports/distributor-performance` — endpoint never existed | The **"Distributors" tab was permanently empty** (acknowledged in a code comment) |
| `downloadReportPdf` used `responseType: 'blob'` + `FileReader` | Report PDF export **broken on mobile** (React Native has neither). Now uses new base64 endpoints |
| `eslint.config.js` (flat config) with `eslint-config-expo@7` (legacy only) | `npm run lint` **crashed** before reading a single file |
| `setFormData` missing `initial_warehouse_id` / `initial_quantity` | The only `tsc` error |
| `Users` screen hidden from Accountants | Contradicted the client's requirement #5 and the backend's own permission matrix |
| `syncStore` still mapped the retired `distributors` entity | Offline sync of a non-existent collection |
| `audit-logs` mapped a `distributor` entity type | Wrong icon for agent records |

**Retired-distributor cleanup:** the term no longer appears in any live code path;
`delivery-notes` now prefers `sales_rep_name` with the legacy alias as fallback.

---

## 6. Performance — the N+1 problem

Several endpoints ran **one query per row**:

| Endpoint | Queries before | Queries after |
|---|---|---|
| `GET /api/inventory` | 2 × rows | 3 (batched) |
| `GET /api/inventory/by-warehouse` | 1 × products | 3 (batched) |
| `GET /api/products?low_stock=true` | 1 × products | 2 (batched) |
| `GET /api/inventory/low-stock` | 1 × products | 2 (batched) |
| `GET /api/inventory/all-warehouses` | 1 × products × branches | 3 (batched) |
| `GET /api/dashboard/stats` | 1 × stock rows + 1 × products | 2 (batched) |

On a catalogue of a few thousand SKUs the dashboard previously issued tens of thousands of
round-trips per load. All are now batched with in-memory joins or a single `$group`
aggregation.

**Indexes added** for every previously unindexed hot path: `stock_transactions`,
`notifications`, `requisitions`, `grns`, `three_way_matches`, `quotations`,
`delivery_notes`, `invoices`, `payments`, `expenses`, `sales_orders` (by warehouse +
status), `purchase_orders`, `counters`, plus a TTL index on `user_sessions.expires_at` so
expired sessions are reclaimed automatically.

---

## 7. Correctness details worth knowing

- **Currency.** Every PDF printed `$` while the app is NGN (₦). The symbol is now derived
  from the company record; the default company currency changed from `USD` to `NGN`.
- **Permission cache.** The role-permission cache is per-process and was never
  invalidated across workers — a permission change was invisible to other workers
  forever. Entries now carry a 30-second TTL.
- **401 vs 422.** A missing `Authorization` header produced FastAPI's 422 validation
  error. Clients treat 401 and 422 very differently; the header is now optional and
  produces a proper 401.
- **Malformed `Content-Length`.** `int(content_length)` raised on a non-numeric header
  → 500. Now a clean 400.
- **Audit logs.** Sensitive mutations now record the actor, the entity and the client IP
  (from `X-Forwarded-For`).

---

## 8. Regression suite

Two new suites live in `backend/` and run with `pytest`:

```
backend/test_functional_sweep.py     # 536 requests across all 141 routes, 8 roles, 2 branches
backend/test_security_regression.py  # 42 tests, one per vulnerability above
backend/test_acceptance.py          # 48 scenario tests — full business lifecycles
backend/acceptance_base.py          # seeded world + route-coverage tracker
backend/test_provisioning_scripts.py # 7 tests — the seeding scripts really work
```

```
$ cd backend && pytest -q
98 passed
```

The acceptance suite **asserts route coverage**: it records every request it
makes, maps it back onto a route template, and fails if any of the 141
routes was never exercised. It also drives the complete lifecycles end to end
and checks the resulting documents, stock and balances:

```
requisition → submit → approve → PO → GRN → invoice → 3-way match → approve → payment
agent quotation → submit → approve → SO → dispatch → release goods → confirm delivery
              → delivery note → invoice → agent payment → debt-ceiling flagging
BOM → produce → components consumed, finished goods created
transfer → initiate → confirm → stock moved between branches
```

### Mobile render suite

```
frontend/__tests__/screens.test.tsx        # every screen renders with its heading
frontend/__tests__/screens-content.test.tsx# every screen shows the real records
                                           # and survives an empty API
frontend/__tests__/navigation.test.tsx     # every screen is reachable
```

```
$ cd frontend && npm test
67 passed
```

They run against an in-memory MongoDB (`mongomock-motor`) — no external services needed.

The sweep asserts that **no** endpoint returns a 5xx, that the cross-role sweep only
ever sees 401/403 where the permission matrix says so, and that a curated list of
"must be denied" calls is actually denied.

---

## 9. Configuration changes

| Variable | Default | Purpose |
|---|---|---|
| `ALLOWED_HOSTS` | built-in list | Extra hostnames for `TrustedHostMiddleware`. **Set this if you deploy behind a custom domain**, otherwise requests to that domain return 400. |
| `LOGIN_RATE_LIMIT` | `30/minute` | Per-IP login rate limit. Raise it if many users share one NAT. |
| `PASSWORD_RESET_PROVIDER` | `console` | `console` / `gmail`. With `gmail`, also set `GMAIL_SMTP_USER` and `GMAIL_SMTP_APP_PASS`. |

---

## 9b. Second-round findings — found by the full acceptance suite

A second, deeper pass (a 141-route acceptance sweep with a seeded
multi-branch database, plus a 67-test mobile render suite) surfaced ten more
defects that the first round's status-code assertions could not see.

### Business logic

| Defect | Impact | Fix |
|---|---|---|
| **Goods received twice.** Receiving via a GRN credited the stock, *and* marking the PO `received` credited it again | Inventory inflated by the full ordered quantity on every purchase | The GRN now writes the accepted quantity back onto the PO line; the PO status update credits only lines that were never GRN'd |
| **Trial balance could never balance.** The plug computed `credits − debits` and then pushed a negative figure onto the *debit* side | The two totals moved further apart instead of balancing, and Retained Earnings carried the wrong sign | Plug recomputed as `debits − credits` and applied on the credit side |
| **Balance sheet had no balancing figure.** Capital was hard-coded to `0` and equity was only net income | `is_balanced` was always false for any business holding inventory | Capital is now the balancing figure; equity = capital + retained earnings |
| **Agent collections were invisible to finance.** Cash collected from field agents lives in `agent_ledger_entries`, but the cash-flow report and the dashboard cash balance only read `payments` | The business's primary revenue channel never appeared in the cash-flow report or on the dashboard | Agent collections are now counted as cash inflows in both |
| **A quotation could be converted twice.** The status was never moved to `converted` | Each conversion silently created another sales order for the same quotation | The quotation is marked `converted` and the new `CONVERTED` status is recorded |
| **`sync/push` returned 200 before its permission check** | An unauthorised push of an empty payload was accepted | The permission check now runs first |

### Security

| Defect | Impact | Fix |
|---|---|---|
| **Stock-summary and inventory-valuation reports had no warehouse scoping** | A branch user could export another branch's valuation | Scoped like every other inventory endpoint |
| **`POST /api/barcode/generate` had no permission check** | A viewer could re-issue barcodes on any product | Now requires `products:update` |
| **`/api/security/health` read the middleware config from the wrong object** | It reported `host_header_restricted: false` about a correctly-configured deployment | Reads the real `Middleware.kwargs` |

### Mobile

| Defect | Impact | Fix |
|---|---|---|
| **Four screens were unreachable.** `/warehouse-transfers`, `/product/[id]`, `/order/[id]` and `/partner/[id]` had no link to them anywhere in the app | Stock transfers — a fully built, backend-supported feature — could never be opened by the client. The three detail screens were dead ends | Warehouse Transfers added to the More tab; product/order/partner detail screens linked from the Inventory, Orders and Agent Ledger screens |
| **Three screens crashed on an empty or malformed response.** `performance-dashboard` read `supplierData.summary.total_suppliers`; `financial-reports` read `balanceSheet.assets.current_assets.map`; `role-permissions` read `matrix.roles.filter` | A flaky network or an empty account crashed the screen outright | Optional chaining plus safe defaults throughout |

---

## 9c. Provisioning scripts — the seeding path

The question "how do I get the first super-admin?" is the one every fresh
deployment starts with, so the path was tested end to end. It surfaced four
problems:

| Defect | Impact | Fix |
|---|---|---|
| **The PBKDF2 routine was copy-pasted into four files** (`server.py`, `reset_passwords.py`, `scripts/reset_passwords.py`, and inline in `seed_admin.py`) | Changing the iteration count in one copy produced hashes the login endpoint could not verify — seeded accounts simply could not sign in, with no error to explain why | Extracted to `backend/passwords.py`; every file imports it. A test now asserts the routine is defined in exactly one place |
| **`seed_admin.py`'s docstring promised a promotion path that was never implemented** | A database with users but no admin could not be bootstrapped | The promotion is now implemented: the earliest user is promoted to `super_admin` and given the password you pass |
| **The seeded account had no phone number** | The account was incomplete against the user model and the Users screen showed a blank | `--phone` added and stored in E.164 form |
| **The script did not seed the role-permission matrix** | The Role Permissions screen was empty until the API booted for the first time | The matrix is now seeded by the script |

`backend/test_provisioning_scripts.py` runs the real scripts against an
in-memory database and then proves the accounts they create **can actually
sign in through the API** — the failure mode that matters most, and the one a
status-code-only test would miss.

---

## 10. Known limitations (not defects — design decisions to confirm)

1. **Day boundaries use UTC.** `today_sales` and the branch summary start at UTC
   midnight; Lagos is UTC+1, so the "today" bucket shifts by an hour. A
   `TZ`-aware day boundary would be more correct for a Nigerian deployment.
2. **Ledger outstanding loads entries into memory** (capped at 10,000) before summing.
   At very high transaction counts this should become a Mongo `$sum` aggregation.
3. **`/api/company` is a single-company collection** (`find_one({})`). The multi-tenant
   schema the models imply (`company_id` everywhere) is not implemented — fine for a
   single-tenant deployment, not for SaaS.
4. **Sessions are stored as plaintext tokens** in `db.user_sessions`. Acceptable for
   this scale; hashing them would be the next hardening step.
5. **`sanitize_string` strips apostrophes and accents** from names. Cosmetic, but
   `O'Brien` becomes `OBrien`.
6. **67 ESLint warnings remain** (mostly `exhaustive-deps` on `loadData` callbacks and
   unused variables). None are errors; the `exhaustive-deps` ones are worth a follow-up
   pass because a stale closure can read stale data.
