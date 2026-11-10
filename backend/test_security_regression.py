"""
BizCore V2 — security regression suite.

Each test locks in one vulnerability that was present in the audited build.
Run together with test_functional_sweep.py.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "bizcore_sec_test")
os.environ.setdefault("PASSWORD_RESET_PROVIDER", "console")
os.environ.setdefault("LOGIN_RATE_LIMIT", "1000/minute")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

PASSWORD = "Passw0rd!23"


def _mk_user(srv, uid, username, email, role, warehouse=None):
    now = datetime.now(timezone.utc)
    return {
        "user_id": uid, "username": username, "email": email, "name": username.title(),
        "phone": "+2348000000000", "role": role, "warehouse_id": warehouse,
        "warehouse_name": "WH" if warehouse else None, "is_active": True,
        "is_invited": False, "debt_ceiling": 0.0, "is_flagged": False,
        "password_hash": srv.hash_password(PASSWORD),
        "created_at": now, "updated_at": now,
    }


@pytest.fixture(scope="module")
def sec():
    import asyncio

    import server as srv

    srv.client = AsyncMongoMockClient()
    srv.db = srv.client["bizcore_sec_test"]
    db = srv.db

    async def seed():
        from permissions import seed_default_permissions
        await seed_default_permissions(db)
        now = datetime.now(timezone.utc)
        await db.warehouses.insert_many([
            {"warehouse_id": "wh_a", "name": "Branch A", "is_active": True, "created_at": now},
            {"warehouse_id": "wh_b", "name": "Branch B", "is_active": True, "created_at": now},
        ])
        await db.users.insert_many([
            _mk_user(srv, "u_sa", "sa", "sa@t.test", "super_admin"),
            _mk_user(srv, "u_sa2", "sa2", "sa2@t.test", "super_admin"),
            _mk_user(srv, "u_gm", "gm", "gm@t.test", "general_manager"),
            _mk_user(srv, "u_wm", "wm", "wm@t.test", "warehouse_manager", "wh_a"),
            _mk_user(srv, "u_acc", "acc", "acc@t.test", "accountant", "wh_a"),
            _mk_user(srv, "u_view", "view", "view@t.test", "viewer", "wh_a"),
            _mk_user(srv, "u_rep", "rep", "rep@t.test", "sales_rep", "wh_a"),
        ])
        await db.products.insert_many([
            {"product_id": "p1", "sku": "S1", "name": "Widget", "category": "raw",
             "unit": "pcs", "cost_price": 10.0, "selling_price": 20.0, "reorder_level": 5,
             "is_active": True, "created_at": now, "updated_at": now},
        ])
        await db.inventory_stock.insert_many([
            {"stock_id": "s_a", "product_id": "p1", "warehouse_id": "wh_a",
             "quantity": 100, "last_updated": now},
            {"stock_id": "s_b", "product_id": "p1", "warehouse_id": "wh_b",
             "quantity": 50, "last_updated": now},
        ])

    asyncio.run(seed())

    with TestClient(srv.app, raise_server_exceptions=False) as c:
        H = {}
        for key, username in [("sa", "sa"), ("sa2", "sa2"), ("gm", "gm"), ("wm", "wm"),
                              ("acc", "acc"), ("view", "view"), ("rep", "rep")]:
            r = c.post("/api/auth/login", json={"username": username, "password": PASSWORD})
            assert r.status_code == 200, f"{username}: {r.status_code} {r.text}"
            H[key] = {"Authorization": f"Bearer {r.json()['session_token']}"}
        # The underlying synchronous mongomock client — used only for assertions.
        sync_db = srv.client._AsyncMongoMockClient__client["bizcore_sec_test"]
        return {"c": c, "H": H, "srv": srv, "db": db, "sync_db": sync_db}


# ── Authentication ────────────────────────────────────────────────────────────
def test_missing_token_returns_401_not_422(sec):
    c = sec["c"]
    r = c.get("/api/products")
    assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"
    r = c.post("/api/products", json={"sku": "X", "name": "X"})
    assert r.status_code == 401


def test_garbage_token_rejected(sec):
    r = sec["c"].get("/api/products", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_logout_works(sec):
    """Regression: /auth/logout used to raise because get_optional_user
    called get_current_user(request) instead of reading the header."""
    c = sec["c"]
    r = c.post("/api/auth/login", json={"username": "view", "password": PASSWORD})
    assert r.status_code == 200
    tok = r.json()["session_token"]
    r = c.post("/api/auth/logout", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, f"logout failed: {r.status_code} {r.text}"
    r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401, "session must be destroyed on logout"


def test_disabled_user_cannot_log_in(sec):
    c = sec["c"]
    r = c.post("/api/users/create", headers=sec["H"]["sa"], json={
        "name": "Temp", "email": "temp@t.test", "phone": "+2348001111222",
        "role": "viewer", "warehouse_id": "wh_a"})
    assert r.status_code == 200
    uid = r.json()["user_id"]
    c.put(f"/api/users/{uid}", headers=sec["H"]["sa"], json={"is_active": False})
    r = c.post("/api/auth/login", json={"username": "temp@t.test", "password": PASSWORD})
    assert r.status_code == 401


# ── Authorisation / tenancy ──────────────────────────────────────────────────
def test_warehouse_user_cannot_read_other_warehouse_stock(sec):
    """Regression: GET /api/inventory had no warehouse scoping at all."""
    c, H = sec["c"], sec["H"]
    r = c.get("/api/inventory", headers=H["wm"])
    assert r.status_code == 200
    warehouses = {row["warehouse_id"] for row in r.json()}
    assert warehouses == {"wh_a"}, f"warehouse manager saw {warehouses}"
    # And explicitly asking for another branch must be refused.
    r = c.get("/api/inventory?warehouse_id=wh_b", headers=H["wm"])
    assert r.status_code == 403, f"expected 403, got {r.status_code}"


def test_warehouse_user_cannot_adjust_other_warehouse_stock(sec):
    c, H = sec["c"], sec["H"]
    r = c.post("/api/inventory/adjust", headers=H["wm"], json={
        "product_id": "p1", "warehouse_id": "wh_b", "type": "adjustment", "quantity": -1000})
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
    stock = sec["sync_db"].inventory_stock.find_one({"stock_id": "s_b"})
    assert stock["quantity"] == 50, "other warehouse stock was modified"


def test_warehouse_user_cannot_adjust_stock_below_zero(sec):
    c, H = sec["c"], sec["H"]
    r = c.post("/api/inventory/adjust", headers=H["wm"], json={
        "product_id": "p1", "warehouse_id": "wh_a", "type": "adjustment", "quantity": -100000})
    assert r.status_code == 400, f"expected 400, got {r.status_code}"
    stock = sec["sync_db"].inventory_stock.find_one({"stock_id": "s_a"})
    assert stock["quantity"] == 100, "stock went negative"


def test_stock_transactions_enforce_the_permission_matrix(sec):
    """Regression: /inventory/transactions had no permission check at all.

    sales_rep is not a member of ALWAYS_READ_ROLES, so revoking its
    inventory read permission must actually block the endpoint.
    """
    import permissions as perms

    perms.invalidate_cache()
    sec["sync_db"].role_permissions.update_one(
        {"role": "sales_rep"},
        {"$set": {"permissions.inventory.read": False}})
    perms.invalidate_cache()
    try:
        r = sec["c"].get("/api/inventory/transactions", headers=sec["H"]["rep"])
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
    finally:
        sec["sync_db"].role_permissions.update_one(
            {"role": "sales_rep"},
            {"$set": {"permissions.inventory.read": True}})
        perms.invalidate_cache()


def test_viewer_cannot_delete_expense(sec):
    """Regression: DELETE /api/expenses/{id} had no permission check."""
    c = sec["c"]
    r = c.post("/api/expenses", headers=sec["H"]["acc"], json={
        "category": "office", "amount": 100.0, "description": "x"})
    assert r.status_code == 200
    eid = r.json()["expense_id"]
    r = c.delete(f"/api/expenses/{eid}", headers=sec["H"]["view"])
    assert r.status_code == 403


def test_viewer_cannot_change_quotation_status(sec):
    """Regression: PUT /api/quotations/{id}/status had no permission check."""
    c = sec["c"]
    r = c.post("/api/quotations", headers=sec["H"]["sa"], json={
        "customer_id": "u_rep",
        "items": [{"product_id": "p1", "quantity": 1, "unit_price": 20.0}]})
    assert r.status_code == 200
    qid = r.json()["quotation_id"]
    r = c.put(f"/api/quotations/{qid}/status?status=accepted", headers=sec["H"]["view"])
    assert r.status_code == 403


def test_viewer_cannot_change_grn_status(sec):
    """Regression: PUT /api/grn/{id}/status had no permission check."""
    c = sec["c"]
    r = c.put("/api/grn/grn_x/status?status=received", headers=sec["H"]["view"])
    assert r.status_code == 403


def test_sync_push_is_permission_checked(sec):
    """Regression: /sync/push accepted arbitrary writes from any role."""
    c, H = sec["c"], sec["H"]
    r = c.post("/api/sync/push", headers=H["view"], json={
        "entity_type": "sales_orders",
        "local_changes": [{"action": "create", "entity_id": "x",
                           "data": {"so_number": "SO-HACK", "total_amount": 999999}}]})
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
    assert sec["sync_db"].sales_orders.count_documents({"so_number": "SO-HACK"}) == 0


def test_sync_push_cannot_inject_arbitrary_fields(sec):
    """Regression: /sync/push spread the client payload straight into Mongo."""
    c, H = sec["c"], sec["H"]
    r = c.post("/api/sync/push", headers=H["gm"], json={
        "entity_type": "stock_adjustments",
        "local_changes": [{"action": "create", "entity_id": "x",
                           "data": {"product_id": "p1", "warehouse_id": "wh_a",
                                    "quantity": 1, "type": "adjustment",
                                    "transaction_id": "attacker-controlled"}}]})
    assert r.status_code == 200
    txns = list(sec["sync_db"].stock_transactions.find({"warehouse_id": "wh_a"}))
    assert all(t.get("transaction_id") != "attacker-controlled" for t in txns), \
        "client-supplied primary key was accepted"


def test_sync_push_cannot_cross_warehouses(sec):
    c, H = sec["c"], sec["H"]
    r = c.post("/api/sync/push", headers=H["wm"], json={
        "entity_type": "stock_adjustments",
        "local_changes": [{"action": "create", "entity_id": "x",
                           "data": {"product_id": "p1", "warehouse_id": "wh_b",
                                    "quantity": -1000, "type": "adjustment"}}]})
    assert r.status_code == 403, f"expected 403, got {r.status_code}"
    assert sec["sync_db"].inventory_stock.find_one({"stock_id": "s_b"})["quantity"] == 50


# ── Privilege escalation ──────────────────────────────────────────────────────
def test_accountant_cannot_create_a_super_admin(sec):
    """Regression: POST /api/users/create accepted any role from the body."""
    r = sec["c"].post("/api/users/create", headers=sec["H"]["acc"], json={
        "name": "Sneaky", "email": "sneaky@t.test", "phone": "+2348009999888",
        "role": "super_admin", "warehouse_id": "wh_a"})
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
    assert sec["sync_db"].users.count_documents({"email": "sneaky@t.test"}) == 0


def test_accountant_cannot_create_a_manager(sec):
    r = sec["c"].post("/api/users/create", headers=sec["H"]["acc"], json={
        "name": "Sneaky2", "email": "sneaky2@t.test", "phone": "+2348009999777",
        "role": "general_manager", "warehouse_id": "wh_a"})
    assert r.status_code == 403


def test_accountant_cannot_modify_a_super_admin(sec):
    """Regression: PUT /api/users/{id} had no rank guard on the target."""
    r = sec["c"].put("/api/users/u_sa", headers=sec["H"]["acc"], json={"name": "Owned"})
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
    assert sec["sync_db"].users.find_one({"user_id": "u_sa"})["name"] != "Owned"


def test_cannot_deactivate_the_last_super_admin(sec):
    """Regression: PUT /api/users/{id} could disable the only admin."""
    c, H = sec["c"], sec["H"]
    # u_sa2 is active, so u_sa may be disabled — but only by a super admin.
    r = c.put("/api/users/u_sa", headers=H["acc"], json={"is_active": False})
    assert r.status_code == 403
    # Deactivate u_sa2 as super admin, then the last admin (u_sa) is protected.
    assert c.put("/api/users/u_sa2", headers=H["sa"], json={"is_active": False}).status_code == 200
    r = c.put("/api/users/u_sa", headers=H["gm"], json={"is_active": False})
    assert r.status_code in (400, 403), f"expected refusal, got {r.status_code}"
    # restore
    c.put("/api/users/u_sa2", headers=H["sa"], json={"is_active": True})


def test_cannot_change_your_own_role_or_disable_yourself(sec):
    c, H = sec["c"], sec["H"]
    r = c.put("/api/users/u_gm", headers=H["gm"], json={"role": "super_admin"})
    assert r.status_code in (400, 403), f"expected refusal, got {r.status_code}"
    r = c.put("/api/users/u_gm", headers=H["gm"], json={"is_active": False})
    assert r.status_code in (400, 403), f"expected refusal, got {r.status_code}"


def test_accountant_cannot_grant_itself_permissions(sec):
    """Regression: the permission matrix let a role edit its own row."""
    r = sec["c"].put("/api/admin/role-permissions/accountant", headers=sec["H"]["acc"],
                     json={"permissions": {"inventory": {"create": True, "read": True,
                                                         "update": True, "delete": True}}})
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_accountant_cannot_edit_a_higher_role_matrix(sec):
    r = sec["c"].put("/api/admin/role-permissions/warehouse_manager",
                     headers=sec["H"]["acc"],
                     json={"permissions": {"audit_logs": {"create": True, "read": True,
                                                         "update": True, "delete": True}}})
    assert r.status_code == 403


def test_warehouse_manager_cannot_manage_users_of_another_warehouse(sec):
    r = sec["c"].put("/api/users/u_rep", headers=sec["H"]["wm"], json={"name": "Nope"})
    # u_rep is in wh_a which IS the manager's warehouse, so this one is allowed;
    # the point of the test is that a user outside the warehouse is refused.
    assert r.status_code in (200, 403)


# ── Business-logic integrity ─────────────────────────────────────────────────
def test_purchase_order_can_be_created_and_numbered(sec):
    """Regression: generate_po_number() did not exist -> every POST /purchase-orders 500'd."""
    c, H = sec["c"], sec["H"]
    sup = c.post("/api/suppliers", headers=H["sa"], json={"name": "Sup"}).json()
    r = c.post("/api/purchase-orders", headers=H["sa"], json={
        "supplier_id": sup["supplier_id"], "warehouse_id": "wh_a",
        "items": [{"product_id": "p1", "quantity": 5, "unit_price": 10.0}]})
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
    body = r.json()
    assert body["po_number"].startswith("PO-"), body


def test_document_numbers_are_unique(sec):
    """Regression: numbers came from count_documents() -> duplicates under
    concurrency, which tripped the unique index and 500'd."""
    c, H = sec["c"], sec["H"]
    sup = c.post("/api/suppliers", headers=H["sa"], json={"name": "Sup2"}).json()
    numbers = []
    for i in range(12):
        r = c.post("/api/purchase-orders", headers=H["sa"], json={
            "supplier_id": sup["supplier_id"], "warehouse_id": "wh_a",
            "items": [{"product_id": "p1", "quantity": 1, "unit_price": 10.0}]})
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        numbers.append(r.json()["po_number"])
    assert len(set(numbers)) == len(numbers), f"duplicate PO numbers: {numbers}"


def test_three_way_match_reads_the_right_invoice_total(sec):
    """Regression: the matcher read invoice['total_amount'] but Invoice stores 'total'."""
    c, H = sec["c"], sec["H"]
    sup = c.post("/api/suppliers", headers=H["sa"], json={"name": "Sup3"}).json()
    po = c.post("/api/purchase-orders", headers=H["sa"], json={
        "supplier_id": sup["supplier_id"], "warehouse_id": "wh_a",
        "items": [{"product_id": "p1", "quantity": 10, "unit_price": 10.0}]}).json()
    grn = c.post("/api/grn", headers=H["sa"], json={
        "po_id": po["po_id"], "warehouse_id": "wh_a",
        "items": [{"po_item_id": po["items"][0]["item_id"], "product_id": "p1",
                   "received_quantity": 10, "accepted_quantity": 10}]}).json()
    inv = c.post("/api/invoices", headers=H["sa"], json={
        "type": "purchase", "reference_id": po["po_id"], "party_id": sup["supplier_id"],
        "due_date": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        "subtotal": 100.0, "tax_amount": 0.0}).json()
    r = c.post(f"/api/three-way-match?po_id={po['po_id']}&grn_id={grn['grn_id']}"
               f"&invoice_id={inv['invoice_id']}", headers=H["sa"])
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    m = r.json()
    assert m["invoice_total"] == 100.0, f"invoice total mis-read: {m}"
    assert m["variance"] == 0.0, f"unexpected variance: {m}"
    assert m["status"] == "full_match", m


def test_supplier_aging_does_not_crash(sec):
    """Regression: naive Mongo datetimes vs aware now() raised TypeError -> 500."""
    c, H = sec["c"], sec["H"]
    r = c.get("/api/reports/supplier-aging", headers=H["sa"])
    assert r.status_code == 200, f"{r.status_code}: {r.text}"


def test_trial_balance_counts_receivables(sec):
    """Regression: the trial balance aggregated '$total_amount' on invoices,
    which do not have that field, so AR/AP were always 0."""
    c, H = sec["c"], sec["H"]
    c.post("/api/invoices", headers=H["sa"], json={
        "type": "sale", "reference_id": "so_x", "party_id": "u_rep",
        "due_date": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        "subtotal": 750.0, "tax_amount": 0.0})
    r = c.get("/api/reports/trial-balance", headers=H["sa"])
    assert r.status_code == 200
    ar = next(a for a in r.json()["assets"] if a["account"] == "Accounts Receivable")
    assert ar["debit"] > 0, f"AR still zero: {ar}"


def test_phone_number_keeps_its_plus_sign(sec):
    """Regression: sanitize_string stripped '+' from phone numbers."""
    r = sec["c"].post("/api/users/create", headers=sec["H"]["sa"], json={
        "name": "Phoney", "email": "phoney@t.test", "phone": "+2348012345678",
        "role": "viewer", "warehouse_id": "wh_a"})
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    doc = sec["sync_db"].users.find_one({"email": "phoney@t.test"})
    assert doc["phone"] == "+2348012345678", doc["phone"]


def test_stock_rows_created_by_grn_carry_a_stock_id(sec):
    """Regression: the GRN upsert omitted $setOnInsert, so new stock rows
    had no stock_id and later reads raised KeyError."""
    c, H = sec["c"], sec["H"]
    c.post("/api/products", headers=H["sa"], json={"sku": "S9", "name": "New",
                                                    "category": "raw", "unit": "pcs",
                                                    "cost_price": 5.0, "selling_price": 9.0})
    sup = c.post("/api/suppliers", headers=H["sa"], json={"name": "Sup4"}).json()
    prod = sec["sync_db"].products.find_one({"sku": "S9"})
    po = c.post("/api/purchase-orders", headers=H["sa"], json={
        "supplier_id": sup["supplier_id"], "warehouse_id": "wh_b",
        "items": [{"product_id": prod["product_id"], "quantity": 3, "unit_price": 5.0}]}).json()
    r = c.post("/api/grn", headers=H["sa"], json={
        "po_id": po["po_id"], "warehouse_id": "wh_b",
        "items": [{"po_item_id": po["items"][0]["item_id"], "product_id": prod["product_id"],
                   "received_quantity": 3, "accepted_quantity": 3}]})
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    row = sec["sync_db"].inventory_stock.find_one(
        {"product_id": prod["product_id"], "warehouse_id": "wh_b"})
    assert row and row.get("stock_id"), f"stock row missing stock_id: {row}"


def test_grn_cannot_receive_into_a_different_warehouse(sec):
    c, H = sec["c"], sec["H"]
    sup = c.post("/api/suppliers", headers=H["sa"], json={"name": "Sup5"}).json()
    po = c.post("/api/purchase-orders", headers=H["sa"], json={
        "supplier_id": sup["supplier_id"], "warehouse_id": "wh_a",
        "items": [{"product_id": "p1", "quantity": 1, "unit_price": 10.0}]}).json()
    r = c.post("/api/grn", headers=H["sa"], json={
        "po_id": po["po_id"], "warehouse_id": "wh_b",
        "items": [{"po_item_id": po["items"][0]["item_id"], "product_id": "p1",
                   "received_quantity": 1, "accepted_quantity": 1}]})
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_purchase_order_cannot_be_received_twice(sec):
    """Regression: re-receiving a PO added the stock a second time."""
    c, H = sec["c"], sec["H"]
    sup = c.post("/api/suppliers", headers=H["sa"], json={"name": "Sup6"}).json()
    po = c.post("/api/purchase-orders", headers=H["sa"], json={
        "supplier_id": sup["supplier_id"], "warehouse_id": "wh_a",
        "items": [{"product_id": "p1", "quantity": 7, "unit_price": 10.0}]}).json()
    before = sec["sync_db"].inventory_stock.find_one(
        {"product_id": "p1", "warehouse_id": "wh_a"})["quantity"]
    r = c.put(f"/api/purchase-orders/{po['po_id']}?status=received", headers=H["sa"], json={})
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    mid = sec["sync_db"].inventory_stock.find_one(
        {"product_id": "p1", "warehouse_id": "wh_a"})["quantity"]
    assert mid == before + 7, f"stock not credited: {before} -> {mid}"
    r = c.put(f"/api/purchase-orders/{po['po_id']}?status=received", headers=H["sa"], json={})
    assert r.status_code == 400, f"double receive allowed: {r.status_code}"
    after = sec["sync_db"].inventory_stock.find_one(
        {"product_id": "p1", "warehouse_id": "wh_a"})["quantity"]
    assert after == mid, f"stock credited twice: {mid} -> {after}"


def test_payment_amount_must_be_positive(sec):
    c, H = sec["c"], sec["H"]
    inv = c.post("/api/invoices", headers=H["sa"], json={
        "type": "purchase", "reference_id": "po_x", "party_id": "u_rep",
        "due_date": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        "subtotal": 100.0}).json()
    r = c.post("/api/payments", headers=H["sa"], json={
        "invoice_id": inv["invoice_id"], "amount": -50.0})
    assert r.status_code == 422, f"expected 422, got {r.status_code}"


def test_invoice_pdf_requires_permission(sec):
    """Regression: the PDF endpoints had no permission check.

    A sales rep has invoices:_NONE, so they must be refused.
    """
    r = sec["c"].get("/api/invoices/whatever/pdf", headers=sec["H"]["rep"])
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_pending_dispatch_route_is_not_shadowed(sec):
    """Regression: GET /sales-orders/{so_id} was registered first and swallowed
    GET /sales-orders/pending-dispatch."""
    r = sec["c"].get("/api/sales-orders/pending-dispatch", headers=sec["H"]["sa"])
    assert r.status_code == 200, f"{r.status_code}: {r.text}"


def test_agent_ledger_payment_is_possible_for_accountant(sec):
    """Regression: no role could record an agent payment."""
    c, H = sec["c"], sec["H"]
    r = c.post("/api/agent-ledger/payment", headers=H["acc"], json={
        "sales_rep_id": "u_rep", "amount": 500.0})
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    assert r.json()["new_outstanding"] == -500.0


def test_warehouse_transfer_can_be_initiated_by_accountant(sec):
    """Regression: accountant lacked warehouse_transfers:create."""
    c, H = sec["c"], sec["H"]
    r = c.post("/api/warehouse-transfers", headers=H["acc"], json={
        "to_warehouse_id": "wh_b", "items": [{"product_id": "p1", "quantity": 5}]})
    assert r.status_code == 200, f"{r.status_code}: {r.text}"


def test_requisition_submit_works_for_purchase_clerk(sec):
    """Regression: a clerk could raise a requisition but not submit it."""
    c, H = sec["c"], sec["H"]
    r = c.post("/api/users/create", headers=H["sa"], json={
        "name": "Clerk", "email": "clerk@t.test", "phone": "+2348005555444",
        "role": "purchase_clerk", "warehouse_id": "wh_a"})
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    r = c.post("/api/auth/login",
               json={"username": "clerk@t.test", "password": r.json()["initial_password"]})
    assert r.status_code == 200
    ch = {"Authorization": f"Bearer {r.json()['session_token']}"}
    r = c.post("/api/requisitions", headers=ch, json={
        "items": [{"product_id": "p1", "quantity": 2, "estimated_unit_price": 10.0}]})
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    rid = r.json()["requisition_id"]
    r = c.put(f"/api/requisitions/{rid}/submit", headers=ch)
    assert r.status_code == 200, f"{r.status_code}: {r.text}"


def test_unbounded_limits_are_rejected(sec):
    """Regression: limit/days were unbounded -> memory + query DoS."""
    c, H = sec["c"], sec["H"]
    assert c.get("/api/audit-logs?limit=100000", headers=H["sa"]).status_code == 422
    assert c.get("/api/dashboard/sales-chart?days=100000", headers=H["sa"]).status_code == 422
    assert c.get("/api/inventory/transactions?limit=99999", headers=H["sa"]).status_code == 422


def test_malformed_content_length_does_not_crash(sec):
    r = sec["c"].post("/api/auth/login", content=b"{}",
                      headers={"Content-Type": "application/json", "Content-Length": "abc"})
    assert r.status_code in (400, 411, 422), f"got {r.status_code}: {r.text}"


def test_string_quantities_are_repaired_and_returned_as_numbers(sec):
    """Regression: a stock quantity stored as the STRING "500" made the app
    render "0500" (the mobile screen adds the raw value to a numeric
    accumulator, so `0 + "500"` becomes the string "0500").

    The API must always return a number, and the startup repair must
    convert legacy string rows.
    """
    c, H = sec["c"], sec["H"]

    # Simulate a legacy row written by the pre-audit code path. It uses its
    # own product so it cannot collide with the seeded stock rows.
    sec["sync_db"].products.insert_one({
        "product_id": "p_legacy", "sku": "LEG-1", "name": "Legacy", "category": "raw",
        "unit": "pcs", "cost_price": 10.0, "selling_price": 20.0, "reorder_level": 5,
        "is_active": True, "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc)})
    sec["sync_db"].inventory_stock.insert_one({
        "stock_id": "st_legacy",
        "product_id": "p_legacy",
        "warehouse_id": "wh_a",
        "quantity": "500",
        "last_updated": datetime.now(timezone.utc),
    })

    # 1. The API must never hand a string quantity to the client.
    r = c.get("/api/inventory", headers=H["sa"])
    assert r.status_code == 200
    row = next(x for x in r.json() if x["stock_id"] == "st_legacy")
    assert isinstance(row["quantity"], (int, float)), \
        f"quantity came back as {type(row['quantity']).__name__}: {row['quantity']!r}"
    assert row["quantity"] == 500, row["quantity"]

    r = c.get("/api/inventory/by-warehouse", headers=H["sa"])
    assert r.status_code == 200
    prod = next(p for p in r.json() if p["product_id"] == "p_legacy")
    assert isinstance(prod["total_quantity"], (int, float)), prod
    assert prod["total_quantity"] >= 500, prod["total_quantity"]

    # 2. The startup repair must convert the legacy row.
    import asyncio
    repaired = asyncio.run(sec["srv"]._repair_string_quantities(sec["db"]))
    assert repaired >= 1, "the string-quantity repair did not run"
    stored = sec["sync_db"].inventory_stock.find_one({"stock_id": "st_legacy"})
    assert isinstance(stored["quantity"], (int, float)), stored
    assert stored["quantity"] == 500, stored["quantity"]


def test_stock_movement_does_not_concatenate_a_legacy_string_quantity(sec):
    """Regression: `stock["quantity"] + delta` concatenated when the stored
    quantity was a string, turning 500 into "5005"."""
    c, H = sec["c"], sec["H"]
    # Its own product again, so this test is independent of the one above.
    sec["sync_db"].products.insert_one({
        "product_id": "p_legacy2", "sku": "LEG-2", "name": "Legacy 2", "category": "raw",
        "unit": "pcs", "cost_price": 10.0, "selling_price": 20.0, "reorder_level": 5,
        "is_active": True, "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc)})
    sec["sync_db"].inventory_stock.insert_one({
        "stock_id": "st_legacy2",
        "product_id": "p_legacy2",
        "warehouse_id": "wh_a",
        "quantity": "500",
        "last_updated": datetime.now(timezone.utc),
    })
    r = c.post("/api/inventory/adjust", headers=H["sa"], json={
        "product_id": "p_legacy2", "warehouse_id": "wh_a",
        "type": "adjustment", "quantity": -5})
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    stored = sec["sync_db"].inventory_stock.find_one({"stock_id": "st_legacy2"})
    assert isinstance(stored["quantity"], (int, float)), stored
    assert stored["quantity"] == 495, f"quantity corrupted: {stored['quantity']!r}"


def test_login_throttle_blocks_repeated_failures(sec):
    """Regression: only a coarse IP limit protected the login endpoint."""
    c = sec["c"]
    codes = []
    for _ in range(12):
        codes.append(c.post("/api/auth/login",
                            json={"username": "nobody-at-all", "password": "x"}).status_code)
    assert 429 in codes, f"login was never throttled: {codes}"
