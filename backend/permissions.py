"""
BizCore Permission System
=========================
Dynamic, database-backed CRUD permission matrix.

Roles (unified — no legacy aliases):
  super_admin       – full access, cross-warehouse
  general_manager   – full access, cross-warehouse
  warehouse_manager – full access within assigned warehouse
  purchase_clerk    – procurement workflow
  sales_rep         – field agent; creates quotations, views own ledger
  sales_clerk       – internal; dispatches goods, processes orders
  accountant        – finance read + invoice/expense write
  viewer            – read-only everywhere (except users & agent_ledger)
"""

import time
from datetime import datetime, timezone
from typing import Dict, Optional
from pydantic import BaseModel, Field

# ── Module registry ────────────────────────────────────────────────────────────
MODULES = [
    "products",
    "inventory",
    "suppliers",
    "purchase_orders",
    "sales_orders",
    "invoices",
    "expenses",
    "requisitions",
    "quotations",
    "grn",
    "warehouses",
    "users",
    "reports",
    "delivery_notes",
    "bom",
    "warehouse_transfers",
    "three_way_match",
    "audit_logs",
    "agent_ledger",
]

MODULE_LABELS: Dict[str, str] = {
    "products":            "Products",
    "inventory":           "Inventory",
    "suppliers":           "Suppliers",
    "purchase_orders":     "Purchase Orders",
    "sales_orders":        "Sales Orders",
    "invoices":            "Invoices & Payments",
    "expenses":            "Expenses",
    "requisitions":        "Purchase Requisitions",
    "quotations":          "Quotations",
    "grn":                 "Goods Receipt (GRN)",
    "warehouses":          "Warehouses",
    "users":               "User Management",
    "reports":             "Reports",
    "delivery_notes":      "Delivery Notes",
    "bom":                 "Bill of Materials",
    "warehouse_transfers": "Warehouse Transfers",
    "three_way_match":     "3-Way Matching",
    "audit_logs":          "Audit Logs",
    "agent_ledger":        "Agent Ledger",
}

ALWAYS_FULL_ACCESS_ROLES = {"super_admin", "general_manager"}
ALWAYS_READ_ROLES = {"super_admin", "general_manager", "accountant"}

# ─────────────────────────────────────────────────────────────────────────────
# MANDATORY OPERATIONS
# ─────────────────────────────────────────────────────────────────────────────
# A handful of operations are part of the *core workflow* a role owns. If the
# stored matrix does not grant them, the workflow becomes impossible to
# complete — e.g. a purchase clerk raises a requisition but cannot submit it,
# or nobody can take a cash payment off an agent's ledger.
#
# These are enforced in `check_permission` so they also apply to databases
# that were seeded before the matrix was corrected (the stored document would
# otherwise win over the new defaults).
#
# role -> module -> operations that are always permitted
MANDATORY_OPERATIONS: Dict[str, Dict[str, set]] = {
    # A purchase clerk must be able to submit the requisition they raised.
    "purchase_clerk": {
        "requisitions": {"create", "read", "update"},
    },
    # A warehouse manager records agent collections in their own branch.
    "warehouse_manager": {
        "agent_ledger": {"read", "create"},
    },
    # The accountant is the finance owner: they bank agent collections and
    # move stock between branches.
    "accountant": {
        "agent_ledger": {"read", "create"},
        "warehouse_transfers": {"read", "create", "update", "delete"},
    },
}

# ── Pydantic models ────────────────────────────────────────────────────────────
class CRUDPermission(BaseModel):
    create: bool = False
    read:   bool = False
    update: bool = False
    delete: bool = False

class RolePermissionDoc(BaseModel):
    role:        str
    permissions: Dict[str, CRUDPermission] = Field(default_factory=dict)
    updated_at:  datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_by:  Optional[str] = None

class PermissionUpdateRequest(BaseModel):
    permissions: Dict[str, CRUDPermission]

# ── Shortcuts ──────────────────────────────────────────────────────────────────
_FULL = CRUDPermission(create=True,  read=True,  update=True,  delete=True)
_CRU  = CRUDPermission(create=True,  read=True,  update=True,  delete=False)
_CR   = CRUDPermission(create=True,  read=True,  update=False, delete=False)
_R    = CRUDPermission(create=False, read=True,  update=False, delete=False)
_RU   = CRUDPermission(create=False, read=True,  update=True,  delete=False)
_NONE = CRUDPermission(create=False, read=False, update=False, delete=False)

DEFAULT_PERMISSIONS: Dict[str, Dict[str, CRUDPermission]] = {

    # ── Cross-warehouse full access ───────────────────────────────────────────
    "super_admin":     {m: _FULL for m in MODULES},
    "general_manager": {m: _FULL for m in MODULES},

    # ── Warehouse Manager — full access within their warehouse ────────────────
    "warehouse_manager": {
        "products":            _FULL,
        "inventory":           _FULL,
        "suppliers":           _FULL,
        "purchase_orders":     _FULL,
        "sales_orders":        _FULL,
        "invoices":            _FULL,
        "expenses":            _FULL,
        "requisitions":        _RU,    # approve/reject
        "quotations":          _RU,    # approve/reject agent quotations
        "grn":                 _FULL,
        "warehouses":          _FULL,
        "users":               _CRU,
        "reports":             _R,
        "delivery_notes":      _FULL,
        "bom":                 _FULL,
        "warehouse_transfers": _FULL,
        "three_way_match":     _FULL,
        "audit_logs":          _NONE,  # SuperAdmin/GM only — system-wide, not warehouse-scopable
        "agent_ledger":        _CR,    # read + record collections in their own branch
    },

    # ── Accountant — top echelon for READ, finance-only for WRITE ──────────────
    # There is exactly one Accountant overseeing the entire business, so
    # they read everything cross-warehouse like SuperAdmin/GM (audit logs,
    # all warehouses' data, etc.) — but can only write in financially
    # non-critical spheres (invoices, expenses, payments). They cannot
    # approve quotations, adjust inventory, create/edit orders, manage
    # users, or write to any other operationally/admin-critical module.
    "accountant": {
        "products":            _R,
        "inventory":           _R,
        "suppliers":           _R,
        "purchase_orders":     _R,
        "sales_orders":        _R,     # view only — cannot approve/create/edit
        "invoices":            _FULL,  # financial record-keeping is their job
        "expenses":            _FULL,  # financial record-keeping is their job
        "requisitions":        _R,
        "quotations":          _R,     # view only — cannot approve (see QUOTATION_APPROVAL_ROLES)
        "grn":                 _R,
        "warehouses":          _R,
        "users":               _R,     # user management is admin-critical, not finance-critical
        "reports":             _R,
        "delivery_notes":      _R,
        "bom":                 _R,
        "warehouse_transfers": _CR,    # initiate + confirm: the accountant owns stock movement
        "three_way_match":     _R,
        "audit_logs":          _R,     # top echelon: read-only oversight of the whole system
        "agent_ledger":        _CR,    # read + record collections (see MANDATORY_OPERATIONS)
    },

    # ── Purchase Clerk — procurement / cost-of-doing-business side ─────────────
    # Buys raw materials, packaging, and finished goods before they're
    # stocked into inventory. Owns the PO → GRN → 3-way-match chain.
    # Has no business creating or managing sales-side records.
    "purchase_clerk": {
        "products":            _R,
        "inventory":           _RU,    # update used for stock-count corrections during receiving reconciliation; the manual /inventory/adjust ("stocking/restocking") endpoint is separately hard-locked to SuperAdmin/GM regardless of this flag — GRN receiving (their actual stock-in path) mutates stock directly and only needs grn:create
        "suppliers":           _FULL,
        "purchase_orders":     _CRU,   # manage own POs through their lifecycle
        "sales_orders":        _R,     # visibility only — not their workflow
        "invoices":            _CR,    # purchase invoices
        "expenses":            _R,
        "requisitions":        _CRU,   # raise + submit their own requisition
        "quotations":          _NONE,  # sales-side workflow, not procurement
        "grn":                 _FULL,
        "warehouses":          _R,
        "users":               _NONE,
        "reports":             _R,
        "delivery_notes":      _R,     # visibility only — not their workflow
        "bom":                 _R,
        "warehouse_transfers": _R,
        "three_way_match":     _FULL,
        "audit_logs":          _NONE,  # SuperAdmin/GM only — system-wide, not warehouse-scopable
        "agent_ledger":        _NONE,
    },

    # ── Sales Rep (field agent) ───────────────────────────────────────────────
    "sales_rep": {
        "products":            _R,
        "inventory":           _R,
        "suppliers":           _NONE,
        "purchase_orders":     _NONE,
        "sales_orders":        _R,     # read own SOs
        "invoices":            _NONE,
        "expenses":            _NONE,
        "requisitions":        _NONE,
        "quotations":          _CR,    # create + read own quotations
        "grn":                 _NONE,
        "warehouses":          _R,
        "users":               _NONE,
        "reports":             _NONE,
        "delivery_notes":      _R,
        "bom":                 _NONE,
        "warehouse_transfers": _NONE,
        "three_way_match":     _NONE,
        "audit_logs":          _NONE,
        "agent_ledger":        _R,     # read own ledger (accounts receivable dashboard)
    },

    # ── Sales Clerk — fulfilment / revenue side ─────────────────────────────────
    # Processes sales orders, releases goods to agents, and tracks delivery.
    # Generates the sales/profit value of the business. Has no business
    # creating or managing purchase-side procurement records.
    "sales_clerk": {
        "products":            _R,
        "inventory":           _R,     # stock visibility for fulfilment, not adjustment
        "suppliers":           _R,
        "purchase_orders":     _R,     # visibility only — not their workflow
        "sales_orders":        _CRU,   # process, release goods, confirm delivery
        "invoices":            _R,
        "expenses":            _R,
        "requisitions":        _NONE,  # procurement workflow, not fulfilment
        "quotations":          _R,     # visibility into what's coming for dispatch
        "grn":                 _NONE,  # procurement workflow, not fulfilment
        "warehouses":          _R,
        "users":               _NONE,
        "reports":             _R,
        "delivery_notes":      _CRU,   # owns delivery tracking
        "bom":                 _R,
        "warehouse_transfers": _R,
        "three_way_match":     _NONE,  # procurement workflow, not fulfilment
        "audit_logs":          _NONE,  # SuperAdmin/GM only — system-wide, not warehouse-scopable
        "agent_ledger":        _NONE,
    },

    # ── Viewer ────────────────────────────────────────────────────────────────
    "viewer": {m: _R for m in MODULES if m not in ("users", "agent_ledger", "audit_logs")},
}
DEFAULT_PERMISSIONS["viewer"]["users"]        = _NONE
DEFAULT_PERMISSIONS["viewer"]["agent_ledger"] = _NONE
DEFAULT_PERMISSIONS["viewer"]["audit_logs"]   = _NONE  # top-echelon only


# ── Runtime helpers ────────────────────────────────────────────────────────────
def _empty_module_map() -> Dict[str, CRUDPermission]:
    return {m: CRUDPermission() for m in MODULES}

def _merge_with_defaults(role: str, db_perms: Optional[Dict]) -> Dict[str, CRUDPermission]:
    base = DEFAULT_PERMISSIONS.get(role, _empty_module_map())
    if not db_perms:
        return base
    merged = dict(base)
    for module, crud in db_perms.items():
        if module in MODULES:
            if isinstance(crud, dict):
                merged[module] = CRUDPermission(**crud)
            elif isinstance(crud, CRUDPermission):
                merged[module] = crud
    return merged

_permission_cache: Dict[str, Dict[str, CRUDPermission]] = {}
_permission_cache_time: Dict[str, float] = {}

# The cache is per-process. When the app runs with more than one worker, a
# permission change written by one worker would not be seen by the others
# until their cache entry expired — so entries carry a short TTL.
PERMISSION_CACHE_TTL_SECONDS = 30

def invalidate_cache(role: Optional[str] = None):
    global _permission_cache
    if role:
        _permission_cache.pop(role, None)
        _permission_cache_time.pop(role, None)
    else:
        _permission_cache.clear()
        _permission_cache_time.clear()

async def get_role_permissions(db, role: str) -> Dict[str, CRUDPermission]:
    cached_at = _permission_cache_time.get(role)
    if role in _permission_cache and cached_at is not None:
        if (time.monotonic() - cached_at) < PERMISSION_CACHE_TTL_SECONDS:
            return _permission_cache[role]
        _permission_cache.pop(role, None)
        _permission_cache_time.pop(role, None)
    doc = await db.role_permissions.find_one({"role": role}, {"_id": 0})
    raw = doc.get("permissions", {}) if doc else {}
    perms = _merge_with_defaults(role, raw)
    _permission_cache[role] = perms
    _permission_cache_time[role] = time.monotonic()
    return perms

async def check_permission(db, role: str, module: str, operation: str) -> bool:
    if role in ALWAYS_FULL_ACCESS_ROLES:
        return True
    if operation == "read" and role in ALWAYS_READ_ROLES:
        return True
    # Core-workflow operations are always permitted for the owning role.
    if operation in MANDATORY_OPERATIONS.get(role, {}).get(module, set()):
        return True
    perms = await get_role_permissions(db, role)
    module_perm = perms.get(module)
    if not module_perm:
        return False
    return getattr(module_perm, operation, False)

async def assert_permission(db, role: str, module: str, operation: str):
    from fastapi import HTTPException
    allowed = await check_permission(db, role, module, operation)
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Your role does not have '{operation}' permission on '{MODULE_LABELS.get(module, module)}'."
        )

async def seed_default_permissions(db):
    for role, perms in DEFAULT_PERMISSIONS.items():
        existing = await db.role_permissions.find_one({"role": role})
        if not existing:
            await db.role_permissions.insert_one({
                "role": role,
                "permissions": {m: p.model_dump() for m, p in perms.items()},
                "updated_at": datetime.now(timezone.utc),
                "updated_by": "system",
            })
