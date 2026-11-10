# BizCore V2 — ERP for Nigerian SMEs

Mobile ERP: **React Native (Expo 51)** app + **FastAPI** backend + **MongoDB**.

Inventory, purchasing, sales, agents, warehouses, finance, and reporting — with a
role-and-warehouse scoped permission model.

---

## Quick start

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export MONGO_URL="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
export DB_NAME="bizcore_db"
export PORT=8080

python seed_admin.py --email admin@yourcompany.ng     # creates the FIRST super_admin
uvicorn server:app --host 0.0.0.0 --port 8080
```

---

## Seeding the first super-admin

**You need exactly one `super_admin` before anything else.** Every other
account is created from the in-app **Users** screen, which enforces the role
hierarchy and writes the audit trail. The API's self-registration endpoint is
closed as soon as one user exists.

```bash
cd backend

export MONGO_URL="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
export DB_NAME="bizcore_db"

python seed_admin.py \
    --username admin \
    --email admin@yourcompany.ng \
    --phone '+2348012345678' \
    --name 'Initial Admin'
```

Omit `--username` / `--password` and it generates a strong random username and
password and prints them once. **The password is not recoverable** — store it
before you close the terminal.

| Flag | Required | Notes |
|---|---|---|
| `--email` | ✅ | Must contain `@`. Used as the login name too. |
| `--username` | | Defaults to the email's local part. Must match `^[a-z0-9_.-]{3,60}$`. |
| `--password` | | Minimum 6 characters. Omit for a generated one. |
| `--name` | | Display name. Defaults to the username. |
| `--phone` | | Optional. Stored in E.164 form. |

**What the script does**

| Database state | Result |
|---|---|
| Empty | Creates a new `super_admin` with the given credentials |
| Users exist, none is an admin | **Promotes** the earliest user to `super_admin` and sets the password you pass (`--password` is then required) |
| A `super_admin` already exists | Refuses and exits with code `3` — use the in-app Users screen instead |

It also seeds the role-permission matrix, so the Role Permissions screen is
populated from the very first boot.

### Then add the rest of the team

Sign in with the seeded account → **More → Team Members → +**. From there:

* **Super Admin / General Manager** — create, edit, deactivate and delete any user.
* **Accountant** — create and edit users in their own branch.
* Anyone else — read-only.

Deleting a user soft-deactivates them (their history is preserved). Use
**Reactivate** to restore them.

### If someone forgets their password

```bash
# one user, from the command line
python scripts/reset_passwords.py --email user@yourcompany.ng

# ...or every user at once (also writes passwords.csv)
python reset_passwords.py
```

The in-app **Forgot password? / Forgot username?** flow works too, but it
delivers the reset token by email, which needs `PASSWORD_RESET_PROVIDER=gmail`
plus `GMAIL_SMTP_USER` / `GMAIL_SMTP_APP_PASS` configured.

> Password hashing lives in **`backend/passwords.py`** — the API and every
> provisioning script import it from there. Do not copy it into another file:
> a mismatch silently produces passwords that will not log in.

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
npx expo start
```

Point the app at your backend with `.env`:

```
EXPO_PUBLIC_BACKEND_URL=https://your-backend.example.com
```

---

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGO_URL` | ✅ | — | MongoDB connection string |
| `DB_NAME` | | `bizcore_db` | Database name |
| `PORT` | | `8080` | HTTP port |
| `ALLOWED_ORIGINS` | | built-in list | Comma-separated CORS origins |
| `ALLOWED_HOSTS` | | built-in list | **Extra hostnames.** Set this when deploying behind a custom domain, otherwise requests to it return 400. |
| `ENABLE_HTTPS_REDIRECT` | | `false` | Set `1` only if you terminate TLS at the app (not behind Railway/Fly) |
| `LOGIN_RATE_LIMIT` | | `30/minute` | Per-IP login limit. Raise it if many users share one NAT/router. |
| `PASSWORD_RESET_PROVIDER` | | `console` | `console` (dev) or `gmail` |
| `GMAIL_SMTP_USER` / `GMAIL_SMTP_APP_PASS` | | — | Required when the provider is `gmail` |
| `DAILY_SEND_CAP` | | `100` | Password-reset emails per UTC day |

---

## Roles

| Role | Scope |
|---|---|
| `super_admin` | Full access, all warehouses |
| `general_manager` | Full access, all warehouses |
| `accountant` | Finance oversight across all branches; manages users in their branch |
| `warehouse_manager` | Full access within their assigned warehouse |
| `purchase_clerk` | PO → GRN → 3-way match, requisitions |
| `sales_clerk` | Fulfilment: release goods, delivery notes |
| `sales_rep` | Field agent: quotations, own ledger |
| `viewer` | Read-only |

The CRUD matrix is editable at runtime (`/role-permissions`) and is stored in
`db.role_permissions`. Core-workflow operations are always granted to the owning role —
see `MANDATORY_OPERATIONS` in `backend/permissions.py`.

---

## API

141 routes under `/api`. Authenticate with `Authorization: Bearer <session_token>`;
tokens are issued by `POST /api/auth/login` and live for 7 days.

`GET /api/security/health` reports the deployment's live security posture.

---

## Tests

```bash
cd backend
pytest -q                       # 91 tests: sweep + security + acceptance
```

The suite runs against an in-memory MongoDB — no external services required.
The acceptance suite asserts that **every route was exercised** and drives the
complete procurement, sales, production and transfer lifecycles.

Frontend checks:

```bash
cd frontend
npx tsc --noEmit                # 0 errors
npx eslint . --ext .ts,.tsx     # 0 errors
npm test                        # 67 tests: every screen renders, shows content,
                                # survives empty data, and is reachable
```

---

## Documentation

- [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) — full code audit, defects found and fixed
- [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md) — white-label deployment
- [`memory/PRD.md`](./memory/PRD.md) — product requirements
