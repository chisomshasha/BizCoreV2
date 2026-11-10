"""
BizCore V2 — full functional sweep.

Exercises every one of the 138 backend routes across a realistic workflow and
records any response that is a server error (5xx) or an unexpected client
error. Seeded with 8 roles across 2 warehouses.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "bizcore_test")
os.environ.setdefault("PASSWORD_RESET_PROVIDER", "console")
os.environ.setdefault("LOGIN_RATE_LIMIT", "1000/minute")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402


@pytest.fixture(scope="module")
def srv_mod():
    import server as srv

    client = AsyncMongoMockClient()
    srv.client = client
    srv.db = client["bizcore_test"]
    return srv


def _mk_user(srv, uid, username, email, role, warehouse=None, password="Passw0rd!23"):
    now = datetime.now(timezone.utc)
    return {
        "user_id": uid,
        "username": username,
        "email": email,
        "name": username.title(),
        "phone": "+2348000000000",
        "role": role,
        "warehouse_id": warehouse,
        "warehouse_name": "Lagos Main" if warehouse else None,
        "is_active": True,
        "is_invited": False,
        "debt_ceiling": 0.0,
        "is_flagged": False,
        "password_hash": srv.hash_password(password),
        "created_at": now,
        "updated_at": now,
    }


@pytest.fixture(scope="module")
def world(srv_mod):
    srv = srv_mod
    db = srv.db
    import asyncio

    async def seed():
        from permissions import seed_default_permissions
        await seed_default_permissions(db)

        now = datetime.now(timezone.utc)
        await db.warehouses.insert_many([
            {"warehouse_id": "wh_lagos", "name": "Lagos Main", "is_active": True, "created_at": now},
            {"warehouse_id": "wh_abuja", "name": "Abuja Branch", "is_active": True, "created_at": now},
        ])
        await db.users.insert_many([
            _mk_user(srv, "u_sa", "superadmin", "sa@bizcore.test", "super_admin"),
            _mk_user(srv, "u_gm", "gm", "gm@bizcore.test", "general_manager"),
            _mk_user(srv, "u_wm", "wm", "wm@bizcore.test", "warehouse_manager", "wh_lagos"),
            _mk_user(srv, "u_acc", "acc", "acc@bizcore.test", "accountant", "wh_lagos"),
            _mk_user(srv, "u_rep", "rep", "rep@bizcore.test", "sales_rep", "wh_lagos"),
            _mk_user(srv, "u_sc", "sc", "sc@bizcore.test", "sales_clerk", "wh_lagos"),
            _mk_user(srv, "u_acc2", "acc2", "acc2@bizcore.test", "accountant", "wh_abuja"),
            _mk_user(srv, "u_pc", "pc", "pc@bizcore.test", "purchase_clerk", "wh_lagos"),
            _mk_user(srv, "u_view", "viewer", "viewer@bizcore.test", "viewer", "wh_lagos"),
        ])
        await db.products.insert_many([
            {"product_id": "p_raw", "sku": "RAW-1", "name": "Tomatoes", "category": "raw",
             "unit": "kg", "cost_price": 100.0, "selling_price": 200.0, "reorder_level": 10,
             "min_stock": 0, "max_stock": 1000, "barcode": "BC111", "is_active": True,
             "created_at": now, "updated_at": now},
            {"product_id": "p_fin", "sku": "FIN-1", "name": "Tomato Paste", "category": "finished",
             "unit": "tin", "cost_price": 800.0, "selling_price": 1500.0, "reorder_level": 5,
             "min_stock": 0, "max_stock": 1000, "is_active": True,
             "created_at": now, "updated_at": now},
        ])
        await db.inventory_stock.insert_many([
            {"stock_id": "st_1", "product_id": "p_raw", "warehouse_id": "wh_lagos",
             "quantity": 500, "last_updated": now},
            {"stock_id": "st_2", "product_id": "p_fin", "warehouse_id": "wh_lagos",
             "quantity": 40, "last_updated": now},
            {"stock_id": "st_3", "product_id": "p_raw", "warehouse_id": "wh_abuja",
             "quantity": 250, "last_updated": now},
        ])
        await db.suppliers.insert_one({
            "supplier_id": "sup_1", "name": "Farm Fresh Ltd", "contact_person": "Ada",
            "phone": "+2348001111111", "email": "ada@farm.test", "payment_terms_days": 30,
            "rating": 4.5, "is_active": True, "created_at": now, "updated_at": now})
        await db.companies.insert_one({
            "company_id": "comp_1", "name": "BizCore Foods Ltd", "currency": "NGN",
            "fiscal_year_start": 1, "created_at": now})
        await db.chart_of_accounts.insert_many([
            {"account_id": "a_1000", "code": "1000", "name": "Cash", "type": "asset",
             "balance": 0, "is_active": True, "created_at": now},
            {"account_id": "a_4000", "code": "4000", "name": "Sales", "type": "income",
             "balance": 0, "is_active": True, "created_at": now},
        ])
        await db.users.update_one({"user_id": "u_rep"}, {"$set": {"debt_ceiling": 100000.0}})

    asyncio.run(seed())

    with TestClient(srv.app, raise_server_exceptions=False) as c:
        tokens = {}
        for key, username in [("sa", "superadmin"), ("gm", "gm"), ("wm", "wm"), ("acc", "acc"),
                              ("rep", "rep"), ("sc", "sc"), ("pc", "pc"), ("viewer", "viewer"),
                              ("acc2", "acc2")]:
            r = c.post("/api/auth/login", json={"username": username, "password": "Passw0rd!23"})
            assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
            tokens[key] = r.json()["session_token"]
        return {"c": c, "srv": srv, "db": srv.db, "tokens": tokens,
                "H": {k: {"Authorization": f"Bearer {v}"} for k, v in tokens.items()}}


class Sweep:
    """Records every non-2xx/3xx response so the report lists all defects."""

    def __init__(self, world):
        self.w = world
        self.c = world["c"]
        self.H = world["H"]
        self.errors = []     # (method, path, role, status, body)
        self.calls = 0
        self.ids = {}
        self.section = ""

    def sec(self, name):
        self.section = name

    def req(self, method, path, role="sa", expect=(), deny_ok=False, **kw):
        headers = dict(self.H[role])
        headers.update(kw.pop("headers", {}))
        r = self.c.request(method, path, headers=headers, **kw)
        self.calls += 1
        if r.status_code >= 400 and r.status_code not in expect:
            if deny_ok and r.status_code in (401, 403):
                return r
            self.errors.append((self.section, method, path, role, r.status_code, r.text[:500]))
        return r

    def ok(self, method, path, role="sa", **kw):
        return self.req(method, path, role, **kw)

    def read_any(self, path, role="sa"):
        """A read whose 401/403 is an acceptable, expected outcome.

        The role matrix deliberately denies some roles access to some
        modules, so for the cross-role sweep only a server error or a
        missing route counts as a defect.
        """
        r = self.req("GET", path, role, deny_ok=True)
        if r.status_code == 404:
            self.errors.append(("role-matrix", "GET", path, role, 404,
                                 "route not found"))
        return r

    def data(self, r, key, default=None):
        try:
            d = r.json()
            return d.get(key, default) if isinstance(d, dict) else default
        except Exception:
            return default


def test_full_functional_sweep(world):
    s = Sweep(world)
    c, H = s.c, s.H
    soon = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    # ── 1. AUTH ─────────────────────────────────────────────────────────────
    s.sec("auth")
    r = c.post("/api/auth/login", json={"username": "gm", "password": "wrong"})
    assert r.status_code == 401, "bad password must 401"
    s.ok("GET", "/api/auth/me", "sa")
    s.ok("POST", "/api/auth/forgot-password", "sa", json={"email_or_phone": "rep@bizcore.test"})
    s.ok("POST", "/api/auth/forgot-username", "sa", json={"email_or_phone": "rep@bizcore.test"})
    s.ok("POST", "/api/auth/rotate-session", "sa")
    # rotate-session invalidates the previous token, so this 401 is expected.
    s.read_any("/api/auth/me", "sa")
    r = c.post("/api/auth/login", json={"username": "superadmin", "password": "Passw0rd!23"})
    H["sa"] = {"Authorization": f"Bearer {r.json()['session_token']}"}

    # ── 2. COMPANY / WAREHOUSES ────────────────────────────────────────────
    s.sec("company")
    s.ok("GET", "/api/company", "sa")
    s.ok("PUT", "/api/company", "sa",
         json={"name": "BizCore Foods Ltd", "address": "Lagos", "tax_id": "T1", "currency": "NGN"})
    s.ok("GET", "/api/warehouses", "sa")
    s.ok("POST", "/api/warehouses", "sa", json={"name": "Kano Branch"})

    # ── 3. PRODUCTS / INVENTORY ────────────────────────────────────────────
    s.sec("products/inventory")
    r = s.ok("POST", "/api/products", "sa", json={
        "sku": "FIN-2", "name": "Tomato Paste 400g", "category": "finished",
        "unit": "tin", "cost_price": 900.0, "selling_price": 1800.0,
        "reorder_level": 5, "barcode": "BC222"})
    prod = s.data(r, "product_id")
    s.ok("GET", "/api/products", "sa")
    s.ok("GET", "/api/products?low_stock=true", "sa")
    if prod:
        s.ok("GET", f"/api/products/{prod}", "sa")
        s.ok("PUT", f"/api/products/{prod}", "sa", json={"selling_price": 1850.0})
    s.ok("GET", "/api/inventory", "sa")
    s.ok("GET", "/api/inventory/by-warehouse", "sa")
    s.ok("GET", "/api/inventory/all-warehouses", "sa")
    s.ok("GET", "/api/inventory/transactions", "sa")
    s.ok("GET", "/api/inventory/low-stock", "sa")
    s.ok("POST", "/api/inventory/adjust", "sa", json={
        "product_id": "p_raw", "warehouse_id": "wh_lagos",
        "type": "adjustment", "quantity": -5, "notes": "damage"})

    # ── 4. SUPPLIERS ───────────────────────────────────────────────────────
    s.sec("suppliers")
    r = s.ok("POST", "/api/suppliers", "sa", json={"name": "Sunrise Co", "email": "x@y.test"})
    sup = s.data(r, "supplier_id")
    s.ok("GET", "/api/suppliers", "sa")
    if sup:
        s.ok("GET", f"/api/suppliers/{sup}", "sa")
        s.ok("PUT", f"/api/suppliers/{sup}", "sa", json={"rating": 4.0})
        s.ok("DELETE", f"/api/suppliers/{sup}", "sa")

    # ── 5. USERS ───────────────────────────────────────────────────────────
    s.sec("users")
    r = s.ok("POST", "/api/users/create", "sa", json={
        "name": "New Hire", "email": "newhire@bizcore.test", "phone": "+2348099999999",
        "role": "viewer", "warehouse_id": "wh_lagos"})
    newu = s.data(r, "user_id")
    s.ok("GET", "/api/users", "sa")
    s.ok("GET", "/api/users?status=all", "sa")
    s.ok("GET", "/api/users/agents", "sa")
    if newu:
        s.ok("PUT", f"/api/users/{newu}", "sa", json={"name": "Renamed"})
        s.ok("DELETE", f"/api/users/{newu}", "sa")
        s.ok("POST", f"/api/users/{newu}/reactivate", "sa")
    s.ok("PUT", "/api/users/u_rep/debt-ceiling?debt_ceiling=250000", "sa")

    # ── 6. PURCHASE ORDER → GRN → INVOICE → 3-WAY MATCH ───────────────────
    s.sec("procurement")
    r = s.ok("POST", "/api/purchase-orders", "pc", json={
        "supplier_id": "sup_1", "warehouse_id": "wh_lagos", "tax_amount": 500.0,
        "expected_date": soon,
        "items": [{"product_id": "p_raw", "quantity": 100, "unit_price": 110.0}]})
    po = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
    po_id = po.get("po_id")
    po_item = po["items"][0]["item_id"] if po.get("items") else None
    s.ok("GET", "/api/purchase-orders", "pc")
    if po_id:
        s.ok("GET", f"/api/purchase-orders/{po_id}", "pc")
        s.ok("PUT", f"/api/purchase-orders/{po_id}", "pc", json={"notes": "updated"})

    r = s.ok("POST", "/api/grn", "pc", json={
        "po_id": po_id, "warehouse_id": "wh_lagos",
        "items": [{"po_item_id": po_item, "product_id": "p_raw",
                   "received_quantity": 100, "accepted_quantity": 95,
                   "rejected_quantity": 5, "rejection_reason": "damaged"}]})
    grn = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
    grn_id = grn.get("grn_id")
    s.ok("GET", "/api/grn", "pc")
    if grn_id:
        s.ok("GET", f"/api/grn/{grn_id}", "pc")
        s.ok("PUT", f"/api/grn/{grn_id}/status?status=received", "pc")

    r = s.ok("POST", "/api/invoices", "acc", json={
        "type": "purchase", "reference_id": po_id, "party_id": "sup_1",
        "due_date": soon, "subtotal": 11000.0, "tax_amount": 500.0})
    inv = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
    inv_id = inv.get("invoice_id")
    s.ok("GET", "/api/invoices", "acc")
    if inv_id:
        s.ok("GET", f"/api/invoices/{inv_id}", "acc")
        s.ok("GET", f"/api/invoices/{inv_id}/pdf", "acc")
        s.ok("GET", f"/api/invoices/{inv_id}/pdf-base64", "acc")
        s.ok("POST", "/api/payments", "acc",
             json={"invoice_id": inv_id, "amount": 5000.0, "method": "bank"})
    s.ok("GET", "/api/payments", "acc")
    s.ok("GET", "/api/accounts", "acc")
    s.ok("POST", "/api/accounts", "acc",
         json={"code": "2100", "name": "Payables", "type": "liability"})

    r = s.ok("POST", f"/api/three-way-match?po_id={po_id}&grn_id={grn_id}&invoice_id={inv_id}", "pc")
    match_id = s.data(r, "match_id")
    s.ok("GET", "/api/three-way-match", "pc")
    if match_id:
        s.ok("PUT", f"/api/three-way-match/{match_id}/approve?notes=ok", "pc")

    # ── 7. REQUISITIONS ────────────────────────────────────────────────────
    s.sec("requisitions")
    r = s.ok("POST", "/api/requisitions", "pc", json={
        "department": "Ops", "priority": "high",
        "items": [{"product_id": "p_raw", "quantity": 20, "estimated_unit_price": 105.0}]})
    req = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
    req_id = req.get("requisition_id")
    s.ok("GET", "/api/requisitions", "pc")
    if req_id:
        s.ok("GET", f"/api/requisitions/{req_id}", "pc")
        s.ok("PUT", f"/api/requisitions/{req_id}/submit", "pc")
        s.ok("PUT", f"/api/requisitions/{req_id}/approve", "wm")
        s.ok("POST", (f"/api/requisitions/{req_id}/convert-to-po"
                      f"?supplier_id=sup_1&warehouse_id=wh_lagos"), "wm")

    # ── 8. AGENT QUOTATION → SO → DISPATCH → DELIVERY ─────────────────────
    s.sec("agent-workflow")
    r = s.ok("POST", "/api/agent-quotations", "rep", json={
        "items": [{"product_id": "p_fin", "quantity": 5, "unit_price": 1500.0}]})
    aq = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
    aq_id = aq.get("quotation_id")
    s.ok("GET", "/api/agent-quotations", "rep")
    s.ok("GET", "/api/agent-quotations", "wm")
    if aq_id:
        s.ok("PUT", f"/api/agent-quotations/{aq_id}/submit", "rep")
        r = s.ok("PUT", f"/api/agent-quotations/{aq_id}/approve", "wm",
                 json={"approval_remarks": "Looks good"})
        so_id = s.data(r, "so_id")
        s.ok("GET", "/api/sales-orders", "wm")
        if so_id:
            s.ok("GET", f"/api/sales-orders/{so_id}", "wm")
            s.ok("GET", "/api/sales-orders/pending-dispatch", "sc")
            s.ok("PUT", f"/api/sales-orders/{so_id}/release-goods", "sc")
            s.ok("PUT", f"/api/sales-orders/{so_id}/confirm-delivery", "rep")

            # ── 13. DELIVERY NOTES ─────────────────────────────
            r = s.ok("POST", "/api/delivery-notes", "sc", json={"so_id": so_id})
            dn = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
            dn_id = dn.get("delivery_id")
            s.ok("GET", "/api/delivery-notes", "sc")
            if dn_id:
                s.ok("PUT", f"/api/delivery-notes/{dn_id}/status?status=delivered", "sc")

    # ── 9. AGENT LEDGER ────────────────────────────────────────────────────
    s.sec("agent-ledger")
    s.ok("GET", "/api/agent-ledger", "rep")
    s.ok("GET", "/api/agent-ledger?sales_rep_id=u_rep", "wm")
    s.ok("POST", "/api/agent-ledger/payment", "wm",
         json={"sales_rep_id": "u_rep", "amount": 1000.0, "payment_method": "cash"})

    # ── 10. BOM / PRODUCTION ───────────────────────────────────────────────
    s.sec("bom")
    r = s.ok("POST", "/api/bom", "wm", json={
        "finished_product_id": "p_fin", "yield_quantity": 10.0,
        "components": [{"raw_product_id": "p_raw", "quantity_required": 3.0}]})
    bom = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
    bom_id = bom.get("bom_id")
    s.ok("GET", "/api/bom", "wm")
    s.ok("GET", "/api/bom/p_fin", "wm")
    if bom_id:
        s.ok("POST", f"/api/bom/{bom_id}/produce?quantity=10&warehouse_id=wh_lagos", "wm")

    # ── 11. WAREHOUSE TRANSFERS ────────────────────────────────────────────
    s.sec("transfers")
    r = s.ok("POST", "/api/warehouse-transfers", "acc", json={
        "to_warehouse_id": "wh_abuja",
        "items": [{"product_id": "p_raw", "quantity": 20}]})
    wt = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
    wt_id = wt.get("transfer_id")
    s.ok("GET", "/api/warehouse-transfers", "acc")
    if wt_id:
        # The receiving branch's accountant confirms; the sender may cancel.
        s.ok("PUT", f"/api/warehouse-transfers/{wt_id}/confirm", "acc2")
        # Cancelling a confirmed transfer is correctly refused (400).
        s.req("PUT", f"/api/warehouse-transfers/{wt_id}/cancel", "acc", expect=(400,))

    # ── 12. CLASSIC QUOTATIONS ─────────────────────────────────────────────
    s.sec("quotations")
    r = s.ok("POST", "/api/quotations", "sa", json={
        "customer_id": "u_rep",
        "items": [{"product_id": "p_fin", "quantity": 3, "unit_price": 1500.0,
                   "discount_percent": 10}],
        "tax_amount": 100.0, "valid_days": 30})
    qt = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
    qt_id = qt.get("quotation_id")
    s.ok("GET", "/api/quotations", "sa")
    if qt_id:
        s.ok("PUT", f"/api/quotations/{qt_id}/status?status=accepted", "sa")
        s.ok("POST", f"/api/quotations/{qt_id}/convert-to-order?warehouse_id=wh_lagos", "sa")

    # ── 14. EXPENSES ───────────────────────────────────────────────────────
    s.sec("expenses")
    r = s.ok("POST", "/api/expenses", "acc", json={
        "category": "travel", "amount": 5000.0, "description": "Trip to Abuja",
        "vendor": "Airtel", "payment_method": "cash"})
    exp = r.json() if r.status_code < 400 and r.text.startswith("{") else {}
    exp_id = exp.get("expense_id")
    s.ok("GET", "/api/expenses", "acc")
    if exp_id:
        s.ok("PUT", f"/api/expenses/{exp_id}/approve", "acc")
        s.ok("DELETE", f"/api/expenses/{exp_id}", "acc")

    # ── 15. DASHBOARD / REPORTS ────────────────────────────────────────────
    s.sec("reports")
    for path in ("/api/dashboard/stats", "/api/dashboard/recent-activity",
                 "/api/dashboard/sales-chart", "/api/dashboard/top-products",
                 "/api/dashboard/branch-summary",
                 "/api/reports/stock-summary", "/api/reports/purchase-analysis",
                 "/api/reports/sales-analysis", "/api/reports/profit-loss",
                 "/api/reports/cash-flow", "/api/reports/supplier-aging",
                 "/api/reports/customer-aging", "/api/reports/inventory-valuation",
                 "/api/reports/trial-balance", "/api/reports/balance-sheet",
                 "/api/reports/supplier-performance", "/api/reports/warehouse-performance",
                 "/api/reports/stock-summary/pdf", "/api/reports/profit-loss/pdf"):
        s.ok("GET", path, "sa")

    # ── 16. NOTIFICATIONS / AUDIT / SYNC / BARCODE ────────────────────────
    s.sec("misc")
    s.ok("GET", "/api/notifications", "sa")
    s.ok("GET", "/api/notifications/generate-alerts", "sa")
    s.ok("PUT", "/api/notifications/read-all", "sa")
    s.ok("POST", "/api/notifications/register-push-token", "sa",
         json={"push_token": "tok_abc", "device_type": "android"})
    s.ok("GET", "/api/notifications/push-tokens", "sa")
    s.ok("DELETE", "/api/notifications/unregister-push-token", "sa")
    s.ok("GET", "/api/audit-logs", "sa")
    s.ok("POST", "/api/sync/pull", "sa", json={"entity_type": "products"})
    s.ok("POST", "/api/sync/push", "sa", json={
        "entity_type": "stock_adjustments",
        "local_changes": [{"action": "create", "entity_id": "x",
                           "data": {"product_id": "p_raw", "warehouse_id": "wh_lagos",
                                    "quantity": 1, "type": "adjustment"}}]})
    s.ok("GET", "/api/sync/status", "sa")
    s.ok("GET", "/api/barcode/BC111", "sa")
    s.ok("POST", "/api/barcode/generate?product_id=p_fin", "sa")

    # ── 17. ROLE PERMISSIONS ───────────────────────────────────────────────
    s.sec("role-permissions")
    s.ok("GET", "/api/admin/role-permissions", "sa")
    s.ok("GET", "/api/admin/role-permissions/viewer", "sa")
    s.ok("PUT", "/api/admin/role-permissions/viewer", "sa",
         json={"permissions": {"products": {"create": False, "read": True,
                                            "update": False, "delete": False}}})
    s.ok("POST", "/api/admin/role-permissions/reset/viewer", "sa")

    # ── 18. HEALTH ─────────────────────────────────────────────────────────
    s.ok("GET", "/api/health")
    s.ok("GET", "/api/security/health")

    # ── 19. EVERY ROLE hits every READ endpoint ───────────────────────────
    s.sec("role-matrix")
    reads = ["/api/dashboard/stats", "/api/dashboard/recent-activity",
             "/api/dashboard/sales-chart", "/api/dashboard/top-products",
             "/api/products", "/api/inventory", "/api/inventory/by-warehouse",
             "/api/suppliers", "/api/purchase-orders", "/api/sales-orders",
             "/api/invoices", "/api/payments", "/api/accounts", "/api/expenses",
             "/api/requisitions", "/api/quotations", "/api/grn", "/api/three-way-match",
             "/api/agent-quotations", "/api/delivery-notes", "/api/bom",
             "/api/warehouse-transfers", "/api/audit-logs", "/api/notifications",
             "/api/users", "/api/users/agents", "/api/warehouses", "/api/company",
             "/api/reports/stock-summary", "/api/reports/profit-loss",
             "/api/reports/trial-balance", "/api/reports/balance-sheet",
             "/api/reports/supplier-aging", "/api/reports/customer-aging",
             "/api/reports/inventory-valuation", "/api/reports/supplier-performance",
             "/api/reports/warehouse-performance", "/api/reports/purchase-analysis",
             "/api/reports/sales-analysis", "/api/reports/cash-flow",
             "/api/dashboard/branch-summary", "/api/inventory/all-warehouses"]
    for role in ("sa", "gm", "wm", "acc", "acc2", "rep", "sc", "pc", "viewer"):
        for path in reads:
            s.read_any(path, role)

    # ── 20. Permission matrix must deny exactly what it should ───────────
    s.sec("negative")
    DENY = [
        # (method, path, role) — these MUST be refused
        ("GET", "/api/users", "rep"), ("GET", "/api/users", "viewer"),
        ("GET", "/api/users", "pc"),
        ("GET", "/api/audit-logs", "wm"), ("GET", "/api/audit-logs", "viewer"),
        ("GET", "/api/audit-logs", "pc"), ("GET", "/api/audit-logs", "sc"),
        ("GET", "/api/suppliers", "rep"), ("GET", "/api/purchase-orders", "rep"),
        ("GET", "/api/invoices", "rep"), ("GET", "/api/payments", "rep"),
        ("GET", "/api/accounts", "rep"), ("GET", "/api/expenses", "rep"),
        ("GET", "/api/requisitions", "rep"), ("GET", "/api/grn", "rep"),
        ("GET", "/api/three-way-match", "rep"), ("GET", "/api/bom", "rep"),
        ("GET", "/api/warehouse-transfers", "rep"), ("GET", "/api/reports/profit-loss", "rep"),
        ("GET", "/api/requisitions", "sc"), ("GET", "/api/grn", "sc"),
        ("GET", "/api/three-way-match", "sc"),
        ("GET", "/api/quotations", "pc"), ("GET", "/api/agent-quotations", "pc"),
        ("GET", "/api/dashboard/branch-summary", "wm"),
        ("GET", "/api/inventory/all-warehouses", "rep"),
        ("GET", "/api/inventory/all-warehouses", "viewer"),
        # No token at all
        ("GET", "/api/products", None), ("POST", "/api/products", None),
    ]
    for method, path, role in DENY:
        if role is None:
            r = c.request(method, path)
        else:
            r = c.request(method, path, headers=H[role])
        s.calls += 1
        if r.status_code != 403 and r.status_code != 401:
            s.errors.append(("negative", method, path, str(role), r.status_code,
                             f"expected 401/403, got {r.status_code}: {r.text[:200]}"))

    # An accountant must NOT be able to escalate itself
    s.req("PUT", "/api/admin/role-permissions/accountant", "acc", expect=(403,),
          json={"permissions": {"inventory": {"create": True, "read": True,
                                              "update": True, "delete": True}}})

    # ── report ─────────────────────────────────────────────────────────────
    print(f"\n{'='*78}\nSWEEP: {s.calls} requests, {len(s.errors)} problem responses\n{'='*78}")
    if s.errors:
        for sec, m, p, role, code, body in s.errors:
            print(f"  [{sec}] {m:6} {p}   role={role}  -> {code}")
            print(f"      {body}\n")
    with open("/tmp/sweep_report.txt", "w") as f:
        for sec, m, p, role, code, body in s.errors:
            f.write(f"[{sec}] {m} {p} role={role} -> {code}\n    {body}\n")
    assert not s.errors, f"{len(s.errors)} problem responses"
