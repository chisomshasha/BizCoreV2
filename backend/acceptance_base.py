"""
BizCore V2 — acceptance-test fixtures.

Not a test module itself: provides a fully seeded, multi-role, multi-branch
world plus a route-coverage tracker so the suite can *prove* it exercised
every endpoint rather than assuming it did.
"""
import os
import re
import sys
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "bizcore_acceptance")
os.environ.setdefault("PASSWORD_RESET_PROVIDER", "console")
os.environ.setdefault("LOGIN_RATE_LIMIT", "1000/minute")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

PASSWORD = "Passw0rd!23"
NOW = datetime.now(timezone.utc)
SOON = (NOW + timedelta(days=30)).isoformat()
PAST = (NOW - timedelta(days=10)).isoformat()

ROLES = ["super_admin", "general_manager", "accountant", "warehouse_manager",
         "purchase_clerk", "sales_clerk", "sales_rep", "viewer"]


# ─────────────────────────────────────────────────────────────────────────────
# Route coverage tracker
# ─────────────────────────────────────────────────────────────────────────────
def _route_templates(app):
    out = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if not path or not methods or not path.startswith("/api"):
            continue
        for m in methods:
            if m in ("HEAD", "OPTIONS"):
                continue
            out.add((m, path))
    return out


class Coverage:
    def __init__(self, app):
        self.app = app
        self.called = set()
        self.counts = {}
        self.unmatched = set()

    def record(self, method, url_path):
        concrete = url_path.split("?")[0]
        cs = concrete.strip("/").split("/")
        for route in self.app.routes:
            path = getattr(route, "path", None)
            methods = getattr(route, "methods", None)
            if not path or not methods or not path.startswith("/api"):
                continue
            ps = path.strip("/").split("/")
            if len(cs) != len(ps):
                continue
            if all(p.startswith("{") or p == c for c, p in zip(cs, ps)):
                if method in methods:
                    self.called.add((method, path))
                    self.counts[(method, path)] = self.counts.get((method, path), 0) + 1
                    return
                # Same path, different verb — keep looking (e.g. GET
                # /api/products vs POST /api/products).
        self.unmatched.add((method, concrete))

    def missing(self):
        return sorted(_route_templates(self.app) - self.called)

    def report(self):
        all_r = _route_templates(self.app)
        lines = []
        for m, p in sorted(all_r):
            n = self.counts.get((m, p), 0)
            lines.append(f"  {'OK ' if n else 'MISS'} {n:>4}x  {m:6} {p}")
        return "\n".join(lines)


class TrackedClient:
    """Wraps TestClient so every request is recorded for coverage analysis."""

    def __init__(self, client, coverage):
        self._c = client
        self._cov = coverage

    def request(self, method, url, **kw):
        self._cov.record(method.upper(), url)
        return self._c.request(method, url, **kw)

    def get(self, url, **kw):
        return self.request("GET", url, **kw)

    def post(self, url, **kw):
        return self.request("POST", url, **kw)

    def put(self, url, **kw):
        return self.request("PUT", url, **kw)

    def delete(self, url, **kw):
        return self.request("DELETE", url, **kw)

    def patch(self, url, **kw):
        return self.request("PATCH", url, **kw)


# ─────────────────────────────────────────────────────────────────────────────
# Seed — a realistic operating business
# ─────────────────────────────────────────────────────────────────────────────
def _user(uid, username, email, role, warehouse=None, debt_ceiling=0.0):
    return {
        "user_id": uid, "username": username, "email": email,
        "name": username.replace("_", " ").title(), "phone": "+2348000000001",
        "role": role, "warehouse_id": warehouse,
        "warehouse_name": {"wh_lagos": "Lagos Main", "wh_abuja": "Abuja Branch"}
                            .get(warehouse),
        "is_active": True, "is_invited": False,
        "debt_ceiling": debt_ceiling, "is_flagged": False,
        "password_hash": None, "created_at": NOW, "updated_at": NOW,
    }


@pytest.fixture(scope="session")
def env():
    import server as srv

    srv.client = AsyncMongoMockClient()
    srv.db = srv.client["bizcore_acceptance"]
    db = srv.db

    async def seed():
        from permissions import seed_default_permissions
        await seed_default_permissions(db)

        users = [
            _user("u_sa", "superadmin", "sa@bizcore.test", "super_admin"),
            _user("u_sa2", "superadmin2", "sa2@bizcore.test", "super_admin"),
            _user("u_gm", "gm", "gm@bizcore.test", "general_manager"),
            _user("u_wm", "wm", "wm@bizcore.test", "warehouse_manager", "wh_lagos"),
            _user("u_wm2", "wm2", "wm2@bizcore.test", "warehouse_manager", "wh_abuja"),
            _user("u_acc", "acc", "acc@bizcore.test", "accountant", "wh_lagos"),
            _user("u_acc2", "acc2", "acc2@bizcore.test", "accountant", "wh_abuja"),
            _user("u_pc", "pc", "pc@bizcore.test", "purchase_clerk", "wh_lagos"),
            _user("u_sc", "sc", "sc@bizcore.test", "sales_clerk", "wh_lagos"),
            _user("u_rep", "rep", "rep@bizcore.test", "sales_rep", "wh_lagos", 500000.0),
            _user("u_rep2", "rep2", "rep2@bizcore.test", "sales_rep", "wh_abuja", 500000.0),
            _user("u_view", "viewer", "viewer@bizcore.test", "viewer", "wh_lagos"),
        ]
        for u in users:
            u["password_hash"] = srv.hash_password(PASSWORD)
        await db.users.insert_many(users)

        await db.warehouses.insert_many([
            {"warehouse_id": "wh_lagos", "name": "Lagos Main", "address": "Ikeja",
             "capacity": 10000, "is_active": True, "created_at": NOW},
            {"warehouse_id": "wh_abuja", "name": "Abuja Branch", "address": "Wuse",
             "capacity": 5000, "is_active": True, "created_at": NOW},
            {"warehouse_id": "wh_kano", "name": "Kano Depot", "address": "Kano",
             "capacity": 2000, "is_active": True, "created_at": NOW},
        ])

        await db.products.insert_many([
            {"product_id": "p_tomato", "sku": "RAW-TOM", "name": "Tomatoes", "category": "raw",
             "unit": "kg", "cost_price": 100.0, "selling_price": 200.0, "reorder_level": 50,
             "min_stock": 0, "max_stock": 5000, "barcode": "BC-TOM-1", "is_active": True,
             "created_at": NOW, "updated_at": NOW},
            {"product_id": "p_paste", "sku": "FIN-PAS", "name": "Tomato Paste", "category": "finished",
             "unit": "tin", "cost_price": 800.0, "selling_price": 1500.0, "reorder_level": 20,
             "min_stock": 0, "max_stock": 1000, "barcode": "BC-PAS-1", "is_active": True,
             "created_at": NOW, "updated_at": NOW},
            {"product_id": "p_tin", "sku": "PKG-TIN", "name": "Tin Packaging", "category": "packaging",
             "unit": "pcs", "cost_price": 50.0, "selling_price": 90.0, "reorder_level": 30,
             "min_stock": 0, "max_stock": 2000, "is_active": True,
             "created_at": NOW, "updated_at": NOW},
        ])

        await db.inventory_stock.insert_many([
            {"stock_id": "st_tom_lag", "product_id": "p_tomato", "warehouse_id": "wh_lagos",
             "quantity": 500, "last_updated": NOW},
            {"stock_id": "st_pas_lag", "product_id": "p_paste", "warehouse_id": "wh_lagos",
             "quantity": 40, "last_updated": NOW},
            {"stock_id": "st_tom_abj", "product_id": "p_tomato", "warehouse_id": "wh_abuja",
             "quantity": 250, "last_updated": NOW},
            {"stock_id": "st_tin_lag", "product_id": "p_tin", "warehouse_id": "wh_lagos",
             "quantity": 300, "last_updated": NOW},
        ])

        await db.suppliers.insert_many([
            {"supplier_id": "sup_farm", "name": "Farm Fresh Ltd", "contact_person": "Ada",
             "phone": "+2348001111111", "email": "ada@farm.test", "address": "Ibadan",
             "payment_terms_days": 30, "rating": 4.5, "is_active": True,
             "created_at": NOW, "updated_at": NOW},
            {"supplier_id": "sup_sun", "name": "Sunrise Co", "contact_person": "Bola",
             "phone": "+2348002222222", "email": "bola@sun.test", "address": "Kano",
             "payment_terms_days": 14, "rating": 3.8, "is_active": True,
             "created_at": NOW, "updated_at": NOW},
        ])

        await db.companies.insert_one({
            "company_id": "comp_1", "name": "BizCore Foods Ltd", "address": "Lagos",
            "tax_id": "TIN-1", "currency": "NGN", "fiscal_year_start": 1, "created_at": NOW})

        await db.chart_of_accounts.insert_many([
            {"account_id": "a_1000", "code": "1000", "name": "Cash", "type": "asset",
             "balance": 0, "is_active": True, "created_at": NOW},
            {"account_id": "a_2100", "code": "2100", "name": "Payables", "type": "liability",
             "balance": 0, "is_active": True, "created_at": NOW},
            {"account_id": "a_4000", "code": "4000", "name": "Sales", "type": "income",
             "balance": 0, "is_active": True, "created_at": NOW},
            {"account_id": "a_5000", "code": "5000", "name": "Cost of Sales", "type": "expense",
             "balance": 0, "is_active": True, "created_at": NOW},
        ])

    asyncio.run(seed())
    return srv


@pytest.fixture(scope="session")
def world(env):
    srv = env
    with TestClient(srv.app, raise_server_exceptions=False) as raw:
        cov = Coverage(srv.app)
        c = TrackedClient(raw, cov)
        tokens = {}
        for key, username in [
            ("sa", "superadmin"), ("sa2", "superadmin2"), ("gm", "gm"),
            ("wm", "wm"), ("wm2", "wm2"), ("acc", "acc"), ("acc2", "acc2"),
            ("pc", "pc"), ("sc", "sc"), ("rep", "rep"), ("rep2", "rep2"),
            ("viewer", "viewer"),
        ]:
            r = c.post("/api/auth/login", json={"username": username, "password": PASSWORD})
            assert r.status_code == 200, f"login {username}: {r.status_code} {r.text}"
            tokens[key] = r.json()["session_token"]
        yield {"c": c, "cov": cov, "H": {k: {"Authorization": f"Bearer {v}"}
                                         for k, v in tokens.items()},
               "srv": srv, "db": srv.db, "tokens": tokens, "raw": raw}


@pytest.fixture(scope="session")
def ids(world):
    """Shared ids of entities created by the scenario tests."""
    return {}


def hdr(world, role):
    return world["H"][role]


def relogin(world, role, username, password=PASSWORD):
    """Re-authenticate a role and refresh its cached header."""
    r = world["c"].post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, f"relogin {username}: {r.status_code} {r.text}"
    tok = r.json()["session_token"]
    world["H"][role] = {"Authorization": f"Bearer {tok}"}
    world["tokens"][role] = tok
    return world["H"][role]


def make_user(world, role, name, email, username, user_role="viewer", warehouse=None):
    """Create a throwaway user (used by destructive auth tests)."""
    r = world["c"].post("/api/users/create", headers=world["H"][role], json={
        "name": name, "email": email, "phone": "+2348010000000",
        "role": user_role, "warehouse_id": warehouse})
    assert r.status_code == 200, f"create {username}: {r.status_code} {r.text}"
    return r.json()


def ok(r, expect=(200, 201), label=""):
    assert r.status_code in expect, (
        f"{label or r.request.url} -> {r.status_code}\n{r.text[:600]}")
    if r.text.strip().startswith(("{", "[")):
        return r.json()
    return r.text
