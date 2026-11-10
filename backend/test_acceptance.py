"""
BizCore V2 — full acceptance suite (scenarios).

Every assertion checks a *business outcome* (documents created, stock moved,
balances updated, money reconciled), not merely an HTTP status.
"""
import pytest

from acceptance_base import (  # noqa: E402
    PASSWORD, NOW, SOON, PAST, ROLES, hdr, ok, relogin, make_user,
)


# ═══════════════════════════════════════════════════════════════════════════
# 1. AUTHENTICATION
# ═══════════════════════════════════════════════════════════════════════════
def test_auth_login_and_identity(world):
    c = world["c"]
    r = c.post("/api/auth/login", json={"username": "gm", "password": PASSWORD})
    body = ok(r)
    assert body["user"]["role"] == "general_manager"
    assert body["session_token"].startswith("sess_")
    assert body["expires_at"]

    r = c.post("/api/auth/login", json={"username": "gm@bizcore.test", "password": PASSWORD})
    assert ok(r)["user"]["username"] == "gm", "login by email must work"

    r = c.post("/api/auth/login", json={"username": "gm", "password": "wrong"})
    assert r.status_code == 401


def test_auth_me_returns_full_profile(world):
    r = world["c"].get("/api/auth/me", headers=hdr(world, "rep"))
    body = ok(r)
    assert body["username"] == "rep"
    assert body["role"] == "sales_rep"
    assert body["warehouse_id"] == "wh_lagos"
    assert "password_hash" not in body, "the password hash must never be returned"


def test_auth_register_is_closed_once_seeded(world):
    r = world["c"].post("/api/auth/register", json={
        "username": "intruder", "email": "intruder@mail.bizcore.ng",
        "password": "Passw0rd!23", "name": "Intruder"})
    assert r.status_code == 403, "self-registration must be closed on a seeded DB"


def test_auth_forgot_password_then_reset(world):
    c = world["c"]
    r = c.post("/api/auth/forgot-password", json={"email_or_phone": "rep@bizcore.test"})
    body = ok(r)
    assert "delivery" in body

    r = c.post("/api/auth/forgot-username", json={"email_or_phone": "rep@bizcore.test"})
    body = ok(r)
    assert body.get("username") == "rep", body

    # Unknown identifier must not reveal that the account is missing.
    r = c.post("/api/auth/forgot-password", json={"email_or_phone": "nobody@nowhere.test"})
    assert r.status_code == 200
    assert "delivery" not in r.json()


def test_auth_reset_password_roundtrip(world):
    c = world["c"]
    probe = make_user(world, "sa", "Reset Probe", "resetprobe@bizcore.test", "resetprobe")
    r = c.post("/api/auth/forgot-password", json={"email_or_phone": "resetprobe@bizcore.test"})
    ok(r)
    # The console provider logs the token; pull it straight from the DB.
    import asyncio
    srv = world["srv"]
    db = world["db"]

    async def latest_token():
        async for d in db.password_resets.find({"user_id": probe["user_id"]}):
            return d["token"]
        return None

    token = asyncio.run(latest_token())
    assert token, "no reset token was issued"

    r = c.post("/api/auth/reset-password", json={"token": token, "new_password": "NewPassw0rd!9"})
    body = ok(r)
    assert body["session_token"], "reset must return a fresh session"

    # The old password is dead, the new one works.
    assert c.post("/api/auth/login",
                  json={"username": "resetprobe", "password": PASSWORD}).status_code == 401
    assert c.post("/api/auth/login",
                  json={"username": "resetprobe", "password": "NewPassw0rd!9"}).status_code == 200

    # The token is single-use.
    r = c.post("/api/auth/reset-password", json={"token": token, "new_password": "AnotherPass!9"})
    assert r.status_code == 400, "a reset token must be single-use"
    c.delete(f"/api/users/{probe['user_id']}", headers=hdr(world, "sa"))


def test_auth_rotate_session(world):
    c = world["c"]
    r = c.post("/api/auth/login", json={"username": "sc", "password": PASSWORD})
    old = r.json()["session_token"]
    r = c.post("/api/auth/rotate-session", headers={"Authorization": f"Bearer {old}"})
    body = ok(r)
    new = body["session_token"]
    assert new != old
    assert c.get("/api/auth/me", headers={"Authorization": f"Bearer {old}"}).status_code == 401
    assert c.get("/api/auth/me", headers={"Authorization": f"Bearer {new}"}).status_code == 200


def test_auth_change_password_invalidates_other_sessions(world):
    c = world["c"]
    probe = make_user(world, "sa", "Chg Probe", "chgprobe@bizcore.test", "chgprobe")
    pw = probe["initial_password"]
    a = c.post("/api/auth/login", json={"username": "chgprobe", "password": pw}).json()["session_token"]
    b = c.post("/api/auth/login", json={"username": "chgprobe", "password": pw}).json()["session_token"]
    r = c.post("/api/auth/change-password",
               headers={"Authorization": f"Bearer {a}"},
               json={"old_password": pw, "new_password": "TempPassw0rd!1"})
    ok(r)
    assert c.get("/api/auth/me", headers={"Authorization": f"Bearer {b}"}).status_code == 401
    c.delete(f"/api/users/{probe['user_id']}", headers=hdr(world, "sa"))


def test_auth_logout(world):
    c = world["c"]
    tok = c.post("/api/auth/login", json={"username": "rep2", "password": PASSWORD}).json()["session_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert c.get("/api/auth/me", headers=h).status_code == 200
    assert c.post("/api/auth/logout", headers=h).status_code == 200
    assert c.get("/api/auth/me", headers=h).status_code == 401


def test_auth_change_password_requires_correct_current(world):
    r = world["c"].post("/api/auth/change-password", headers=hdr(world, "sc"),
                        json={"old_password": "nope", "new_password": "Whatever!123"})
    assert r.status_code == 401


# ═══════════════════════════════════════════════════════════════════════════
# 2. USER MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════
def test_users_crud_lifecycle(world, ids):
    c = world["c"]
    H = hdr(world, "sa")

    r = c.get("/api/users", headers=H)
    users = ok(r)
    assert len(users) >= 12
    assert all("password_hash" not in u for u in users), "password hashes leaked"

    r = c.get("/api/users?status=all", headers=H)
    assert len(ok(r)) >= len(users)

    r = c.post("/api/users/create", headers=H, json={
        "name": "New Clerk", "email": "newclerk@bizcore.test", "phone": "+2348012345678",
        "role": "purchase_clerk", "warehouse_id": "wh_lagos"})
    created = ok(r)
    ids["user"] = created["user_id"]
    assert created["initial_password"], "the admin must receive the initial password"
    assert created["username"] == "newclerk"

    # The new user can sign in with the issued password.
    login = c.post("/api/auth/login", json={
        "username": "newclerk", "password": created["initial_password"]})
    assert login.status_code == 200, login.text
    new_token = login.json()["session_token"]
    assert c.get("/api/auth/me",
                 headers={"Authorization": f"Bearer {new_token}"}).status_code == 200

    r = c.put(f"/api/users/{ids['user']}", headers=H, json={"name": "Renamed Clerk"})
    assert ok(r)["name"] == "Renamed Clerk"

    r = c.delete(f"/api/users/{ids['user']}", headers=H)
    body = ok(r)
    assert body["deactivated"] is True, "delete must soft-deactivate by default"

    # A deactivated account must not be able to sign in...
    assert c.post("/api/auth/login", json={
        "username": "newclerk", "password": created["initial_password"]}).status_code == 401
    # ...and its existing session must stop working.
    assert c.get("/api/auth/me",
                 headers={"Authorization": f"Bearer {new_token}"}).status_code == 401

    r = c.post(f"/api/users/{ids['user']}/reactivate", headers=H)
    assert ok(r)["action"] == "reactivated"


def test_users_accountant_can_manage_own_branch_users(world):
    """Client requirement #5: accountant may view and create users."""
    c = world["c"]
    r = c.get("/api/users", headers=hdr(world, "acc"))
    users = ok(r)
    assert all(u["warehouse_id"] == "wh_lagos" for u in users), \
        "an accountant must only see their own branch's users"

    r = c.post("/api/users/create", headers=hdr(world, "acc"), json={
        "name": "Acc Hire", "email": "acchire@bizcore.test", "phone": "+2348099998888",
        "role": "viewer", "warehouse_id": "wh_lagos"})
    assert r.status_code == 200, r.text
    uid = r.json()["user_id"]
    world["c"].delete(f"/api/users/{uid}", headers=hdr(world, "sa"))


def test_users_escalation_is_refused(world):
    c = world["c"]
    r = c.post("/api/users/create", headers=hdr(world, "acc"), json={
        "name": "Sneaky", "email": "sneaky@bizcore.test", "phone": "+2348099998777",
        "role": "super_admin", "warehouse_id": "wh_lagos"})
    assert r.status_code == 403, r.text

    r = c.put("/api/users/u_sa", headers=hdr(world, "acc"), json={"name": "Owned"})
    assert r.status_code == 403, r.text

    r = c.put("/api/users/u_gm", headers=hdr(world, "gm"), json={"role": "super_admin"})
    assert r.status_code in (400, 403)


def test_users_debt_ceiling_and_agents(world, ids):
    c = world["c"]
    H = hdr(world, "sa")
    r = c.put("/api/users/u_rep/debt-ceiling?debt_ceiling=750000", headers=H)
    body = ok(r)
    assert body["debt_ceiling"] == 750000
    assert body["is_flagged"] is False

    r = c.put("/api/users/u_rep/debt-ceiling?debt_ceiling=-5", headers=H)
    assert r.status_code == 422

    r = c.get("/api/users/agents", headers=H)
    agents = ok(r)
    rep = next(a for a in agents if a["user_id"] == "u_rep")
    assert rep["outstanding_balance"] == 0
    assert rep["debt_ceiling"] == 750000


# ═══════════════════════════════════════════════════════════════════════════
# 3. ROLE & PERMISSION MATRIX
# ═══════════════════════════════════════════════════════════════════════════
def test_role_permission_matrix_read_and_write(world):
    c = world["c"]
    for role in ("sa", "gm", "acc"):
        r = c.get("/api/admin/role-permissions", headers=hdr(world, role))
        body = ok(r)
        assert len(body["roles"]) == len(ROLES)
        assert body["modules"], "module list missing"
        assert body["module_labels"]["inventory"] == "Inventory"

    r = c.get("/api/admin/role-permissions/viewer", headers=hdr(world, "acc"))
    body = ok(r)
    assert body["role"] == "viewer"
    assert body["permissions"]["inventory"]["read"] is True

    r = c.get("/api/admin/role-permissions/does_not_exist", headers=hdr(world, "sa"))
    assert r.status_code == 404

    # Change a subordinate role and prove the change actually takes effect.
    import permissions as perms_mod
    before = c.get("/api/reports/profit-loss", headers=hdr(world, "sc"))
    assert before.status_code == 200, before.text

    r = c.put("/api/admin/role-permissions/sales_clerk", headers=hdr(world, "sa"),
              json={"permissions": {"reports": {"create": False, "read": False,
                                               "update": False, "delete": False}}})
    ok(r)
    perms_mod.invalidate_cache("sales_clerk")
    r = c.get("/api/reports/profit-loss", headers=hdr(world, "sc"))
    assert r.status_code == 403, "the permission change did not take effect"

    r = c.post("/api/admin/role-permissions/reset/sales_clerk", headers=hdr(world, "sa"))
    ok(r)
    perms_mod.invalidate_cache("sales_clerk")
    assert c.get("/api/reports/profit-loss", headers=hdr(world, "sc")).status_code == 200


def test_role_permission_self_escalation_refused(world):
    r = world["c"].put("/api/admin/role-permissions/accountant", headers=hdr(world, "acc"),
                       json={"permissions": {"inventory": {"create": True, "read": True,
                                                           "update": True, "delete": True}}})
    assert r.status_code == 403, r.text


# ═══════════════════════════════════════════════════════════════════════════
# 4. COMPANY & WAREHOUSES
# ═══════════════════════════════════════════════════════════════════════════
def test_company_read_and_update(world):
    c = world["c"]
    body = ok(c.get("/api/company", headers=hdr(world, "sa")))
    assert body["currency"] == "NGN", "the default currency must be NGN, not USD"

    body = ok(c.put("/api/company", headers=hdr(world, "sa"), json={
        "name": "BizCore Foods Ltd", "address": "Lagos", "tax_id": "TIN-1", "currency": "NGN"}))
    assert body["name"] == "BizCore Foods Ltd"

    assert c.put("/api/company", headers=hdr(world, "acc"),
                 json={"name": "Hijacked"}).status_code == 403


def test_warehouses_crud(world, ids):
    c = world["c"]
    H = hdr(world, "sa")
    body = ok(c.get("/api/warehouses", headers=H))
    assert len(body) == 3

    body = ok(c.post("/api/warehouses", headers=H, json={"name": "Port Harcourt Depot"}))
    ids["wh"] = body["warehouse_id"]

    body = ok(c.put(f"/api/warehouses/{ids['wh']}", headers=H, json={"name": "PH Depot"}))
    assert body["name"] == "PH Depot"

    ok(c.delete(f"/api/warehouses/{ids['wh']}", headers=H))
    body = ok(c.get("/api/warehouses", headers=H))
    assert all(w["warehouse_id"] != ids["wh"] for w in body), "deleted warehouse still listed"


# ═══════════════════════════════════════════════════════════════════════════
# 5. PRODUCTS & INVENTORY
# ═══════════════════════════════════════════════════════════════════════════
def test_products_crud_and_filters(world, ids):
    c = world["c"]
    H = hdr(world, "sa")

    body = ok(c.get("/api/products", headers=H))
    assert len(body) == 3
    assert body[0]["sku"], "product must expose its SKU"

    body = ok(c.post("/api/products", headers=H, json={
        "sku": "NEW-1", "name": "New Product", "category": "raw", "unit": "pcs",
        "cost_price": 10.0, "selling_price": 20.0, "reorder_level": 5, "barcode": "BC-NEW"}))
    ids["product"] = body["product_id"]

    body = ok(c.get(f"/api/products/{ids['product']}", headers=H))
    assert body["sku"] == "NEW-1"

    body = ok(c.put(f"/api/products/{ids['product']}", headers=H, json={"selling_price": 25.0}))
    assert body["selling_price"] == 25.0

    body = ok(c.get("/api/products?category=raw", headers=H))
    assert all(p["category"] == "raw" for p in body)

    ok(c.delete(f"/api/products/{ids['product']}", headers=H))
    body = ok(c.get("/api/products", headers=H))
    assert all(p["product_id"] != ids["product"] for p in body)

    # Duplicate SKU is refused.
    r = c.post("/api/products", headers=H, json={"sku": "RAW-TOM", "name": "Dup"})
    assert r.status_code == 400


def test_inventory_views_and_scopes(world):
    c = world["c"]

    body = ok(c.get("/api/inventory", headers=hdr(world, "sa")))
    assert len(body) == 4
    for row in body:
        assert isinstance(row["quantity"], (int, float)), \
            f"quantity came back as {type(row['quantity']).__name__}: {row['quantity']!r}"
        assert row["product_name"] and row["warehouse_name"], "inventory rows must be enriched"

    body = ok(c.get("/api/inventory/by-warehouse", headers=hdr(world, "sa")))
    tomato = next(p for p in body if p["product_id"] == "p_tomato")
    assert tomato["total_quantity"] == 750, tomato
    assert tomato["total_value"] == 75000.0, tomato
    by_wh = {w["warehouse_id"]: w["quantity"] for w in tomato["by_warehouse"]}
    assert by_wh.get("wh_lagos") == 500, by_wh
    assert by_wh.get("wh_abuja") == 250, by_wh
    assert set(by_wh) >= {"wh_lagos", "wh_abuja"}, "every active warehouse must be listed"

    # A warehouse-scoped user sees only their own branch.
    body = ok(c.get("/api/inventory/by-warehouse", headers=hdr(world, "wm")))
    tomato = next(p for p in body if p["product_id"] == "p_tomato")
    assert tomato["total_quantity"] == 500, tomato
    assert all(w["warehouse_id"] == "wh_lagos" for w in tomato["by_warehouse"])

    body = ok(c.get("/api/inventory/all-warehouses", headers=hdr(world, "sa")))
    tomato = next(p for p in body if p["product_id"] == "p_tomato")
    assert tomato["total_quantity"] == 750

    body = ok(c.get("/api/inventory/low-stock", headers=hdr(world, "sa")))
    assert isinstance(body, list)


def test_inventory_adjustment_semantics(world):
    c = world["c"]
    H = hdr(world, "sa")

    r = c.post("/api/inventory/adjust", headers=H, json={
        "product_id": "p_tin", "warehouse_id": "wh_lagos",
        "type": "adjustment", "quantity": -50, "notes": "damaged"})
    ok(r)
    body = ok(c.get("/api/inventory", headers=H))
    tin = next(x for x in body if x["product_id"] == "p_tin" and x["warehouse_id"] == "wh_lagos")
    assert tin["quantity"] == 250, tin

    # A movement must be recorded in the transaction history.
    body = ok(c.get("/api/inventory/transactions", headers=H))
    assert any(t["product_id"] == "p_tin" for t in body)

    # Stock may never go negative.
    r = c.post("/api/inventory/adjust", headers=H, json={
        "product_id": "p_tin", "warehouse_id": "wh_lagos",
        "type": "adjustment", "quantity": -999999})
    assert r.status_code == 400, r.text

    # A warehouse manager may not touch another branch.
    r = c.post("/api/inventory/adjust", headers=hdr(world, "wm"), json={
        "product_id": "p_tin", "warehouse_id": "wh_abuja",
        "type": "adjustment", "quantity": -5})
    assert r.status_code == 403, r.text


def test_barcode_lookup_and_generation(world):
    c = world["c"]
    H = hdr(world, "sa")
    body = ok(c.get("/api/barcode/BC-TOM-1", headers=H))
    assert body["product"]["sku"] == "RAW-TOM"
    assert body["total_stock"] == 750

    body = ok(c.post("/api/barcode/generate?product_id=p_tin", headers=H))
    assert body["barcode"].startswith("BZC")

    assert c.get("/api/barcode/NOPE", headers=H).status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# 6. PROCUREMENT LIFECYCLE
#    requisition → submit → approve → PO → GRN → invoice → 3-way match → payment
# ═══════════════════════════════════════════════════════════════════════════
def test_procurement_lifecycle(world, ids):
    c = world["c"]

    # 1. Purchase clerk raises a requisition
    body = ok(c.post("/api/requisitions", headers=hdr(world, "pc"), json={
        "department": "Production", "priority": "high",
        "required_date": SOON,
        "items": [{"product_id": "p_tomato", "quantity": 200,
                   "estimated_unit_price": 110.0, "reason": "Q3 production"}]}))
    req_id = body["requisition_id"]
    ids["req"] = req_id
    assert body["status"] == "draft"
    assert body["total_estimated"] == 22000.0, body
    assert body["requested_by"] == "u_pc"

    # 2. Clerk submits their own draft
    ok(c.put(f"/api/requisitions/{req_id}/submit", headers=hdr(world, "pc")))

    # 3. Warehouse manager approves
    ok(c.put(f"/api/requisitions/{req_id}/approve", headers=hdr(world, "wm")))
    body = ok(c.get(f"/api/requisitions/{req_id}", headers=hdr(world, "wm")))
    assert body["status"] == "approved"
    assert body["approved_by"] == "u_wm"

    # 4. Convert to a purchase order
    body = ok(c.post(f"/api/requisitions/{req_id}/convert-to-po"
                     f"?supplier_id=sup_farm&warehouse_id=wh_lagos", headers=hdr(world, "wm")))
    po_id = body["po_id"]
    ids["po"] = po_id
    assert body["po_number"].startswith("PO-")
    po = ok(c.get(f"/api/purchase-orders/{po_id}", headers=hdr(world, "pc")))
    assert po["status"] == "draft"
    assert po["supplier_id"] == "sup_farm"
    assert po["items"][0]["quantity"] == 200
    po_item = po["items"][0]["item_id"]

    # 5. Goods receipt — stock must increase by the accepted amount
    before = next(x for x in ok(c.get("/api/inventory", headers=hdr(world, "sa")))
                  if x["product_id"] == "p_tomato" and x["warehouse_id"] == "wh_lagos")
    body = ok(c.post("/api/grn", headers=hdr(world, "pc"), json={
        "po_id": po_id, "warehouse_id": "wh_lagos",
        "items": [{"po_item_id": po_item, "product_id": "p_tomato",
                   "received_quantity": 200, "accepted_quantity": 190,
                   "rejected_quantity": 10, "rejection_reason": "bruised"}]}))
    grn_id = body["grn_id"]
    ids["grn"] = grn_id
    assert body["total_amount"] == 190 * 110.0, body
    assert body["status"] == "pending"

    after = next(x for x in ok(c.get("/api/inventory", headers=hdr(world, "sa")))
                 if x["product_id"] == "p_tomato" and x["warehouse_id"] == "wh_lagos")
    assert after["quantity"] == before["quantity"] + 190, \
        f"stock must rise by the ACCEPTED quantity: {before['quantity']} -> {after['quantity']}"

    ok(c.put(f"/api/grn/{grn_id}/status?status=received", headers=hdr(world, "pc")))

    # 6. Purchase invoice for the accepted value
    body = ok(c.post("/api/invoices", headers=hdr(world, "acc"), json={
        "type": "purchase", "reference_id": po_id, "party_id": "sup_farm",
        "due_date": SOON, "subtotal": 20900.0, "tax_amount": 1000.0}))
    inv_id = body["invoice_id"]
    ids["po_invoice"] = inv_id
    assert body["total"] == 21900.0, body
    assert body["status"] == "unpaid"

    # 7. Three-way match
    body = ok(c.post(f"/api/three-way-match?po_id={po_id}&grn_id={grn_id}&invoice_id={inv_id}",
                     headers=hdr(world, "pc")))
    ids["match"] = body["match_id"]
    assert body["invoice_total"] == 21900.0, f"invoice total mis-read: {body}"
    assert body["po_total"] == 22000.0, body
    assert body["grn_total"] == 20900.0, body
    assert body["variance"] == 1100.0, body
    assert body["status"] in ("partial_match", "discrepancy"), body
    assert body["discrepancies"], "the quantity difference must be reported"

    # 8. Approve the match, then pay the invoice
    ok(c.put(f"/api/three-way-match/{ids['match']}/approve?notes=checked", headers=hdr(world, "pc")))
    body = ok(c.post("/api/payments", headers=hdr(world, "acc"), json={
        "invoice_id": inv_id, "amount": 10000.0, "method": "bank",
        "transaction_ref": "TRF-001"}))
    assert body["amount"] == 10000.0
    inv = ok(c.get(f"/api/invoices/{inv_id}", headers=hdr(world, "acc")))
    assert inv["paid_amount"] == 10000.0, inv
    assert inv["status"] == "partial", inv

    body = ok(c.post("/api/payments", headers=hdr(world, "acc"), json={
        "invoice_id": inv_id, "amount": 11900.0, "method": "bank"}))
    inv = ok(c.get(f"/api/invoices/{inv_id}", headers=hdr(world, "acc")))
    assert inv["status"] == "paid", inv
    assert inv["paid_amount"] == 21900.0, inv


def test_procurement_guards(world, ids):
    c = world["c"]
    # A PO already receipted through a GRN must not credit the stock twice
    def qty(pid, wh="wh_lagos"):
        return next(x for x in ok(c.get("/api/inventory", headers=hdr(world, "sa")))
                    if x["product_id"] == pid and x["warehouse_id"] == wh)["quantity"]

    before = qty("p_tomato")
    r = c.put(f"/api/purchase-orders/{ids['po']}?status=received",
              headers=hdr(world, "sa"), json={})
    assert r.status_code == 200, r.text
    assert qty("p_tomato") == before, \
        "the GRN already credited this PO — marking it received must not add stock again"

    # ...and a second close is refused outright
    r = c.put(f"/api/purchase-orders/{ids['po']}?status=received",
              headers=hdr(world, "sa"), json={})
    assert r.status_code == 400, "double-receiving a PO must be refused"

    # A negative payment is refused
    r = c.post("/api/payments", headers=hdr(world, "acc"),
               json={"invoice_id": ids["po_invoice"], "amount": -100})
    assert r.status_code == 422

    # A PO with no items is refused
    r = c.post("/api/purchase-orders", headers=hdr(world, "pc"), json={
        "supplier_id": "sup_farm", "warehouse_id": "wh_lagos", "items": []})
    assert r.status_code == 422

    # A zero-quantity line is refused
    r = c.post("/api/purchase-orders", headers=hdr(world, "pc"), json={
        "supplier_id": "sup_farm", "warehouse_id": "wh_lagos",
        "items": [{"product_id": "p_tomato", "quantity": 0, "unit_price": 10}]})
    assert r.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════
# 7. SALES LIFECYCLE (agent → manager → warehouse → agent → finance)
# ═══════════════════════════════════════════════════════════════════════════
def test_sales_lifecycle(world, ids):
    c = world["c"]

    # 1. Sales rep raises a quotation against their own warehouse's stock
    body = ok(c.post("/api/agent-quotations", headers=hdr(world, "rep"), json={
        "items": [{"product_id": "p_paste", "quantity": 10, "unit_price": 1500.0}]}))
    aq_id = body["quotation_id"]
    ids["aq"] = aq_id
    assert body["status"] == "draft"
    assert body["total_amount"] == 15000.0, body
    assert body["warehouse_id"] == "wh_lagos"
    assert body["sales_rep_id"] == "u_rep"

    # A rep cannot quote more than they have
    r = c.post("/api/agent-quotations", headers=hdr(world, "rep"), json={
        "items": [{"product_id": "p_paste", "quantity": 99999, "unit_price": 1500.0}]})
    assert r.status_code == 400, r.text

    # 2. Rep submits
    ok(c.put(f"/api/agent-quotations/{aq_id}/submit", headers=hdr(world, "rep")))

    # 3. Manager approves with remarks → a Sales Order is auto-created
    body = ok(c.put(f"/api/agent-quotations/{aq_id}/approve", headers=hdr(world, "wm"),
                    json={"approval_remarks": "Approved for the Lagos route"}))
    so_id = body["so_id"]
    ids["so"] = so_id
    assert body["so_number"].startswith("SO-")

    so = ok(c.get(f"/api/sales-orders/{so_id}", headers=hdr(world, "wm")))
    assert so["status"] == "approved", so
    assert so["dispatch_status"] == "pending_dispatch", so
    assert so["total_amount"] == 15000.0, so
    assert so["sales_rep_id"] == "u_rep"

    # 4. The warehouse sees it in the dispatch queue
    body = ok(c.get("/api/sales-orders/pending-dispatch", headers=hdr(world, "sc")))
    assert any(o["so_id"] == so_id for o in body), "the approved SO must be dispatchable"

    # 5. Warehouse releases the goods → stock down, agent ledger debited
    before = next(x for x in ok(c.get("/api/inventory", headers=hdr(world, "sa")))
                  if x["product_id"] == "p_paste" and x["warehouse_id"] == "wh_lagos")
    ok(c.put(f"/api/sales-orders/{so_id}/release-goods", headers=hdr(world, "sc")))
    after = next(x for x in ok(c.get("/api/inventory", headers=hdr(world, "sa")))
                 if x["product_id"] == "p_paste" and x["warehouse_id"] == "wh_lagos")
    assert after["quantity"] == before["quantity"] - 10, \
        f"stock must fall on release: {before['quantity']} -> {after['quantity']}"

    so = ok(c.get(f"/api/sales-orders/{so_id}", headers=hdr(world, "sc")))
    assert so["status"] == "goods_released", so
    assert so["dispatch_status"] == "dispatched", so

    ledger = ok(c.get("/api/agent-ledger", headers=hdr(world, "rep")))
    assert ledger["accounts_receivable"] == 15000.0, ledger
    assert ledger["total_goods_released"] == 15000.0, ledger
    assert ledger["items_in_custody"][0]["quantity"] == 10, ledger
    assert ledger["agent"]["debt_ceiling"] == 750000.0, ledger

    # 6. The rep confirms delivery
    ok(c.put(f"/api/sales-orders/{so_id}/confirm-delivery", headers=hdr(world, "rep")))
    so = ok(c.get(f"/api/sales-orders/{so_id}", headers=hdr(world, "rep")))
    assert so["status"] == "delivered", so

    # 7. Delivery note
    body = ok(c.post("/api/delivery-notes", headers=hdr(world, "sc"), json={"so_id": so_id}))
    dn_id = body["delivery_id"]
    ids["dn"] = dn_id
    assert body["so_number"] == so["so_number"]
    assert body["sales_rep_id"] == "u_rep", body
    assert body["distributor_name"] == so["sales_rep_name"], "legacy alias must still be populated"

    ok(c.put(f"/api/delivery-notes/{dn_id}/status?status=delivered", headers=hdr(world, "sc")))

    # 8. Sales invoice, then a payment from the agent
    body = ok(c.post("/api/invoices", headers=hdr(world, "acc"), json={
        "type": "sale", "reference_id": so_id, "party_id": "u_rep",
        "due_date": SOON, "subtotal": 15000.0, "tax_amount": 0.0}))
    inv_id = body["invoice_id"]
    ids["so_invoice"] = inv_id
    assert body["total"] == 15000.0

    body = ok(c.post("/api/agent-ledger/payment", headers=hdr(world, "wm"), json={
        "sales_rep_id": "u_rep", "amount": 5000.0, "payment_method": "bank"}))
    assert body["new_outstanding"] == 10000.0, body

    ledger = ok(c.get("/api/agent-ledger", headers=hdr(world, "rep")))
    assert ledger["accounts_receivable"] == 10000.0, ledger
    assert ledger["total_payments_received"] == 5000.0, ledger


def test_agent_debt_ceiling_flagging(world, ids):
    """When outstanding reaches the ceiling the agent must be flagged."""
    c = world["c"]
    # Drop the ceiling so the existing 10,000 balance trips it.
    ok(c.put("/api/users/u_rep/debt-ceiling?debt_ceiling=5000", headers=hdr(world, "sa")))
    agents = ok(c.get("/api/users/agents", headers=hdr(world, "sa")))
    rep = next(a for a in agents if a["user_id"] == "u_rep")
    assert rep["is_flagged"] is True, rep
    assert rep["outstanding_balance"] == 10000.0, rep
    # restore
    ok(c.put("/api/users/u_rep/debt-ceiling?debt_ceiling=750000", headers=hdr(world, "sa")))


def test_sales_guards(world, ids):
    c = world["c"]
    # A viewer cannot create a quotation
    r = c.post("/api/agent-quotations", headers=hdr(world, "viewer"), json={
        "items": [{"product_id": "p_paste", "quantity": 1, "unit_price": 100}]})
    assert r.status_code == 403

    # Approval requires remarks
    r = c.put(f"/api/agent-quotations/{ids['aq']}/approve", headers=hdr(world, "wm"),
              json={"approval_remarks": "   "})
    assert r.status_code == 422

    # A rep cannot release goods
    r = c.put(f"/api/sales-orders/{ids['so']}/release-goods", headers=hdr(world, "rep"))
    assert r.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════
# 8. BOM & PRODUCTION
# ═══════════════════════════════════════════════════════════════════════════
def test_bom_production_consumes_components(world, ids):
    c = world["c"]
    body = ok(c.post("/api/bom", headers=hdr(world, "wm"), json={
        "finished_product_id": "p_paste", "yield_quantity": 10.0,
        "components": [{"raw_product_id": "p_tomato", "quantity_required": 2.0},
                       {"raw_product_id": "p_tin", "quantity_required": 1.0}]}))
    bom_id = body["bom_id"]
    ids["bom"] = bom_id
    assert body["finished_product_name"] == "Tomato Paste"
    assert len(body["components"]) == 2

    body = ok(c.get("/api/bom", headers=hdr(world, "wm")))
    assert any(b["bom_id"] == bom_id for b in body)

    body = ok(c.get("/api/bom/p_paste", headers=hdr(world, "wm")))
    assert body["bom_id"] == bom_id

    # BOMs are only valid for finished products
    r = c.post("/api/bom", headers=hdr(world, "wm"), json={
        "finished_product_id": "p_tomato", "yield_quantity": 1.0,
        "components": [{"raw_product_id": "p_tin", "quantity_required": 1.0}]})
    assert r.status_code == 400, r.text

    # Produce 20 units → consumes 40kg tomatoes and 20 tins, adds 20 tins of paste
    def qty(pid, wh="wh_lagos"):
        return next(x for x in ok(c.get("/api/inventory", headers=hdr(world, "sa")))
                    if x["product_id"] == pid and x["warehouse_id"] == wh)["quantity"]

    # The BOM makes 10 tins of paste from 2kg of tomatoes + 1 tin of packaging,
    # so producing 20 tins consumes 4kg of tomatoes and 2 tins of packaging.
    t0, tin0, paste0 = qty("p_tomato"), qty("p_tin"), qty("p_paste")
    ok(c.post(f"/api/bom/{bom_id}/produce?quantity=20&warehouse_id=wh_lagos", headers=hdr(world, "wm")))
    assert qty("p_tomato") == t0 - 4, "components must be consumed"
    assert qty("p_tin") == tin0 - 2, "components must be consumed"
    assert qty("p_paste") == paste0 + 20, "finished goods must be produced"

    # Producing more than the stock allows is refused
    r = c.post(f"/api/bom/{bom_id}/produce?quantity=999999&warehouse_id=wh_lagos",
               headers=hdr(world, "wm"))
    assert r.status_code == 400, r.text


# ═══════════════════════════════════════════════════════════════════════════
# 9. WAREHOUSE TRANSFERS
# ═══════════════════════════════════════════════════════════════════════════
def test_warehouse_transfer_moves_stock(world, ids):
    c = world["c"]

    def qty(pid, wh):
        rows = [x for x in ok(c.get("/api/inventory", headers=hdr(world, "sa")))
                if x["product_id"] == pid and x["warehouse_id"] == wh]
        return rows[0]["quantity"] if rows else 0

    before_src = qty("p_tin", "wh_lagos")
    before_dst = qty("p_tin", "wh_abuja")

    body = ok(c.post("/api/warehouse-transfers", headers=hdr(world, "acc"), json={
        "to_warehouse_id": "wh_abuja", "items": [{"product_id": "p_tin", "quantity": 60}]}))
    wt_id = body["transfer_id"]
    ids["wt"] = wt_id
    assert body["status"] == "pending"
    assert body["from_warehouse_id"] == "wh_lagos"
    assert body["total_value"] == 60 * 50.0, body

    body = ok(c.get("/api/warehouse-transfers", headers=hdr(world, "acc")))
    assert any(t["transfer_id"] == wt_id for t in body)

    # The receiving branch confirms → stock moves
    ok(c.put(f"/api/warehouse-transfers/{wt_id}/confirm", headers=hdr(world, "acc2")))
    assert qty("p_tin", "wh_lagos") == before_src - 60, "source stock must fall"
    assert qty("p_tin", "wh_abuja") == before_dst + 60, "destination stock must rise"

    body = ok(c.get("/api/warehouse-transfers", headers=hdr(world, "acc")))
    t = next(t for t in body if t["transfer_id"] == wt_id)
    assert t["status"] == "confirmed", t
    assert t["confirmed_by"] == "u_acc2", t

    # A confirmed transfer can no longer be cancelled
    r = c.put(f"/api/warehouse-transfers/{wt_id}/cancel", headers=hdr(world, "acc"))
    assert r.status_code == 400, r.text

    # A transfer is refused if the source does not hold the stock
    r = c.post("/api/warehouse-transfers", headers=hdr(world, "acc"), json={
        "to_warehouse_id": "wh_abuja", "items": [{"product_id": "p_tin", "quantity": 999999}]})
    assert r.status_code == 400, r.text


def test_warehouse_transfer_cancellation(world, ids):
    c = world["c"]
    created = ok(c.post("/api/warehouse-transfers", headers=hdr(world, "acc"), json={
        "to_warehouse_id": "wh_kano", "items": [{"product_id": "p_tin", "quantity": 5}]}))
    wt_id = created["transfer_id"]
    ok(c.put(f"/api/warehouse-transfers/{wt_id}/cancel", headers=hdr(world, "acc")))
    body = ok(c.get("/api/warehouse-transfers", headers=hdr(world, "acc")))
    t = next(t for t in body if t["transfer_id"] == wt_id)
    assert t["status"] == "cancelled", t


# ═══════════════════════════════════════════════════════════════════════════
# 10. EXPENSES
# ═══════════════════════════════════════════════════════════════════════════
def test_expenses_lifecycle(world, ids):
    c = world["c"]
    body = ok(c.post("/api/expenses", headers=hdr(world, "acc"), json={
        "category": "travel", "amount": 7500.0, "description": "Abuja sales run",
        "vendor": "Airtel", "payment_method": "cash"}))
    exp_id = body["expense_id"]
    ids["exp"] = exp_id
    assert body["approved"] is False
    assert body["warehouse_id"] == "wh_lagos", "an expense must be tagged to the creator's branch"
    assert body["created_by"] == "u_acc"

    ok(c.put(f"/api/expenses/{exp_id}/approve", headers=hdr(world, "acc")))
    body = ok(c.get("/api/expenses", headers=hdr(world, "acc")))
    e = next(x for x in body if x["expense_id"] == exp_id)
    assert e["approved"] is True
    assert e["approved_by"] == "u_acc"

    body = ok(c.get("/api/expenses?approved_only=true", headers=hdr(world, "acc")))
    assert any(x["expense_id"] == exp_id for x in body)

    body = ok(c.get("/api/expenses?category=travel", headers=hdr(world, "acc")))
    assert all(x["category"] == "travel" for x in body)

    # A viewer cannot delete an expense
    assert c.delete(f"/api/expenses/{exp_id}", headers=hdr(world, "viewer")).status_code == 403
    # A negative expense is refused
    r = c.post("/api/expenses", headers=hdr(world, "acc"), json={
        "category": "office", "amount": -10, "description": "x"})
    assert r.status_code == 422

    ok(c.delete(f"/api/expenses/{exp_id}", headers=hdr(world, "acc")))
    body = ok(c.get("/api/expenses?approved_only=true", headers=hdr(world, "acc")))
    assert all(x["expense_id"] != exp_id for x in body)


# ═══════════════════════════════════════════════════════════════════════════
# 11. CLASSIC QUOTATIONS (the customer-facing quotation flow)
# ═══════════════════════════════════════════════════════════════════════════
def test_classic_quotation_lifecycle(world, ids):
    c = world["c"]
    body = ok(c.post("/api/quotations", headers=hdr(world, "sa"), json={
        "customer_id": "u_rep2",
        "items": [{"product_id": "p_paste", "quantity": 4, "unit_price": 1500.0,
                   "discount_percent": 10}],
        "tax_amount": 500.0, "valid_days": 30, "terms": "Net 30"}))
    qt_id = body["quotation_id"]
    ids["qt"] = qt_id
    assert body["status"] == "draft"
    assert body["subtotal"] == 6000.0, body
    assert body["discount_amount"] == 600.0, body
    assert body["total_amount"] == 6000.0 - 600.0 + 500.0, body
    assert body["customer_id"] == "u_rep2"

    body = ok(c.get("/api/quotations", headers=hdr(world, "sa")))
    assert any(q["quotation_id"] == qt_id for q in body)

    # Filtering by the retired `distributor_id` must map onto customer_id
    body = ok(c.get("/api/quotations?distributor_id=u_rep2", headers=hdr(world, "sa")))
    assert any(q["quotation_id"] == qt_id for q in body), \
        "the distributor_id filter must still resolve to the customer"

    ok(c.put(f"/api/quotations/{qt_id}/status?status=accepted", headers=hdr(world, "sa")))

    body = ok(c.post(f"/api/quotations/{qt_id}/convert-to-order?warehouse_id=wh_abuja",
                     headers=hdr(world, "sa")))
    assert body["so_number"].startswith("SO-")
    so = ok(c.get(f"/api/sales-orders/{body['so_id']}", headers=hdr(world, "sa")))
    assert so["subtotal"] == 6000.0 - 600.0, f"discount must be applied: {so}"
    assert so["items"][0]["unit_price"] == 1500.0 * 0.9, so
    assert so["total_amount"] == 6000.0 - 600.0 + 500.0, so
    assert so["sales_rep_id"] == "u_rep2", so
    assert so["warehouse_id"] == "wh_abuja"

    # Only an accepted quotation can be converted
    r = c.post(f"/api/quotations/{qt_id}/convert-to-order?warehouse_id=wh_lagos",
               headers=hdr(world, "sa"))
    assert r.status_code == 400, r.text

    # A viewer may not change a quotation's status
    r = c.put(f"/api/quotations/{qt_id}/status?status=rejected", headers=hdr(world, "viewer"))
    assert r.status_code == 403, r.text


# ═══════════════════════════════════════════════════════════════════════════
# 12. REPORTS — all seventeen, with real assertions
# ═══════════════════════════════════════════════════════════════════════════
def test_reports_produce_correct_numbers(world):
    c = world["c"]
    H = hdr(world, "sa")

    body = ok(c.get("/api/reports/stock-summary", headers=H))
    assert isinstance(body, list) and body
    row = body[0]
    for field in ("product_name", "sku", "warehouse_name", "quantity", "value"):
        assert field in row, f"stock-summary is missing {field}: {row}"
    assert isinstance(row["quantity"], (int, float)), row
    assert row["value"] == round(row["quantity"] * row["cost_price"], 2), row

    body = ok(c.get("/api/reports/purchase-analysis", headers=H))
    assert body["total_orders"] >= 1, body
    assert body["total_amount"] > 0, body
    assert body["by_supplier"], body

    body = ok(c.get("/api/reports/sales-analysis", headers=H))
    assert body["total_orders"] >= 1, body
    assert body["by_sales_rep"], "the sales analysis must group by sales rep"

    body = ok(c.get("/api/reports/profit-loss", headers=H))
    for field in ("revenue", "cost_of_goods_sold", "gross_profit",
                  "operating_expenses", "net_profit", "gross_margin_percent"):
        assert field in body, f"profit-loss is missing {field}"
    assert body["revenue"]["total_sales"] > 0, body
    assert body["gross_profit"] == round(
        body["revenue"]["total_sales"] - body["cost_of_goods_sold"]["total_cogs"], 2), body

    body = ok(c.get("/api/reports/cash-flow", headers=H))
    assert body["cash_inflows"]["total"] > 0, body
    assert "cash_outflows" in body and "net_cash_flow" in body

    body = ok(c.get("/api/reports/supplier-aging", headers=H))
    assert body["total_accounts_payable"] >= 0, body
    assert set(body["aging_summary"]) == {"current", "1_30_days", "31_60_days",
                                          "61_90_days", "over_90_days"}, body

    body = ok(c.get("/api/reports/customer-aging", headers=H))
    assert body["total_accounts_receivable"] > 0, \
        f"customer aging must see the unpaid sale invoice: {body}"

    body = ok(c.get("/api/reports/inventory-valuation", headers=H))
    assert body["total_inventory_value"] > 0, body
    assert body["total_skus"] >= 3, body
    assert body["items"][0]["total_value"] >= body["items"][-1]["total_value"], \
        "valuation must be sorted by value"

    body = ok(c.get("/api/reports/trial-balance", headers=H))
    assert body["total_debit"] > 0, body
    ar = next(a for a in body["assets"] if a["account"] == "Accounts Receivable")
    assert ar["debit"] > 0, f"the trial balance must pick up receivables: {ar}"
    assert abs(body["total_debit"] - body["total_credit"]) < 0.01, \
        f"the trial balance must balance: {body}"

    body = ok(c.get("/api/reports/balance-sheet", headers=H))
    assert body["assets"]["total_assets"] > 0, body
    assert body["is_balanced"] is True, \
        f"the balance sheet must balance: {body['assets']['total_assets']} vs " \
        f"{body['total_liabilities_and_equity']}"

    body = ok(c.get("/api/reports/supplier-performance", headers=H))
    assert body["suppliers"], body
    s = body["suppliers"][0]
    for field in ("supplier_name", "delivery_rate", "quality_rate", "overall_score"):
        assert field in s, f"supplier performance is missing {field}"
    assert 0 <= s["overall_score"] <= 100, s

    body = ok(c.get("/api/reports/agent-performance", headers=H))
    assert body["agents"], body
    a = next(x for x in body["agents"] if x["agent_id"] == "u_rep")
    assert a["total_revenue"] == 15000.0, a
    assert a["outstanding_balance"] == 10000.0, a
    assert a["total_quotations"] >= 1, a
    assert body["summary"]["total_agents"] >= 2, body["summary"]

    body = ok(c.get("/api/reports/warehouse-performance", headers=H))
    assert body["warehouses"], body
    w = next(x for x in body["warehouses"] if x["warehouse_id"] == "wh_lagos")
    assert w["total_sales"] > 0, w
    assert w["net"] == round(w["total_sales"] - w["total_expenses"], 2), w

    body = ok(c.get("/api/reports/warehouse-performance", headers=hdr(world, "wm")))
    assert all(x["warehouse_id"] == "wh_lagos" for x in body["warehouses"]), \
        "a warehouse manager must only see their own branch"


def test_report_pdfs_are_valid(world):
    c = world["c"]
    H = hdr(world, "sa")
    for path in ("/api/reports/stock-summary/pdf", "/api/reports/profit-loss/pdf"):
        r = c.get(path, headers=H)
        assert r.status_code == 200, f"{path} -> {r.status_code}"
        assert r.headers["content-type"] == "application/pdf", path
        assert r.content[:4] == b"%PDF", f"{path} is not a PDF: {r.content[:20]!r}"
        assert len(r.content) > 1000, path

    for path in ("/api/reports/stock-summary/pdf-base64",
                 "/api/reports/profit-loss/pdf-base64"):
        body = ok(c.get(path, headers=H))
        assert "pdf_base64" in body, path
        import base64
        assert base64.b64decode(body["pdf_base64"])[:4] == b"%PDF", path


def test_invoice_pdfs_are_valid(world, ids):
    c = world["c"]
    H = hdr(world, "sa")
    r = c.get(f"/api/invoices/{ids['so_invoice']}/pdf", headers=H)
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"

    body = ok(c.get(f"/api/invoices/{ids['so_invoice']}/pdf-base64", headers=H))
    import base64
    assert base64.b64decode(body["pdf_base64"])[:4] == b"%PDF"
    assert body["filename"].startswith("invoice_")

    # A role without invoice read must be refused
    assert c.get(f"/api/invoices/{ids['so_invoice']}/pdf",
                 headers=hdr(world, "rep")).status_code == 403


# ═══════════════════════════════════════════════════════════════════════════
# 13. DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════
def test_dashboard_endpoints(world):
    c = world["c"]
    H = hdr(world, "sa")

    body = ok(c.get("/api/dashboard/stats", headers=H))
    for field in ("total_inventory_value", "low_stock_count", "today_sales",
                  "today_purchases", "cash_balance", "pending_invoices",
                  "total_products", "total_suppliers", "total_agents",
                  "total_warehouses"):
        assert field in body, f"dashboard stats is missing {field}: {body}"
    assert body["total_products"] >= 3, body
    assert body["total_agents"] >= 2, body
    assert body["total_inventory_value"] > 0, body

    body = ok(c.get("/api/dashboard/recent-activity", headers=H))
    assert isinstance(body, list)
    for a in body[:3]:
        assert {"type", "title", "timestamp"} <= set(a), a

    body = ok(c.get("/api/dashboard/sales-chart", headers=H))
    assert len(body) == 7, body
    assert {"date", "sales", "purchases"} <= set(body[0]), body[0]

    body = ok(c.get("/api/dashboard/top-products", headers=H))
    assert isinstance(body, list)

    body = ok(c.get("/api/dashboard/branch-summary", headers=H))
    assert body["branches"], body
    b = next(x for x in body["branches"] if x["warehouse_id"] == "wh_lagos")
    assert b["inventory_value"] > 0, b
    assert "today_sales" in b and "open_orders_pending_dispatch" in b, b


# ═══════════════════════════════════════════════════════════════════════════
# 14. NOTIFICATIONS, AUDIT, SYNC, PUSH, ACCOUNTS
# ═══════════════════════════════════════════════════════════════════════════
def test_notifications_lifecycle(world):
    c = world["c"]
    H = hdr(world, "sa")

    body = ok(c.get("/api/notifications", headers=H))
    assert isinstance(body, list)

    body = ok(c.get("/api/notifications/generate-alerts", headers=H))
    assert "alerts_generated" in body, body

    # The alert generator must not spam: a second call adds no duplicates.
    before = len(ok(c.get("/api/notifications", headers=H)))
    ok(c.get("/api/notifications/generate-alerts", headers=H))
    after = len(ok(c.get("/api/notifications", headers=H)))
    assert after == before, f"the alert generator duplicated notifications: {before} -> {after}"

    ok(c.put("/api/notifications/read-all", headers=H))
    body = ok(c.get("/api/notifications?unread_only=true", headers=H))
    assert body == [], body


def test_push_token_registration(world):
    c = world["c"]
    H = hdr(world, "sa")
    ok(c.post("/api/notifications/register-push-token", headers=H,
              json={"push_token": "ExponentPushToken[abc123]", "device_type": "android"}))
    body = ok(c.get("/api/notifications/push-tokens", headers=H))
    assert any(t["push_token"].startswith("ExponentPushToken") for t in body)
    ok(c.delete("/api/notifications/unregister-push-token", headers=H))
    body = ok(c.get("/api/notifications/push-tokens", headers=H))
    assert not any(t["user_id"] == "u_sa" for t in body)


def test_audit_log_captures_activity(world):
    c = world["c"]
    body = ok(c.get("/api/audit-logs", headers=hdr(world, "sa")))
    assert body, "the audit log must not be empty"
    log = body[0]
    for field in ("user_id", "action", "entity_type", "entity_id", "timestamp"):
        assert field in log, f"audit log is missing {field}: {log}"
    assert "user_name" in log, log

    body = ok(c.get("/api/audit-logs?entity_type=quotation", headers=hdr(world, "sa")))
    assert all(l["entity_type"] == "quotation" for l in body)

    # NOTE: mongomock-motor's cursor.to_list() ignores the length argument
    # (real Motor honours it), so the cap itself is asserted through the
    # declared bounds rather than by counting rows here.
    assert c.get("/api/audit-logs?limit=0", headers=hdr(world, "sa")).status_code == 422
    assert c.get("/api/audit-logs?limit=100000", headers=hdr(world, "sa")).status_code == 422
    body = ok(c.get("/api/audit-logs?limit=1000", headers=hdr(world, "sa")))
    assert len(body) <= 1000

    # A warehouse manager has no audit-log visibility
    assert c.get("/api/audit-logs", headers=hdr(world, "wm")).status_code == 403


def test_sync_pull_push_and_status(world):
    c = world["c"]
    H = hdr(world, "sa")

    body = ok(c.post("/api/sync/pull", headers=H, json={"entity_type": "products"}))
    assert body["entity_type"] == "products"
    assert body["count"] >= 3, body
    assert all("product_id" in p for p in body["data"]), body

    for entity in ("products", "suppliers", "warehouses", "inventory",
                   "purchase_orders", "sales_orders"):
        body = ok(c.post("/api/sync/pull", headers=H, json={"entity_type": entity}))
        assert "data" in body, entity

    r = c.post("/api/sync/pull", headers=H, json={"entity_type": "not_a_thing"})
    assert r.status_code == 400

    # A stock adjustment pushed from the device must land in the ledger.
    body = ok(c.post("/api/sync/push", headers=H, json={
        "entity_type": "stock_adjustments",
        "local_changes": [{"action": "create", "entity_id": "offline-1",
                           "data": {"product_id": "p_tin", "warehouse_id": "wh_lagos",
                                    "quantity": -2, "type": "adjustment",
                                    "notes": "offline correction"}}]}))
    assert body["synced"] == 1, body
    assert not body["errors"], body

    # A viewer may not push
    r = c.post("/api/sync/push", headers=hdr(world, "viewer"), json={
        "entity_type": "sales_orders",
        "local_changes": [{"action": "create", "entity_id": "x", "data": {}}]})
    assert r.status_code == 403, r.text

    body = ok(c.get("/api/sync/status", headers=H))
    assert "entities" in body and "server_time" in body


def test_chart_of_accounts(world):
    c = world["c"]
    body = ok(c.get("/api/accounts", headers=hdr(world, "sa")))
    assert len(body) == 4, body

    body = ok(c.get("/api/accounts?type=asset", headers=hdr(world, "sa")))
    assert all(a["type"] == "asset" for a in body)

    body = ok(c.post("/api/accounts", headers=hdr(world, "acc"), json={
        "code": "1100", "name": "Bank", "type": "asset"}))
    assert body["code"] == "1100"

    r = c.post("/api/accounts", headers=hdr(world, "acc"), json={
        "code": "1000", "name": "Dup", "type": "asset"})
    assert r.status_code == 400, r.text


# ═══════════════════════════════════════════════════════════════════════════
# 15. TENANT ISOLATION — every scoped endpoint, probed from the wrong branch
# ═══════════════════════════════════════════════════════════════════════════
def test_tenant_isolation_across_every_scoped_endpoint(world, ids):
    """A Lagos user must never read or write Abuja data."""
    c = world["c"]
    L = hdr(world, "wm")      # Lagos warehouse manager
    A = hdr(world, "acc2")    # Abuja accountant

    # --- reads ---
    probes = [
        ("GET", "/api/inventory?warehouse_id=wh_abuja", 403),
        ("GET", "/api/inventory/transactions?warehouse_id=wh_abuja", 403),
        ("GET", "/api/inventory/low-stock", 200),          # scoped, not refused
        ("GET", "/api/inventory/all-warehouses", 200),     # scoped to own branch
        ("GET", "/api/reports/stock-summary?warehouse_id=wh_abuja", 403),
        ("GET", "/api/reports/inventory-valuation?warehouse_id=wh_abuja", 403),
        ("GET", "/api/users", 200),                       # scoped to own branch
        ("GET", "/api/audit-logs", 403),
        ("GET", "/api/warehouse-transfers", 200),
        ("GET", "/api/dashboard/branch-summary", 403),
        ("GET", "/api/agent-ledger?sales_rep_id=u_rep2", 403),
    ]
    for method, path, expect in probes:
        r = c.request(method, path, headers=L)
        assert r.status_code == expect, \
            f"{method} {path} as a Lagos manager -> {r.status_code}, expected {expect}"

    # the branch-scoped reads must contain only their own branch
    body = ok(c.get("/api/inventory", headers=L))
    assert all(r["warehouse_id"] == "wh_lagos" for r in body), body

    body = ok(c.get("/api/inventory/all-warehouses", headers=L))
    for p in body:
        assert all(w["warehouse_id"] == "wh_lagos" for w in p["by_warehouse"]), p

    body = ok(c.get("/api/users", headers=L))
    assert all(u["warehouse_id"] == "wh_lagos" for u in body), body

    body = ok(c.get("/api/warehouse-transfers", headers=L))
    assert all(t["from_warehouse_id"] == "wh_lagos" or t["to_warehouse_id"] == "wh_lagos"
               for t in body), body

    # --- writes ---
    r = c.post("/api/inventory/adjust", headers=L, json={
        "product_id": "p_tomato", "warehouse_id": "wh_abuja",
        "type": "adjustment", "quantity": -1})
    assert r.status_code == 403, r.text

    r = c.post("/api/expenses", headers=A, json={
        "category": "office", "amount": 100, "description": "x"})
    assert r.status_code == 200
    exp_id = r.json()["expense_id"]
    assert r.json()["warehouse_id"] == "wh_abuja", "an expense must belong to the creator's branch"
    ok(c.delete(f"/api/expenses/{exp_id}", headers=A))

    # the Lagos manager may not approve an Abuja expense
    r = c.post("/api/expenses", headers=A, json={
        "category": "office", "amount": 100, "description": "x"})
    exp_id = r.json()["expense_id"]
    r = c.put(f"/api/expenses/{exp_id}/approve", headers=L)
    assert r.status_code == 403, r.text
    ok(c.delete(f"/api/expenses/{exp_id}", headers=A))


# ═══════════════════════════════════════════════════════════════════════════
# 16. ROLE MATRIX — every role against every read endpoint
# ═══════════════════════════════════════════════════════════════════════════
READ_PATHS = [
    "/api/auth/me", "/api/users", "/api/users/agents", "/api/company",
    "/api/warehouses", "/api/products", "/api/inventory", "/api/inventory/by-warehouse",
    "/api/inventory/all-warehouses", "/api/inventory/transactions", "/api/inventory/low-stock",
    "/api/suppliers", "/api/purchase-orders", "/api/sales-orders",
    "/api/sales-orders/pending-dispatch", "/api/invoices", "/api/payments", "/api/accounts",
    "/api/expenses", "/api/requisitions", "/api/quotations", "/api/agent-quotations",
    "/api/agent-ledger", "/api/grn", "/api/three-way-match", "/api/delivery-notes",
    "/api/bom", "/api/warehouse-transfers", "/api/audit-logs", "/api/notifications",
    "/api/notifications/push-tokens", "/api/dashboard/stats", "/api/dashboard/recent-activity",
    "/api/dashboard/sales-chart", "/api/dashboard/top-products", "/api/dashboard/branch-summary",
    "/api/reports/stock-summary", "/api/reports/purchase-analysis", "/api/reports/sales-analysis",
    "/api/reports/profit-loss", "/api/reports/cash-flow", "/api/reports/supplier-aging",
    "/api/reports/customer-aging", "/api/reports/inventory-valuation",
    "/api/reports/trial-balance", "/api/reports/balance-sheet",
    "/api/reports/supplier-performance", "/api/reports/agent-performance",
    "/api/reports/warehouse-performance", "/api/admin/role-permissions",
]


def test_every_role_against_every_read_endpoint(world):
    """No role may ever provoke a server error, and a refusal is always a
    clean 401/403 — never a 500."""
    c = world["c"]
    for role in ("sa", "sa2", "gm", "wm", "wm2", "acc", "acc2",
                 "pc", "sc", "rep", "rep2", "viewer"):
        for path in READ_PATHS:
            r = c.get(path, headers=hdr(world, role))
            assert r.status_code != 500, f"{role} GET {path} -> 500"
            assert r.status_code < 500, f"{role} GET {path} -> {r.status_code}"
            if r.status_code >= 400:
                assert r.status_code in (400, 401, 403), \
                    f"{role} GET {path} -> {r.status_code}: {r.text[:200]}"


def test_unauthenticated_access_is_refused_everywhere(world):
    c = world["c"]
    for path in READ_PATHS:
        r = c.get(path)
        assert r.status_code in (401, 403), \
            f"unauthenticated GET {path} -> {r.status_code}: {r.text[:200]}"


def test_write_endpoints_refuse_the_wrong_roles(world):
    c = world["c"]
    viewer = hdr(world, "viewer")
    writes = [
        ("POST", "/api/products", {"sku": "X", "name": "X"}),
        ("POST", "/api/suppliers", {"name": "X"}),
        ("POST", "/api/purchase-orders", {"supplier_id": "sup_farm",
                                          "warehouse_id": "wh_lagos", "items": []}),
        ("POST", "/api/sales-orders", {"sales_rep_id": "u_rep",
                                       "warehouse_id": "wh_lagos", "items": []}),
        ("POST", "/api/invoices", {"type": "sale", "reference_id": "x",
                                   "party_id": "u_rep", "due_date": SOON, "subtotal": 1}),
        ("POST", "/api/payments", {"invoice_id": "x", "amount": 1}),
        ("POST", "/api/expenses", {"category": "office", "amount": 1, "description": "x"}),
        ("POST", "/api/requisitions", {"items": []}),
        ("POST", "/api/quotations", {"customer_id": "u_rep", "items": []}),
        ("POST", "/api/agent-quotations", {"items": []}),
        ("POST", "/api/grn", {"po_id": "x", "warehouse_id": "wh_lagos", "items": []}),
        ("POST", "/api/three-way-match?po_id=a&grn_id=b&invoice_id=c", None),
        ("POST", "/api/delivery-notes", {"so_id": "x"}),
        ("POST", "/api/bom", {"finished_product_id": "p_paste", "components": []}),
        ("POST", "/api/warehouse-transfers", {"to_warehouse_id": "wh_abuja", "items": []}),
        ("POST", "/api/users/create", {"name": "X", "email": "x@mail.bizcore.ng",
                                       "phone": "1", "role": "viewer"}),
        ("POST", "/api/accounts", {"code": "1", "name": "X", "type": "asset"}),
        ("POST", "/api/inventory/adjust", {"product_id": "p_tin", "warehouse_id": "wh_lagos",
                                           "type": "adjustment", "quantity": 1}),
        ("POST", "/api/barcode/generate?product_id=p_tin", None),
        ("POST", "/api/sync/push", {"entity_type": "sales_orders", "local_changes": []}),
    ]
    for method, path, body in writes:
        r = c.request(method, path, headers=viewer,
                      **({"json": body} if body is not None else {}))
        assert r.status_code in (401, 403), \
            f"viewer {method} {path} -> {r.status_code}: {r.text[:200]}"


# ═══════════════════════════════════════════════════════════════════════════
# 18. REMAINING ROUTES — the soft-delete, reject and single-record endpoints
# ═══════════════════════════════════════════════════════════════════════════
def test_remaining_routes_soft_delete_and_reject(world, ids):
    c = world["c"]
    H = hdr(world, "sa")

    # --- suppliers: get, update, soft-delete ---
    body = ok(c.get("/api/suppliers/sup_farm", headers=H))
    assert body["name"] == "Farm Fresh Ltd"

    body = ok(c.put("/api/suppliers/sup_sun", headers=H, json={"rating": 4.9, "name": "Sunrise Ltd"}))
    assert body["rating"] == 4.9, body
    assert body["name"] == "Sunrise Ltd"

    ok(c.delete("/api/suppliers/sup_sun", headers=H))
    body = ok(c.get("/api/suppliers", headers=H))
    assert all(s["supplier_id"] != "sup_sun" for s in body), "a deleted supplier must be hidden"

    # --- purchase order: cancel a draft ---
    body = ok(c.post("/api/purchase-orders", headers=hdr(world, "pc"), json={
        "supplier_id": "sup_farm", "warehouse_id": "wh_lagos",
        "items": [{"product_id": "p_tomato", "quantity": 1, "unit_price": 100.0}]}))
    draft_po = body["po_id"]
    assert body["status"] == "draft", body
    body = ok(c.delete(f"/api/purchase-orders/{draft_po}", headers=hdr(world, "wm")))
    assert "cancel" in body["message"].lower(), body
    po = ok(c.get(f"/api/purchase-orders/{draft_po}", headers=hdr(world, "pc")))
    assert po["status"] == "cancelled", po

    # a PO that is no longer a draft cannot be cancelled
    r = c.delete(f"/api/purchase-orders/{ids['po']}", headers=hdr(world, "wm"))
    assert r.status_code == 400, r.text

    # --- sales order: update then cancel ---
    body = ok(c.post("/api/sales-orders", headers=hdr(world, "gm"), json={
        "sales_rep_id": "u_rep", "warehouse_id": "wh_lagos",
        "items": [{"product_id": "p_paste", "quantity": 2, "unit_price": 1400.0}]}))
    so_id = body["so_id"]
    assert body["status"] == "pending_approval", body
    body = ok(c.put(f"/api/sales-orders/{so_id}", headers=hdr(world, "gm"),
                    json={"status": "draft", "notes": "customer changed their mind"}))
    assert body["status"] == "draft", body
    body = ok(c.delete(f"/api/sales-orders/{so_id}", headers=hdr(world, "gm")))
    assert "cancel" in body["message"].lower(), body
    so = ok(c.get(f"/api/sales-orders/{so_id}", headers=hdr(world, "gm")))
    assert so["status"] == "cancelled", so

    # --- GRN by id ---
    body = ok(c.get(f"/api/grn/{ids['grn']}", headers=hdr(world, "pc")))
    assert body["grn_id"] == ids["grn"]
    assert body["po_id"] == ids["po"]

    # --- reject an agent quotation ---
    q = ok(c.post("/api/agent-quotations", headers=hdr(world, "rep"), json={
        "items": [{"product_id": "p_paste", "quantity": 1, "unit_price": 1500.0}]}))
    ok(c.put(f"/api/agent-quotations/{q['quotation_id']}/submit", headers=hdr(world, "rep")))
    body = ok(c.put(f"/api/agent-quotations/{q['quotation_id']}/reject", headers=hdr(world, "wm"),
                    json={"approval_remarks": "Price is above the approved rate"}))
    assert body["approval_remarks"] == "Price is above the approved rate", body
    listing = ok(c.get("/api/agent-quotations", headers=hdr(world, "wm")))
    rejected = next(x for x in listing if x["quotation_id"] == q["quotation_id"])
    assert rejected["status"] == "rejected", rejected

    # --- reject a requisition ---
    r = ok(c.post("/api/requisitions", headers=hdr(world, "pc"), json={
        "items": [{"product_id": "p_tin", "quantity": 5, "estimated_unit_price": 50.0}]}))
    ok(c.put(f"/api/requisitions/{r['requisition_id']}/submit", headers=hdr(world, "pc")))
    ok(c.put(f"/api/requisitions/{r['requisition_id']}/reject?reason=not+budgeted",
             headers=hdr(world, "wm")))
    req = ok(c.get(f"/api/requisitions/{r['requisition_id']}", headers=hdr(world, "wm")))
    assert req["status"] == "rejected", req
    assert req["rejection_reason"] == "not budgeted", req

    # --- mark a single notification read ---
    # Nothing in this scenario is low on stock, so raise a real notification
    # the way the app does: a stock transfer notifies the receiving branch.
    created = ok(c.post("/api/warehouse-transfers", headers=hdr(world, "acc"), json={
        "to_warehouse_id": "wh_abuja", "items": [{"product_id": "p_tin", "quantity": 2}]}))
    ok(c.put(f"/api/warehouse-transfers/{created['transfer_id']}/cancel", headers=hdr(world, "acc")))

    notifications = ok(c.get("/api/notifications", headers=hdr(world, "acc2")))
    assert notifications, "an incoming transfer must notify the receiving branch"
    nid = notifications[0]["notification_id"]
    ok(c.put(f"/api/notifications/{nid}/read", headers=hdr(world, "acc2")))
    after = ok(c.get("/api/notifications", headers=hdr(world, "acc2")))
    marked = next(n for n in after if n["notification_id"] == nid)
    assert marked["is_read"] is True, marked
    # ...and another user's notification must not have been touched
    other = ok(c.get("/api/notifications", headers=hdr(world, "wm")))
    if other:
        assert all(n["user_id"] != "u_acc2" for n in other), \
            "notifications must be scoped to their owner"


def test_health_endpoints_need_no_authentication(world):
    c = world["c"]
    body = ok(c.get("/api/health"))
    assert body["status"] == "healthy", body

    body = ok(c.get("/api/security/health"))
    assert body["rate_limiting_enabled"] is True, body
    assert body["cors_restricted"] is True, body
    assert body["host_header_restricted"] is True, body
    assert body["warehouse_scoping_enforced"] is True, body
    assert body["privilege_escalation_guard"] is True, body


# ═══════════════════════════════════════════════════════════════════════════
# 17. ROUTE COVERAGE — every route in the app must have been exercised
# ═══════════════════════════════════════════════════════════════════════════
def test_every_route_was_exercised(world):
    cov = world["cov"]
    missing = cov.missing()
    print("\n" + cov.report())
    assert not missing, (
        f"{len(missing)} route(s) were never exercised by the acceptance suite:\n"
        + "\n".join(f"  {m} {p}" for m, p in missing))
    # A sanity floor: the suite really did talk to the API a lot.
    assert sum(cov.counts.values()) > 300, sum(cov.counts.values())


def test_no_unmatched_urls(world):
    """Every request the suite made must have mapped onto a real route."""
    assert not world["cov"].unmatched, world["cov"].unmatched
