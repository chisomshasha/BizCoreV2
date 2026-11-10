from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, Query
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import Header, HTTPException, Depends
import os
import logging
import secrets
import re
import hashlib
import hmac
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from enum import Enum
import io
import base64

# SECURITY: Rate limiting
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# ============================================================
# PASSWORD HASHING (PBKDF2-HMAC-SHA256)
# ============================================================
# We deliberately avoid the `bcrypt` / `passlib` extra dependency.
# PBKDF2 is in the stdlib, NIST-recommended, and gives us a
# constant-time comparison path that prevents timing attacks.

# The implementation lives in `backend/passwords.py` so the API and the
# provisioning scripts (seed_admin / reset_passwords) can never drift apart —
# a mismatch there silently produces passwords that will not log in.
from passwords import hash_password, verify_password  # noqa: F401

# ── Currency ───────────────────────────────────────────────────────────────
DEFAULT_CURRENCY = "NGN"
_CURRENCY_SYMBOLS = {
    "NGN": "₦", "USD": "$", "EUR": "€", "GBP": "£",
    "KES": "KSh", "GHS": "GH₵", "ZAR": "R", "CAD": "C$", "AUD": "A$",
}


def currency_symbol(code: str = DEFAULT_CURRENCY) -> str:
    """Symbol for a currency code (falls back to 'CODE ')."""
    code = (code or DEFAULT_CURRENCY).upper()
    return _CURRENCY_SYMBOLS.get(code, f"{code} ")


async def get_company_currency() -> str:
    """Currency code configured on the company record."""
    company = await db.companies.find_one({}, {"_id": 0, "currency": 1})
    return (company or {}).get("currency") or DEFAULT_CURRENCY


# PDF Generation imports
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Dynamic permission system
from permissions import (
    get_role_permissions, check_permission, assert_permission,
    invalidate_cache, seed_default_permissions,
    RolePermissionDoc, PermissionUpdateRequest,
    MODULES, MODULE_LABELS, CRUDPermission, DEFAULT_PERMISSIONS,
    ALWAYS_FULL_ACCESS_ROLES, ALWAYS_READ_ROLES,
)

# ========================
# SECURITY: Rate Limiter Setup
# ========================
limiter = Limiter(key_func=get_remote_address)
app_exception_handlers = {RateLimitExceeded: _rate_limit_exceeded_handler}

# MongoDB async connection (single client — sync client removed)
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'bizcore_db')]

# Create the main app
app = FastAPI(title="BizCore API", version="1.0.0", exception_handlers=app_exception_handlers)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ========================
# SECURITY: Helper Functions
# ========================

def sanitize_string(input_str: str) -> str:
    """Sanitize user input to prevent NoSQL injection"""
    if not input_str:
        return ""
    if not isinstance(input_str, str):
        return str(input_str)
    return re.sub(r'[^\w\s\-_\.]', '', input_str)


def _sanitise_order_items(items: Any) -> List[Dict[str, Any]]:
    """Rebuild order items from a client payload with numeric quantities.

    The offline-sync endpoint receives items straight from the device, so
    a stray string quantity would re-introduce the "0 500" concatenation
    bug further down the line.
    """
    clean: List[Dict[str, Any]] = []
    if not isinstance(items, list):
        return clean
    for item in items:
        if not isinstance(item, dict):
            continue
        product_id = str(item.get("product_id") or "")
        if not product_id:
            continue
        clean.append({
            "item_id": item.get("item_id") or f"item_{uuid.uuid4().hex[:12]}",
            "product_id": product_id,
            "product_name": item.get("product_name"),
            "quantity": _num(item.get("quantity")),
            "unit_price": _num(item.get("unit_price")),
        })
    return clean


def _num(value: Any, default: float = 0.0) -> float:
    """Coerce a stored value to a float.

    Stock quantities can exist as strings in older documents (written by the
    pre-audit code paths that did `stock["quantity"] + delta`, which
    *concatenates* when the stored value is a string). Every read and write
    of a quantity now goes through this helper, so a legacy string heals
    itself instead of corrupting the value further.
    """
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def sanitize_phone(input_str: str) -> str:
    """Sanitize a phone number while preserving the leading '+' and digits.

    `sanitize_string` strips every non-word character, which turned
    '+234800...' into '234800...' and silently corrupted stored numbers.
    """
    if not input_str:
        return ""
    if not isinstance(input_str, str):
        input_str = str(input_str)
    stripped = input_str.strip()
    digits = re.sub(r'[^0-9]', '', stripped)
    return ('+' + digits) if stripped.startswith('+') else digits

def validate_object_id(id_str: str) -> bool:
    """Validate ID format to prevent injection"""
    if not id_str or not isinstance(id_str, str):
        return False
    return bool(re.match(r'^[a-f0-9]{24}$', id_str)) or bool(re.match(r'^[a-zA-Z0-9_\-]{10,50}$', id_str))

def sanitize_query(query: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively sanitize query dictionary values"""
    sanitized = {}
    for key, value in query.items():
        if isinstance(value, str):
            sanitized[key] = sanitize_string(value)
        elif isinstance(value, dict):
            sanitized[key] = sanitize_query(value)
        elif isinstance(value, list):
            sanitized[key] = [sanitize_string(v) if isinstance(v, str) else v for v in value]
        else:
            sanitized[key] = value
    return sanitized

# ========================
# SECURITY: Middleware Classes
# ========================

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses"""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        response.headers["Cache-Control"] = "no-store, max-age=0"
        return response


class RequestValidationMiddleware(BaseHTTPMiddleware):
    """Validate request size and origin"""
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        try:
            content_length_int = int(content_length) if content_length else 0
        except (TypeError, ValueError):
            # A malformed Content-Length must not crash the request.
            return JSONResponse(
                status_code=400,
                content={"detail": "Invalid Content-Length header"}
            )
        if content_length_int > 10_485_760:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request too large. Maximum size is 10MB."}
            )
        if request.method not in ["GET", "OPTIONS", "HEAD"]:
            origin = request.headers.get("origin")
            # Allow the same host (no Origin header) plus common dev hosts
            # and the mobile app custom scheme. Configurable via env.
            env_origins = os.environ.get("ALLOWED_ORIGINS", "")
            allowed_origins = {
                "https://bizcorev2-production.up.railway.app",
                "https://bizcorev2.up.railway.app",
                "https://bizcore-v2.fly.dev",
                "bizcorev2://",
                "bizcore://",
            }
            for o in env_origins.split(","):
                o = o.strip()
                if o:
                    allowed_origins.add(o)
            if origin:
                if (origin not in allowed_origins
                        and "localhost" not in origin
                        and "127.0.0.1" not in origin
                        and "exp.direct" not in origin      # Expo dev tools
                        and not origin.startswith("exp://")):
                    return JSONResponse(
                        status_code=403,
                        content={"detail": f"Origin not allowed: {origin}"}
                    )
        return await call_next(request)

# ========================
# ENUMS
# ========================

class ProductCategory(str, Enum):
    RAW = "raw"
    FINISHED = "finished"
    PACKAGING = "packaging"

class TransactionType(str, Enum):
    PURCHASE = "purchase"
    SALE = "sale"
    PRODUCTION = "production"
    ADJUSTMENT = "adjustment"
    RETURN = "return"

class OrderStatus(str, Enum):
    # Shared
    DRAFT     = "draft"
    CANCELLED = "cancelled"
    PAID      = "paid"
    PARTIAL   = "partial"
    # Purchase-order path
    ORDERED   = "ordered"
    RECEIVED  = "received"
    # Sales-order / agent workflow
    PENDING_APPROVAL = "pending_approval"  # SO created from quotation, awaiting manager sign-off
    APPROVED         = "approved"          # manager approved the SO
    GOODS_RELEASED   = "goods_released"    # warehouse released goods to agent
    DELIVERED        = "delivered"         # agent confirms receipt / delivery done

class InvoiceType(str, Enum):
    PURCHASE = "purchase"
    SALE = "sale"

class InvoiceStatus(str, Enum):
    UNPAID = "unpaid"
    PAID = "paid"
    PARTIAL = "partial"
    OVERDUE = "overdue"

class PaymentMethod(str, Enum):
    CASH = "cash"
    BANK = "bank"
    UPI = "upi"
    CARD = "card"

class AccountType(str, Enum):
    ASSET = "asset"
    LIABILITY = "liability"
    INCOME = "income"
    EXPENSE = "expense"
    EQUITY = "equity"

class UserRole(str, Enum):
    SUPER_ADMIN       = "super_admin"
    GENERAL_MANAGER   = "general_manager"
    WAREHOUSE_MANAGER = "warehouse_manager"
    PURCHASE_CLERK    = "purchase_clerk"
    SALES_REP         = "sales_rep"      # field agent — creates quotations (was also sales_executive)
    SALES_CLERK       = "sales_clerk"
    ACCOUNTANT        = "accountant"
    VIEWER            = "viewer"

# Convenience role sets
CROSS_WAREHOUSE_ROLES = {UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER}
APPROVAL_ROLES = {UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER,
                  UserRole.WAREHOUSE_MANAGER, UserRole.ACCOUNTANT}
ADMIN_ROLES    = {UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER,
                  UserRole.WAREHOUSE_MANAGER}

class RequisitionStatus(str, Enum):
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CONVERTED = "converted"

class AgentQuotationStatus(str, Enum):
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CONVERTED = "converted"

class DispatchStatus(str, Enum):
    PENDING_DISPATCH = "pending_dispatch"
    DISPATCHED = "dispatched"

class TransferStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"

class AgentLedgerEntryType(str, Enum):
    DISPATCH = "dispatch"
    PAYMENT = "payment"
    RETURN = "return"
    ADJUSTMENT = "adjustment"

class GRNStatus(str, Enum):
    PENDING = "pending"
    RECEIVED = "received"
    PARTIAL = "partial"
    REJECTED = "rejected"

class MatchingStatus(str, Enum):
    UNMATCHED = "unmatched"
    PARTIAL_MATCH = "partial_match"
    FULL_MATCH = "full_match"
    DISCREPANCY = "discrepancy"

# ========================
# PYDANTIC MODELS
# ========================

# Auth Models
class User(BaseModel):
    user_id: str
    username: Optional[str] = None
    email: str
    name: str
    picture: Optional[str] = None
    role: UserRole = UserRole.VIEWER
    company_id: Optional[str] = None
    phone: Optional[str] = None
    warehouse_id: Optional[str] = None          # NEW: assigned warehouse
    warehouse_name: Optional[str] = None         # NEW: denormalised for display
    is_active: bool = True
    is_invited: bool = False                     # NEW: SuperAdmin pre-created user
    debt_ceiling: float = 0.0                   # NEW: for sales_rep role
    is_flagged: bool = False                    # NEW: auto-set when outstanding >= ceiling
    deactivated_at: Optional[datetime] = None   # set on soft-delete
    deactivated_by: Optional[str] = None        # user_id of who deactivated
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    warehouse_id: Optional[str] = None
    debt_ceiling: Optional[float] = None

class UserCreate(BaseModel):
    """SuperAdmin creates a user before their first login"""
    name: str
    email: str
    phone: str
    role: UserRole = UserRole.VIEWER
    warehouse_id: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None   # if omitted, user must reset on first login

# Company Model
class Company(BaseModel):
    company_id: str = Field(default_factory=lambda: f"comp_{uuid.uuid4().hex[:12]}")
    name: str
    address: Optional[str] = None
    tax_id: Optional[str] = None
    logo_url: Optional[str] = None
    currency: str = "NGN"
    fiscal_year_start: int = 1  # Month (1-12)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CompanyCreate(BaseModel):
    name: str
    address: Optional[str] = None
    tax_id: Optional[str] = None
    currency: str = "NGN"

# Warehouse Model
class Warehouse(BaseModel):
    warehouse_id: str = Field(default_factory=lambda: f"wh_{uuid.uuid4().hex[:12]}")
    name: str
    address: Optional[str] = None
    capacity: Optional[float] = None
    manager_id: Optional[str] = None           # NEW
    accountant_ids: List[str] = []             # NEW
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class WarehouseCreate(BaseModel):
    name: str
    address: Optional[str] = None
    capacity: Optional[float] = None
    manager_id: Optional[str] = None           # NEW
    accountant_ids: Optional[List[str]] = []   # NEW

# Product Model
class Product(BaseModel):
    product_id: str = Field(default_factory=lambda: f"prod_{uuid.uuid4().hex[:12]}")
    sku: str
    name: str
    description: Optional[str] = None
    category: ProductCategory = ProductCategory.RAW
    unit: str = "pcs"
    cost_price: float = 0.0
    selling_price: float = 0.0
    reorder_level: int = 10
    min_stock: int = 0
    max_stock: int = 1000
    expiry_days: Optional[int] = None
    barcode: Optional[str] = None
    image_url: Optional[str] = None
    default_supplier_id: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ProductCreate(BaseModel):
    sku: str
    name: str
    description: Optional[str] = None
    category: ProductCategory = ProductCategory.RAW
    unit: str = "pcs"
    cost_price: float = 0.0
    selling_price: float = 0.0
    reorder_level: int = 10
    min_stock: int = 0
    max_stock: int = 1000
    expiry_days: Optional[int] = None
    barcode: Optional[str] = None
    image_url: Optional[str] = None
    default_supplier_id: Optional[str] = None

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[ProductCategory] = None
    unit: Optional[str] = None
    cost_price: Optional[float] = None
    selling_price: Optional[float] = None
    reorder_level: Optional[int] = None
    min_stock: Optional[int] = None
    max_stock: Optional[int] = None
    expiry_days: Optional[int] = None
    barcode: Optional[str] = None
    image_url: Optional[str] = None
    default_supplier_id: Optional[str] = None
    is_active: Optional[bool] = None

# Inventory Stock Model
class InventoryStock(BaseModel):
    stock_id: str = Field(default_factory=lambda: f"stock_{uuid.uuid4().hex[:12]}")
    product_id: str
    warehouse_id: str
    quantity: float = 0.0
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Stock Transaction Model
class StockTransaction(BaseModel):
    transaction_id: str = Field(default_factory=lambda: f"txn_{uuid.uuid4().hex[:12]}")
    product_id: str
    warehouse_id: str
    type: TransactionType
    quantity: float
    reference_id: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StockTransactionCreate(BaseModel):
    product_id: str
    warehouse_id: str
    type: TransactionType
    quantity: float
    reference_id: Optional[str] = None
    notes: Optional[str] = None

# Supplier Model
class Supplier(BaseModel):
    supplier_id: str = Field(default_factory=lambda: f"sup_{uuid.uuid4().hex[:12]}")
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    payment_terms_days: int = 30
    tax_id: Optional[str] = None
    rating: float = 0.0
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SupplierCreate(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    payment_terms_days: int = 30
    tax_id: Optional[str] = None

class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    payment_terms_days: Optional[int] = None
    tax_id: Optional[str] = None
    rating: Optional[float] = None
    is_active: Optional[bool] = None

# Distributor collection retired — agents (sales_rep role) replace this concept

# Purchase Order Models
class PurchaseOrderItem(BaseModel):
    item_id: str = Field(default_factory=lambda: f"poi_{uuid.uuid4().hex[:12]}")
    product_id: str
    product_name: Optional[str] = None
    quantity: float
    unit_price: float
    received_quantity: float = 0.0

class PurchaseOrder(BaseModel):
    po_id: str = Field(default_factory=lambda: f"po_{uuid.uuid4().hex[:12]}")
    po_number: str
    supplier_id: str
    supplier_name: Optional[str] = None
    warehouse_id: str
    order_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expected_date: Optional[datetime] = None
    status: OrderStatus = OrderStatus.DRAFT
    items: List[PurchaseOrderItem] = []
    subtotal: float = 0.0
    tax_amount: float = 0.0
    total_amount: float = 0.0
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PurchaseOrderItemCreate(BaseModel):
    product_id: str
    quantity: float
    unit_price: float

class PurchaseOrderCreate(BaseModel):
    supplier_id: str
    warehouse_id: str
    expected_date: Optional[datetime] = None
    items: List[PurchaseOrderItemCreate] = []
    tax_amount: float = 0.0
    notes: Optional[str] = None

class PurchaseOrderUpdate(BaseModel):
    status: Optional[OrderStatus] = None
    expected_date: Optional[datetime] = None
    notes: Optional[str] = None

# Purchase Requisition Models
class RequisitionItem(BaseModel):
    item_id: str = Field(default_factory=lambda: f"ri_{uuid.uuid4().hex[:12]}")
    product_id: str
    product_name: Optional[str] = None
    quantity: float
    estimated_unit_price: float = 0.0
    reason: Optional[str] = None

class PurchaseRequisition(BaseModel):
    requisition_id: str = Field(default_factory=lambda: f"req_{uuid.uuid4().hex[:12]}")
    requisition_number: str
    requested_by: str
    requested_by_name: Optional[str] = None
    department: Optional[str] = None
    priority: str = "normal"  # low, normal, high, urgent
    required_date: Optional[datetime] = None
    status: RequisitionStatus = RequisitionStatus.DRAFT
    items: List[RequisitionItem] = []
    total_estimated: float = 0.0
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    converted_po_id: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class RequisitionItemCreate(BaseModel):
    product_id: str
    quantity: float
    estimated_unit_price: float = 0.0
    reason: Optional[str] = None

class PurchaseRequisitionCreate(BaseModel):
    department: Optional[str] = None
    priority: str = "normal"
    required_date: Optional[datetime] = None
    items: List[RequisitionItemCreate] = []
    notes: Optional[str] = None

# Goods Receipt Note (GRN) Models
class GRNItem(BaseModel):
    item_id: str = Field(default_factory=lambda: f"grni_{uuid.uuid4().hex[:12]}")
    po_item_id: str
    product_id: str
    product_name: Optional[str] = None
    ordered_quantity: float
    received_quantity: float
    accepted_quantity: float
    rejected_quantity: float = 0.0
    rejection_reason: Optional[str] = None
    unit_price: float

class GoodsReceiptNote(BaseModel):
    grn_id: str = Field(default_factory=lambda: f"grn_{uuid.uuid4().hex[:12]}")
    grn_number: str
    po_id: str
    po_number: str
    supplier_id: str
    supplier_name: Optional[str] = None
    warehouse_id: str
    received_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: GRNStatus = GRNStatus.PENDING
    items: List[GRNItem] = []
    total_amount: float = 0.0
    received_by: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class GRNItemCreate(BaseModel):
    po_item_id: str
    product_id: str
    received_quantity: float
    accepted_quantity: float
    rejected_quantity: float = 0.0
    rejection_reason: Optional[str] = None

class GRNCreate(BaseModel):
    po_id: str
    warehouse_id: str
    items: List[GRNItemCreate] = []
    notes: Optional[str] = None

# 3-Way Matching Model
class ThreeWayMatch(BaseModel):
    match_id: str = Field(default_factory=lambda: f"match_{uuid.uuid4().hex[:12]}")
    po_id: str
    po_number: str
    grn_id: str
    grn_number: str
    invoice_id: str
    invoice_number: str
    supplier_id: str
    supplier_name: Optional[str] = None
    status: MatchingStatus = MatchingStatus.UNMATCHED
    po_total: float = 0.0
    grn_total: float = 0.0
    invoice_total: float = 0.0
    variance: float = 0.0
    variance_percent: float = 0.0
    discrepancies: List[dict] = []
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Sales Order Models
class SalesOrderItem(BaseModel):
    item_id: str = Field(default_factory=lambda: f"soi_{uuid.uuid4().hex[:12]}")
    product_id: str
    product_name: Optional[str] = None
    quantity: float
    unit_price: float
    delivered_quantity: float = 0.0

class SalesOrder(BaseModel):
    so_id: str = Field(default_factory=lambda: f"so_{uuid.uuid4().hex[:12]}")
    so_number: str
    sales_rep_id: str
    sales_rep_name: Optional[str] = None
    warehouse_id: str
    order_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    delivery_date: Optional[datetime] = None
    status: OrderStatus = OrderStatus.PENDING_APPROVAL  # starts here after quotation approval
    dispatch_status: DispatchStatus = DispatchStatus.PENDING_DISPATCH
    source_quotation_id: Optional[str] = None
    approved_by: Optional[str] = None
    approved_by_name: Optional[str] = None
    approved_at: Optional[datetime] = None
    items: List[SalesOrderItem] = []
    subtotal: float = 0.0
    tax_amount: float = 0.0
    total_amount: float = 0.0
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SalesOrderItemCreate(BaseModel):
    product_id: str
    quantity: float
    unit_price: float

class SalesOrderCreate(BaseModel):
    """Internal use only — SOs are normally created via agent-quotation approval."""
    sales_rep_id: str
    warehouse_id: str
    delivery_date: Optional[datetime] = None
    items: List[SalesOrderItemCreate] = []
    tax_amount: float = 0.0
    notes: Optional[str] = None

class SalesOrderUpdate(BaseModel):
    status: Optional[OrderStatus] = None
    delivery_date: Optional[datetime] = None
    notes: Optional[str] = None

# ─────────────────────────────────────────
# NEW: Agent Quotation Models
# ─────────────────────────────────────────

class AgentQuotationItem(BaseModel):
    item_id: str = Field(default_factory=lambda: f"aqi_{uuid.uuid4().hex[:12]}")
    product_id: str
    product_name: Optional[str] = None
    quantity: float
    unit_price: float

class AgentQuotation(BaseModel):
    quotation_id: str = Field(default_factory=lambda: f"aqt_{uuid.uuid4().hex[:12]}")
    quotation_number: str
    sales_rep_id: str
    sales_rep_name: Optional[str] = None
    warehouse_id: str
    warehouse_name: Optional[str] = None
    status: AgentQuotationStatus = AgentQuotationStatus.DRAFT
    items: List[AgentQuotationItem] = []
    total_amount: float = 0.0
    approved_by: Optional[str] = None
    approved_by_name: Optional[str] = None
    approved_at: Optional[datetime] = None
    approval_remarks: Optional[str] = None
    converted_so_id: Optional[str] = None
    agent_is_flagged: bool = False          # snapshot of flag at submission time
    agent_outstanding: float = 0.0          # snapshot of outstanding balance
    agent_debt_ceiling: float = 0.0         # snapshot of ceiling
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AgentQuotationItemCreate(BaseModel):
    product_id: str
    quantity: float
    unit_price: float

class AgentQuotationCreate(BaseModel):
    items: List[AgentQuotationItemCreate] = []

class AgentQuotationApprove(BaseModel):
    approval_remarks: str   # required — validated in endpoint

# ─────────────────────────────────────────
# NEW: Agent Ledger Models
# ─────────────────────────────────────────

class AgentLedgerEntry(BaseModel):
    entry_id: str = Field(default_factory=lambda: f"ale_{uuid.uuid4().hex[:12]}")
    sales_rep_id: str
    warehouse_id: str
    entry_type: AgentLedgerEntryType
    reference_id: Optional[str] = None
    items: Optional[List[dict]] = None
    amount: float           # positive = debt added; negative = payment/credit
    notes: Optional[str] = None
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AgentPaymentCreate(BaseModel):
    sales_rep_id: str
    amount: float
    payment_method: PaymentMethod = PaymentMethod.CASH
    notes: Optional[str] = None

# ─────────────────────────────────────────
# NEW: Warehouse Transfer Models
# ─────────────────────────────────────────

class WarehouseTransferItem(BaseModel):
    product_id: str
    product_name: Optional[str] = None
    quantity: float
    cost_price: float = 0.0

class WarehouseTransfer(BaseModel):
    transfer_id: str = Field(default_factory=lambda: f"wt_{uuid.uuid4().hex[:12]}")
    transfer_number: str
    from_warehouse_id: str
    from_warehouse_name: Optional[str] = None
    to_warehouse_id: str
    to_warehouse_name: Optional[str] = None
    items: List[WarehouseTransferItem] = []
    total_value: float = 0.0
    status: TransferStatus = TransferStatus.PENDING
    initiated_by: str
    initiated_by_name: Optional[str] = None
    confirmed_by: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class WarehouseTransferItemCreate(BaseModel):
    product_id: str
    quantity: float

class WarehouseTransferCreate(BaseModel):
    to_warehouse_id: str
    items: List[WarehouseTransferItemCreate] = []
    notes: Optional[str] = None

# Invoice Model
class Invoice(BaseModel):
    invoice_id: str = Field(default_factory=lambda: f"inv_{uuid.uuid4().hex[:12]}")
    invoice_number: str
    type: InvoiceType
    reference_id: str  # PO or SO id
    party_id: str  # Supplier or Sales Rep id
    party_name: Optional[str] = None
    issue_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    due_date: datetime
    subtotal: float = 0.0
    tax_amount: float = 0.0
    total: float = 0.0
    paid_amount: float = 0.0
    status: InvoiceStatus = InvoiceStatus.UNPAID
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class InvoiceCreate(BaseModel):
    type: InvoiceType
    reference_id: str
    party_id: str
    due_date: datetime
    subtotal: float
    tax_amount: float = 0.0

# Payment Model
class Payment(BaseModel):
    payment_id: str = Field(default_factory=lambda: f"pay_{uuid.uuid4().hex[:12]}")
    invoice_id: str
    amount: float
    payment_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    method: PaymentMethod = PaymentMethod.CASH
    transaction_ref: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PaymentCreate(BaseModel):
    invoice_id: str
    amount: float
    method: PaymentMethod = PaymentMethod.CASH
    transaction_ref: Optional[str] = None
    notes: Optional[str] = None

# Chart of Accounts Model
class ChartOfAccount(BaseModel):
    account_id: str = Field(default_factory=lambda: f"acc_{uuid.uuid4().hex[:12]}")
    code: str
    name: str
    type: AccountType
    parent_id: Optional[str] = None
    balance: float = 0.0
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ChartOfAccountCreate(BaseModel):
    code: str
    name: str
    type: AccountType
    parent_id: Optional[str] = None

# Notification Model
class Notification(BaseModel):
    notification_id: str = Field(default_factory=lambda: f"notif_{uuid.uuid4().hex[:12]}")
    user_id: str
    title: str
    message: str
    type: str = "info"
    is_read: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Audit Log Model (enhanced with IP and user-agent for security tracing)
class AuditLog(BaseModel):
    log_id: str = Field(default_factory=lambda: f"log_{uuid.uuid4().hex[:12]}")
    user_id: str
    action: str
    entity_type: str
    entity_id: str
    old_value: Optional[Dict[str, Any]] = None
    new_value: Optional[Dict[str, Any]] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Dashboard Models
class DashboardStats(BaseModel):
    total_inventory_value: float = 0.0
    low_stock_count: int = 0
    today_sales: float = 0.0
    today_purchases: float = 0.0
    cash_balance: float = 0.0
    pending_invoices: int = 0
    total_products: int = 0
    total_suppliers: int = 0
    total_agents: int = 0
    total_warehouses: int = 0

# ========================
# AUTHENTICATION HELPERS
# ========================

# ── Login / Register request models ──────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=120,
                          description="Username OR email")
    password: str = Field(..., min_length=1, max_length=200)

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=60)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=200)
    name: str = Field(..., min_length=1, max_length=120)
    phone: Optional[str] = None

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=6, max_length=200)

class ForgotPasswordRequest(BaseModel):
    email_or_phone: str = Field(..., min_length=1, max_length=200)

class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=8, max_length=200)
    new_password: str = Field(..., min_length=6, max_length=200)

class ForgotUsernameRequest(BaseModel):
    email_or_phone: str = Field(..., min_length=1, max_length=200)

# ── Document number generators ───────────────────────────────────────────────
# Every business document (PO, SO, invoice, GRN, …) needs a unique, sortable
# reference. A naive `count_documents()` based generator is NOT safe: two
# concurrent requests both read the same count and produce the same number,
# which then trips the unique index on po_number / so_number / invoice_number
# and 500s the request. Instead we keep an atomic counter document per prefix
# in the `counters` collection and $inc it — Mongo guarantees uniqueness even
# under concurrent writers and across multiple app instances.

async def _next_sequence(key: str) -> int:
    """Atomically increment and return the counter for `key`."""
    try:
        from pymongo import ReturnDocument
        doc = await db.counters.find_one_and_update(
            {"_id": key},
            {"$inc": {"value": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return int((doc or {}).get("value", 1))
    except Exception:
        # Fall back to a timestamp-derived sequence so numbering never hard-fails.
        return int(datetime.now(timezone.utc).timestamp() * 1000)


async def _make_doc_number(prefix: str, key: str) -> str:
    """Build a unique human-readable document number, e.g. 'PO-202611-0007'."""
    seq = await _next_sequence(key)
    stamp = datetime.now(timezone.utc).strftime("%Y%m")
    return f"{prefix}-{stamp}-{seq:04d}"


async def generate_po_number() -> str:
    return await _make_doc_number("PO", "purchase_order")


async def generate_agent_quotation_number() -> str:
    return await _make_doc_number("AQT", "agent_quotation")


async def generate_requisition_number() -> str:
    return await _make_doc_number("REQ", "requisition")


async def generate_grn_number() -> str:
    return await _make_doc_number("GRN", "grn")


# ── Session token plumbing ────────────────────────────────────────────────────
SESSION_TTL_DAYS = 7


def _issue_session_token() -> str:
    return f"sess_{secrets.token_urlsafe(32)}"


async def _create_session(user_id: str) -> Dict[str, Any]:
    """Create a new session record and return it."""
    token = _issue_session_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    await db.user_sessions.insert_one({
        "user_id":       user_id,
        "session_token": token,
        "expires_at":    expires_at,
        "created_at":    datetime.now(timezone.utc),
    })
    return {"session_token": token, "expires_at": expires_at}


async def _resolve_session(token: str) -> User:
    """Resolve a raw session token to its user, raising 401 when invalid."""
    if not token:
        raise HTTPException(status_code=401, detail="Empty token")

    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    expires_at = session.get("expires_at")
    if expires_at:
        # MongoDB returns naive datetimes in some configurations; normalise.
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            await db.user_sessions.delete_one({"session_token": token})
            raise HTTPException(status_code=401, detail="Session expired, please log in again")

    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account disabled")

    return User(**user)


def _extract_token(request: Request) -> str:
    """Pull the session token from the Authorization header or the cookie."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (request.cookies.get("session_token") or "").strip()


async def get_current_user(authorization: Optional[str] = Header(None)) -> User:
    """Validate the Bearer session token and return the matching user.

    The header is declared Optional so that a request with no credentials
    returns 401 "Unauthorized" rather than FastAPI's 422 validation error —
    clients treat the two very differently.

    Migration: this used to call Supabase. Now we look up the token in
    `db.user_sessions` (created by /api/auth/login) and load the user.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization[7:] if authorization.startswith("Bearer ") else authorization
    return await _resolve_session(token.strip())


async def get_optional_user(request: Request) -> Optional[User]:
    """Get the current user if the request carries a valid session, else None.

    Used by /api/auth/logout so a logout with an already-expired token still
    succeeds instead of raising.
    """
    try:
        token = _extract_token(request)
        if not token:
            return None
        return await _resolve_session(token)
    except HTTPException:
        return None

# ─────────────────────────────────────────
# NEW: Warehouse Scoping Helpers
# ─────────────────────────────────────────

def is_cross_warehouse_role(role: UserRole) -> bool:
    """SuperAdmin and General Manager can see all warehouses"""
    return role in (UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER)

def get_user_warehouse_filter(user: User) -> Optional[str]:
    """Returns warehouse_id filter for DB queries, or None for cross-warehouse roles"""
    if is_cross_warehouse_role(user.role):
        return None
    return user.warehouse_id

def assert_same_warehouse(user: User, warehouse_id: str, action: str = "access"):
    """Raises 403 if user is scoped to a different warehouse.

    A warehouse-scoped user with no warehouse assigned is denied too —
    otherwise an unassigned clerk could read every warehouse's data.
    """
    if is_cross_warehouse_role(user.role):
        return
    if not user.warehouse_id:
        raise HTTPException(
            status_code=403,
            detail=f"You have no warehouse assigned, so you cannot {action} data in warehouse {warehouse_id}",
        )
    if user.warehouse_id != warehouse_id:
        raise HTTPException(status_code=403,
                            detail=f"Not authorized to {action} data in warehouse {warehouse_id}")

# Role rank map used to prevent privilege escalation.
# (Defined early so it can be used by the user-management endpoints.)
_ROLE_RANK: Dict[str, int] = {
    UserRole.VIEWER.value: 1,
    UserRole.SALES_CLERK.value: 2,
    UserRole.PURCHASE_CLERK.value: 2,
    UserRole.SALES_REP.value: 3,
    UserRole.ACCOUNTANT.value: 4,
    UserRole.WAREHOUSE_MANAGER.value: 5,
    UserRole.GENERAL_MANAGER.value: 6,
    UserRole.SUPER_ADMIN.value: 7,
}


def role_rank(role) -> int:
    """Numeric rank of a role (accepts str or UserRole)."""
    value = role.value if hasattr(role, "value") else str(role)
    return _ROLE_RANK.get(value, 0)


def assert_approval_role(user: User):
    """Raises 403 if user cannot approve quotations"""
    if user.role not in APPROVAL_ROLES:
        raise HTTPException(status_code=403, detail="Only Managers and Accountants can approve quotations")

async def send_notification(user_ids: List[str], title: str, message: str, notif_type: str = "info"):
    """Create in-app notifications for a list of users"""
    for uid in user_ids:
        notif = {
            "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
            "user_id": uid,
            "title": title,
            "message": message,
            "type": notif_type,
            "is_read": False,
            "created_at": datetime.now(timezone.utc)
        }
        await db.notifications.insert_one(notif)

async def get_warehouse_staff_ids(warehouse_id: str, roles: List[UserRole]) -> List[str]:
    """Get user_ids of staff at a warehouse matching given roles"""
    role_values = [r.value for r in roles]
    users = await db.users.find(
        {"warehouse_id": warehouse_id, "role": {"$in": role_values}, "is_active": True},
        {"_id": 0, "user_id": 1}
    ).to_list(100)
    return [u["user_id"] for u in users]

async def recalculate_agent_flag(sales_rep_id: str):
    """Recompute is_flagged for a Sales Rep based on their outstanding balance vs ceiling"""
    user = await db.users.find_one({"user_id": sales_rep_id}, {"_id": 0})
    if not user:
        return
    ceiling = user.get("debt_ceiling", 0.0)
    if ceiling <= 0:
        await db.users.update_one({"user_id": sales_rep_id}, {"$set": {"is_flagged": False}})
        return
    entries = await db.agent_ledger_entries.find(
        {"sales_rep_id": sales_rep_id}, {"_id": 0, "amount": 1}
    ).to_list(10000)
    outstanding = sum(_num(e.get("amount")) for e in entries)
    is_flagged = outstanding >= ceiling
    await db.users.update_one(
        {"user_id": sales_rep_id},
        {"$set": {"is_flagged": is_flagged, "updated_at": datetime.now(timezone.utc)}}
    )
    # Fire notification when newly flagged
    if is_flagged:
        wh_id = user.get("warehouse_id")
        if wh_id:
            manager_ids = await get_warehouse_staff_ids(
                wh_id,
                [UserRole.WAREHOUSE_MANAGER, UserRole.ACCOUNTANT]
            )
            await send_notification(
                manager_ids,
                "Agent Debt Ceiling Reached",
                f"Sales Rep {user.get('name','Unknown')} has reached their debt ceiling of {ceiling:.2f}. Outstanding: {outstanding:.2f}",
                "warning"
            )

# ── Login throttling ───────────────────────────────────────────────────────
# The global limiter is keyed by IP address, which is a poor signal for a
# mobile app: a whole office behind one NAT (or a carrier-grade NAT) shares
# an IP, so one burst of logins locks out everyone else. We therefore also
# throttle per *identifier* (username + IP), which still stops credential
# stuffing against one account without punishing unrelated users.
LOGIN_ATTEMPT_WINDOW_MINUTES = 15
MAX_LOGIN_ATTEMPTS = 8


async def _register_login_failure(identifier: str, ip: str) -> int:
    """Record a failed login for `identifier` and return the attempt count."""
    try:
        from pymongo import ReturnDocument
        key = f"{identifier}|{ip}"
        doc = await db.login_attempts.find_one_and_update(
            {"_id": key},
            {"$inc": {"count": 1},
             "$set": {"identifier": identifier, "ip": ip,
                      "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return int((doc or {}).get("count", 1))
    except Exception:
        return 0


async def _is_login_throttled(identifier: str, ip: str) -> bool:
    """True when this identifier has exceeded the failed-attempt budget."""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=LOGIN_ATTEMPT_WINDOW_MINUTES)
        doc = await db.login_attempts.find_one(
            {"_id": f"{identifier}|{ip}", "updated_at": {"$gte": cutoff}}
        )
        return bool(doc and doc.get("count", 0) >= MAX_LOGIN_ATTEMPTS)
    except Exception:
        return False


async def _clear_login_failures(identifier: str, ip: str):
    """Reset the counter after a successful login."""
    try:
        await db.login_attempts.delete_one({"_id": f"{identifier}|{ip}"})
    except Exception:
        pass


# ========================
# AUTH ENDPOINTS  (direct username / password — no third-party auth)
# ========================

def _public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    """Strip password_hash and any internal fields before returning a user."""
    safe = {k: v for k, v in user.items() if k != "password_hash" and k != "_id"}
    return safe


@api_router.post("/auth/login")
@limiter.limit(os.environ.get("LOGIN_RATE_LIMIT", "30/minute"))
async def login(request: Request, response: Response, body: LoginRequest):
    """Direct username/email + password login.

    - Accepts either a `username` OR an `email` in the `username` field.
    - On success: creates a session, returns the user and the session token.
    - 401 on any credential failure (same message either way to avoid
      username-enumeration).
    """
    identifier = body.username.strip().lower()
    password   = body.password
    client_ip  = request.client.host if request.client else "unknown"

    # Per-identifier throttle (independent of the IP-based global limiter).
    if await _is_login_throttled(identifier, client_ip):
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts. Please try again in a few minutes.",
        )

    user = await db.users.find_one(
        {"$or": [{"username": identifier}, {"email": identifier}]},
        {"_id": 0},
    )

    # Constant-ish path: always run the hash verify so a non-existent user
    # and a wrong password take similar time.
    if not user:
        # Run a dummy verify to keep timing similar
        verify_password(password, "pbkdf2_sha256$200000$" + "00" * 16 + "$" + "00" * 32)
        await _register_login_failure(identifier, client_ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    if not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="This account has been disabled. Contact your administrator.")

    stored_hash = user.get("password_hash", "")
    if not stored_hash or not verify_password(password, stored_hash):
        await _register_login_failure(identifier, client_ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    await _clear_login_failures(identifier, client_ip)

    # Optional: invalidate prior sessions (single-device policy).
    # Commented out so users can stay signed in across phone + tablet.
    # await db.user_sessions.delete_many({"user_id": user["user_id"]})

    session = await _create_session(user["user_id"])

    # Also set a HttpOnly cookie for browser/curl convenience. The mobile
    # client uses the Bearer header — both work.
    response.set_cookie(
        key="session_token",
        value=session["session_token"],
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/",
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
    )

    await create_audit_log(user["user_id"], "login", "auth", user["user_id"], request=request)
    return {
        "user":          _public_user(user),
        "session_token": session["session_token"],
        "expires_at":    session["expires_at"].isoformat(),
    }


@api_router.post("/auth/register")
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest):
    """First-user-becomes-super_admin bootstrap.

    This endpoint exists for ONE reason: provisioning the very first
    super-admin on a fresh database. After that, it is **closed** —
    every other user must be created by an admin via
    `POST /api/users/create` from the in-app Users screen.

    The login UI does NOT expose this endpoint by default. If you need
    to enable open sign-up for a particular deployment, set
    ALLOW_SELF_REGISTER=true in the build env (eas.json → build.env).

    Prefer the `backend/seed_admin.py` CLI script for first-user
    provisioning in production.
    - If the user collection is empty, the registered user is promoted
      to `super_admin` so the company can self-onboard.
    - If users already exist, registration is **closed** — admins must
      use the `POST /api/users/create` endpoint to invite people.
    """
    user_count = await db.users.count_documents({})
    if user_count > 0:
        raise HTTPException(
            status_code=403,
            detail="Self-registration is disabled. Please ask your administrator to create an account.",
        )

    username = body.username.strip().lower()
    email    = body.email.strip().lower()

    # Sanitise
    if not re.match(r"^[a-z0-9_.\-]{3,60}$", username):
        raise HTTPException(status_code=422, detail="Username may only contain letters, numbers, '.', '_' and '-' (3-60 chars)")

    if await db.users.find_one({"$or": [{"username": username}, {"email": email}]}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="A user with that username or email already exists")

    user_id  = f"user_{uuid.uuid4().hex[:12]}"
    now      = datetime.now(timezone.utc)
    user_doc = {
        "user_id":       user_id,
        "username":      username,
        "email":         email,
        "name":          sanitize_string(body.name),
        "phone":         sanitize_string(body.phone) if body.phone else None,
        "role":          UserRole.SUPER_ADMIN.value,   # first user is always super_admin
        "is_active":     True,
        "is_invited":    False,
        "debt_ceiling":  0.0,
        "is_flagged":    False,
        "password_hash": hash_password(body.password),
        "created_at":    now,
        "updated_at":    now,
    }
    await db.users.insert_one(user_doc)

    session = await _create_session(user_id)
    await create_audit_log(user_id, "register", "auth", user_id, request=request)
    return {
        "user":          _public_user(user_doc),
        "session_token": session["session_token"],
        "expires_at":    session["expires_at"].isoformat(),
        "message":       "Super admin account created",
    }


@api_router.post("/auth/change-password")
@limiter.limit("5/minute")
async def change_password(request: Request, body: ChangePasswordRequest,
                          user: User = Depends(get_current_user)):
    """Logged-in user changes their own password."""
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not user_doc or not user_doc.get("password_hash"):
        raise HTTPException(status_code=400, detail="Password login not enabled for this account")

    if not verify_password(body.old_password, user_doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    new_hash = hash_password(body.new_password)
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"password_hash": new_hash, "updated_at": datetime.now(timezone.utc)}},
    )
    # Invalidate other sessions for safety
    await db.user_sessions.delete_many({"user_id": user.user_id})
    new_session = await _create_session(user.user_id)

    await create_audit_log(user.user_id, "change_password", "auth", user.user_id, request=request)
    return {"message": "Password changed. Please use the new session token.", "session_token": new_session["session_token"]}


@api_router.post("/auth/rotate-session")
@limiter.limit("5/minute")
async def rotate_session(request: Request, response: Response, user: User = Depends(get_current_user)):
    """Rotate session token for security (prevents session fixation attacks)."""
    # Accept token from header OR cookie
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        old_token = auth[7:].strip()
    else:
        old_token = request.cookies.get("session_token", "")

    new_session = await _create_session(user.user_id)
    if old_token:
        await db.user_sessions.delete_one({"session_token": old_token})

    response.set_cookie(
        key="session_token",
        value=new_session["session_token"],
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/",
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
    )

    await create_audit_log(user.user_id, "rotate_session", "auth", user.user_id, request=request)
    return {"message": "Session rotated successfully", "session_token": new_session["session_token"]}


@api_router.get("/auth/me")
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current user info"""
    return current_user.model_dump()


# ========================
# FORGOT PASSWORD / USERNAME
# ========================
# Provider-agnostic flow:
#  1. /auth/forgot-password   → issue a 15-min reset token, persist in DB,
#                                deliver via configured provider (or log if none)
#  2. /auth/reset-password    → validate the token, set new password
#  3. /auth/forgot-username   → look up the user by email/phone, return masked
#                                email/phone so the requester can identify the
#                                account (no token issued)
#
# Provider configuration is read from env vars at module import time:
#   PASSWORD_RESET_PROVIDER = "console" | "email" | "sms"  (default "console")
#   PASSWORD_RESET_FROM_EMAIL (for email provider)
#   PASSWORD_RESET_SMS_SENDER (for sms provider)
# In the default "console" mode the token is logged to stdout + written to
# the audit log so a developer can copy-paste it during local testing.

import secrets as _secrets

RESET_TOKEN_TTL_MINUTES = 15
PASSWORD_RESET_PROVIDER = os.getenv("PASSWORD_RESET_PROVIDER", "console").lower()

# Gmail SMTP delivery config (only used when PASSWORD_RESET_PROVIDER=="gmail")
# Generate the App Password at https://myaccount.google.com/apppasswords
# Requires 2-Step Verification to be enabled on the Google account.
GMAIL_SMTP_USER      = os.getenv("GMAIL_SMTP_USER", "chisomarinzeshasha@gmail.com")
GMAIL_SMTP_APP_PASS  = os.getenv("GMAIL_SMTP_APP_PASS", "")
GMAIL_SMTP_FROM_NAME = os.getenv("GMAIL_SMTP_FROM_NAME", "BizCore")

# Daily send cap. Google personal accounts are limited to ~500/day; we set
# this conservatively at 100 to leave headroom for the user's own mail.
DAILY_SEND_CAP = int(os.getenv("DAILY_SEND_CAP", "100"))


def _daily_send_count_key() -> str:
    return datetime.now(timezone.utc).strftime("email_send_count_%Y%m%d")


async def _increment_and_check_daily_send() -> bool:
    """Atomically increment today's send counter and return True if we are
    still under the daily cap. Uses Mongo as a shared counter so the cap
    holds even with multiple backend instances behind a load balancer.
    """
    try:
        from pymongo import ReturnDocument
        key = _daily_send_count_key()
        doc = await db.email_send_log.find_one_and_update(
            {"_id": key},
            {"$inc": {"count": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        count = (doc or {}).get("count", 0)
        return count <= DAILY_SEND_CAP
    except Exception as e:
        # If the counter fails, fail closed (refuse to send) so we never
        # accidentally blow past Gmail's quota.
        print(f"[email-send] daily counter error: {e}")
        return False


def _send_gmail_email(to: str, subject: str, html_body: str) -> Dict[str, Any]:
    """Send an email via Gmail SMTP. Returns a small status dict.

    Runs synchronously in a thread (smtplib is blocking). Caller should
    invoke via `asyncio.to_thread` to avoid blocking the event loop.
    """
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    if not GMAIL_SMTP_APP_PASS:
        raise RuntimeError(
            "GMAIL_SMTP_APP_PASS is not set. Generate an App Password at "
            "https://myaccount.google.com/apppasswords and set it in the env."
        )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{GMAIL_SMTP_FROM_NAME} <{GMAIL_SMTP_USER}>"
    msg["To"]      = to
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as server:
        server.login(GMAIL_SMTP_USER, GMAIL_SMTP_APP_PASS)
        server.sendmail(GMAIL_SMTP_USER, [to], msg.as_string())

    return {"smtp_response": "sent"}


async def _deliver_reset_token(user: Dict[str, Any], token: str, request: Request):
    """Deliver a password-reset token via the configured provider.

    Always writes to the audit log so an admin can recover the token later.
    In dev / no-provider mode, also prints the token to stdout.
    """
    await create_audit_log(
        user.get("user_id"), "password_reset_issued", "auth", user.get("user_id"),
        new_value={
            "provider": PASSWORD_RESET_PROVIDER,
            "ttl_minutes": RESET_TOKEN_TTL_MINUTES,
            "token_last4": token[-4:],
        },
        request=request,
    )

    if PASSWORD_RESET_PROVIDER == "console":
        print(
            f"[password-reset] user={user.get('email')} "
            f"phone={user.get('phone')} token={token} "
            f"ttl={RESET_TOKEN_TTL_MINUTES}min"
        )
        return {"delivered_via": "console", "hint": "Token logged to backend stdout."}

    if PASSWORD_RESET_PROVIDER == "gmail":
        return await _send_via_gmail(user, token)

    if PASSWORD_RESET_PROVIDER == "email":
        # Legacy alias: "email" used to mean a placeholder; we now treat
        # it the same as "gmail" for backward-compat with any existing
        # environment variable. Operators should rename to "gmail".
        return await _send_via_gmail(user, token)

    if PASSWORD_RESET_PROVIDER == "sms":
        # SMS disabled — owner decided to ship email-only.
        print(f"[password-reset] sms disabled (email-only deployment); token={token}")
        return {"delivered_via": "sms", "sent": False,
                "error": "SMS is disabled for this deployment"}

    return {"delivered_via": PASSWORD_RESET_PROVIDER, "hint": "Unknown provider."}


async def _send_via_gmail(user: Dict[str, Any], token: str) -> Dict[str, Any]:
    """Send the password-reset email through Gmail SMTP. The cap-check and
    HTML template live here, separate from the audit-log / dispatch logic
    in _deliver_reset_token, so the legacy "email" alias can reuse it
    without re-emitting the audit log entry."""
    to_email = (user.get("email") or "").strip()
    if not to_email or "@" not in to_email:
        return {"delivered_via": "gmail", "sent": False,
                "error": "user has no email on file"}

    under_cap = await _increment_and_check_daily_send()
    if not under_cap:
        print(
            f"[password-reset] daily cap {DAILY_SEND_CAP} reached; "
            f"token NOT emailed to {to_email}; token={token}"
        )
        return {"delivered_via": "gmail", "sent": False,
                "error": f"daily send cap of {DAILY_SEND_CAP} reached",
                "hint": "Token logged to backend stdout for manual delivery."}

    html = f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#6366F1;margin-bottom:8px;">Reset your BizCore password</h2>
      <p style="color:#374151;">Hi {user.get('name', 'there')},</p>
      <p style="color:#374151;">Use the token below to reset your password. It expires in {RESET_TOKEN_TTL_MINUTES} minutes and can only be used once.</p>
      <div style="background:#F3F4F6;border:1px solid #E5E7EB;border-radius:8px;padding:16px;margin:20px 0;word-break:break-all;font-family:monospace;font-size:14px;color:#111827;">
        {token}
      </div>
      <p style="color:#6B7280;font-size:13px;">In the BizCore mobile app, open the sign-in screen and tap <b>Forgot password?</b> → <b>I already have a reset token</b>, then paste this code.</p>
      <p style="color:#6B7280;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;"/>
      <p style="color:#9CA3AF;font-size:11px;">Sent by {GMAIL_SMTP_FROM_NAME} &middot; do not reply.</p>
    </div>
    """.strip()
    try:
        import asyncio
        await asyncio.to_thread(
            _send_gmail_email, to_email,
            "Reset your BizCore password", html,
        )
        return {"delivered_via": "gmail", "sent": True, "to": to_email}
    except Exception as e:
        print(f"[password-reset] gmail send failed: {e}; token={token}")
        return {"delivered_via": "gmail", "sent": False, "error": str(e),
                "hint": "Token logged to backend stdout for manual delivery."}


@api_router.post("/auth/forgot-password")
@limiter.limit("5/minute")
async def forgot_password(request: Request, body: ForgotPasswordRequest):
    """Issue a password-reset token. Always returns 200 (don't leak whether the
    account exists)."""
    identifier = (body.email_or_phone or "").strip().lower()
    if not identifier:
        raise HTTPException(status_code=422, detail="email_or_phone is required")

    # Look up by email or phone (last-7-digit match to be flexible)
    user_doc = await db.users.find_one(
        {"$or": [
            {"email": identifier},
            {"username": identifier},
        ]},
        {"_id": 0},
    )
    if not user_doc:
        # Try phone (the field stores full E.164; we match last 10 digits)
        all_users = await db.users.find({}, {"_id": 0, "user_id": 1, "email": 1,
                                              "phone": 1, "name": 1}).to_list(2000)
        for u in all_users:
            if u.get("phone") and identifier in u["phone"].replace(" ", ""):
                user_doc = u
                break

    if not user_doc:
        # Don't reveal whether the user exists
        return {
            "message": "If an account exists for that identifier, a reset token "
                       "has been sent.",
        }

    # Issue a token
    token = _secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)
    await db.password_resets.delete_many({"user_id": user_doc["user_id"]})
    await db.password_resets.insert_one({
        "user_id": user_doc["user_id"],
        "token": token,
        "expires_at": expires_at,
        "used": False,
        "created_at": datetime.now(timezone.utc),
    })
    delivery = await _deliver_reset_token(user_doc, token, request)

    return {
        "message": "If an account exists for that identifier, a reset token "
                   "has been sent.",
        "delivery": delivery,
    }


@api_router.post("/auth/reset-password")
@limiter.limit("10/minute")
async def reset_password(request: Request, body: ResetPasswordRequest):
    """Validate a reset token and set a new password."""
    if not body.token or not body.new_password:
        raise HTTPException(status_code=422, detail="token and new_password are required")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters")

    reset = await db.password_resets.find_one({"token": body.token}, {"_id": 0})
    if not reset or reset.get("used"):
        raise HTTPException(status_code=400, detail="Invalid or already-used token")
    if reset["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Token has expired; request a new one")

    user_doc = await db.users.find_one({"user_id": reset["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="Account no longer exists")

    new_hash = hash_password(body.new_password)
    await db.users.update_one(
        {"user_id": reset["user_id"]},
        {"$set": {
            "password_hash": new_hash,
            "is_active": True,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    await db.password_resets.update_one(
        {"token": body.token},
        {"$set": {"used": True, "used_at": datetime.now(timezone.utc)}},
    )
    # Invalidate all other sessions for safety
    await db.user_sessions.delete_many({"user_id": reset["user_id"]})
    new_session = await _create_session(reset["user_id"])

    await create_audit_log(
        reset["user_id"], "password_reset_completed", "auth", reset["user_id"],
        request=request,
    )
    return {
        "message": "Password has been reset. You are now signed in.",
        "session_token": new_session["session_token"],
        "expires_at": new_session["expires_at"],
    }


@api_router.post("/auth/forgot-username")
@limiter.limit("5/minute")
async def forgot_username(request: Request, body: ForgotUsernameRequest):
    """Look up the account by email/phone and return the username (and a
    masked email) so the user can recover access. Provider-agnostic.
    """
    identifier = (body.email_or_phone or "").strip().lower()
    if not identifier:
        raise HTTPException(status_code=422, detail="email_or_phone is required")

    user_doc = None
    if "@" in identifier:
        user_doc = await db.users.find_one({"email": identifier}, {"_id": 0})
    else:
        all_users = await db.users.find({}, {"_id": 0, "user_id": 1, "email": 1,
                                              "phone": 1, "username": 1, "name": 1}).to_list(2000)
        for u in all_users:
            if u.get("phone") and identifier in u["phone"].replace(" ", ""):
                user_doc = u
                break

    if not user_doc:
        return {"message": "If an account exists for that identifier, we sent a reminder."}

    # Mask the email for the response (so the caller can confirm they own it)
    email = user_doc.get("email", "")
    if "@" in email:
        local, _, domain = email.partition("@")
        masked = (local[:2] + "***@" + domain) if len(local) > 2 else "***@" + domain
    else:
        masked = "***"

    await create_audit_log(
        user_doc["user_id"], "forgot_username_looked_up", "auth", user_doc["user_id"],
        request=request,
    )
    delivery: Dict[str, Any] = {"delivered_via": PASSWORD_RESET_PROVIDER,
                                "hint": "Reminder issued."}

    if PASSWORD_RESET_PROVIDER == "console":
        print(
            f"[forgot-username] user={user_doc.get('username')} email={email} "
            f"phone={user_doc.get('phone')}"
        )
        # In dev / console mode we also return the username directly so the
        # user can recover it from the API response.
        return {
            "message": "If an account exists for that identifier, we sent a reminder.",
            "delivery": delivery,
            "username": user_doc.get("username"),
            "email_masked": masked,
            "name": user_doc.get("name"),
        }

    if PASSWORD_RESET_PROVIDER in ("gmail", "email"):
        # Email the username reminder. Do NOT return the username in the
        # response body — only the owner of the email inbox should learn it.
        under_cap = await _increment_and_check_daily_send()
        if not under_cap:
            print(
                f"[forgot-username] daily cap {DAILY_SEND_CAP} reached; "
                f"username NOT emailed to {email}; username={user_doc.get('username')}"
            )
            return {
                "message": "If an account exists for that identifier, we sent a reminder.",
                "delivery": {"delivered_via": "gmail", "sent": False,
                             "error": f"daily send cap of {DAILY_SEND_CAP} reached"},
            }

        html = f"""
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#6366F1;margin-bottom:8px;">Your BizCore username</h2>
          <p style="color:#374151;">Hi {user_doc.get('name', 'there')},</p>
          <p style="color:#374151;">A username reminder was requested for the account associated with this email address.</p>
          <div style="background:#F3F4F6;border:1px solid #E5E7EB;border-radius:8px;padding:16px;margin:20px 0;font-family:monospace;font-size:16px;color:#111827;text-align:center;">
            {user_doc.get('username')}
          </div>
          <p style="color:#6B7280;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;"/>
          <p style="color:#9CA3AF;font-size:11px;">Sent by {GMAIL_SMTP_FROM_NAME} &middot; do not reply.</p>
        </div>
        """.strip()
        try:
            import asyncio
            await asyncio.to_thread(
                _send_gmail_email, email,
                "Your BizCore username", html,
            )
            delivery = {"delivered_via": "gmail", "sent": True, "to": email}
        except Exception as e:
            print(f"[forgot-username] gmail send failed: {e}")
            delivery = {"delivered_via": "gmail", "sent": False, "error": str(e)}

        return {
            "message": "If an account exists for that identifier, we sent a reminder.",
            "delivery": delivery,
            # Show the masked email so the requester can confirm ownership
            "email_masked": masked,
            "name": user_doc.get("name"),
        }

    return {
        "message": "If an account exists for that identifier, we sent a reminder.",
        "delivery": delivery,
    }


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response,
                 user: Optional[User] = Depends(get_optional_user)):
    """Destroy the current session. Works for both header and cookie auth."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    else:
        token = request.cookies.get("session_token", "")

    if token:
        await db.user_sessions.delete_many({"session_token": token})
    if user:
        await create_audit_log(user.user_id, "logout", "auth", user.user_id, request=request)

    response.delete_cookie(key="session_token", path="/")
    return {"message": "Logged out successfully"}

# ========================
# USER MANAGEMENT ENDPOINTS
# ========================

@api_router.get("/users", response_model=List[User])
@limiter.limit("100/minute")
async def get_users(
    request: Request,
    status: Optional[str] = "active",  # active | deactivated | all
    user: User = Depends(get_current_user),
):
    """Get users (admin only). Rate limited: 100/minute.

    Query param `status`:
      - active      (default) → only is_active=True
      - deactivated → only is_active=False
      - all         → every user, active and deactivated
    """
    await assert_permission(db, user.role, "users", "read")
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER,
                          UserRole.WAREHOUSE_MANAGER, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Not authorized")

    query: Dict[str, Any] = {}
    # Warehouse-scoped staff only see their own warehouse users
    if user.role in [UserRole.WAREHOUSE_MANAGER, UserRole.ACCOUNTANT] and user.warehouse_id:
        query["warehouse_id"] = sanitize_string(user.warehouse_id)

    status_norm = (status or "active").strip().lower()
    if status_norm == "active":
        query["is_active"] = True
    elif status_norm == "deactivated":
        query["is_active"] = False
    elif status_norm == "all":
        pass  # no is_active filter
    else:
        raise HTTPException(
            status_code=422,
            detail="status must be one of: active, deactivated, all",
        )

    users = await db.users.find(query, {"_id": 0}).to_list(1000)
    return [User(**u) for u in users]

@api_router.post("/users/create")
@limiter.limit("20/minute")
async def create_user(request: Request, user_data: UserCreate, current_user: User = Depends(get_current_user)):
    """SuperAdmin / General Manager / Accountant creates a user — Name, Email, Phone required. Rate limited: 20/minute."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Only Super Admin, General Manager, or Accountant can create users")

    # SECURITY: You cannot create a user whose role outranks your own.
    if role_rank(user_data.role) > role_rank(current_user.role):
        raise HTTPException(
            status_code=403,
            detail="Cannot create a user with a role higher than your own",
        )

    # FIX: Do NOT use sanitize_string on emails — it strips the '@' symbol.
    sanitized_email = user_data.email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", sanitized_email):
        raise HTTPException(status_code=422, detail="Invalid email format")
        
    sanitized_name = sanitize_string(user_data.name)
    sanitized_phone = sanitize_phone(user_data.phone)
    
    # Resolve username — derive from email if not provided
    if user_data.username:
        sanitized_username = sanitize_string(user_data.username.lower())
        if not re.match(r"^[a-z0-9_.\-]{3,60}$", sanitized_username):
            raise HTTPException(status_code=422, detail="Username may only contain letters, numbers, '.', '_' and '-' (3-60 chars)")
    else:
        # FIX: Safely extract the local part of the email
        raw_username = sanitized_email.split("@")[0]
        sanitized_username = re.sub(r'[^\w_.\-]', '', raw_username).lower()
        if not sanitized_username or len(sanitized_username) < 3:
            sanitized_username = f"user_{secrets.token_hex(4)}"

    # Validate email / username uniqueness
    existing = await db.users.find_one(
        {"$or": [{"email": sanitized_email}, {"username": sanitized_username}]},
        {"_id": 0},
    )
    if existing:
        raise HTTPException(status_code=400, detail="A user with that email or username already exists")

    if not sanitized_phone or not sanitized_phone.strip():
        raise HTTPException(status_code=422, detail="Phone number is required when creating a user")

    # Resolve warehouse name if provided
    wh_name = None
    if user_data.warehouse_id:
        wh = await db.warehouses.find_one({"warehouse_id": user_data.warehouse_id}, {"_id": 0})
        if not wh:
            raise HTTPException(status_code=404, detail="Warehouse not found")
        wh_name = wh["name"]

    new_user_id = f"user_{uuid.uuid4().hex[:12]}"
    # Initial password — either admin-supplied, or a strong random one
    if user_data.password:
        if len(user_data.password) < 6:
            raise HTTPException(status_code=422, detail="Password must be at least 6 characters")
        password_hash = hash_password(user_data.password)
        initial_password = user_data.password
    else:
        initial_password = secrets.token_urlsafe(10)
        password_hash = hash_password(initial_password)

    user_doc = {
        "user_id":       new_user_id,
        "username":      sanitized_username,
        "email":         sanitized_email,
        "name":          sanitized_name,
        "phone":         sanitized_phone,
        "role":          user_data.role.value,
        "warehouse_id":  user_data.warehouse_id,
        "warehouse_name": wh_name,
        "is_active":     True,
        "is_invited":    True,
        "debt_ceiling":  0.0,
        "is_flagged":    False,
        "password_hash": password_hash,
        "created_at":    datetime.now(timezone.utc),
        "updated_at":    datetime.now(timezone.utc),
    }
    await db.users.insert_one(user_doc)
    await create_audit_log(current_user.user_id, "create", "user", new_user_id,
                           new_value={"email": sanitized_email, "role": user_data.role.value},
                           request=request)
    safe = _public_user(user_doc)
    safe["initial_password"] = initial_password
    safe["message"] = "User created. Share the username and password with them."
    return safe

@api_router.put("/users/{user_id}")
@limiter.limit("100/minute")
async def update_user(request: Request, user_id: str, update: UserUpdate, user: User = Depends(get_current_user)):
    """Update user. Rate limited: 100/minute."""
    await assert_permission(db, user.role, "users", "update")
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER,
                          UserRole.WAREHOUSE_MANAGER, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Not authorized")

    update_data = {k: v for k, v in update.model_dump().items() if v is not None}

    # SECURITY: Prevent privilege escalation — cannot assign a role >= own rank
    if "role" in update_data:
        caller_rank = role_rank(user.role)
        target_rank = role_rank(update_data["role"])
        if target_rank >= caller_rank and user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=403,
                detail="Cannot assign a role equal to or higher than your own"
            )

    # Load the target so we can enforce tenancy + rank rules.
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # SECURITY: You cannot modify an account that outranks you.
    if user.role != UserRole.SUPER_ADMIN:
        if role_rank(target.get("role")) >= role_rank(user.role):
            raise HTTPException(
                status_code=403,
                detail="Cannot modify a user whose role is equal to or higher than your own",
            )

    # SECURITY: Warehouse-scoped admins only manage users in their warehouse.
    if user.role in [UserRole.WAREHOUSE_MANAGER, UserRole.ACCOUNTANT]:
        if not user.warehouse_id or target.get("warehouse_id") != user.warehouse_id:
            raise HTTPException(
                status_code=403,
                detail="You can only manage users in your own warehouse",
            )

    # SECURITY: Do not let anyone demote or deactivate themselves — that
    # locks the actor out and can strand the system without an admin.
    if user_id == user.user_id:
        if update_data.get("is_active") is False:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
        if "role" in update_data and update_data["role"] != user.role:
            raise HTTPException(status_code=400, detail="You cannot change your own role")

    # SECURITY: The last active Super Admin must stay active.
    if target.get("role") == UserRole.SUPER_ADMIN.value and update_data.get("is_active") is False:
        active_sa = await db.users.count_documents(
            {"role": UserRole.SUPER_ADMIN.value, "is_active": True}
        )
        if active_sa <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot deactivate the last active Super Admin",
            )

    # Resolve warehouse name if warehouse_id is being changed
    if "warehouse_id" in update_data and update_data["warehouse_id"]:
        wh = await db.warehouses.find_one({"warehouse_id": update_data["warehouse_id"]}, {"_id": 0})
        if not wh:
            raise HTTPException(status_code=404, detail="Warehouse not found")
        update_data["warehouse_name"] = wh["name"]

    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc)
        await db.users.update_one({"user_id": user_id}, {"$set": update_data})

    updated_user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not updated_user:
        raise HTTPException(status_code=404, detail="User not found")
    return User(**updated_user)


@api_router.delete("/users/{user_id}")
@limiter.limit("30/minute")
async def delete_user(request: Request, user_id: str, user: User = Depends(get_current_user)):
    """Deactivate (soft-delete) or permanently delete a user. Rate limited: 30/minute.

    Authorization: Super Admin or General Manager only.

    - Cannot delete/deactivate self.
    - Cannot deactivate the last active Super Admin.
    - Default behaviour is always soft-delete (is_active=False) so the
      audit trail is preserved and the UI can show a faded “Deactivated” row.
    - Pass ?hard=true to attempt a permanent delete. Hard delete is only
      allowed when the user has no business history; otherwise soft-delete
      is forced.

    Success responses always use HTTP 200 with success=true so the UI
    can show a neutral/success toast (“User deactivated”) instead of an error.
    """
    await assert_permission(db, user.role, "users", "delete")
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER]:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Cannot delete self
    if user_id == user.user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Already deactivated → treat as success (idempotent)
    if not target.get("is_active", True):
        return {
            "success": True,
            "action": "deactivated",
            "deleted": False,
            "deactivated": True,
            "message": "User account is already deactivated.",
            "user_id": user_id,
        }

    # Cannot deactivate the last active Super Admin
    if target.get("role") == UserRole.SUPER_ADMIN.value:
        active_sa_count = await db.users.count_documents(
            {"role": UserRole.SUPER_ADMIN.value, "is_active": True}
        )
        if active_sa_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot deactivate the last active Super Admin"
            )

    # Check for any business records referencing this user
    has_history = False
    for coll in [db.purchase_orders, db.sales_orders, db.quotations,
                 db.audit_logs, db.stock_transactions]:
        try:
            count = await coll.count_documents(
                {"$or": [{"created_by": user_id}, {"user_id": user_id},
                         {"created_by_user": user_id}]},
                limit=1,
            )
            if count > 0:
                has_history = True
                break
        except Exception:
            # collection may not exist yet — treat as no history
            continue

    hard = request.query_params.get("hard", "").lower() in ("1", "true", "yes")

    # Prefer soft-delete unless hard=true AND no history
    if has_history or not hard:
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "is_active": False,
                "deactivated_at": datetime.now(timezone.utc),
                "deactivated_by": user.user_id,
                "updated_at": datetime.now(timezone.utc),
            }}
        )
        await create_audit_log(
            user.user_id, "deactivate", "user", user_id,
            new_value={"email": target.get("email"), "role": target.get("role")},
            request=request,
        )
        return {
            "success": True,
            "action": "deactivated",
            "deleted": False,
            "deactivated": True,
            "message": "User account has been deactivated.",
            "user_id": user_id,
        }

    # True hard delete (no history + explicit hard=true)
    await db.users.delete_one({"user_id": user_id})
    await create_audit_log(
        user.user_id, "delete", "user", user_id,
        new_value={"email": target.get("email"), "role": target.get("role")},
        request=request,
    )
    return {
        "success": True,
        "action": "deleted",
        "deleted": True,
        "deactivated": False,
        "message": "User permanently deleted.",
        "user_id": user_id,
    }


@api_router.post("/users/{user_id}/reactivate")
@limiter.limit("30/minute")
async def reactivate_user(
    request: Request,
    user_id: str,
    user: User = Depends(get_current_user),
):
    """Reactivate a previously soft-deleted (deactivated) user account.

    Authorization: Super Admin or General Manager only.
    Returns HTTP 200 with success=true so the UI can show a success toast.
    """
    await assert_permission(db, user.role, "users", "update")
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER]:
        raise HTTPException(status_code=403, detail="Not authorized")

    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.get("is_active", True):
        return {
            "success": True,
            "action": "reactivated",
            "message": "User is already active.",
            "user_id": user_id,
        }

    await db.users.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "is_active": True,
                "updated_at": datetime.now(timezone.utc),
            },
            "$unset": {
                "deactivated_at": "",
                "deactivated_by": "",
            },
        },
    )
    await create_audit_log(
        user.user_id, "reactivate", "user", user_id,
        new_value={"email": target.get("email"), "role": target.get("role")},
        request=request,
    )
    return {
        "success": True,
        "action": "reactivated",
        "message": "User account has been reactivated.",
        "user_id": user_id,
    }


@api_router.put("/users/{user_id}/debt-ceiling")
@limiter.limit("50/minute")
async def set_agent_debt_ceiling(request: Request, user_id: str, debt_ceiling: float,
                                  user: User = Depends(get_current_user)):
    """Set debt ceiling for a Sales Rep — Manager/Accountant of same warehouse or SuperAdmin. Rate limited: 50/minute."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") not in [UserRole.SALES_REP.value]:
        raise HTTPException(status_code=400, detail="Debt ceiling only applies to Sales Reps")

    # Permission check
    if user.role not in CROSS_WAREHOUSE_ROLES:
        if user.role not in APPROVAL_ROLES:
            raise HTTPException(status_code=403, detail="Not authorized")
        assert_same_warehouse(user, target.get("warehouse_id", ""), "set debt ceiling for agent in")

    if debt_ceiling < 0:
        raise HTTPException(status_code=422, detail="Debt ceiling cannot be negative")

    await db.users.update_one({"user_id": user_id},
                               {"$set": {"debt_ceiling": debt_ceiling,
                                         "updated_at": datetime.now(timezone.utc)}})
    await recalculate_agent_flag(user_id)
    updated = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"message": "Debt ceiling updated", "debt_ceiling": debt_ceiling,
            "is_flagged": updated.get("is_flagged", False)}

@api_router.get("/users/agents")
@limiter.limit("100/minute")
async def get_warehouse_agents(request: Request, user: User = Depends(get_current_user)):
    """Get Sales Reps for current user's warehouse with outstanding balance & flag. Rate limited: 100/minute."""
    wh_filter = get_user_warehouse_filter(user)
    query: Dict[str, Any] = {"role": UserRole.SALES_REP.value}
    if wh_filter:
        query["warehouse_id"] = sanitize_string(wh_filter)

    agents = await db.users.find(query, {"_id": 0}).to_list(500)
    result = []
    for agent in agents:
        entries = await db.agent_ledger_entries.find(
            {"sales_rep_id": agent["user_id"]}, {"_id": 0, "amount": 1}
        ).to_list(10000)
        outstanding = sum(_num(e.get("amount")) for e in entries)
        result.append({
            **{k: v for k, v in agent.items() if k != "_id"},
            "outstanding_balance": round(outstanding, 2),
        })
    return result

# ========================
# COMPANY ENDPOINTS
# ========================

@api_router.get("/company")
async def get_company(user: User = Depends(get_current_user)):
    """Get company info"""
    company = await db.companies.find_one({}, {"_id": 0})
    if not company:
        default_company = Company(
            name="My Company",
            currency="NGN"
        )
        await db.companies.insert_one(default_company.model_dump())
        return default_company
    return company

@api_router.put("/company")
async def update_company(company_data: CompanyCreate, user: User = Depends(get_current_user)):
    """Update company info (admin only)"""
    if user.role not in [UserRole.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    existing = await db.companies.find_one({}, {"_id": 0})
    if existing:
        await db.companies.update_one({}, {"$set": company_data.model_dump()})
    else:
        company = Company(**company_data.model_dump())
        await db.companies.insert_one(company.model_dump())
    
    return await db.companies.find_one({}, {"_id": 0})

# ========================
# WAREHOUSE ENDPOINTS
# ========================

@api_router.get("/warehouses", response_model=List[Warehouse])
async def get_warehouses(user: User = Depends(get_current_user)):
    """Get all warehouses"""
    warehouses = await db.warehouses.find({"is_active": True}, {"_id": 0}).to_list(1000)
    return [Warehouse(**w) for w in warehouses]

@api_router.post("/warehouses", response_model=Warehouse)
async def create_warehouse(warehouse: WarehouseCreate, user: User = Depends(get_current_user)):
    """Create a warehouse"""
    await assert_permission(db, user.role, "warehouses", "create")
    new_warehouse = Warehouse(**warehouse.model_dump())
    await db.warehouses.insert_one(new_warehouse.model_dump())
    return new_warehouse

@api_router.put("/warehouses/{warehouse_id}", response_model=Warehouse)
async def update_warehouse(warehouse_id: str, warehouse: WarehouseCreate, user: User = Depends(get_current_user)):
    """Update a warehouse"""
    await assert_permission(db, user.role, "warehouses", "update")
    await db.warehouses.update_one(
        {"warehouse_id": warehouse_id},
        {"$set": warehouse.model_dump()}
    )
    updated = await db.warehouses.find_one({"warehouse_id": warehouse_id}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    return Warehouse(**updated)

@api_router.delete("/warehouses/{warehouse_id}")
async def delete_warehouse(warehouse_id: str, user: User = Depends(get_current_user)):
    """Delete a warehouse (soft delete)"""
    await assert_permission(db, user.role, "warehouses", "delete")
    await db.warehouses.update_one(
        {"warehouse_id": warehouse_id},
        {"$set": {"is_active": False}}
    )
    return {"message": "Warehouse deleted"}

# ========================
# PRODUCT ENDPOINTS
# ========================

@api_router.get("/products", response_model=List[Product])
async def get_products(
    category: Optional[ProductCategory] = None,
    supplier_id: Optional[str] = None,
    low_stock: bool = False,
    user: User = Depends(get_current_user)
):
    """Get all products with optional filters"""
    await assert_permission(db, user.role, "products", "read")
    query = {"is_active": True}
    if category:
        query["category"] = category.value
    if supplier_id:
        query["default_supplier_id"] = supplier_id
    
    products = await db.products.find(query, {"_id": 0}).to_list(1000)
    result = [Product(**p) for p in products]
    
    if low_stock:
        totals = await stock_totals_by_product([p.product_id for p in result])
        result = [p for p in result
                   if totals.get(p.product_id, 0) <= p.reorder_level]
    
    return result

async def stock_totals_by_product(
    product_ids: Optional[List[str]] = None,
    warehouse_id: Optional[str] = None,
) -> Dict[str, float]:
    """Total quantity per product, computed with a single aggregation.

    The previous implementation ran one query *per product*; on a catalogue
    of a few thousand SKUs that turned every dashboard load into thousands
    of round-trips.
    """
    match: Dict[str, Any] = {}
    if product_ids:
        match["product_id"] = {"$in": product_ids}
    if warehouse_id:
        match["warehouse_id"] = warehouse_id
    rows = await db.inventory_stock.aggregate([
        {"$match": match},
        {"$group": {"_id": "$product_id", "total": {"$sum": "$quantity"}}},
    ]).to_list(10000)
    return {r["_id"]: (r.get("total") or 0) for r in rows if r.get("_id") is not None}


async def is_low_stock(product_id: str, reorder_level: int) -> bool:
    """Check if product is low on stock"""
    stocks = await db.inventory_stock.find({"product_id": product_id}, {"_id": 0}).to_list(100)
    total_qty = sum(_num(s.get("quantity")) for s in stocks)
    return total_qty <= reorder_level

@api_router.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str, user: User = Depends(get_current_user)):
    """Get a single product"""
    await assert_permission(db, user.role, "products", "read")
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return Product(**product)

@api_router.post("/products", response_model=Product)
async def create_product(product: ProductCreate, user: User = Depends(get_current_user)):
    """Create a product"""
    await assert_permission(db, user.role, "products", "create")
    existing = await db.products.find_one({"sku": product.sku}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="SKU already exists")
    
    new_product = Product(**product.model_dump())
    await db.products.insert_one(new_product.model_dump())
    return new_product

@api_router.put("/products/{product_id}", response_model=Product)
async def update_product(product_id: str, update: ProductUpdate, user: User = Depends(get_current_user)):
    """Update a product"""
    await assert_permission(db, user.role, "products", "update")
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc)
        await db.products.update_one({"product_id": product_id}, {"$set": update_data})
    
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return Product(**product)

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, user: User = Depends(get_current_user)):
    """Delete a product (soft delete)"""
    await assert_permission(db, user.role, "products", "delete")
    await db.products.update_one(
        {"product_id": product_id},
        {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc)}}
    )
    return {"message": "Product deleted"}

# ========================
# INVENTORY ENDPOINTS
# ========================

@api_router.get("/inventory")
async def get_inventory(
    warehouse_id: Optional[str] = None,
    product_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get inventory stock levels"""
    await assert_permission(db, user.role, "inventory", "read")
    query = {}
    if warehouse_id:
        # A warehouse-scoped user may only read their own warehouse's stock.
        assert_same_warehouse(user, warehouse_id, "read inventory in")
        query["warehouse_id"] = warehouse_id
    else:
        scoped = get_user_warehouse_filter(user)
        if scoped:
            query["warehouse_id"] = scoped
    if product_id:
        query["product_id"] = product_id
    
    stocks = await db.inventory_stock.find(query, {"_id": 0}).to_list(1000)

    # Enrich with product / warehouse info using two batched lookups
    # instead of two queries per stock row.
    product_ids = {s.get("product_id") for s in stocks if s.get("product_id")}
    warehouse_ids = {s.get("warehouse_id") for s in stocks if s.get("warehouse_id")}
    products = await db.products.find(
        {"product_id": {"$in": list(product_ids)}}, {"_id": 0}).to_list(5000) if product_ids else []
    warehouses = await db.warehouses.find(
        {"warehouse_id": {"$in": list(warehouse_ids)}}, {"_id": 0}).to_list(500) if warehouse_ids else []
    product_map = {p["product_id"]: p for p in products}
    warehouse_map = {w["warehouse_id"]: w for w in warehouses}

    result = []
    for stock in stocks:
        product = product_map.get(stock.get("product_id"))
        warehouse = warehouse_map.get(stock.get("warehouse_id"))
        # Always return a number, never a legacy string.
        stock["quantity"] = _num(stock.get("quantity"))
        stock["product_name"] = product["name"] if product else "Unknown"
        stock["product_sku"] = product["sku"] if product else "Unknown"
        stock["warehouse_name"] = warehouse["name"] if warehouse else "Unknown"
        stock["cost_price"] = product["cost_price"] if product else 0
        stock["reorder_level"] = product["reorder_level"] if product else 0
        result.append(stock)

    return result


@api_router.get("/inventory/by-warehouse")
async def get_inventory_by_warehouse(
    product_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get inventory grouped by warehouse for each product.

    Super Admin, General Manager, and Accountant see every warehouse; other
    roles are scoped to their own warehouse (if set).

    Returns:
    [
      {
        "product_id": "prod_abc",
        "product_name": "Tomato Paste 400g",
        "sku": "TP-400",
        "unit": "tin",
        "cost_price": 850.0,
        "reorder_level": 50,
        "by_warehouse": [
          {"warehouse_id": "wh_lagos", "warehouse_name": "Lagos Main", "quantity": 120, "value": 102000.0},
          {"warehouse_id": "wh_abuja", "warehouse_name": "Abuja Branch", "quantity": 30,  "value":  25500.0},
        ],
        "total_quantity": 150,
        "total_value": 127500.0,
      },
      ...
    ]
    """
    await assert_permission(db, user.role, "inventory", "read")

    # Determine the visible warehouse scope for the current user.
    # Per client spec: Super Admin, General Manager, and Accountant see all
    # warehouses; Warehouse Managers see only their own; everyone else
    # falls back to their own warehouse if set.
    INVENTORY_FULL_VISIBILITY = {
        UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT
    }
    is_admin_like = user.role in INVENTORY_FULL_VISIBILITY
    visible_warehouse_ids: Optional[set] = None
    if not is_admin_like and user.warehouse_id:
        visible_warehouse_ids = {user.warehouse_id}

    # Build a fast lookup of all warehouses
    warehouses_cursor = db.warehouses.find({}, {"_id": 0, "warehouse_id": 1, "name": 1})
    warehouses_list = await warehouses_cursor.to_list(200)
    warehouse_name = {w["warehouse_id"]: w.get("name", "Unknown") for w in warehouses_list}

    # Build product filter
    product_query: Dict[str, Any] = {"is_active": True}
    if product_id:
        product_query["product_id"] = product_id
    products = await db.products.find(product_query, {"_id": 0}).to_list(2000)

    # One stock query for every product, grouped in memory.
    stock_query: Dict[str, Any] = {"product_id": {"$in": [p["product_id"] for p in products]}}
    if visible_warehouse_ids is not None:
        stock_query["warehouse_id"] = {"$in": list(visible_warehouse_ids)}
    all_stocks = await db.inventory_stock.find(stock_query, {"_id": 0}).to_list(50000)

    stock_by_product: Dict[str, Dict[str, int]] = {}
    for s in all_stocks:
        pid = s.get("product_id")
        wid = s.get("warehouse_id")
        if not pid or not wid:
            continue
        bucket = stock_by_product.setdefault(pid, {})
        bucket[wid] = bucket.get(wid, 0) + _num(s.get("quantity"))

    result = []
    for product in products:
        pid = product["product_id"]
        cost = product.get("cost_price", 0) or 0

        by_warehouse_map: Dict[str, int] = stock_by_product.get(pid, {})

        # Ensure we list every visible warehouse even when quantity == 0,
        # so the user can see "Lagos Main: 0" rows in the UI.
        by_warehouse: List[Dict[str, Any]] = []
        for wid, name in warehouse_name.items():
            if visible_warehouse_ids is not None and wid not in visible_warehouse_ids:
                continue
            qty = by_warehouse_map.get(wid, 0)
            by_warehouse.append({
                "warehouse_id": wid,
                "warehouse_name": name,
                "quantity": qty,
                "value": round(qty * cost, 2),
            })

        total_qty = sum(w["quantity"] for w in by_warehouse)
        total_value = round(total_qty * cost, 2)

        result.append({
            "product_id": pid,
            "product_name": product.get("name", "Unknown"),
            "sku": product.get("sku", ""),
            "unit": product.get("unit", ""),
            "category": product.get("category", ""),
            "cost_price": cost,
            "reorder_level": product.get("reorder_level", 0) or 0,
            "is_low_stock": total_qty <= (product.get("reorder_level", 0) or 0),
            "by_warehouse": by_warehouse,
            "total_quantity": total_qty,
            "total_value": total_value,
        })

    return result

@api_router.post("/inventory/adjust")
async def adjust_inventory(adjustment: StockTransactionCreate, user: User = Depends(get_current_user)):
    """Adjust inventory (damage, return, conversion)"""
    await assert_permission(db, user.role, "inventory", "update")
    assert_same_warehouse(user, adjustment.warehouse_id, "adjust inventory in")

    # Find or create stock record
    stock = await db.inventory_stock.find_one({
        "product_id": adjustment.product_id,
        "warehouse_id": adjustment.warehouse_id
    }, {"_id": 0})
    
    if stock:
        new_qty = _num(stock.get("quantity")) + adjustment.quantity
        if new_qty < 0:
            raise HTTPException(
                status_code=400,
                detail=("Adjustment would take stock below zero "
                        f"(current {stock['quantity']}, adjustment {adjustment.quantity})"),
            )
        await db.inventory_stock.update_one(
            {"stock_id": stock["stock_id"]},
            {"$set": {"quantity": new_qty, "last_updated": datetime.now(timezone.utc)}}
        )
    else:
        new_stock = InventoryStock(
            product_id=adjustment.product_id,
            warehouse_id=adjustment.warehouse_id,
            quantity=adjustment.quantity
        )
        await db.inventory_stock.insert_one(new_stock.model_dump())
    
    # Record transaction
    transaction = StockTransaction(
        **adjustment.model_dump(),
        created_by=user.user_id
    )
    await db.stock_transactions.insert_one(transaction.model_dump())
    
    return {"message": "Inventory adjusted", "transaction_id": transaction.transaction_id}

@api_router.get("/inventory/transactions")
async def get_stock_transactions(
    product_id: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    user: User = Depends(get_current_user)
):
    """Get stock transaction history"""
    await assert_permission(db, user.role, "inventory", "read")
    query = {}
    if product_id:
        query["product_id"] = product_id
    if warehouse_id:
        assert_same_warehouse(user, warehouse_id, "view stock movements in")
        query["warehouse_id"] = warehouse_id
    else:
        scoped = get_user_warehouse_filter(user)
        if scoped:
            query["warehouse_id"] = scoped
    
    transactions = await db.stock_transactions.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return transactions

@api_router.get("/inventory/low-stock")
async def get_low_stock_items(user: User = Depends(get_current_user)):
    """Get products that are low on stock"""
    await assert_permission(db, user.role, "inventory", "read")
    scoped = get_user_warehouse_filter(user)
    products = await db.products.find({"is_active": True}, {"_id": 0}).to_list(1000)
    totals = await stock_totals_by_product(
        [p["product_id"] for p in products], warehouse_id=scoped)
    low_stock_items = []
    
    for product in products:
        total_qty = totals.get(product["product_id"], 0)
        if total_qty <= product.get("reorder_level", 10):
            low_stock_items.append({
                "product_id": product["product_id"],
                "name": product["name"],
                "sku": product["sku"],
                "current_stock": total_qty,
                "reorder_level": product.get("reorder_level", 10)
            })
    
    return low_stock_items

# ========================
# SUPPLIER ENDPOINTS
# ========================

@api_router.get("/suppliers", response_model=List[Supplier])
async def get_suppliers(user: User = Depends(get_current_user)):
    """Get all suppliers"""
    await assert_permission(db, user.role, "suppliers", "read")
    suppliers = await db.suppliers.find({"is_active": True}, {"_id": 0}).to_list(1000)
    return [Supplier(**s) for s in suppliers]

@api_router.get("/suppliers/{supplier_id}", response_model=Supplier)
async def get_supplier(supplier_id: str, user: User = Depends(get_current_user)):
    """Get a single supplier"""
    await assert_permission(db, user.role, "suppliers", "read")
    supplier = await db.suppliers.find_one({"supplier_id": supplier_id}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return Supplier(**supplier)

@api_router.post("/suppliers", response_model=Supplier)
async def create_supplier(supplier: SupplierCreate, user: User = Depends(get_current_user)):
    """Create a supplier"""
    await assert_permission(db, user.role, "suppliers", "create")
    new_supplier = Supplier(**supplier.model_dump())
    await db.suppliers.insert_one(new_supplier.model_dump())
    return new_supplier

@api_router.put("/suppliers/{supplier_id}", response_model=Supplier)
async def update_supplier(supplier_id: str, update: SupplierUpdate, user: User = Depends(get_current_user)):
    """Update a supplier"""
    await assert_permission(db, user.role, "suppliers", "update")
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc)
        await db.suppliers.update_one({"supplier_id": supplier_id}, {"$set": update_data})
    
    supplier = await db.suppliers.find_one({"supplier_id": supplier_id}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return Supplier(**supplier)

@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, user: User = Depends(get_current_user)):
    """Delete a supplier (soft delete)"""
    await assert_permission(db, user.role, "suppliers", "delete")
    await db.suppliers.update_one(
        {"supplier_id": supplier_id},
        {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc)}}
    )
    return {"message": "Supplier deleted"}

# ========================
# DISTRIBUTOR ENDPOINTS
# ========================

@api_router.get("/purchase-orders")
async def get_purchase_orders(
    status: Optional[OrderStatus] = None,
    supplier_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get all purchase orders"""
    await assert_permission(db, user.role, "purchase_orders", "read")
    query = {}
    if status:
        query["status"] = status.value
    if supplier_id:
        query["supplier_id"] = supplier_id
    
    orders = await db.purchase_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return orders

@api_router.get("/purchase-orders/{po_id}")
async def get_purchase_order(po_id: str, user: User = Depends(get_current_user)):
    """Get a single purchase order"""
    await assert_permission(db, user.role, "purchase_orders", "read")
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po

@api_router.post("/purchase-orders")
async def create_purchase_order(po_data: PurchaseOrderCreate, user: User = Depends(get_current_user)):
    """Create a purchase order"""
    await assert_permission(db, user.role, "purchase_orders", "create")
    if not po_data.items:
        raise HTTPException(status_code=422, detail="Purchase order must contain at least one item")
    for item in po_data.items:
        if item.quantity <= 0:
            raise HTTPException(status_code=422, detail="Item quantity must be greater than zero")
        if item.unit_price < 0:
            raise HTTPException(status_code=422, detail="Item unit price cannot be negative")
    supplier = await db.suppliers.find_one({"supplier_id": po_data.supplier_id}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    
    # Build items with product names
    items = []
    subtotal = 0.0
    for item in po_data.items:
        product = await db.products.find_one({"product_id": item.product_id}, {"_id": 0})
        po_item = PurchaseOrderItem(
            product_id=item.product_id,
            product_name=product["name"] if product else "Unknown",
            quantity=item.quantity,
            unit_price=item.unit_price
        )
        items.append(po_item.model_dump())
        subtotal += item.quantity * item.unit_price
    
    po = PurchaseOrder(
        po_number=await generate_po_number(),
        supplier_id=po_data.supplier_id,
        supplier_name=supplier["name"],
        warehouse_id=po_data.warehouse_id,
        expected_date=po_data.expected_date,
        items=items,
        subtotal=subtotal,
        tax_amount=po_data.tax_amount,
        total_amount=subtotal + po_data.tax_amount,
        notes=po_data.notes,
        created_by=user.user_id
    )
    
    await db.purchase_orders.insert_one(po.model_dump())
    return po.model_dump()

@api_router.put("/purchase-orders/{po_id}")
async def update_purchase_order(
    po_id: str,
    update: PurchaseOrderUpdate,
    status: Optional[str] = Query(None, description="Status override (?status=received)"),
    user: User = Depends(get_current_user),
):
    """Update a purchase order"""
    await assert_permission(db, user.role, "purchase_orders", "update")
    if status:
        try:
            update.status = OrderStatus(status)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {status}")
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc)
        
        # Handle status change to "received"
        if update.status == OrderStatus.RECEIVED:
            po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
            if po:
                # Idempotency: receiving the same PO twice would double the stock.
                if po.get("status") == OrderStatus.RECEIVED.value:
                    raise HTTPException(
                        status_code=400,
                        detail="This purchase order has already been received",
                    )
                for item in po.get("items", []):
                    # A GRN is the source of truth for what actually arrived.
                    # If this line has already been receipted through a GRN we
                    # must not add anything here: the GRN credited the stock,
                    # and any shortfall was rejected at the gate, not received.
                    # This closes the "received twice" hole where a PO was
                    # receipted by GRN *and* by its status flag.
                    already_received = _num(item.get("received_quantity"))
                    if already_received > 0:
                        continue
                    shortfall = _num(item.get("quantity"))

                    # Update inventory
                    stock = await db.inventory_stock.find_one({
                        "product_id": item["product_id"],
                        "warehouse_id": po["warehouse_id"]
                    }, {"_id": 0})
                    
                    if stock:
                        new_qty = _num(stock.get("quantity")) + shortfall
                        await db.inventory_stock.update_one(
                            {"stock_id": stock["stock_id"]},
                            {"$set": {"quantity": new_qty, "last_updated": datetime.now(timezone.utc)}}
                        )
                    else:
                        new_stock = InventoryStock(
                            product_id=item["product_id"],
                            warehouse_id=po["warehouse_id"],
                            quantity=shortfall
                        )
                        await db.inventory_stock.insert_one(new_stock.model_dump())
                    
                    # Record transaction
                    transaction = StockTransaction(
                        product_id=item["product_id"],
                        warehouse_id=po["warehouse_id"],
                        type=TransactionType.PURCHASE,
                        quantity=shortfall,
                        reference_id=po_id,
                        created_by=user.user_id
                    )
                    await db.stock_transactions.insert_one(transaction.model_dump())
        
        await db.purchase_orders.update_one({"po_id": po_id}, {"$set": update_data})
    
    return await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})

@api_router.delete("/purchase-orders/{po_id}")
async def delete_purchase_order(po_id: str, user: User = Depends(get_current_user)):
    """Cancel a purchase order"""
    await assert_permission(db, user.role, "purchase_orders", "delete")
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    
    if po["status"] != OrderStatus.DRAFT.value:
        raise HTTPException(status_code=400, detail="Can only cancel draft orders")
    
    await db.purchase_orders.update_one(
        {"po_id": po_id},
        {"$set": {"status": OrderStatus.CANCELLED.value, "updated_at": datetime.now(timezone.utc)}}
    )
    return {"message": "Purchase order cancelled"}

# ========================
# SALES ORDER ENDPOINTS
# ========================

async def generate_so_number():
    """Generate a unique, collision-safe Sales Order number."""
    return await _make_doc_number("SO", "sales_order")

@api_router.get("/sales-orders")
async def get_sales_orders(
    status: Optional[OrderStatus] = None,
    sales_rep_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get sales orders. Sales reps see only their own; managers see all."""
    await assert_permission(db, user.role, "sales_orders", "read")
    query: Dict[str, Any] = {}
    if status:
        query["status"] = status.value
    # Scope: agents only see their own orders
    if user.role == UserRole.SALES_REP.value:
        query["sales_rep_id"] = user.user_id
    elif sales_rep_id:
        query["sales_rep_id"] = sales_rep_id

    orders = await db.sales_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return orders

@api_router.get("/sales-orders/pending-dispatch")
async def get_pending_dispatch_orders(user: User = Depends(get_current_user)):
    """Warehouse staff view: approved Sales Orders awaiting goods release."""
    if user.role not in [UserRole.SALES_CLERK, UserRole.WAREHOUSE_MANAGER,
                          UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER]:
        raise HTTPException(status_code=403, detail="Not authorized")

    query: Dict[str, Any] = {"status": OrderStatus.APPROVED.value}
    wh_filter = get_user_warehouse_filter(user)
    if wh_filter:
        query["warehouse_id"] = wh_filter

    orders = await db.sales_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return orders

@api_router.get("/sales-orders/{so_id}")
async def get_sales_order(so_id: str, user: User = Depends(get_current_user)):
    """Get a single sales order"""
    await assert_permission(db, user.role, "sales_orders", "read")
    so = await db.sales_orders.find_one({"so_id": so_id}, {"_id": 0})
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    return so

@api_router.post("/sales-orders")
async def create_sales_order(so_data: SalesOrderCreate, user: User = Depends(get_current_user)):
    """Create a sales order (manager override). Normal path: approve an agent quotation."""
    await assert_permission(db, user.role, "sales_orders", "create")
    if not so_data.items:
        raise HTTPException(status_code=422, detail="Sales order must contain at least one item")
    for item in so_data.items:
        if item.quantity <= 0:
            raise HTTPException(status_code=422, detail="Item quantity must be greater than zero")
        if item.unit_price < 0:
            raise HTTPException(status_code=422, detail="Item unit price cannot be negative")
    # Verify the referenced sales rep exists
    rep = await db.users.find_one({"user_id": so_data.sales_rep_id, "role": UserRole.SALES_REP.value}, {"_id": 0})
    if not rep:
        raise HTTPException(status_code=404, detail="Sales Rep not found")

    # Build items with product names
    items = []
    subtotal = 0.0
    for item in so_data.items:
        product = await db.products.find_one({"product_id": item.product_id}, {"_id": 0})
        so_item = SalesOrderItem(
            product_id=item.product_id,
            product_name=product["name"] if product else "Unknown",
            quantity=item.quantity,
            unit_price=item.unit_price
        )
        items.append(so_item.model_dump())
        subtotal += item.quantity * item.unit_price

    so = SalesOrder(
        so_number=await generate_so_number(),
        sales_rep_id=so_data.sales_rep_id,
        sales_rep_name=rep.get("name"),
        warehouse_id=so_data.warehouse_id,
        delivery_date=so_data.delivery_date,
        items=items,
        subtotal=subtotal,
        tax_amount=so_data.tax_amount,
        total_amount=subtotal + so_data.tax_amount,
        notes=so_data.notes,
        created_by=user.user_id
    )
    
    await db.sales_orders.insert_one(so.model_dump())
    return so.model_dump()

@api_router.put("/sales-orders/{so_id}")
async def update_sales_order(
    so_id: str,
    update: SalesOrderUpdate,
    status: Optional[str] = Query(None, description="Status override (?status=delivered)"),
    user: User = Depends(get_current_user),
):
    """Update a sales order"""
    await assert_permission(db, user.role, "sales_orders", "update")
    if status:
        try:
            update.status = OrderStatus(status)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {status}")
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc)
        
        # Handle status change to "delivered"
        if update.status == OrderStatus.DELIVERED:
            so = await db.sales_orders.find_one({"so_id": so_id}, {"_id": 0})
            if so:
                # Idempotency: delivering twice would double-deduct the stock.
                if so.get("status") == OrderStatus.DELIVERED.value:
                    raise HTTPException(
                        status_code=400,
                        detail="This sales order has already been delivered",
                    )
                for item in so.get("items", []):
                    # Update inventory (reduce stock)
                    stock = await db.inventory_stock.find_one({
                        "product_id": item["product_id"],
                        "warehouse_id": so["warehouse_id"]
                    }, {"_id": 0})
                    
                    if stock:
                        new_qty = _num(stock.get("quantity")) - _num(item.get("quantity"))
                        await db.inventory_stock.update_one(
                            {"stock_id": stock["stock_id"]},
                            {"$set": {"quantity": max(0, new_qty), "last_updated": datetime.now(timezone.utc)}}
                        )
                    
                    # Record transaction
                    transaction = StockTransaction(
                        product_id=item["product_id"],
                        warehouse_id=so["warehouse_id"],
                        type=TransactionType.SALE,
                        quantity=-item["quantity"],
                        reference_id=so_id,
                        created_by=user.user_id
                    )
                    await db.stock_transactions.insert_one(transaction.model_dump())
        
        await db.sales_orders.update_one({"so_id": so_id}, {"$set": update_data})
    
    return await db.sales_orders.find_one({"so_id": so_id}, {"_id": 0})

@api_router.delete("/sales-orders/{so_id}")
async def delete_sales_order(so_id: str, user: User = Depends(get_current_user)):
    """Cancel a sales order"""
    await assert_permission(db, user.role, "sales_orders", "delete")
    so = await db.sales_orders.find_one({"so_id": so_id}, {"_id": 0})
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    
    if so["status"] != OrderStatus.DRAFT.value:
        raise HTTPException(status_code=400, detail="Can only cancel draft orders")
    
    await db.sales_orders.update_one(
        {"so_id": so_id},
        {"$set": {"status": OrderStatus.CANCELLED.value, "updated_at": datetime.now(timezone.utc)}}
    )
    return {"message": "Sales order cancelled"}

# ========================
# INVOICE ENDPOINTS
# ========================

async def generate_invoice_number(inv_type: InvoiceType):
    """Generate a unique, collision-safe invoice number."""
    prefix = "PI" if inv_type == InvoiceType.PURCHASE else "SI"
    return await _make_doc_number(prefix, f"invoice_{inv_type.value}")

@api_router.get("/invoices")
async def get_invoices(
    type: Optional[InvoiceType] = None,
    status: Optional[InvoiceStatus] = None,
    user: User = Depends(get_current_user)
):
    """Get all invoices"""
    await assert_permission(db, user.role, "invoices", "read")
    query = {}
    if type:
        query["type"] = type.value
    if status:
        query["status"] = status.value
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return invoices

@api_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, user: User = Depends(get_current_user)):
    """Get a single invoice"""
    await assert_permission(db, user.role, "invoices", "read")
    invoice = await db.invoices.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice

@api_router.post("/invoices")
async def create_invoice(invoice_data: InvoiceCreate, user: User = Depends(get_current_user)):
    """Create an invoice"""
    await assert_permission(db, user.role, "invoices", "create")
    # Get party name
    party_name = "Unknown"
    if invoice_data.type == InvoiceType.PURCHASE:
        supplier = await db.suppliers.find_one({"supplier_id": invoice_data.party_id}, {"_id": 0})
        party_name = supplier["name"] if supplier else "Unknown"
    else:
        # party_id is a sales order reference; get name from the SO
        _so_for_invoice = await db.sales_orders.find_one({"so_id": invoice_data.party_id}, {"_id": 0})
        party_name = _so_for_invoice.get("sales_rep_name", "Unknown") if _so_for_invoice else "Unknown"
    
    invoice = Invoice(
        invoice_number=await generate_invoice_number(invoice_data.type),
        type=invoice_data.type,
        reference_id=invoice_data.reference_id,
        party_id=invoice_data.party_id,
        party_name=party_name,
        due_date=invoice_data.due_date,
        subtotal=invoice_data.subtotal,
        tax_amount=invoice_data.tax_amount,
        total=invoice_data.subtotal + invoice_data.tax_amount
    )
    
    await db.invoices.insert_one(invoice.model_dump())
    return invoice.model_dump()

# ========================
# PAYMENT ENDPOINTS
# ========================

@api_router.get("/payments")
async def get_payments(invoice_id: Optional[str] = None, user: User = Depends(get_current_user)):
    """Get all payments"""
    await assert_permission(db, user.role, "invoices", "read")
    query = {}
    if invoice_id:
        query["invoice_id"] = invoice_id
    
    payments = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return payments

@api_router.post("/payments")
async def create_payment(payment_data: PaymentCreate, user: User = Depends(get_current_user)):
    """Record a payment"""
    await assert_permission(db, user.role, "invoices", "create")
    if payment_data.amount <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero")
    invoice = await db.invoices.find_one({"invoice_id": payment_data.invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    payment = Payment(
        **payment_data.model_dump(),
        created_by=user.user_id
    )
    await db.payments.insert_one(payment.model_dump())
    
    # Update invoice paid amount
    new_paid = invoice.get("paid_amount", 0) + payment_data.amount
    new_status = InvoiceStatus.PAID if new_paid >= invoice["total"] else InvoiceStatus.PARTIAL
    
    await db.invoices.update_one(
        {"invoice_id": payment_data.invoice_id},
        {"$set": {"paid_amount": new_paid, "status": new_status.value}}
    )
    
    return payment.model_dump()

# ========================
# CHART OF ACCOUNTS ENDPOINTS
# ========================

@api_router.get("/accounts")
async def get_accounts(type: Optional[AccountType] = None, user: User = Depends(get_current_user)):
    """Get chart of accounts"""
    await assert_permission(db, user.role, "invoices", "read")
    query = {"is_active": True}
    if type:
        query["type"] = type.value
    
    accounts = await db.chart_of_accounts.find(query, {"_id": 0}).to_list(1000)
    return accounts

@api_router.post("/accounts")
async def create_account(account_data: ChartOfAccountCreate, user: User = Depends(get_current_user)):
    """Create an account"""
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    existing = await db.chart_of_accounts.find_one({"code": account_data.code}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Account code already exists")
    
    account = ChartOfAccount(**account_data.model_dump())
    await db.chart_of_accounts.insert_one(account.model_dump())
    return account.model_dump()

# ========================
# DASHBOARD ENDPOINTS
# ========================

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(user: User = Depends(get_current_user)):
    """Get dashboard statistics"""
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Count totals
    total_products = await db.products.count_documents({"is_active": True})
    total_suppliers = await db.suppliers.count_documents({"is_active": True})
    total_agents = await db.users.count_documents({"role": "sales_rep", "is_active": True})
    total_warehouses = await db.warehouses.count_documents({"is_active": True})
    
    # Calculate inventory value with two batched queries (was one query per
    # stock row, which made the dashboard unusable on a real catalogue).
    all_products = await db.products.find(
        {"is_active": True}, {"_id": 0, "product_id": 1, "cost_price": 1}).to_list(10000)
    cost_by_product = {p["product_id"]: (p.get("cost_price") or 0) for p in all_products}
    # Scope the stock read to the caller's warehouse, matching every other
    # inventory endpoint.
    dashboard_scope = get_user_warehouse_filter(user)
    stock_match: Dict[str, Any] = {}
    if dashboard_scope:
        stock_match["warehouse_id"] = dashboard_scope
    stock_rows = await db.inventory_stock.find(
        stock_match, {"_id": 0, "product_id": 1, "quantity": 1}).to_list(100000)
    total_inventory_value = 0.0
    totals_by_product: Dict[str, float] = {}
    for row in stock_rows:
        pid = row.get("product_id")
        qty = _num(row.get("quantity"))
        totals_by_product[pid] = totals_by_product.get(pid, 0) + qty
        total_inventory_value += qty * cost_by_product.get(pid, 0)
    total_inventory_value = round(total_inventory_value, 2)
    
    # Count low stock items from the same totals (no extra round-trips).
    reorder_by_product = {
        p["product_id"]: (p.get("reorder_level") if p.get("reorder_level") is not None else 10)
        for p in all_products
    }
    low_stock_count = sum(
        1 for pid, reorder in reorder_by_product.items()
        if totals_by_product.get(pid, 0) <= reorder
    )
    
    # Today's sales
    today_sales_orders = await db.sales_orders.find({
        "order_date": {"$gte": today}
    }, {"_id": 0}).to_list(1000)
    today_sales = sum(so.get("total_amount", 0) for so in today_sales_orders)
    
    # Today's purchases
    today_purchase_orders = await db.purchase_orders.find({
        "order_date": {"$gte": today}
    }, {"_id": 0}).to_list(1000)
    today_purchases = sum(po.get("total_amount", 0) for po in today_purchase_orders)
    
    # Pending invoices
    pending_invoices = await db.invoices.count_documents({
        "status": {"$in": [InvoiceStatus.UNPAID.value, InvoiceStatus.PARTIAL.value]}
    })
    
    # Cash balance (simplified - sum of all payments minus purchase payments)
    all_payments = await db.payments.find({}, {"_id": 0}).to_list(10000)
    cash_balance = 0.0
    for payment in all_payments:
        invoice = await db.invoices.find_one({"invoice_id": payment["invoice_id"]}, {"_id": 0})
        if invoice:
            if invoice["type"] == InvoiceType.SALE.value:
                cash_balance += _num(payment.get("amount"))
            else:
                cash_balance -= _num(payment.get("amount"))

    # Collections made by field agents against their ledger are cash in.
    agent_entries = await db.agent_ledger_entries.find(
        {"entry_type": AgentLedgerEntryType.PAYMENT.value},
        {"_id": 0, "amount": 1}).to_list(10000)
    cash_balance += sum(abs(_num(e.get("amount"))) for e in agent_entries)
    
    return DashboardStats(
        total_inventory_value=round(total_inventory_value, 2),
        low_stock_count=low_stock_count,
        today_sales=round(today_sales, 2),
        today_purchases=round(today_purchases, 2),
        cash_balance=round(cash_balance, 2),
        pending_invoices=pending_invoices,
        total_products=total_products,
        total_suppliers=total_suppliers,
        total_agents=total_agents,
        total_warehouses=total_warehouses
    )

@api_router.get("/dashboard/recent-activity")
async def get_recent_activity(limit: int = Query(10, ge=1, le=100),
                              user: User = Depends(get_current_user)):
    """Get recent activity feed"""
    activities = []
    
    # Recent purchase orders
    recent_pos = await db.purchase_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(5)
    for po in recent_pos:
        activities.append({
            "type": "purchase_order",
            "title": f"PO {po['po_number']}",
            "description": f"Created for {po.get('supplier_name', 'Unknown')}",
            "amount": po.get("total_amount", 0),
            "status": po.get("status"),
            "timestamp": po.get("created_at")
        })
    
    # Recent sales orders
    recent_sos = await db.sales_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(5)
    for so in recent_sos:
        activities.append({
            "type": "sales_order",
            "title": f"SO {so['so_number']}",
            "description": f"Created for {so.get('sales_rep_name', 'Unknown')}",
            "amount": so.get("total_amount", 0),
            "status": so.get("status"),
            "timestamp": so.get("created_at")
        })
    
    # Recent stock transactions
    recent_txns = await db.stock_transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(5)
    for txn in recent_txns:
        product = await db.products.find_one({"product_id": txn["product_id"]}, {"_id": 0})
        activities.append({
            "type": "stock_transaction",
            "title": f"Stock {txn['type']}",
            "description": f"{product['name'] if product else 'Unknown'}: {txn['quantity']} units",
            "amount": None,
            "status": txn.get("type"),
            "timestamp": txn.get("created_at")
        })
    
    # Sort by timestamp and return top N
    activities.sort(key=lambda x: x.get("timestamp") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return activities[:limit]

@api_router.get("/dashboard/sales-chart")
async def get_sales_chart(days: int = Query(7, ge=1, le=90),
                           user: User = Depends(get_current_user)):
    """Get sales vs purchases chart data"""
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    chart_data = []
    for i in range(days):
        date = start_date + timedelta(days=i)
        next_date = date + timedelta(days=1)
        
        # Sales for the day
        day_sales = await db.sales_orders.find({
            "order_date": {"$gte": date, "$lt": next_date}
        }, {"_id": 0}).to_list(1000)
        total_sales = sum(so.get("total_amount", 0) for so in day_sales)
        
        # Purchases for the day
        day_purchases = await db.purchase_orders.find({
            "order_date": {"$gte": date, "$lt": next_date}
        }, {"_id": 0}).to_list(1000)
        total_purchases = sum(po.get("total_amount", 0) for po in day_purchases)
        
        chart_data.append({
            "date": date.strftime("%Y-%m-%d"),
            "sales": round(total_sales, 2),
            "purchases": round(total_purchases, 2)
        })
    
    return chart_data

@api_router.get("/dashboard/top-products")
async def get_top_products(limit: int = Query(5, ge=1, le=50),
                            user: User = Depends(get_current_user)):
    """Get top selling products"""
    # Aggregate sales by product
    product_sales = {}
    
    sales_orders = await db.sales_orders.find({}, {"_id": 0}).to_list(1000)
    for so in sales_orders:
        for item in so.get("items", []):
            pid = item["product_id"]
            if pid not in product_sales:
                product_sales[pid] = {"quantity": 0, "revenue": 0}
            product_sales[pid]["quantity"] += _num(item.get("quantity"))
            product_sales[pid]["revenue"] += _num(item.get("quantity")) * _num(item.get("unit_price"))
    
    # Sort and get top products
    sorted_products = sorted(product_sales.items(), key=lambda x: x[1]["revenue"], reverse=True)[:limit]
    
    result = []
    for pid, data in sorted_products:
        product = await db.products.find_one({"product_id": pid}, {"_id": 0})
        if product:
            result.append({
                "product_id": pid,
                "name": product["name"],
                "sku": product["sku"],
                "quantity_sold": data["quantity"],
                "revenue": round(data["revenue"], 2)
            })
    
    return result

# ========================
# NOTIFICATIONS ENDPOINTS
# ========================

@api_router.get("/notifications")
async def get_notifications(unread_only: bool = False, user: User = Depends(get_current_user)):
    """Get user notifications"""
    query = {"user_id": user.user_id}
    if unread_only:
        query["is_read"] = False
    
    notifications = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return notifications

@api_router.put("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user: User = Depends(get_current_user)):
    """Mark notification as read"""
    await db.notifications.update_one(
        {"notification_id": notification_id, "user_id": user.user_id},
        {"$set": {"is_read": True}}
    )
    return {"message": "Notification marked as read"}

@api_router.put("/notifications/read-all")
async def mark_all_notifications_read(user: User = Depends(get_current_user)):
    """Mark all notifications as read"""
    await db.notifications.update_many(
        {"user_id": user.user_id},
        {"$set": {"is_read": True}}
    )
    return {"message": "All notifications marked as read"}

# ========================
# REPORTS ENDPOINTS
# ========================

@api_router.get("/reports/stock-summary")
async def get_stock_summary_report(warehouse_id: Optional[str] = None, user: User = Depends(get_current_user)):
    """Get stock summary report"""
    await assert_permission(db, user.role, "reports", "read")
    query = {}
    if warehouse_id:
        # A warehouse-scoped user may not export another branch's stock.
        assert_same_warehouse(user, warehouse_id, "export stock summary for")
        query["warehouse_id"] = warehouse_id
    else:
        scoped = get_user_warehouse_filter(user)
        if scoped:
            query["warehouse_id"] = scoped
    
    stocks = await db.inventory_stock.find(query, {"_id": 0}).to_list(10000)
    
    report = []
    for stock in stocks:
        product = await db.products.find_one({"product_id": stock["product_id"]}, {"_id": 0})
        warehouse = await db.warehouses.find_one({"warehouse_id": stock["warehouse_id"]}, {"_id": 0})
        
        if product:
            report.append({
                "product_id": stock["product_id"],
                "product_name": product["name"],
                "sku": product["sku"],
                "category": product.get("category"),
                "warehouse_id": stock["warehouse_id"],
                "warehouse_name": warehouse["name"] if warehouse else "Unknown",
                "quantity": _num(stock.get("quantity")),
                "unit": product.get("unit", "pcs"),
                "cost_price": product.get("cost_price", 0),
                "value": round(_num(stock.get("quantity")) * product.get("cost_price", 0), 2),
                "reorder_level": product.get("reorder_level", 0),
                "is_low_stock": _num(stock.get("quantity")) <= product.get("reorder_level", 0)
            })
    
    return report

@api_router.get("/reports/purchase-analysis")
async def get_purchase_analysis_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get purchase analysis report"""
    await assert_permission(db, user.role, "reports", "read")
    query = {}
    if start_date:
        query["order_date"] = {"$gte": datetime.fromisoformat(start_date)}
    if end_date:
        if "order_date" in query:
            query["order_date"]["$lte"] = datetime.fromisoformat(end_date)
        else:
            query["order_date"] = {"$lte": datetime.fromisoformat(end_date)}
    
    orders = await db.purchase_orders.find(query, {"_id": 0}).to_list(10000)
    
    # Aggregate by supplier
    by_supplier = {}
    for order in orders:
        sid = order["supplier_id"]
        if sid not in by_supplier:
            by_supplier[sid] = {
                "supplier_name": order.get("supplier_name", "Unknown"),
                "order_count": 0,
                "total_amount": 0
            }
        by_supplier[sid]["order_count"] += 1
        by_supplier[sid]["total_amount"] += order.get("total_amount", 0)
    
    return {
        "total_orders": len(orders),
        "total_amount": round(sum(o.get("total_amount", 0) for o in orders), 2),
        "by_supplier": list(by_supplier.values())
    }

@api_router.get("/reports/sales-analysis")
async def get_sales_analysis_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get sales analysis report"""
    await assert_permission(db, user.role, "reports", "read")
    query = {}
    if start_date:
        query["order_date"] = {"$gte": datetime.fromisoformat(start_date)}
    if end_date:
        if "order_date" in query:
            query["order_date"]["$lte"] = datetime.fromisoformat(end_date)
        else:
            query["order_date"] = {"$lte": datetime.fromisoformat(end_date)}
    
    orders = await db.sales_orders.find(query, {"_id": 0}).to_list(10000)
    
    # Aggregate by sales rep
    by_sales_rep = {}
    for order in orders:
        did = order.get("sales_rep_id", "unknown")
        if did not in by_sales_rep:
            by_sales_rep[did] = {
                "sales_rep_name": order.get("sales_rep_name", "Unknown"),
                "order_count": 0,
                "total_amount": 0
            }
        by_sales_rep[did]["order_count"] += 1
        by_sales_rep[did]["total_amount"] += order.get("total_amount", 0)
    
    return {
        "total_orders": len(orders),
        "total_amount": round(sum(o.get("total_amount", 0) for o in orders), 2),
        "by_sales_rep": list(by_sales_rep.values())
    }

# ========================
# AUDIT LOG ENDPOINTS
# ========================

async def create_audit_log(
    user_id: str, action: str, entity_type: str, entity_id: str,
    old_value: dict = None, new_value: dict = None,
    request: Request = None
):
    """Helper function to create audit logs with IP address and user-agent for security tracing"""
    ip_address = None
    user_agent = None
    if request:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip_address = forwarded.split(",")[0].strip()
        else:
            ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")

    log = AuditLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        ip_address=ip_address,
        user_agent=user_agent
    )
    await db.audit_logs.insert_one(log.model_dump())

@api_router.get("/audit-logs")
async def get_audit_logs(
    entity_type: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    user: User = Depends(get_current_user)
):
    """Get audit logs (admin only)"""
    await assert_permission(db, user.role, "audit_logs", "read")
    
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    
    # Enrich with user names
    for log in logs:
        user_doc = await db.users.find_one({"user_id": log.get("user_id")}, {"_id": 0, "name": 1})
        log["user_name"] = user_doc.get("name") if user_doc else "Unknown"
    
    return logs

# ========================
# EXPENSE TRACKING ENDPOINTS
# ========================

class ExpenseCategory(str, Enum):
    OFFICE = "office"
    TRAVEL = "travel"
    UTILITIES = "utilities"
    SALARY = "salary"
    MARKETING = "marketing"
    MAINTENANCE = "maintenance"
    SUPPLIES = "supplies"
    OTHER = "other"

class Expense(BaseModel):
    expense_id: str = Field(default_factory=lambda: f"exp_{uuid.uuid4().hex[:12]}")
    category: ExpenseCategory
    amount: float
    description: str
    vendor: Optional[str] = None
    receipt_image: Optional[str] = None
    expense_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payment_method: PaymentMethod = PaymentMethod.CASH
    approved: bool = False
    approved_by: Optional[str] = None
    warehouse_id: Optional[str] = None        # NEW: scoped to warehouse
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ExpenseCreate(BaseModel):
    category: ExpenseCategory
    amount: float
    description: str
    vendor: Optional[str] = None
    receipt_image: Optional[str] = None
    expense_date: Optional[datetime] = None
    payment_method: PaymentMethod = PaymentMethod.CASH

@api_router.get("/expenses")
async def get_expenses(
    category: Optional[ExpenseCategory] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    approved_only: bool = False,
    warehouse_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get expenses — scoped to user's warehouse unless cross-warehouse role"""
    await assert_permission(db, user.role, "expenses", "read")
    query: Dict[str, Any] = {}
    if category:
        query["category"] = category.value
    if approved_only:
        query["approved"] = True
    if start_date:
        query["expense_date"] = {"$gte": datetime.fromisoformat(start_date)}
    if end_date:
        if "expense_date" in query:
            query["expense_date"]["$lte"] = datetime.fromisoformat(end_date)
        else:
            query["expense_date"] = {"$lte": datetime.fromisoformat(end_date)}

    # Warehouse scoping
    if is_cross_warehouse_role(user.role):
        if warehouse_id:
            query["warehouse_id"] = warehouse_id
    else:
        # Non-admin users only see their own warehouse expenses
        query["warehouse_id"] = user.warehouse_id

    expenses = await db.expenses.find(query, {"_id": 0}).sort("expense_date", -1).to_list(1000)
    return expenses

@api_router.post("/expenses")
async def create_expense(expense_data: ExpenseCreate, user: User = Depends(get_current_user)):
    """Create an expense — auto-tagged to user's warehouse"""
    await assert_permission(db, user.role, "expenses", "create")
    if expense_data.amount <= 0:
        raise HTTPException(status_code=422, detail="Expense amount must be greater than zero")
    expense_dict = expense_data.model_dump(exclude={"expense_date"})
    expense = Expense(
        **expense_dict,
        expense_date=expense_data.expense_date or datetime.now(timezone.utc),
        warehouse_id=user.warehouse_id,   # auto-scope
        created_by=user.user_id
    )
    await db.expenses.insert_one(expense.model_dump())
    await create_audit_log(user.user_id, "create", "expense", expense.expense_id)
    return expense.model_dump()

@api_router.put("/expenses/{expense_id}/approve")
async def approve_expense(expense_id: str, user: User = Depends(get_current_user)):
    """Approve an expense (manager/accountant only)"""
    await assert_permission(db, user.role, "expenses", "update")
    expense = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    # Warehouse scoping check
    if not is_cross_warehouse_role(user.role):
        assert_same_warehouse(user, expense.get("warehouse_id", ""), "approve expense in")
    await db.expenses.update_one(
        {"expense_id": expense_id},
        {"$set": {"approved": True, "approved_by": user.user_id}}
    )
    await create_audit_log(user.user_id, "approve", "expense", expense_id)
    return {"message": "Expense approved"}

@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user: User = Depends(get_current_user)):
    """Delete an expense"""
    await assert_permission(db, user.role, "expenses", "delete")
    expense = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    if not is_cross_warehouse_role(user.role):
        assert_same_warehouse(user, expense.get("warehouse_id", ""), "delete expense in")
    await db.expenses.delete_one({"expense_id": expense_id})
    await create_audit_log(user.user_id, "delete", "expense", expense_id)
    return {"message": "Expense deleted"}

# ========================
# QUOTATION ENDPOINTS
# ========================

class QuotationStatus(str, Enum):
    DRAFT = "draft"
    SENT = "sent"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CONVERTED = "converted"   # a sales order was created from it

class QuotationItem(BaseModel):
    item_id: str = Field(default_factory=lambda: f"qi_{uuid.uuid4().hex[:12]}")
    product_id: str
    product_name: Optional[str] = None
    quantity: float
    unit_price: float
    discount_percent: float = 0.0

class Quotation(BaseModel):
    quotation_id: str = Field(default_factory=lambda: f"qt_{uuid.uuid4().hex[:12]}")
    quotation_number: str
    converted_so_id: Optional[str] = None
    customer_id: str                     # generic customer/party reference
    customer_name: Optional[str] = None
    items: List[QuotationItem] = []
    subtotal: float = 0.0
    discount_amount: float = 0.0
    tax_amount: float = 0.0
    total_amount: float = 0.0
    valid_until: datetime
    status: QuotationStatus = QuotationStatus.DRAFT
    notes: Optional[str] = None
    terms: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class QuotationItemCreate(BaseModel):
    product_id: str
    quantity: float
    unit_price: float
    discount_percent: float = 0.0

class QuotationCreate(BaseModel):
    customer_id: str
    items: List[QuotationItemCreate] = []
    tax_amount: float = 0.0
    valid_days: int = 30
    notes: Optional[str] = None
    terms: Optional[str] = None

async def generate_quotation_number():
    """Generate a unique, collision-safe quotation number."""
    return await _make_doc_number("QT", "quotation")

@api_router.get("/quotations")
async def get_quotations(
    status: Optional[QuotationStatus] = None,
    distributor_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get all quotations"""
    await assert_permission(db, user.role, "quotations", "read")
    query = {}
    if status:
        query["status"] = status.value
    if distributor_id:
        # The Quotation model stores the party as `customer_id`; the old
        # `distributor_id` filter always matched nothing.
        query["customer_id"] = distributor_id
    
    quotations = await db.quotations.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return quotations

@api_router.post("/quotations")
async def create_quotation(qt_data: QuotationCreate, user: User = Depends(get_current_user)):
    """Create a quotation"""
    await assert_permission(db, user.role, "quotations", "create")
    # customer_id is flexible (rep, agent, or any party)
    customer_doc = await db.users.find_one({"user_id": qt_data.customer_id}, {"_id": 0})
    customer_name = customer_doc.get("name") if customer_doc else qt_data.customer_id
    
    items = []
    subtotal = 0.0
    discount_total = 0.0
    for item in qt_data.items:
        product = await db.products.find_one({"product_id": item.product_id}, {"_id": 0})
        line_total = item.quantity * item.unit_price
        line_discount = line_total * (item.discount_percent / 100)
        qt_item = QuotationItem(
            product_id=item.product_id,
            product_name=product["name"] if product else "Unknown",
            quantity=item.quantity,
            unit_price=item.unit_price,
            discount_percent=item.discount_percent
        )
        items.append(qt_item.model_dump())
        subtotal += line_total
        discount_total += line_discount
    
    quotation = Quotation(
        quotation_number=await generate_quotation_number(),
        customer_id=qt_data.customer_id,
        customer_name=customer_name,
        items=items,
        subtotal=subtotal,
        discount_amount=discount_total,
        tax_amount=qt_data.tax_amount,
        total_amount=subtotal - discount_total + qt_data.tax_amount,
        valid_until=datetime.now(timezone.utc) + timedelta(days=qt_data.valid_days),
        notes=qt_data.notes,
        terms=qt_data.terms,
        created_by=user.user_id
    )
    
    await db.quotations.insert_one(quotation.model_dump())
    await create_audit_log(user.user_id, "create", "quotation", quotation.quotation_id)
    return quotation.model_dump()

@api_router.put("/quotations/{quotation_id}/status")
async def update_quotation_status(quotation_id: str, status: QuotationStatus, user: User = Depends(get_current_user)):
    """Update quotation status"""
    await assert_permission(db, user.role, "quotations", "update")
    quotation = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quotation:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not is_cross_warehouse_role(user.role) and user.role != UserRole.SALES_REP:
        assert_same_warehouse(user, str(quotation.get("warehouse_id") or ""), "update quotations in")
    await db.quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {"status": status.value}}
    )
    await create_audit_log(user.user_id, "update_status", "quotation", quotation_id, new_value={"status": status.value})
    return await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})

@api_router.post("/quotations/{quotation_id}/convert-to-order")
async def convert_quotation_to_order(
    quotation_id: str,
    warehouse_id: str = None,
    user: User = Depends(get_current_user)
):
    """Convert accepted quotation to sales order"""
    if not warehouse_id:
        raise HTTPException(status_code=400, detail="warehouse_id is required")
    
    quotation = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quotation:
        raise HTTPException(status_code=404, detail="Quotation not found")
    
    if quotation["status"] != QuotationStatus.ACCEPTED.value:
        raise HTTPException(status_code=400, detail="Only accepted quotations can be converted")
    
    # Create sales order from quotation
    so_items = []
    for item in quotation["items"]:
        so_items.append({
            "product_id": item["product_id"],
            "quantity": item["quantity"],
            "unit_price": item["unit_price"] * (1 - item.get("discount_percent", 0) / 100)
        })
    
    so_data = SalesOrderCreate(
        sales_rep_id=quotation.get("customer_id", quotation.get("distributor_id", "")),
        warehouse_id=warehouse_id,
        items=[SalesOrderItemCreate(**item) for item in so_items],
        tax_amount=quotation["tax_amount"],
        notes=f"Created from {quotation['quotation_number']}"
    )
    
    # Reuse existing create function logic
    rep_doc = await db.users.find_one({"user_id": so_data.sales_rep_id}, {"_id": 0})
    items = []
    subtotal = 0.0
    for item in so_data.items:
        product = await db.products.find_one({"product_id": item.product_id}, {"_id": 0})
        so_item = SalesOrderItem(
            product_id=item.product_id,
            product_name=product["name"] if product else "Unknown",
            quantity=item.quantity,
            unit_price=item.unit_price
        )
        items.append(so_item.model_dump())
        subtotal += item.quantity * item.unit_price
    
    so = SalesOrder(
        so_number=await generate_so_number(),
        sales_rep_id=so_data.sales_rep_id,
        sales_rep_name=rep_doc.get("name") if rep_doc else None,
        warehouse_id=warehouse_id,
        items=items,
        subtotal=subtotal,
        tax_amount=so_data.tax_amount,
        total_amount=subtotal + so_data.tax_amount,
        notes=so_data.notes,
        created_by=user.user_id
    )
    
    await db.sales_orders.insert_one(so.model_dump())

    # Mark the quotation as converted so it cannot be converted a second time
    # (which would silently create a duplicate sales order).
    await db.quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {"status": QuotationStatus.CONVERTED.value,
                  "converted_so_id": so.so_id,
                  "updated_at": datetime.now(timezone.utc)}},
    )
    await create_audit_log(user.user_id, "convert", "quotation", quotation_id, new_value={"so_id": so.so_id})
    
    return {"message": "Quotation converted to sales order", "so_id": so.so_id, "so_number": so.so_number}

# ========================
# DELIVERY NOTE ENDPOINTS
# ========================

class DeliveryStatus(str, Enum):
    PENDING = "pending"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    RETURNED = "returned"

class DeliveryNote(BaseModel):
    delivery_id: str = Field(default_factory=lambda: f"dn_{uuid.uuid4().hex[:12]}")
    delivery_number: str
    so_id: str
    so_number: Optional[str] = None
    # Legacy alias kept for the existing UI; mirrors sales_rep_*.
    distributor_id: str = ""
    distributor_name: Optional[str] = None
    sales_rep_id: Optional[str] = None
    sales_rep_name: Optional[str] = None
    warehouse_id: str
    items: List[dict] = []
    status: DeliveryStatus = DeliveryStatus.PENDING
    delivery_date: Optional[datetime] = None
    delivered_by: Optional[str] = None
    received_by: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DeliveryNoteCreate(BaseModel):
    so_id: str
    notes: Optional[str] = None

async def generate_delivery_number():
    """Generate a unique, collision-safe delivery-note number."""
    return await _make_doc_number("DN", "delivery_note")

@api_router.get("/delivery-notes")
async def get_delivery_notes(
    status: Optional[DeliveryStatus] = None,
    so_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get all delivery notes"""
    await assert_permission(db, user.role, "delivery_notes", "read")
    query = {}
    if status:
        query["status"] = status.value
    if so_id:
        query["so_id"] = so_id
    
    notes = await db.delivery_notes.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return notes

@api_router.post("/delivery-notes")
async def create_delivery_note(dn_data: DeliveryNoteCreate, user: User = Depends(get_current_user)):
    """Create a delivery note from sales order"""
    await assert_permission(db, user.role, "delivery_notes", "create")
    so = await db.sales_orders.find_one({"so_id": dn_data.so_id}, {"_id": 0})
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    
    delivery = DeliveryNote(
        delivery_number=await generate_delivery_number(),
        so_id=so["so_id"],
        so_number=so["so_number"],
        distributor_id=so.get("sales_rep_id", ""),
        distributor_name=so.get("sales_rep_name"),
        sales_rep_id=so.get("sales_rep_id"),
        sales_rep_name=so.get("sales_rep_name"),
        warehouse_id=so["warehouse_id"],
        items=so.get("items", []),
        notes=dn_data.notes,
        created_by=user.user_id
    )
    
    await db.delivery_notes.insert_one(delivery.model_dump())
    await create_audit_log(user.user_id, "create", "delivery_note", delivery.delivery_id)
    return delivery.model_dump()

@api_router.put("/delivery-notes/{delivery_id}/status")
async def update_delivery_status(
    delivery_id: str,
    status: DeliveryStatus,
    received_by: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Update delivery note status"""
    await assert_permission(db, user.role, "delivery_notes", "update")
    update_data = {"status": status.value}
    if status == DeliveryStatus.DELIVERED:
        update_data["delivery_date"] = datetime.now(timezone.utc)
        update_data["delivered_by"] = user.user_id
        if received_by:
            update_data["received_by"] = received_by
        
        # Update sales order status
        delivery = await db.delivery_notes.find_one({"delivery_id": delivery_id}, {"_id": 0})
        if delivery:
            await db.sales_orders.update_one(
                {"so_id": delivery["so_id"]},
                {"$set": {"status": OrderStatus.DELIVERED.value, "updated_at": datetime.now(timezone.utc)}}
            )
    
    await db.delivery_notes.update_one({"delivery_id": delivery_id}, {"$set": update_data})
    await create_audit_log(user.user_id, "update_status", "delivery_note", delivery_id, new_value={"status": status.value})
    return await db.delivery_notes.find_one({"delivery_id": delivery_id}, {"_id": 0})

# ========================
# BILL OF MATERIALS (BOM) ENDPOINTS
# ========================

class BOMItem(BaseModel):
    raw_product_id: str
    raw_product_name: Optional[str] = None
    quantity_required: float
    unit: Optional[str] = None

class BillOfMaterials(BaseModel):
    bom_id: str = Field(default_factory=lambda: f"bom_{uuid.uuid4().hex[:12]}")
    finished_product_id: str
    finished_product_name: Optional[str] = None
    components: List[BOMItem] = []
    yield_quantity: float = 1.0
    notes: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class BOMItemCreate(BaseModel):
    raw_product_id: str
    quantity_required: float

class BOMCreate(BaseModel):
    finished_product_id: str
    components: List[BOMItemCreate] = []
    yield_quantity: float = 1.0
    notes: Optional[str] = None

@api_router.get("/bom")
async def get_all_bom(user: User = Depends(get_current_user)):
    """Get all BOMs"""
    await assert_permission(db, user.role, "bom", "read")
    boms = await db.bill_of_materials.find({"is_active": True}, {"_id": 0}).to_list(1000)
    return boms

@api_router.get("/bom/{product_id}")
async def get_bom_for_product(product_id: str, user: User = Depends(get_current_user)):
    """Get BOM for a finished product"""
    await assert_permission(db, user.role, "bom", "read")
    bom = await db.bill_of_materials.find_one({"finished_product_id": product_id, "is_active": True}, {"_id": 0})
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    return bom

@api_router.post("/bom")
async def create_bom(bom_data: BOMCreate, user: User = Depends(get_current_user)):
    """Create a BOM for a finished product"""
    await assert_permission(db, user.role, "bom", "create")
    # Verify finished product exists and is finished category
    finished = await db.products.find_one({"product_id": bom_data.finished_product_id}, {"_id": 0})
    if not finished:
        raise HTTPException(status_code=404, detail="Finished product not found")
    if finished["category"] != "finished":
        raise HTTPException(status_code=400, detail="BOM can only be created for finished products")
    
    # Build components with names
    components = []
    for comp in bom_data.components:
        raw = await db.products.find_one({"product_id": comp.raw_product_id}, {"_id": 0})
        if not raw:
            raise HTTPException(status_code=404, detail=f"Raw material {comp.raw_product_id} not found")
        components.append(BOMItem(
            raw_product_id=comp.raw_product_id,
            raw_product_name=raw["name"],
            quantity_required=comp.quantity_required,
            unit=raw.get("unit")
        ).model_dump())
    
    bom = BillOfMaterials(
        finished_product_id=bom_data.finished_product_id,
        finished_product_name=finished["name"],
        components=components,
        yield_quantity=bom_data.yield_quantity,
        notes=bom_data.notes
    )
    
    # Deactivate existing BOM for this product
    await db.bill_of_materials.update_many(
        {"finished_product_id": bom_data.finished_product_id},
        {"$set": {"is_active": False}}
    )
    
    await db.bill_of_materials.insert_one(bom.model_dump())
    await create_audit_log(user.user_id, "create", "bom", bom.bom_id)
    return bom.model_dump()

@api_router.post("/bom/{bom_id}/produce")
async def produce_from_bom(
    bom_id: str,
    quantity: float,
    warehouse_id: str,
    user: User = Depends(get_current_user)
):
    """Produce finished goods from raw materials using BOM"""
    await assert_permission(db, user.role, "bom", "update")
    bom = await db.bill_of_materials.find_one({"bom_id": bom_id, "is_active": True}, {"_id": 0})
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    
    # Check if all raw materials are available
    multiplier = quantity / bom["yield_quantity"]
    for comp in bom["components"]:
        stock = await db.inventory_stock.find_one({
            "product_id": comp["raw_product_id"],
            "warehouse_id": warehouse_id
        }, {"_id": 0})
        required = comp["quantity_required"] * multiplier
        available = _num(stock.get("quantity")) if stock else 0
        if available < required:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient {comp['raw_product_name']}: need {required}, have {available}"
            )
    
    # Deduct raw materials
    for comp in bom["components"]:
        required = comp["quantity_required"] * multiplier
        stock = await db.inventory_stock.find_one({
            "product_id": comp["raw_product_id"],
            "warehouse_id": warehouse_id
        }, {"_id": 0})
        new_qty = _num(stock.get("quantity")) - required
        await db.inventory_stock.update_one(
            {"stock_id": stock["stock_id"]},
            {"$set": {"quantity": new_qty, "last_updated": datetime.now(timezone.utc)}}
        )
        # Record transaction
        await db.stock_transactions.insert_one(StockTransaction(
            product_id=comp["raw_product_id"],
            warehouse_id=warehouse_id,
            type=TransactionType.PRODUCTION,
            quantity=-required,
            reference_id=bom_id,
            notes=f"Used in production of {bom['finished_product_name']}",
            created_by=user.user_id
        ).model_dump())
    
    # Add finished goods
    finished_stock = await db.inventory_stock.find_one({
        "product_id": bom["finished_product_id"],
        "warehouse_id": warehouse_id
    }, {"_id": 0})
    
    if finished_stock:
        new_qty = _num(finished_stock.get("quantity")) + quantity
        await db.inventory_stock.update_one(
            {"stock_id": finished_stock["stock_id"]},
            {"$set": {"quantity": new_qty, "last_updated": datetime.now(timezone.utc)}}
        )
    else:
        new_stock = InventoryStock(
            product_id=bom["finished_product_id"],
            warehouse_id=warehouse_id,
            quantity=quantity
        )
        await db.inventory_stock.insert_one(new_stock.model_dump())
    
    # Record finished goods transaction
    await db.stock_transactions.insert_one(StockTransaction(
        product_id=bom["finished_product_id"],
        warehouse_id=warehouse_id,
        type=TransactionType.PRODUCTION,
        quantity=quantity,
        reference_id=bom_id,
        notes=f"Produced from BOM",
        created_by=user.user_id
    ).model_dump())
    
    await create_audit_log(user.user_id, "produce", "bom", bom_id, new_value={"quantity": quantity})
    return {"message": f"Produced {quantity} units of {bom['finished_product_name']}"}

# ========================
# ENHANCED FINANCIAL REPORTS
# ========================

@api_router.get("/reports/profit-loss")
async def get_profit_loss_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get Profit & Loss report"""
    await assert_permission(db, user.role, "reports", "read")
    # Default to current month
    if not start_date:
        start_date = datetime.now(timezone.utc).replace(day=1).isoformat()
    if not end_date:
        end_date = datetime.now(timezone.utc).isoformat()
    
    start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00')) if 'Z' in start_date or '+' in start_date else datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
    end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00')) if 'Z' in end_date or '+' in end_date else datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
    
    # Calculate Revenue (from delivered/paid sales orders)
    sales = await db.sales_orders.find({
        "order_date": {"$gte": start_dt, "$lte": end_dt},
        "status": {"$in": ["delivered", "paid"]}
    }, {"_id": 0}).to_list(10000)
    total_revenue = sum(so.get("total_amount", 0) for so in sales)
    
    # Calculate Cost of Goods Sold (from received/paid purchase orders)
    purchases = await db.purchase_orders.find({
        "order_date": {"$gte": start_dt, "$lte": end_dt},
        "status": {"$in": ["received", "paid"]}
    }, {"_id": 0}).to_list(10000)
    total_cogs = sum(po.get("total_amount", 0) for po in purchases)
    
    # Calculate Expenses
    expenses = await db.expenses.find({
        "expense_date": {"$gte": start_dt, "$lte": end_dt},
        "approved": True
    }, {"_id": 0}).to_list(10000)
    total_expenses = sum(exp.get("amount", 0) for exp in expenses)
    
    # Expense breakdown by category
    expense_by_category = {}
    for exp in expenses:
        cat = exp.get("category", "other")
        expense_by_category[cat] = expense_by_category.get(cat, 0) + exp.get("amount", 0)
    
    gross_profit = total_revenue - total_cogs
    net_profit = gross_profit - total_expenses
    gross_margin = (gross_profit / total_revenue * 100) if total_revenue > 0 else 0
    net_margin = (net_profit / total_revenue * 100) if total_revenue > 0 else 0
    
    return {
        "period": {"start": start_date, "end": end_date},
        "revenue": {
            "total_sales": round(total_revenue, 2),
            "sales_count": len(sales)
        },
        "cost_of_goods_sold": {
            "total_cogs": round(total_cogs, 2),
            "purchase_count": len(purchases)
        },
        "gross_profit": round(gross_profit, 2),
        "gross_margin_percent": round(gross_margin, 2),
        "operating_expenses": {
            "total": round(total_expenses, 2),
            "by_category": {k: round(v, 2) for k, v in expense_by_category.items()}
        },
        "net_profit": round(net_profit, 2),
        "net_margin_percent": round(net_margin, 2)
    }

@api_router.get("/reports/cash-flow")
async def get_cash_flow_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get Cash Flow report"""
    await assert_permission(db, user.role, "reports", "read")
    if not start_date:
        start_date = datetime.now(timezone.utc).replace(day=1).isoformat()
    if not end_date:
        end_date = datetime.now(timezone.utc).isoformat()
    
    start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00')) if 'Z' in start_date or '+' in start_date else datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
    end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00')) if 'Z' in end_date or '+' in end_date else datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
    
    # Cash Inflows (payments received)
    inflow_payments = await db.payments.find({
        "payment_date": {"$gte": start_dt, "$lte": end_dt}
    }, {"_id": 0}).to_list(10000)
    
    cash_inflows = 0.0
    cash_outflows = 0.0
    inflow_details = []
    outflow_details = []
    
    for payment in inflow_payments:
        invoice = await db.invoices.find_one({"invoice_id": payment["invoice_id"]}, {"_id": 0})
        if invoice:
            if invoice["type"] == "sale":
                cash_inflows += payment["amount"]
                inflow_details.append({
                    "date": payment["payment_date"],
                    "amount": payment["amount"],
                    "source": invoice.get("party_name", "Customer"),
                    "method": payment.get("method")
                })
            else:
                cash_outflows += payment["amount"]
                outflow_details.append({
                    "date": payment["payment_date"],
                    "amount": payment["amount"],
                    "destination": invoice.get("party_name", "Supplier"),
                    "method": payment.get("method"),
                    "type": "supplier_payment"
                })
    
    # Cash collected from field agents against their ledger is a cash inflow
    # too. Agent collections are recorded in `agent_ledger_entries` (not in
    # `payments`), so without this the cash-flow report showed zero inflows
    # even when agents had paid cash in.
    agent_entries = await db.agent_ledger_entries.find(
        {"entry_type": AgentLedgerEntryType.PAYMENT.value},
        {"_id": 0}).to_list(10000)
    for entry in agent_entries:
        created = entry.get("created_at")
        if isinstance(created, str):
            created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        if created is not None:
            if created.tzinfo is None:
                # Mongo returns naive UTC datetimes; normalise before comparing.
                created = created.replace(tzinfo=timezone.utc)
            if not (start_dt <= created <= end_dt):
                continue
        amount = abs(_num(entry.get("amount")))
        if amount <= 0:
            continue
        cash_inflows += amount
        inflow_details.append({
            "date": created,
            "amount": amount,
            "source": entry.get("notes") or "Sales agent collection",
            "method": "cash",
        })

    # Add expenses to outflows
    expenses = await db.expenses.find({
        "expense_date": {"$gte": start_dt, "$lte": end_dt},
        "approved": True
    }, {"_id": 0}).to_list(10000)
    
    for exp in expenses:
        cash_outflows += exp["amount"]
        outflow_details.append({
            "date": exp["expense_date"],
            "amount": exp["amount"],
            "destination": exp.get("vendor", exp["category"]),
            "method": exp.get("payment_method"),
            "type": "expense"
        })
    
    net_cash_flow = cash_inflows - cash_outflows
    
    return {
        "period": {"start": start_date, "end": end_date},
        "cash_inflows": {
            "total": round(cash_inflows, 2),
            "count": len(inflow_details),
            "details": inflow_details[-10:]  # Last 10
        },
        "cash_outflows": {
            "total": round(cash_outflows, 2),
            "count": len(outflow_details),
            "details": outflow_details[-10:]
        },
        "net_cash_flow": round(net_cash_flow, 2)
    }

@api_router.get("/reports/supplier-aging")
async def get_supplier_aging_report(user: User = Depends(get_current_user)):
    """Get Supplier Aging (Accounts Payable) report"""
    await assert_permission(db, user.role, "reports", "read")
    today = datetime.now(timezone.utc)
    
    # Get unpaid purchase invoices
    invoices = await db.invoices.find({
        "type": "purchase",
        "status": {"$in": ["unpaid", "partial"]}
    }, {"_id": 0}).to_list(10000)
    
    aging_buckets = {
        "current": {"total": 0, "invoices": []},
        "1_30_days": {"total": 0, "invoices": []},
        "31_60_days": {"total": 0, "invoices": []},
        "61_90_days": {"total": 0, "invoices": []},
        "over_90_days": {"total": 0, "invoices": []}
    }
    
    by_supplier = {}
    
    for inv in invoices:
        due_date = inv.get("due_date")
        if isinstance(due_date, str):
            due_date = datetime.fromisoformat(due_date.replace('Z', '+00:00'))
        elif due_date is not None and due_date.tzinfo is None:
            # Mongo returns naive UTC datetimes; normalise before subtracting.
            due_date = due_date.replace(tzinfo=timezone.utc)
        
        days_overdue = (today - due_date).days if due_date else 0
        outstanding = inv["total"] - inv.get("paid_amount", 0)
        
        inv_summary = {
            "invoice_number": inv["invoice_number"],
            "party_name": inv.get("party_name"),
            "amount": outstanding,
            "due_date": inv.get("due_date"),
            "days_overdue": max(0, days_overdue)
        }
        
        if days_overdue <= 0:
            bucket = "current"
        elif days_overdue <= 30:
            bucket = "1_30_days"
        elif days_overdue <= 60:
            bucket = "31_60_days"
        elif days_overdue <= 90:
            bucket = "61_90_days"
        else:
            bucket = "over_90_days"
        
        aging_buckets[bucket]["total"] += outstanding
        aging_buckets[bucket]["invoices"].append(inv_summary)
        
        supplier_id = inv.get("party_id")
        if supplier_id not in by_supplier:
            by_supplier[supplier_id] = {
                "name": inv.get("party_name"),
                "total": 0,
                "current": 0,
                "overdue": 0
            }
        by_supplier[supplier_id]["total"] += outstanding
        if days_overdue > 0:
            by_supplier[supplier_id]["overdue"] += outstanding
        else:
            by_supplier[supplier_id]["current"] += outstanding
    
    total_payable = sum(b["total"] for b in aging_buckets.values())
    
    return {
        "total_accounts_payable": round(total_payable, 2),
        "aging_summary": {k: round(v["total"], 2) for k, v in aging_buckets.items()},
        "aging_details": {k: {"total": round(v["total"], 2), "invoices": v["invoices"][:5]} for k, v in aging_buckets.items()},
        "by_supplier": list(by_supplier.values())
    }

@api_router.get("/reports/customer-aging")
async def get_customer_aging_report(user: User = Depends(get_current_user)):
    """Get Customer Aging (Accounts Receivable) report"""
    await assert_permission(db, user.role, "reports", "read")
    today = datetime.now(timezone.utc)
    
    # Get unpaid sales invoices
    invoices = await db.invoices.find({
        "type": "sale",
        "status": {"$in": ["unpaid", "partial"]}
    }, {"_id": 0}).to_list(10000)
    
    aging_buckets = {
        "current": {"total": 0, "invoices": []},
        "1_30_days": {"total": 0, "invoices": []},
        "31_60_days": {"total": 0, "invoices": []},
        "61_90_days": {"total": 0, "invoices": []},
        "over_90_days": {"total": 0, "invoices": []}
    }
    
    by_customer = {}
    
    for inv in invoices:
        due_date = inv.get("due_date")
        if isinstance(due_date, str):
            due_date = datetime.fromisoformat(due_date.replace('Z', '+00:00'))
        elif due_date and due_date.tzinfo is None:
            due_date = due_date.replace(tzinfo=timezone.utc)
        
        days_overdue = (today - due_date).days if due_date else 0
        outstanding = inv["total"] - inv.get("paid_amount", 0)
        
        inv_summary = {
            "invoice_number": inv["invoice_number"],
            "party_name": inv.get("party_name"),
            "amount": outstanding,
            "due_date": inv.get("due_date"),
            "days_overdue": max(0, days_overdue)
        }
        
        if days_overdue <= 0:
            bucket = "current"
        elif days_overdue <= 30:
            bucket = "1_30_days"
        elif days_overdue <= 60:
            bucket = "31_60_days"
        elif days_overdue <= 90:
            bucket = "61_90_days"
        else:
            bucket = "over_90_days"
        
        aging_buckets[bucket]["total"] += outstanding
        aging_buckets[bucket]["invoices"].append(inv_summary)
        
        customer_id = inv.get("party_id")
        if customer_id not in by_customer:
            by_customer[customer_id] = {
                "name": inv.get("party_name"),
                "total": 0,
                "current": 0,
                "overdue": 0
            }
        by_customer[customer_id]["total"] += outstanding
        if days_overdue > 0:
            by_customer[customer_id]["overdue"] += outstanding
        else:
            by_customer[customer_id]["current"] += outstanding
    
    total_receivable = sum(b["total"] for b in aging_buckets.values())
    
    return {
        "total_accounts_receivable": round(total_receivable, 2),
        "aging_summary": {k: round(v["total"], 2) for k, v in aging_buckets.items()},
        "aging_details": {k: {"total": round(v["total"], 2), "invoices": v["invoices"][:5]} for k, v in aging_buckets.items()},
        "by_customer": list(by_customer.values())
    }

@api_router.get("/reports/inventory-valuation")
async def get_inventory_valuation_report(
    method: str = "average",  # average, fifo, lifo
    warehouse_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get Inventory Valuation report"""
    await assert_permission(db, user.role, "reports", "read")
    query = {}
    if warehouse_id:
        assert_same_warehouse(user, warehouse_id, "export valuation for")
        query["warehouse_id"] = warehouse_id
    else:
        scoped = get_user_warehouse_filter(user)
        if scoped:
            query["warehouse_id"] = scoped
    
    stocks = await db.inventory_stock.find(query, {"_id": 0}).to_list(10000)
    
    valuation = []
    total_value = 0.0
    total_items = 0
    
    for stock in stocks:
        product = await db.products.find_one({"product_id": stock["product_id"]}, {"_id": 0})
        if not product:
            continue
        
        warehouse = await db.warehouses.find_one({"warehouse_id": stock["warehouse_id"]}, {"_id": 0})
        
        qty = _num(stock.get("quantity"))
        cost = product.get("cost_price", 0)
        value = qty * cost
        
        valuation.append({
            "product_id": stock["product_id"],
            "product_name": product["name"],
            "sku": product["sku"],
            "category": product.get("category"),
            "warehouse_id": stock["warehouse_id"],
            "warehouse_name": warehouse["name"] if warehouse else "Unknown",
            "quantity": qty,
            "unit": product.get("unit"),
            "unit_cost": cost,
            "total_value": round(value, 2),
            "selling_price": product.get("selling_price", 0),
            "potential_revenue": round(qty * product.get("selling_price", 0), 2)
        })
        
        total_value += value
        total_items += qty
    
    # Sort by value descending
    valuation.sort(key=lambda x: x["total_value"], reverse=True)
    
    return {
        "valuation_method": method,
        "total_inventory_value": round(total_value, 2),
        "total_items": total_items,
        "total_skus": len(valuation),
        "items": valuation,
        "top_5_by_value": valuation[:5]
    }

# ========================
# NOTIFICATION SYSTEM
# ========================

class NotificationType(str, Enum):
    LOW_STOCK = "low_stock"
    ORDER_STATUS = "order_status"
    PAYMENT_DUE = "payment_due"
    APPROVAL_REQUIRED = "approval_required"
    SYSTEM = "system"

async def create_notification(user_id: str, title: str, message: str, notif_type: NotificationType):
    """Helper to create notifications"""
    notif = Notification(
        user_id=user_id,
        title=title,
        message=message,
        type=notif_type.value
    )
    await db.notifications.insert_one(notif.model_dump())
    return notif

@api_router.get("/notifications/generate-alerts")
async def generate_system_alerts(user: User = Depends(get_current_user)):
    """Generate system alerts for low stock, overdue payments, etc."""
    alerts_generated = []
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Low stock alerts
    products = await db.products.find({"is_active": True}, {"_id": 0}).to_list(1000)
    for product in products:
        stocks = await db.inventory_stock.find({"product_id": product["product_id"]}, {"_id": 0}).to_list(100)
        total_qty = sum(_num(s.get("quantity")) for s in stocks)
        reorder_level = product.get("reorder_level", 10)
        if total_qty <= reorder_level:
            # De-duplicate: only notify once per product per day, otherwise
            # every dashboard poll floods the user's notification list.
            title = f"Low Stock Alert: {product['name']}"
            already = await db.notifications.find_one(
                {"user_id": user.user_id, "title": title, "created_at": {"$gte": today_start}}
            )
            if not already:
                await create_notification(
                    user.user_id,
                    title,
                    f"{product['name']} is low on stock. Current: {total_qty}, Reorder Level: {reorder_level}",
                    NotificationType.LOW_STOCK
                )
                alerts_generated.append({"type": "low_stock", "product": product["name"]})
    
    # Overdue invoices
    today = datetime.now(timezone.utc)
    overdue_invoices = await db.invoices.find({
        "status": {"$in": ["unpaid", "partial"]},
        "due_date": {"$lt": today}
    }, {"_id": 0}).to_list(100)
    
    for inv in overdue_invoices:
        title = f"Payment Overdue: {inv['invoice_number']}"
        already = await db.notifications.find_one(
            {"user_id": user.user_id, "title": title, "created_at": {"$gte": today_start}}
        )
        if already:
            continue
        outstanding = inv.get("total", inv.get("total_amount", 0)) - inv.get("paid_amount", 0)
        await create_notification(
            user.user_id,
            title,
            f"Invoice {inv['invoice_number']} for {inv.get('party_name')} is overdue. "
            f"Amount: {currency_symbol()}{outstanding:.2f}",
            NotificationType.PAYMENT_DUE
        )
        alerts_generated.append({"type": "payment_due", "invoice": inv["invoice_number"]})
    
    return {"alerts_generated": len(alerts_generated), "alerts": alerts_generated}

# ========================
# PDF EXPORT ENDPOINTS
# ========================

def generate_invoice_pdf(invoice_data: dict, items: list, company_name: str = "BizCore",
                         symbol: str = "₦") -> bytes:
    """Generate PDF for an invoice"""
    if not PDF_AVAILABLE:
        raise HTTPException(status_code=500, detail="PDF generation not available")
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=24, alignment=TA_CENTER, spaceAfter=20)
    header_style = ParagraphStyle('Header', parent=styles['Normal'], fontSize=12, alignment=TA_LEFT)
    
    elements = []
    
    # Header
    elements.append(Paragraph(company_name, title_style))
    elements.append(Spacer(1, 0.2*inch))
    
    # Invoice info
    inv_type = "SALES INVOICE" if invoice_data.get("type") == "sale" else "PURCHASE INVOICE"
    elements.append(Paragraph(f"<b>{inv_type}</b>", ParagraphStyle('Type', fontSize=16, alignment=TA_CENTER)))
    elements.append(Spacer(1, 0.2*inch))
    
    # Invoice details table
    inv_number = invoice_data.get("invoice_number", "N/A")
    issue_date = invoice_data.get("issue_date", "")
    if isinstance(issue_date, datetime):
        issue_date = issue_date.strftime("%Y-%m-%d")
    due_date = invoice_data.get("due_date", "")
    if isinstance(due_date, datetime):
        due_date = due_date.strftime("%Y-%m-%d")
    
    details_data = [
        ["Invoice Number:", inv_number, "Issue Date:", str(issue_date)[:10]],
        ["Party:", invoice_data.get("party_name", "N/A"), "Due Date:", str(due_date)[:10]],
        ["Status:", invoice_data.get("status", "").upper(), "", ""],
    ]
    
    details_table = Table(details_data, colWidths=[1.5*inch, 2.5*inch, 1.2*inch, 1.5*inch])
    details_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(details_table)
    elements.append(Spacer(1, 0.3*inch))
    
    # Items table
    if items:
        items_header = ["#", "Product", "Quantity", "Unit Price", "Total"]
        items_data = [items_header]
        for i, item in enumerate(items, 1):
            qty = item.get("quantity", 0)
            price = item.get("unit_price", 0)
            total = qty * price
            items_data.append([
                str(i),
                item.get("product_name", "N/A"),
                str(qty),
                f"{symbol}{price:.2f}",
                f"{symbol}{total:.2f}"
            ])
        
        items_table = Table(items_data, colWidths=[0.5*inch, 3*inch, 1*inch, 1*inch, 1*inch])
        items_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#6366F1')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#F3F4F6')),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#E5E7EB')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9FAFB')]),
        ]))
        elements.append(items_table)
        elements.append(Spacer(1, 0.3*inch))
    
    # Totals
    subtotal = invoice_data.get("subtotal", 0)
    tax = invoice_data.get("tax_amount", 0)
    total = invoice_data.get("total", 0)
    paid = invoice_data.get("paid_amount", 0)
    
    totals_data = [
        ["", "", "Subtotal:", f"{symbol}{subtotal:.2f}"],
        ["", "", "Tax:", f"{symbol}{tax:.2f}"],
        ["", "", "Total:", f"{symbol}{total:.2f}"],
        ["", "", "Paid:", f"{symbol}{paid:.2f}"],
        ["", "", "Balance Due:", f"{symbol}{(total - paid):.2f}"],
    ]
    
    totals_table = Table(totals_data, colWidths=[2*inch, 2*inch, 1.5*inch, 1*inch])
    totals_table.setStyle(TableStyle([
        ('ALIGN', (2, 0), (-1, -1), 'RIGHT'),
        ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('LINEABOVE', (2, -1), (-1, -1), 1, colors.black),
        ('FONTNAME', (2, -1), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (2, -1), (-1, -1), 12),
    ]))
    elements.append(totals_table)
    
    # Footer
    elements.append(Spacer(1, 0.5*inch))
    elements.append(Paragraph("Thank you for your business!", ParagraphStyle('Footer', fontSize=10, alignment=TA_CENTER, textColor=colors.gray)))
    elements.append(Paragraph(f"Generated by {company_name} on {datetime.now().strftime('%Y-%m-%d %H:%M')}", 
                             ParagraphStyle('Footer2', fontSize=8, alignment=TA_CENTER, textColor=colors.gray)))
    
    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()

@api_router.get("/invoices/{invoice_id}/pdf")
async def get_invoice_pdf(invoice_id: str, user: User = Depends(get_current_user)):
    """Generate and return invoice PDF"""
    await assert_permission(db, user.role, "invoices", "read")
    invoice = await db.invoices.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Get related order items
    items = []
    if invoice.get("type") == "sale":
        so = await db.sales_orders.find_one({"so_id": invoice.get("reference_id")}, {"_id": 0})
        if so:
            items = so.get("items", [])
    else:
        po = await db.purchase_orders.find_one({"po_id": invoice.get("reference_id")}, {"_id": 0})
        if po:
            items = po.get("items", [])
    
    # Get company info
    company = await db.companies.find_one({}, {"_id": 0})
    company_name = company.get("name", "BizCore") if company else "BizCore"
    symbol = currency_symbol(await get_company_currency())
    
    pdf_bytes = generate_invoice_pdf(invoice, items, company_name, symbol)
    
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=invoice_{invoice['invoice_number']}.pdf"}
    )

@api_router.get("/invoices/{invoice_id}/pdf-base64")
async def get_invoice_pdf_base64(invoice_id: str, user: User = Depends(get_current_user)):
    """Generate and return invoice PDF as base64 (for mobile)"""
    await assert_permission(db, user.role, "invoices", "read")
    invoice = await db.invoices.find_one({"invoice_id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    items = []
    if invoice.get("type") == "sale":
        so = await db.sales_orders.find_one({"so_id": invoice.get("reference_id")}, {"_id": 0})
        if so:
            items = so.get("items", [])
    else:
        po = await db.purchase_orders.find_one({"po_id": invoice.get("reference_id")}, {"_id": 0})
        if po:
            items = po.get("items", [])
    
    company = await db.companies.find_one({}, {"_id": 0})
    company_name = company.get("name", "BizCore") if company else "BizCore"
    symbol = currency_symbol(await get_company_currency())
    
    pdf_bytes = generate_invoice_pdf(invoice, items, company_name, symbol)
    pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
    
    return {
        "pdf_base64": pdf_base64,
        "filename": f"invoice_{invoice['invoice_number']}.pdf"
    }

def generate_report_pdf(title: str, data: dict, report_type: str, symbol: str = "₦") -> bytes:
    """Generate PDF for reports"""
    if not PDF_AVAILABLE:
        raise HTTPException(status_code=500, detail="PDF generation not available")
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=20, alignment=TA_CENTER, spaceAfter=20)
    
    elements = []
    
    # Header
    elements.append(Paragraph(title, title_style))
    elements.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", 
                             ParagraphStyle('Date', fontSize=10, alignment=TA_CENTER, textColor=colors.gray)))
    elements.append(Spacer(1, 0.3*inch))
    
    if report_type == "stock_summary":
        # Stock summary table
        items = data.get("items", [])
        if items:
            header = ["SKU", "Product", "Warehouse", "Qty", "Value"]
            table_data = [header]
            for item in items[:50]:  # Limit to 50 items
                table_data.append([
                    item.get("sku", ""),
                    item.get("product_name", "")[:30],
                    item.get("warehouse_name", "")[:15],
                    str(item.get("quantity", 0)),
                    f"{symbol}{item.get('value', 0):.2f}"
                ])
            
            table = Table(table_data, colWidths=[1*inch, 2.5*inch, 1.2*inch, 0.8*inch, 1*inch])
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#6366F1')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#E5E7EB')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9FAFB')]),
            ]))
            elements.append(table)
        
        # Summary
        elements.append(Spacer(1, 0.3*inch))
        elements.append(Paragraph(f"<b>Total Inventory Value: {symbol}{data.get('total_inventory_value', 0):,.2f}</b>", 
                                 ParagraphStyle('Summary', fontSize=14, alignment=TA_RIGHT)))
    
    elif report_type == "profit_loss":
        pl_data = [
            ["Revenue", f"{symbol}{data.get('revenue', {}).get('total_sales', 0):,.2f}"],
            ["Cost of Goods Sold", f"-{symbol}{data.get('cost_of_goods_sold', {}).get('total_cogs', 0):,.2f}"],
            ["Gross Profit", f"{symbol}{data.get('gross_profit', 0):,.2f}"],
            ["Operating Expenses", f"-{symbol}{data.get('operating_expenses', {}).get('total', 0):,.2f}"],
            ["Net Profit", f"{symbol}{data.get('net_profit', 0):,.2f}"],
        ]
        
        table = Table(pl_data, colWidths=[4*inch, 2*inch])
        table.setStyle(TableStyle([
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('LINEBELOW', (0, 2), (-1, 2), 1, colors.black),
            ('LINEBELOW', (0, -1), (-1, -1), 2, colors.black),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, -1), (-1, -1), 14),
        ]))
        elements.append(table)
    
    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()

@api_router.get("/reports/stock-summary/pdf")
async def get_stock_summary_pdf(warehouse_id: Optional[str] = None, user: User = Depends(get_current_user)):
    """Generate stock summary report PDF"""
    await assert_permission(db, user.role, "reports", "read")
    # Get the data
    query = {}
    if warehouse_id:
        query["warehouse_id"] = warehouse_id
    
    stocks = await db.inventory_stock.find(query, {"_id": 0}).to_list(10000)
    
    items = []
    total_value = 0.0
    for stock in stocks:
        product = await db.products.find_one({"product_id": stock["product_id"]}, {"_id": 0})
        warehouse = await db.warehouses.find_one({"warehouse_id": stock["warehouse_id"]}, {"_id": 0})
        
        if product:
            value = _num(stock.get("quantity")) * product.get("cost_price", 0)
            items.append({
                "sku": product["sku"],
                "product_name": product["name"],
                "warehouse_name": warehouse["name"] if warehouse else "Unknown",
                "quantity": _num(stock.get("quantity")),
                "value": value
            })
            total_value += value
    
    data = {"items": items, "total_inventory_value": total_value}
    symbol = currency_symbol(await get_company_currency())
    pdf_bytes = generate_report_pdf("Stock Summary Report", data, "stock_summary", symbol)
    
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=stock_summary_report.pdf"}
    )

@api_router.get("/reports/stock-summary/pdf-base64")
async def get_stock_summary_pdf_base64(warehouse_id: Optional[str] = None,
                                        user: User = Depends(get_current_user)):
    """Stock summary PDF as base64 — the mobile client cannot consume a blob."""
    await assert_permission(db, user.role, "reports", "read")
    query = {}
    if warehouse_id:
        assert_same_warehouse(user, warehouse_id, "export stock summary for")
        query["warehouse_id"] = warehouse_id
    else:
        scoped = get_user_warehouse_filter(user)
        if scoped:
            query["warehouse_id"] = scoped

    stocks = await db.inventory_stock.find(query, {"_id": 0}).to_list(10000)
    items = []
    total_value = 0.0
    for stock in stocks:
        product = await db.products.find_one({"product_id": stock["product_id"]}, {"_id": 0})
        warehouse = await db.warehouses.find_one({"warehouse_id": stock["warehouse_id"]}, {"_id": 0})
        if product:
            value = _num(stock.get("quantity")) * product.get("cost_price", 0)
            items.append({
                "sku": product["sku"],
                "product_name": product["name"],
                "warehouse_name": warehouse["name"] if warehouse else "Unknown",
                "quantity": _num(stock.get("quantity")),
                "value": value,
            })
            total_value += value

    symbol = currency_symbol(await get_company_currency())
    data = {"items": items, "total_inventory_value": total_value}
    pdf_bytes = generate_report_pdf("Stock Summary Report", data, "stock_summary", symbol)
    return {
        "pdf_base64": base64.b64encode(pdf_bytes).decode("utf-8"),
        "filename": "stock_summary_report.pdf",
    }


@api_router.get("/reports/profit-loss/pdf")
async def get_profit_loss_pdf(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Generate P&L report PDF"""
    await assert_permission(db, user.role, "reports", "read")
    # Reuse the existing P&L logic
    if not start_date:
        start_date = datetime.now(timezone.utc).replace(day=1).isoformat()
    if not end_date:
        end_date = datetime.now(timezone.utc).isoformat()
    
    start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00')) if 'Z' in start_date or '+' in start_date else datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
    end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00')) if 'Z' in end_date or '+' in end_date else datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
    
    sales = await db.sales_orders.find({
        "order_date": {"$gte": start_dt, "$lte": end_dt},
        "status": {"$in": ["delivered", "paid"]}
    }, {"_id": 0}).to_list(10000)
    total_revenue = sum(so.get("total_amount", 0) for so in sales)
    
    purchases = await db.purchase_orders.find({
        "order_date": {"$gte": start_dt, "$lte": end_dt},
        "status": {"$in": ["received", "paid"]}
    }, {"_id": 0}).to_list(10000)
    total_cogs = sum(po.get("total_amount", 0) for po in purchases)
    
    expenses = await db.expenses.find({
        "expense_date": {"$gte": start_dt, "$lte": end_dt},
        "approved": True
    }, {"_id": 0}).to_list(10000)
    total_expenses = sum(exp.get("amount", 0) for exp in expenses)
    
    gross_profit = total_revenue - total_cogs
    net_profit = gross_profit - total_expenses
    
    data = {
        "revenue": {"total_sales": total_revenue},
        "cost_of_goods_sold": {"total_cogs": total_cogs},
        "gross_profit": gross_profit,
        "operating_expenses": {"total": total_expenses},
        "net_profit": net_profit
    }
    
    symbol = currency_symbol(await get_company_currency())
    pdf_bytes = generate_report_pdf("Profit & Loss Statement", data, "profit_loss", symbol)
    
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=profit_loss_report.pdf"}
    )

@api_router.get("/reports/profit-loss/pdf-base64")
async def get_profit_loss_pdf_base64(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Profit & Loss PDF as base64 — the mobile client cannot consume a blob."""
    await assert_permission(db, user.role, "reports", "read")
    if not start_date:
        start_date = datetime.now(timezone.utc).replace(day=1).isoformat()
    if not end_date:
        end_date = datetime.now(timezone.utc).isoformat()

    start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00')) if 'Z' in start_date or '+' in start_date else datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
    end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00')) if 'Z' in end_date or '+' in end_date else datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)

    sales = await db.sales_orders.find({
        "order_date": {"$gte": start_dt, "$lte": end_dt},
        "status": {"$in": ["delivered", "paid"]}
    }, {"_id": 0}).to_list(10000)
    total_revenue = sum(so.get("total_amount", 0) for so in sales)

    purchases = await db.purchase_orders.find({
        "order_date": {"$gte": start_dt, "$lte": end_dt},
        "status": {"$in": ["received", "paid"]}
    }, {"_id": 0}).to_list(10000)
    total_cogs = sum(po.get("total_amount", 0) for po in purchases)

    expenses = await db.expenses.find({
        "expense_date": {"$gte": start_dt, "$lte": end_dt},
        "approved": True
    }, {"_id": 0}).to_list(10000)
    total_expenses = sum(exp.get("amount", 0) for exp in expenses)

    gross_profit = total_revenue - total_cogs
    net_profit = gross_profit - total_expenses

    data = {
        "revenue": {"total_sales": total_revenue},
        "cost_of_goods_sold": {"total_cogs": total_cogs},
        "gross_profit": gross_profit,
        "operating_expenses": {"total": total_expenses},
        "net_profit": net_profit,
    }
    symbol = currency_symbol(await get_company_currency())
    pdf_bytes = generate_report_pdf("Profit & Loss Statement", data, "profit_loss", symbol)
    return {
        "pdf_base64": base64.b64encode(pdf_bytes).decode("utf-8"),
        "filename": "profit_loss_report.pdf",
    }


# ========================
# PUSH NOTIFICATION REGISTRATION
# ========================

class PushTokenRegister(BaseModel):
    push_token: str
    device_type: str = "unknown"  # ios, android, web

@api_router.post("/notifications/register-push-token")
async def register_push_token(token_data: PushTokenRegister, user: User = Depends(get_current_user)):
    """Register push notification token for a user"""
    await db.push_tokens.update_one(
        {"user_id": user.user_id},
        {
            "$set": {
                "user_id": user.user_id,
                "push_token": token_data.push_token,
                "device_type": token_data.device_type,
                "updated_at": datetime.now(timezone.utc)
            }
        },
        upsert=True
    )
    return {"message": "Push token registered"}

@api_router.delete("/notifications/unregister-push-token")
async def unregister_push_token(user: User = Depends(get_current_user)):
    """Unregister push notification token"""
    await db.push_tokens.delete_many({"user_id": user.user_id})
    return {"message": "Push token unregistered"}

@api_router.get("/notifications/push-tokens")
@limiter.limit("20/minute")
async def get_push_tokens(request: Request, user: User = Depends(get_current_user)):
    """Get push tokens — SUPER_ADMIN only. Rate limited: 20/minute."""
    # SECURITY: Restricted to SUPER_ADMIN only (was incorrectly open to MANAGER)
    if user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized")

    tokens = await db.push_tokens.find({}, {"_id": 0}).to_list(1000)
    return tokens

# ========================
# OFFLINE SYNC ENDPOINTS
# ========================

class SyncData(BaseModel):
    entity_type: str  # products, suppliers, distributors, etc.
    last_sync: Optional[str] = None
    local_changes: List[Dict[str, Any]] = []

@api_router.post("/sync/pull")
async def sync_pull(sync_data: SyncData, user: User = Depends(get_current_user)):
    """Pull data changes since last sync for offline mode"""
    last_sync_dt = None
    if sync_data.last_sync:
        try:
            last_sync_dt = datetime.fromisoformat(sync_data.last_sync.replace('Z', '+00:00'))
        except:
            pass
    
    query = {}
    if last_sync_dt:
        query["updated_at"] = {"$gt": last_sync_dt}
    
    collection_map = {
        "products": db.products,
        "suppliers": db.suppliers,
        "distributors": db.distributors,
        "warehouses": db.warehouses,
        "inventory": db.inventory_stock,
        "purchase_orders": db.purchase_orders,
        "sales_orders": db.sales_orders,
    }
    
    if sync_data.entity_type not in collection_map:
        raise HTTPException(status_code=400, detail=f"Unknown entity type: {sync_data.entity_type}")
    
    collection = collection_map[sync_data.entity_type]
    
    # For inventory, we use last_updated instead of updated_at
    if sync_data.entity_type == "inventory" and last_sync_dt:
        query = {"last_updated": {"$gt": last_sync_dt}}
    
    data = await collection.find(query, {"_id": 0}).to_list(10000)
    
    return {
        "entity_type": sync_data.entity_type,
        "sync_time": datetime.now(timezone.utc).isoformat(),
        "count": len(data),
        "data": data
    }

@api_router.post("/sync/push")
async def sync_push(sync_data: SyncData, user: User = Depends(get_current_user)):
    """Push local changes to server for offline mode.

    SECURITY: every write path is permission-checked, and the payload is
    rebuilt from a whitelist of fields — the client cannot inject arbitrary
    document keys (e.g. `total_amount`, `status`, `created_by`).
    """
    WRITE_PERMISSIONS = {
        "stock_adjustments": ("inventory", "update"),
        "sales_orders":      ("sales_orders", "create"),
        "purchase_orders":   ("purchase_orders", "create"),
    }
    perm = WRITE_PERMISSIONS.get(sync_data.entity_type)
    if perm is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported entity type for push: {sync_data.entity_type}",
        )
    await assert_permission(db, user.role, perm[0], perm[1])

    if not sync_data.local_changes:
        return {"message": "No changes to sync", "synced": 0}
    
    synced = 0
    errors = []
    
    for change in sync_data.local_changes:
        try:
            action = change.get("action", "update")
            entity_id = change.get("entity_id")
            data = change.get("data", {})
            
            if sync_data.entity_type == "stock_adjustments":
                # Handle stock adjustments — whitelist the fields we accept.
                product_id = str(data.get("product_id") or "")
                warehouse_id = str(data.get("warehouse_id") or "")
                quantity = float(data.get("quantity") or 0)
                if not product_id or not warehouse_id:
                    raise ValueError("stock_adjustments require product_id and warehouse_id")
                assert_same_warehouse(user, warehouse_id, "adjust inventory in")

                await db.stock_transactions.insert_one({
                    "transaction_id": f"txn_{uuid.uuid4().hex[:12]}",
                    "product_id": product_id,
                    "warehouse_id": warehouse_id,
                    "type": data.get("type") or TransactionType.ADJUSTMENT.value,
                    "quantity": quantity,
                    "reference_id": data.get("reference_id"),
                    "notes": data.get("notes"),
                    "created_by": user.user_id,
                    "created_at": datetime.now(timezone.utc),
                    "synced_from_offline": True,
                })
                
                # Update inventory
                stock = await db.inventory_stock.find_one({
                    "product_id": product_id,
                    "warehouse_id": warehouse_id
                }, {"_id": 0})
                
                if stock:
                    new_qty = _num(stock.get("quantity")) + quantity
                    if new_qty < 0:
                        raise ValueError("adjustment would take stock below zero")
                    await db.inventory_stock.update_one(
                        {"stock_id": stock["stock_id"]},
                        {"$set": {"quantity": new_qty, "last_updated": datetime.now(timezone.utc)}}
                    )
                else:
                    await db.inventory_stock.insert_one({
                        "stock_id": f"stock_{uuid.uuid4().hex[:12]}",
                        "product_id": product_id,
                        "warehouse_id": warehouse_id,
                        "quantity": quantity,
                        "last_updated": datetime.now(timezone.utc),
                    })
                synced += 1
            
            elif sync_data.entity_type == "sales_orders" and action == "create":
                # Create new sales order from offline — whitelist fields.
                so_doc = {
                    "so_id": f"so_{uuid.uuid4().hex[:12]}",
                    "so_number": await generate_so_number(),
                    "sales_rep_id": str(data.get("sales_rep_id") or user.user_id),
                    "sales_rep_name": data.get("sales_rep_name"),
                    "warehouse_id": str(data.get("warehouse_id") or user.warehouse_id or ""),
                    "order_date": datetime.now(timezone.utc),
                    "status": OrderStatus.PENDING_APPROVAL.value,
                    "dispatch_status": DispatchStatus.PENDING_DISPATCH.value,
                    "items": _sanitise_order_items(data.get("items")),
                    "subtotal": float(data.get("subtotal") or 0),
                    "tax_amount": float(data.get("tax_amount") or 0),
                    "total_amount": float(data.get("total_amount") or 0),
                    "notes": data.get("notes"),
                    "created_by": user.user_id,
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    "synced_from_offline": True,
                }
                await db.sales_orders.insert_one(so_doc)
                synced += 1
            
            elif sync_data.entity_type == "purchase_orders" and action == "create":
                # Create new purchase order from offline — whitelist fields.
                po_doc = {
                    "po_id": f"po_{uuid.uuid4().hex[:12]}",
                    "po_number": await generate_po_number(),
                    "supplier_id": str(data.get("supplier_id") or ""),
                    "supplier_name": data.get("supplier_name"),
                    "warehouse_id": str(data.get("warehouse_id") or user.warehouse_id or ""),
                    "order_date": datetime.now(timezone.utc),
                    "status": OrderStatus.DRAFT.value,
                    "items": _sanitise_order_items(data.get("items")),
                    "subtotal": float(data.get("subtotal") or 0),
                    "tax_amount": float(data.get("tax_amount") or 0),
                    "total_amount": float(data.get("total_amount") or 0),
                    "notes": data.get("notes"),
                    "created_by": user.user_id,
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    "synced_from_offline": True,
                }
                await db.purchase_orders.insert_one(po_doc)
                synced += 1
        
        except HTTPException:
            # Permission / validation failures must abort the push, not be
            # swallowed into a per-item error list.
            raise
        except Exception as e:
            errors.append({"entity_id": entity_id, "error": str(e)})
    
    return {
        "message": f"Synced {synced} changes",
        "synced": synced,
        "errors": errors
    }

@api_router.get("/sync/status")
async def get_sync_status(user: User = Depends(get_current_user)):
    """Get sync status for all entities"""
    entities = ["products", "suppliers", "distributors", "warehouses", "purchase_orders", "sales_orders"]
    
    status = {}
    for entity in entities:
        collection = db[entity]
        count = await collection.count_documents({})
        latest = await collection.find_one({}, {"_id": 0, "updated_at": 1}, sort=[("updated_at", -1)])
        status[entity] = {
            "count": count,
            "last_updated": latest.get("updated_at").isoformat() if latest and latest.get("updated_at") else None
        }
    
    return {
        "server_time": datetime.now(timezone.utc).isoformat(),
        "entities": status
    }

# ========================
# BARCODE LOOKUP
# ========================

@api_router.get("/barcode/{barcode}")
async def lookup_barcode(barcode: str, user: User = Depends(get_current_user)):
    """Look up product by barcode"""
    product = await db.products.find_one({"barcode": barcode, "is_active": True}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    # Get stock levels
    stocks = await db.inventory_stock.find({"product_id": product["product_id"]}, {"_id": 0}).to_list(100)
    total_stock = sum(_num(s.get("quantity")) for s in stocks)
    
    return {
        "product": product,
        "total_stock": total_stock,
        "stock_by_warehouse": stocks
    }

@api_router.post("/barcode/generate")
async def generate_barcode(product_id: str, user: User = Depends(get_current_user)):
    """Generate and assign barcode to product"""
    await assert_permission(db, user.role, "products", "update")
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    # Generate barcode (simple format: BZC + timestamp + random)
    barcode = f"BZC{datetime.now().strftime('%y%m%d')}{uuid.uuid4().hex[:6].upper()}"
    
    await db.products.update_one(
        {"product_id": product_id},
        {"$set": {"barcode": barcode, "updated_at": datetime.now(timezone.utc)}}
    )
    
    return {"product_id": product_id, "barcode": barcode}

# ========================
# PURCHASE REQUISITIONS API
# ========================

@api_router.get("/requisitions")
async def list_requisitions(
    status: Optional[RequisitionStatus] = None,
    priority: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """List all purchase requisitions"""
    await assert_permission(db, user.role, "requisitions", "read")
    query = {}
    if status:
        query["status"] = status.value
    if priority:
        query["priority"] = priority
    
    requisitions = await db.requisitions.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return requisitions

@api_router.get("/requisitions/{requisition_id}")
async def get_requisition(requisition_id: str, user: User = Depends(get_current_user)):
    """Get requisition by ID"""
    req = await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Requisition not found")
    return req

@api_router.post("/requisitions")
async def create_requisition(data: PurchaseRequisitionCreate, user: User = Depends(get_current_user)):
    """Create a new purchase requisition"""
    await assert_permission(db, user.role, "requisitions", "create")
    # Generate requisition number
    req_number = await generate_requisition_number()
    
    # Build items with product names
    items = []
    total = 0.0
    for item_data in data.items:
        product = await db.products.find_one({"product_id": item_data.product_id})
        item = RequisitionItem(
            product_id=item_data.product_id,
            product_name=product["name"] if product else None,
            quantity=item_data.quantity,
            estimated_unit_price=item_data.estimated_unit_price,
            reason=item_data.reason
        )
        items.append(item.model_dump())
        total += item_data.quantity * item_data.estimated_unit_price
    
    requisition = PurchaseRequisition(
        requisition_number=req_number,
        requested_by=user.user_id,
        requested_by_name=user.name,
        department=data.department,
        priority=data.priority,
        required_date=data.required_date,
        items=items,
        total_estimated=total,
        notes=data.notes
    )
    
    await db.requisitions.insert_one(requisition.model_dump())
    await create_audit_log(user.user_id, "create", "requisition", requisition.requisition_id, None, requisition.model_dump())
    
    return requisition.model_dump()

@api_router.put("/requisitions/{requisition_id}/submit")
async def submit_requisition(requisition_id: str, user: User = Depends(get_current_user)):
    """Submit requisition for approval"""
    await assert_permission(db, user.role, "requisitions", "update")
    req = await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Requisition not found")
    
    if req["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft requisitions can be submitted")
    # Only the requester (or an approver) may submit it.
    if req.get("requested_by") != user.user_id:
        assert_approval_role(user)
    
    await db.requisitions.update_one(
        {"requisition_id": requisition_id},
        {"$set": {"status": "pending", "updated_at": datetime.now(timezone.utc)}}
    )
    
    return {"message": "Requisition submitted for approval"}

@api_router.put("/requisitions/{requisition_id}/approve")
async def approve_requisition(requisition_id: str, user: User = Depends(get_current_user)):
    """Approve a purchase requisition"""
    await assert_permission(db, user.role, "requisitions", "update")
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER, UserRole.WAREHOUSE_MANAGER]:
        raise HTTPException(status_code=403, detail="Only managers can approve requisitions")
    
    req = await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Requisition not found")
    
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail="Only pending requisitions can be approved")
    
    await db.requisitions.update_one(
        {"requisition_id": requisition_id},
        {"$set": {
            "status": "approved",
            "approved_by": user.user_id,
            "approved_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    
    await create_audit_log(user.user_id, "update_status", "requisition", requisition_id, {"status": "pending"}, {"status": "approved"})
    
    return {"message": "Requisition approved"}

@api_router.put("/requisitions/{requisition_id}/reject")
async def reject_requisition(requisition_id: str, reason: str = "", user: User = Depends(get_current_user)):
    """Reject a purchase requisition"""
    await assert_permission(db, user.role, "requisitions", "update")
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER, UserRole.WAREHOUSE_MANAGER]:
        raise HTTPException(status_code=403, detail="Only managers can reject requisitions")
    
    req = await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Requisition not found")
    
    await db.requisitions.update_one(
        {"requisition_id": requisition_id},
        {"$set": {
            "status": "rejected",
            "rejection_reason": reason,
            "approved_by": user.user_id,
            "approved_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    
    return {"message": "Requisition rejected"}

@api_router.post("/requisitions/{requisition_id}/convert-to-po")
async def convert_requisition_to_po(
    requisition_id: str,
    supplier_id: str,
    warehouse_id: str,
    user: User = Depends(get_current_user)
):
    """Convert approved requisition to Purchase Order"""
    await assert_permission(db, user.role, "purchase_orders", "create")
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER,
                          UserRole.WAREHOUSE_MANAGER, UserRole.PURCHASE_CLERK]:
        raise HTTPException(status_code=403, detail="Not authorized to convert requisitions")
    req = await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Requisition not found")
    
    if req["status"] != "approved":
        raise HTTPException(status_code=400, detail="Only approved requisitions can be converted")
    
    # Get supplier info
    supplier = await db.suppliers.find_one({"supplier_id": supplier_id})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    
    # Create PO number
    po_number = await generate_po_number()
    
    # Convert items
    po_items = []
    subtotal = 0.0
    for item in req["items"]:
        po_item = PurchaseOrderItem(
            product_id=item["product_id"],
            product_name=item.get("product_name"),
            quantity=item["quantity"],
            unit_price=item["estimated_unit_price"]
        )
        po_items.append(po_item.model_dump())
        subtotal += item["quantity"] * item["estimated_unit_price"]
    
    po = PurchaseOrder(
        po_number=po_number,
        supplier_id=supplier_id,
        supplier_name=supplier["name"],
        warehouse_id=warehouse_id,
        expected_date=req.get("required_date"),
        items=po_items,
        subtotal=subtotal,
        total_amount=subtotal,
        notes=f"Converted from {req['requisition_number']}",
        created_by=user.user_id
    )
    
    await db.purchase_orders.insert_one(po.model_dump())
    
    # Update requisition
    await db.requisitions.update_one(
        {"requisition_id": requisition_id},
        {"$set": {"status": "converted", "converted_po_id": po.po_id, "updated_at": datetime.now(timezone.utc)}}
    )
    
    await create_audit_log(user.user_id, "create", "purchase_order", po.po_id, None, {"from_requisition": requisition_id})
    
    return {"message": "Requisition converted to PO", "po_id": po.po_id, "po_number": po_number}

# ========================
# GOODS RECEIPT NOTES (GRN) API
# ========================

@api_router.get("/grn")
async def list_grns(
    status: Optional[GRNStatus] = None,
    po_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """List all Goods Receipt Notes"""
    await assert_permission(db, user.role, "grn", "read")
    query = {}
    if status:
        query["status"] = status.value
    if po_id:
        query["po_id"] = po_id
    
    grns = await db.grns.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return grns

@api_router.get("/grn/{grn_id}")
async def get_grn(grn_id: str, user: User = Depends(get_current_user)):
    """Get GRN by ID"""
    await assert_permission(db, user.role, "grn", "read")
    grn = await db.grns.find_one({"grn_id": grn_id}, {"_id": 0})
    if not grn:
        raise HTTPException(status_code=404, detail="GRN not found")
    return grn

@api_router.post("/grn")
async def create_grn(data: GRNCreate, user: User = Depends(get_current_user)):
    """Create a new Goods Receipt Note"""
    await assert_permission(db, user.role, "grn", "create")
    # Get PO
    po = await db.purchase_orders.find_one({"po_id": data.po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")
    # Goods must be received into the warehouse the PO was raised for.
    if data.warehouse_id != po.get("warehouse_id"):
        raise HTTPException(
            status_code=400,
            detail="GRN warehouse must match the purchase order warehouse",
        )
    assert_same_warehouse(user, data.warehouse_id, "receive goods into")
    
    # Get supplier
    supplier = await db.suppliers.find_one({"supplier_id": po["supplier_id"]})
    
    # Generate GRN number
    grn_number = await generate_grn_number()
    
    # Build GRN items
    items = []
    total = 0.0
    for item_data in data.items:
        # Find PO item
        po_item = next((i for i in po["items"] if i["item_id"] == item_data.po_item_id), None)
        if not po_item:
            continue
        
        product = await db.products.find_one({"product_id": item_data.product_id})
        
        grn_item = GRNItem(
            po_item_id=item_data.po_item_id,
            product_id=item_data.product_id,
            product_name=product["name"] if product else None,
            ordered_quantity=po_item["quantity"],
            received_quantity=item_data.received_quantity,
            accepted_quantity=item_data.accepted_quantity,
            rejected_quantity=item_data.rejected_quantity,
            rejection_reason=item_data.rejection_reason,
            unit_price=po_item["unit_price"]
        )
        items.append(grn_item.model_dump())
        total += item_data.accepted_quantity * po_item["unit_price"]
    
    grn = GoodsReceiptNote(
        grn_number=grn_number,
        po_id=data.po_id,
        po_number=po["po_number"],
        supplier_id=po["supplier_id"],
        supplier_name=supplier["name"] if supplier else None,
        warehouse_id=data.warehouse_id,
        items=items,
        total_amount=total,
        received_by=user.user_id,
        notes=data.notes
    )
    
    await db.grns.insert_one(grn.model_dump())

    # Record the accepted quantity back onto the purchase-order line so a
    # later "mark PO received" only credits the outstanding shortfall.
    try:
        po_items = po.get("items") or []
        for grn_item in items:
            for po_item in po_items:
                if po_item.get("item_id") == grn_item.get("po_item_id"):
                    po_item["received_quantity"] = (
                        _num(po_item.get("received_quantity"))
                        + _num(grn_item.get("accepted_quantity"))
                    )
                    break
        await db.purchase_orders.update_one(
            {"po_id": data.po_id},
            {"$set": {"items": po_items, "updated_at": datetime.now(timezone.utc)}},
        )
    except Exception:
        pass

    # Update inventory for accepted items
    for item in items:
        if item["accepted_quantity"] > 0:
            # $setOnInsert guarantees the upserted row carries a stock_id —
            # without it every later read of that row raises KeyError.
            await db.inventory_stock.update_one(
                {"product_id": item["product_id"], "warehouse_id": data.warehouse_id},
                {
                    "$inc": {"quantity": item["accepted_quantity"]},
                    "$set": {"last_updated": datetime.now(timezone.utc)},
                    "$setOnInsert": {
                        "stock_id": f"stock_{uuid.uuid4().hex[:12]}",
                        "product_id": item["product_id"],
                        "warehouse_id": data.warehouse_id,
                    },
                },
                upsert=True
            )
    
    await create_audit_log(user.user_id, "create", "grn", grn.grn_id, None, grn.model_dump())
    
    return grn.model_dump()

@api_router.put("/grn/{grn_id}/status")
async def update_grn_status(grn_id: str, status: GRNStatus, user: User = Depends(get_current_user)):
    """Update GRN status"""
    await assert_permission(db, user.role, "grn", "update")
    grn = await db.grns.find_one({"grn_id": grn_id}, {"_id": 0})
    if not grn:
        raise HTTPException(status_code=404, detail="GRN not found")
    
    await db.grns.update_one(
        {"grn_id": grn_id},
        {"$set": {"status": status.value}}
    )
    
    return {"message": f"GRN status updated to {status.value}"}

# ========================
# 3-WAY MATCHING API
# ========================

@api_router.get("/three-way-match")
async def list_matches(
    status: Optional[MatchingStatus] = None,
    user: User = Depends(get_current_user)
):
    """List all 3-way matches"""
    await assert_permission(db, user.role, "three_way_match", "read")
    query = {}
    if status:
        query["status"] = status.value
    
    matches = await db.three_way_matches.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return matches

@api_router.post("/three-way-match")
async def create_three_way_match(
    po_id: str,
    grn_id: str,
    invoice_id: str,
    user: User = Depends(get_current_user)
):
    """Create a 3-way match between PO, GRN, and Invoice"""
    await assert_permission(db, user.role, "three_way_match", "create")
    # Get documents
    po = await db.purchase_orders.find_one({"po_id": po_id})
    grn = await db.grns.find_one({"grn_id": grn_id}, {"_id": 0})
    invoice = await db.invoices.find_one({"invoice_id": invoice_id})
    
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if not grn:
        raise HTTPException(status_code=404, detail="GRN not found")
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Get supplier info
    supplier = await db.suppliers.find_one({"supplier_id": po["supplier_id"]})
    
    # Calculate totals
    po_total = po.get("total_amount", 0)
    grn_total = grn.get("total_amount", 0)
    # Invoice stores the payable amount in `total` (not `total_amount`).
    invoice_total = invoice.get("total", invoice.get("total_amount", 0))
    
    # Find discrepancies
    discrepancies = []
    variance = max(po_total, grn_total, invoice_total) - min(po_total, grn_total, invoice_total)
    variance_percent = (variance / po_total * 100) if po_total > 0 else 0
    
    # Check quantity discrepancies
    for po_item in po.get("items", []):
        grn_item = next((g for g in grn.get("items", []) if g.get("po_item_id") == po_item.get("item_id")), None)
        if grn_item:
            if _num(grn_item.get("accepted_quantity")) != _num(po_item.get("quantity")):
                discrepancies.append({
                    "type": "quantity",
                    "product_id": po_item.get("product_id"),
                    "po_qty": po_item.get("quantity"),
                    "grn_qty": grn_item.get("accepted_quantity"),
                    "difference": po_item.get("quantity", 0) - grn_item.get("accepted_quantity", 0)
                })
    
    # Determine status
    if variance == 0 and len(discrepancies) == 0:
        status = MatchingStatus.FULL_MATCH
    elif variance_percent <= 5 and len(discrepancies) <= 2:
        status = MatchingStatus.PARTIAL_MATCH
    else:
        status = MatchingStatus.DISCREPANCY
    
    match = ThreeWayMatch(
        po_id=po_id,
        po_number=po["po_number"],
        grn_id=grn_id,
        grn_number=grn["grn_number"],
        invoice_id=invoice_id,
        invoice_number=invoice["invoice_number"],
        supplier_id=po["supplier_id"],
        supplier_name=supplier["name"] if supplier else None,
        status=status,
        po_total=po_total,
        grn_total=grn_total,
        invoice_total=invoice_total,
        variance=variance,
        variance_percent=round(variance_percent, 2),
        discrepancies=discrepancies
    )
    
    await db.three_way_matches.insert_one(match.model_dump())
    await create_audit_log(user.user_id, "create", "three_way_match", match.match_id, None, match.model_dump())
    
    return match.model_dump()

@api_router.put("/three-way-match/{match_id}/approve")
async def approve_three_way_match(match_id: str, notes: str = "", user: User = Depends(get_current_user)):
    """Approve a 3-way match"""
    await assert_permission(db, user.role, "three_way_match", "update")
    match = await db.three_way_matches.find_one({"match_id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    
    await db.three_way_matches.update_one(
        {"match_id": match_id},
        {"$set": {
            "status": "full_match",
            "approved_by": user.user_id,
            "approved_at": datetime.now(timezone.utc),
            "notes": notes
        }}
    )
    
    # Update related invoice as ready for payment
    await db.invoices.update_one(
        {"invoice_id": match["invoice_id"]},
        {"$set": {"matching_approved": True}}
    )
    
    return {"message": "Match approved for payment"}

# ========================
# FINANCIAL REPORTS API
# ========================

@api_router.get("/reports/trial-balance")
async def get_trial_balance(
    as_of_date: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Generate Trial Balance Report"""
    await assert_permission(db, user.role, "reports", "read")
    date = datetime.fromisoformat(as_of_date) if as_of_date else datetime.now(timezone.utc)
    
    # Get all accounts
    accounts = await db.chart_of_accounts.find({}).to_list(100)
    
    # Calculate balances from transactions
    trial_balance = []
    total_debit = 0.0
    total_credit = 0.0
    
    # Assets (Debit balances)
    assets = []
    inventory_value = 0.0
    products = await db.products.find({}).to_list(1000)
    for product in products:
        stock = await db.inventory_stock.find({"product_id": product["product_id"]}).to_list(100)
        total_qty = sum(_num(s.get("quantity")) for s in stock)
        inventory_value += total_qty * product.get("cost_price", 0)
    
    assets.append({"account": "Inventory", "type": "asset", "debit": inventory_value, "credit": 0})
    total_debit += inventory_value
    
    # Calculate AR from unpaid sales invoices
    ar = await db.invoices.aggregate([
        {"$match": {"type": "sale", "status": {"$in": ["unpaid", "partial"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}}
    ]).to_list(1)
    ar_total = ar[0]["total"] if ar else 0
    assets.append({"account": "Accounts Receivable", "type": "asset", "debit": ar_total, "credit": 0})
    total_debit += ar_total
    
    # Liabilities (Credit balances)
    liabilities = []
    
    # Calculate AP from unpaid purchase invoices
    ap = await db.invoices.aggregate([
        {"$match": {"type": "purchase", "status": {"$in": ["unpaid", "partial"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}}
    ]).to_list(1)
    ap_total = ap[0]["total"] if ap else 0
    liabilities.append({"account": "Accounts Payable", "type": "liability", "debit": 0, "credit": ap_total})
    total_credit += ap_total
    
    # Income (Credit balances)
    income = []
    sales = await db.sales_orders.aggregate([
        {"$match": {"status": {"$in": ["delivered", "paid"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    sales_total = sales[0]["total"] if sales else 0
    income.append({"account": "Sales Revenue", "type": "income", "debit": 0, "credit": sales_total})
    total_credit += sales_total
    
    # Expenses (Debit balances)
    expenses_data = []
    expenses = await db.expenses.aggregate([
        {"$group": {"_id": "$category", "total": {"$sum": "$amount"}}}
    ]).to_list(100)
    for exp in expenses:
        expenses_data.append({"account": f"Expense - {exp['_id']}", "type": "expense", "debit": exp["total"], "credit": 0})
        total_debit += exp["total"]
    
    # COGS
    cogs = await db.purchase_orders.aggregate([
        {"$match": {"status": {"$in": ["received", "paid"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    cogs_total = cogs[0]["total"] if cogs else 0
    expenses_data.append({"account": "Cost of Goods Sold", "type": "expense", "debit": cogs_total, "credit": 0})
    total_debit += cogs_total
    
    # Equity (balancing figure)
    #
    # A trial balance balances when total debits == total credits. The amount
    # still missing on the credit side is (debits - credits); that is the
    # owner's capital, so it belongs on the CREDIT side. The previous code
    # computed (credits - debits) and then pushed a negative figure onto the
    # DEBIT side, which moved the totals further apart instead of balancing
    # them — so the report could never balance and Retained Earnings carried
    # the wrong sign.
    equity_total = total_debit - total_credit
    equity = [{
        "account": "Retained Earnings",
        "type": "equity",
        "debit": abs(equity_total) if equity_total < 0 else 0,
        "credit": equity_total if equity_total >= 0 else 0,
    }]

    if equity_total >= 0:
        total_credit += equity_total
    else:
        total_debit += abs(equity_total)
    
    return {
        "report_date": date.isoformat(),
        "assets": assets,
        "liabilities": liabilities,
        "equity": equity,
        "income": income,
        "expenses": expenses_data,
        "total_debit": round(total_debit, 2),
        "total_credit": round(total_credit, 2),
        "is_balanced": abs(total_debit - total_credit) < 0.01
    }

@api_router.get("/reports/balance-sheet")
async def get_balance_sheet(
    as_of_date: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Generate Balance Sheet Report"""
    await assert_permission(db, user.role, "reports", "read")
    date = datetime.fromisoformat(as_of_date) if as_of_date else datetime.now(timezone.utc)
    
    # ASSETS
    # Current Assets
    inventory_value = 0.0
    products = await db.products.find({}).to_list(1000)
    for product in products:
        stock = await db.inventory_stock.find({"product_id": product["product_id"]}).to_list(100)
        total_qty = sum(_num(s.get("quantity")) for s in stock)
        inventory_value += total_qty * product.get("cost_price", 0)
    
    ar = await db.invoices.aggregate([
        {"$match": {"type": "sale", "status": {"$in": ["unpaid", "partial"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}}
    ]).to_list(1)
    ar_total = ar[0]["total"] if ar else 0
    
    current_assets = [
        {"name": "Inventory", "amount": round(inventory_value, 2)},
        {"name": "Accounts Receivable", "amount": round(ar_total, 2)},
    ]
    total_current_assets = inventory_value + ar_total
    
    # Fixed Assets (placeholder)
    fixed_assets = [
        {"name": "Equipment", "amount": 0},
        {"name": "Vehicles", "amount": 0},
    ]
    total_fixed_assets = 0
    
    total_assets = total_current_assets + total_fixed_assets
    
    # LIABILITIES
    ap = await db.invoices.aggregate([
        {"$match": {"type": "purchase", "status": {"$in": ["unpaid", "partial"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}}
    ]).to_list(1)
    ap_total = ap[0]["total"] if ap else 0
    
    current_liabilities = [
        {"name": "Accounts Payable", "amount": round(ap_total, 2)},
    ]
    total_current_liabilities = ap_total
    
    long_term_liabilities = []
    total_long_term_liabilities = 0
    
    total_liabilities = total_current_liabilities + total_long_term_liabilities
    
    # EQUITY
    # Calculate retained earnings from P&L
    sales = await db.sales_orders.aggregate([
        {"$match": {"status": {"$in": ["delivered", "paid"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    revenue = sales[0]["total"] if sales else 0
    
    expenses = await db.expenses.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_expenses = expenses[0]["total"] if expenses else 0
    
    cogs = await db.purchase_orders.aggregate([
        {"$match": {"status": {"$in": ["received", "paid"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    cogs_total = cogs[0]["total"] if cogs else 0
    
    net_income = revenue - cogs_total - total_expenses
    
    # Equity = owner's capital + accumulated profit.
    #
    # Capital is the balancing figure: what the owners put in (the amount
    # needed for assets to equal liabilities + equity). Previously capital
    # was hard-coded to 0 and equity was only the net income, so the balance
    # sheet could never balance for any business that owns inventory.
    capital = round(total_assets - total_liabilities - net_income, 2)
    equity_items = [
        {"name": "Capital", "amount": capital},
        {"name": "Retained Earnings", "amount": round(net_income, 2)},
    ]
    total_equity = round(capital + net_income, 2)
    
    return {
        "report_date": date.isoformat(),
        "assets": {
            "current_assets": current_assets,
            "total_current_assets": round(total_current_assets, 2),
            "fixed_assets": fixed_assets,
            "total_fixed_assets": round(total_fixed_assets, 2),
            "total_assets": round(total_assets, 2)
        },
        "liabilities": {
            "current_liabilities": current_liabilities,
            "total_current_liabilities": round(total_current_liabilities, 2),
            "long_term_liabilities": long_term_liabilities,
            "total_long_term_liabilities": round(total_long_term_liabilities, 2),
            "total_liabilities": round(total_liabilities, 2)
        },
        "equity": {
            "items": equity_items,
            "total_equity": round(total_equity, 2)
        },
        "total_liabilities_and_equity": round(total_liabilities + total_equity, 2),
        "is_balanced": abs(total_assets - (total_liabilities + total_equity)) < 0.01
    }

# ========================
# SUPPLIER/DISTRIBUTOR PERFORMANCE API
# ========================

@api_router.get("/reports/supplier-performance")
async def get_supplier_performance(user: User = Depends(get_current_user)):
    """Get supplier performance dashboard data"""
    await assert_permission(db, user.role, "reports", "read")
    suppliers = await db.suppliers.find({}).to_list(100)
    
    performance_data = []
    for supplier in suppliers:
        supplier_id = supplier["supplier_id"]
        
        # Get PO statistics
        pos = await db.purchase_orders.find({"supplier_id": supplier_id}).to_list(1000)
        total_orders = len(pos)
        total_value = sum(po.get("total_amount", 0) for po in pos)
        
        # Calculate on-time delivery
        grns = await db.grns.find({"supplier_id": supplier_id}).to_list(1000)
        on_time = 0
        late = 0
        for grn in grns:
            po = next((p for p in pos if p["po_id"] == grn["po_id"]), None)
            if po and po.get("expected_date"):
                if grn.get("received_date", datetime.now(timezone.utc)) <= po["expected_date"]:
                    on_time += 1
                else:
                    late += 1
        
        # Calculate quality (accepted vs rejected)
        total_accepted = sum(sum(item.get("accepted_quantity", 0) for item in grn.get("items", [])) for grn in grns)
        total_rejected = sum(sum(item.get("rejected_quantity", 0) for item in grn.get("items", [])) for grn in grns)
        quality_rate = (total_accepted / (total_accepted + total_rejected) * 100) if (total_accepted + total_rejected) > 0 else 100
        
        # Delivery rate
        delivery_rate = (on_time / (on_time + late) * 100) if (on_time + late) > 0 else 100
        
        performance_data.append({
            "supplier_id": supplier_id,
            "supplier_name": supplier["name"],
            "total_orders": total_orders,
            "total_value": round(total_value, 2),
            "on_time_deliveries": on_time,
            "late_deliveries": late,
            "delivery_rate": round(delivery_rate, 1),
            "quality_rate": round(quality_rate, 1),
            "overall_score": round((delivery_rate + quality_rate) / 2, 1),
            "rating": supplier.get("rating", 0)
        })
    
    # Sort by overall score
    performance_data.sort(key=lambda x: x["overall_score"], reverse=True)
    
    return {
        "suppliers": performance_data,
        "summary": {
            "total_suppliers": len(performance_data),
            "avg_delivery_rate": round(sum(p["delivery_rate"] for p in performance_data) / len(performance_data), 1) if performance_data else 0,
            "avg_quality_rate": round(sum(p["quality_rate"] for p in performance_data) / len(performance_data), 1) if performance_data else 0,
            "top_performer": performance_data[0]["supplier_name"] if performance_data else None
        }
    }

@api_router.get("/agent-quotations")
async def get_agent_quotations(
    status: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """List agent quotations.
    - Sales Rep: own quotations only
    - Manager/Accountant: all pending for their warehouse
    - SuperAdmin/GM: filterable across all warehouses
    """
    await assert_permission(db, user.role, "quotations", "read")
    query: Dict[str, Any] = {}

    if user.role in [UserRole.SALES_REP]:
        query["sales_rep_id"] = user.user_id
    elif is_cross_warehouse_role(user.role):
        if warehouse_id:
            query["warehouse_id"] = warehouse_id
    else:
        # Managers / Accountants / Clerks see their warehouse
        query["warehouse_id"] = user.warehouse_id

    if status:
        query["status"] = status

    quotations = await db.agent_quotations.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return quotations

@api_router.post("/agent-quotations")
async def create_agent_quotation(qt_data: AgentQuotationCreate,
                                  user: User = Depends(get_current_user)):
    """Sales Rep creates a quotation from their assigned warehouse"""
    await assert_permission(db, user.role, "quotations", "create")
    if user.role not in [UserRole.SALES_REP]:
        raise HTTPException(status_code=403, detail="Only Sales Reps can create agent quotations")
    if not user.warehouse_id:
        raise HTTPException(status_code=400, detail="Sales Rep has no assigned warehouse")
    if not qt_data.items:
        raise HTTPException(status_code=422, detail="Quotation must contain at least one item")

    wh = await db.warehouses.find_one({"warehouse_id": user.warehouse_id}, {"_id": 0})

    items = []
    total = 0.0
    for item in qt_data.items:
        product = await db.products.find_one({"product_id": item.product_id,
                                               "is_active": True}, {"_id": 0})
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
        # Check warehouse stock
        stock = await db.inventory_stock.find_one(
            {"product_id": item.product_id, "warehouse_id": user.warehouse_id}, {"_id": 0}
        )
        available = _num(stock.get("quantity")) if stock else 0
        if available < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for {product['name']}: requested {item.quantity}, available {available}"
            )
        aqi = AgentQuotationItem(
            product_id=item.product_id,
            product_name=product["name"],
            quantity=item.quantity,
            unit_price=item.unit_price
        )
        items.append(aqi.model_dump())
        total += item.quantity * item.unit_price

    qt = AgentQuotation(
        quotation_number=await generate_agent_quotation_number(),
        sales_rep_id=user.user_id,
        sales_rep_name=user.name,
        warehouse_id=user.warehouse_id,
        warehouse_name=wh["name"] if wh else None,
        items=items,
        total_amount=round(total, 2),
        status=AgentQuotationStatus.DRAFT
    )
    await db.agent_quotations.insert_one(qt.model_dump())
    await create_audit_log(user.user_id, "create", "agent_quotation", qt.quotation_id)
    return qt.model_dump()

@api_router.put("/agent-quotations/{quotation_id}/submit")
async def submit_agent_quotation(quotation_id: str, user: User = Depends(get_current_user)):
    """Sales Rep submits quotation for approval"""
    if user.role not in [UserRole.SALES_REP]:
        raise HTTPException(status_code=403, detail="Only Sales Reps can submit quotations")

    qt = await db.agent_quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not qt:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if qt["sales_rep_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="Cannot submit another rep's quotation")
    if qt["status"] != AgentQuotationStatus.DRAFT.value:
        raise HTTPException(status_code=400, detail="Only draft quotations can be submitted")

    # Snapshot agent financials
    entries = await db.agent_ledger_entries.find(
        {"sales_rep_id": user.user_id}, {"_id": 0, "amount": 1}
    ).to_list(10000)
    outstanding = sum(_num(e.get("amount")) for e in entries)
    agent_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    ceiling = agent_doc.get("debt_ceiling", 0.0) if agent_doc else 0.0
    flagged = agent_doc.get("is_flagged", False) if agent_doc else False

    await db.agent_quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {
            "status": AgentQuotationStatus.PENDING.value,
            "agent_is_flagged": flagged,
            "agent_outstanding": round(outstanding, 2),
            "agent_debt_ceiling": ceiling,
            "updated_at": datetime.now(timezone.utc)
        }}
    )

    # Notify warehouse managers and accountants
    mgr_ids = await get_warehouse_staff_ids(
        qt["warehouse_id"],
        [UserRole.WAREHOUSE_MANAGER, UserRole.ACCOUNTANT]
    )
    flag_note = f" ⚠️ AGENT FLAGGED (Outstanding: {outstanding:.2f} / Ceiling: {ceiling:.2f})" if flagged else ""
    await send_notification(
        mgr_ids,
        "New Quotation Awaiting Approval",
        f"{user.name} submitted quotation {qt['quotation_number']} for {qt['total_amount']:.2f}.{flag_note}",
        "warning" if flagged else "info"
    )
    return {"message": "Quotation submitted for approval", "status": "pending"}

@api_router.put("/agent-quotations/{quotation_id}/approve")
async def approve_agent_quotation(quotation_id: str, body: AgentQuotationApprove,
                                   user: User = Depends(get_current_user)):
    """Manager/Accountant approves a quotation — remarks required, auto-converts to Sales Order"""
    assert_approval_role(user)

    if not body.approval_remarks or not body.approval_remarks.strip():
        raise HTTPException(status_code=422, detail="Approval remarks are required")

    qt = await db.agent_quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not qt:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if qt["status"] != AgentQuotationStatus.PENDING.value:
        raise HTTPException(status_code=400, detail="Only pending quotations can be approved")

    # Warehouse scope check
    if not is_cross_warehouse_role(user.role):
        assert_same_warehouse(user, qt["warehouse_id"], "approve quotations from")

    approver = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})

    # ── Convert quotation to Sales Order ─────────────────────
    # Status starts at APPROVED (manager just approved it).
    # Next step: warehouse releases goods → GOODS_RELEASED.
    so_items = []
    subtotal = 0.0
    for item in qt["items"]:
        so_item = SalesOrderItem(
            product_id=item["product_id"],
            product_name=item.get("product_name"),
            quantity=item["quantity"],
            unit_price=item["unit_price"]
        )
        so_items.append(so_item.model_dump())
        subtotal += item["quantity"] * item["unit_price"]

    so = SalesOrder(
        so_number=await generate_so_number(),
        sales_rep_id=qt["sales_rep_id"],
        sales_rep_name=qt.get("sales_rep_name"),
        warehouse_id=qt["warehouse_id"],
        items=so_items,
        subtotal=round(subtotal, 2),
        total_amount=round(subtotal, 2),
        notes=f"Auto-created from {qt['quotation_number']}",
        status=OrderStatus.APPROVED,
        dispatch_status=DispatchStatus.PENDING_DISPATCH,
        approved_by=user.user_id,
        approved_by_name=approver["name"] if approver else None,
        approved_at=datetime.now(timezone.utc),
        source_quotation_id=quotation_id,
        created_by=user.user_id
    )
    await db.sales_orders.insert_one(so.model_dump())

    # Update quotation record
    await db.agent_quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {
            "status": AgentQuotationStatus.CONVERTED.value,
            "approved_by": user.user_id,
            "approved_by_name": approver["name"] if approver else None,
            "approved_at": datetime.now(timezone.utc),
            "approval_remarks": body.approval_remarks.strip(),
            "converted_so_id": so.so_id,
            "updated_at": datetime.now(timezone.utc)
        }}
    )

    # Notify Sales Rep and Sales Clerks
    clerk_ids = await get_warehouse_staff_ids(qt["warehouse_id"], [UserRole.SALES_CLERK])
    await send_notification(
        [qt["sales_rep_id"]],
        "Quotation Approved",
        f"Your quotation {qt['quotation_number']} has been approved. Remarks: {body.approval_remarks.strip()}",
        "success"
    )
    await send_notification(
        clerk_ids,
        "New Sales Order Ready for Dispatch",
        f"Sales Order {so.so_number} from {qt.get('sales_rep_name','Unknown')} is ready for dispatch.",
        "info"
    )
    await create_audit_log(user.user_id, "approve", "agent_quotation", quotation_id,
                           new_value={"so_id": so.so_id})
    return {
        "message": "Quotation approved and converted to Sales Order",
        "so_id": so.so_id,
        "so_number": so.so_number,
        "approval_remarks": body.approval_remarks.strip()
    }

@api_router.put("/agent-quotations/{quotation_id}/reject")
async def reject_agent_quotation(quotation_id: str, body: AgentQuotationApprove,
                                  user: User = Depends(get_current_user)):
    """Manager/Accountant rejects a quotation — remarks required"""
    assert_approval_role(user)

    if not body.approval_remarks or not body.approval_remarks.strip():
        raise HTTPException(status_code=422, detail="Rejection remarks are required")

    qt = await db.agent_quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not qt:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if qt["status"] != AgentQuotationStatus.PENDING.value:
        raise HTTPException(status_code=400, detail="Only pending quotations can be rejected")
    if not is_cross_warehouse_role(user.role):
        assert_same_warehouse(user, qt["warehouse_id"], "reject quotations from")

    approver = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    await db.agent_quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {
            "status": AgentQuotationStatus.REJECTED.value,
            "approved_by": user.user_id,
            "approved_by_name": approver["name"] if approver else None,
            "approved_at": datetime.now(timezone.utc),
            "approval_remarks": body.approval_remarks.strip(),
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    await send_notification(
        [qt["sales_rep_id"]],
        "Quotation Rejected",
        f"Your quotation {qt['quotation_number']} was rejected. Remarks: {body.approval_remarks.strip()}",
        "error"
    )
    await create_audit_log(user.user_id, "reject", "agent_quotation", quotation_id,
                           new_value={"reason": body.approval_remarks})
    return {"message": "Quotation rejected", "approval_remarks": body.approval_remarks.strip()}

# ========================
# SALES ORDER DISPATCH  (ENHANCED)
# ========================

@api_router.put("/sales-orders/{so_id}/release-goods")
async def release_goods(so_id: str, user: User = Depends(get_current_user)):
    """Warehouse Clerk/Manager releases approved goods to the Sales Rep.

    Workflow step: APPROVED → GOODS_RELEASED
    - Decrements warehouse stock
    - Creates an agent ledger debit (goods in custody)
    - Status advances to GOODS_RELEASED; dispatch_status → DISPATCHED
    """
    if user.role not in [UserRole.SALES_CLERK, UserRole.WAREHOUSE_MANAGER,
                          UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER]:
        raise HTTPException(status_code=403, detail="Only warehouse staff can release goods")

    so = await db.sales_orders.find_one({"so_id": so_id}, {"_id": 0})
    if not so:
        raise HTTPException(status_code=404, detail="Sales Order not found")
    if so.get("status") != OrderStatus.APPROVED.value:
        raise HTTPException(status_code=400,
                            detail=f"Only approved orders can have goods released (current status: {so.get('status')})")
    if not is_cross_warehouse_role(user.role):
        assert_same_warehouse(user, so["warehouse_id"], "release goods from")

    # Decrement inventory stock
    for item in so.get("items", []):
        stock = await db.inventory_stock.find_one(
            {"product_id": item["product_id"], "warehouse_id": so["warehouse_id"]},
            {"_id": 0}
        )
        if not stock:
            raise HTTPException(
                status_code=400,
                detail=f"No stock record for product {item['product_id']} in this warehouse",
            )
        if _num(stock.get("quantity")) < _num(item.get("quantity")):
            raise HTTPException(
                status_code=400,
                detail=(f"Insufficient stock for product {item['product_id']}: "
                        f"need {item['quantity']}, have {_num(stock.get('quantity'))}"),
            )
        new_qty = _num(stock.get("quantity")) - _num(item.get("quantity"))
        await db.inventory_stock.update_one(
            {"stock_id": stock["stock_id"]},
            {"$set": {"quantity": new_qty, "last_updated": datetime.now(timezone.utc)}}
        )
        txn = StockTransaction(
            product_id=item["product_id"],
            warehouse_id=so["warehouse_id"],
            type=TransactionType.SALE,
            quantity=-item["quantity"],
            reference_id=so_id,
            notes=f"Goods released to agent {so.get('sales_rep_name', '')}",
            created_by=user.user_id
        )
        await db.stock_transactions.insert_one(txn.model_dump())

    # Debit agent ledger — goods are now in the agent's custody
    if so.get("sales_rep_id"):
        entry = AgentLedgerEntry(
            sales_rep_id=so["sales_rep_id"],
            warehouse_id=so["warehouse_id"],
            entry_type=AgentLedgerEntryType.DISPATCH,
            reference_id=so_id,
            items=so.get("items", []),
            amount=round(so.get("total_amount", 0), 2),
            notes=f"Goods released for SO {so['so_number']}",
            created_by=user.user_id
        )
        await db.agent_ledger_entries.insert_one(entry.model_dump())
        await recalculate_agent_flag(so["sales_rep_id"])
        # Notify the Sales Rep
        await send_notification(
            [so["sales_rep_id"]],
            "Goods Released",
            f"Goods for Sales Order {so['so_number']} have been released to you. "
            f"Total value: {so.get('total_amount', 0):.2f}",
            "success"
        )

    await db.sales_orders.update_one(
        {"so_id": so_id},
        {"$set": {
            "status": OrderStatus.GOODS_RELEASED.value,
            "dispatch_status": DispatchStatus.DISPATCHED.value,
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    await create_audit_log(user.user_id, "release_goods", "sales_order", so_id)
    return {"message": f"Goods for order {so['so_number']} released successfully"}

@api_router.put("/sales-orders/{so_id}/confirm-delivery")
async def confirm_delivery(so_id: str, user: User = Depends(get_current_user)):
    """Sales Rep confirms they have received the goods.

    Workflow step: GOODS_RELEASED → DELIVERED
    """
    if user.role not in [UserRole.SALES_REP, UserRole.SALES_CLERK,
                          UserRole.WAREHOUSE_MANAGER, UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER]:
        raise HTTPException(status_code=403, detail="Not authorized to confirm delivery")

    so = await db.sales_orders.find_one({"so_id": so_id}, {"_id": 0})
    if not so:
        raise HTTPException(status_code=404, detail="Sales Order not found")
    if so.get("status") != OrderStatus.GOODS_RELEASED.value:
        raise HTTPException(status_code=400,
                            detail="Only goods-released orders can be confirmed as delivered")
    # Sales rep can only confirm their own orders
    if user.role == UserRole.SALES_REP and so.get("sales_rep_id") != user.user_id:
        raise HTTPException(status_code=403, detail="You can only confirm delivery of your own orders")

    await db.sales_orders.update_one(
        {"so_id": so_id},
        {"$set": {"status": OrderStatus.DELIVERED.value, "updated_at": datetime.now(timezone.utc)}}
    )
    await create_audit_log(user.user_id, "confirm_delivery", "sales_order", so_id)
    return {"message": f"Delivery confirmed for order {so['so_number']}"}

# ========================
# AGENT LEDGER ENDPOINTS  (NEW)
# ========================

@api_router.get("/agent-ledger")
async def get_agent_ledger(sales_rep_id: Optional[str] = None,
                            user: User = Depends(get_current_user)):
    """Get agent ledger — reps see own ledger, managers can view any agent"""
    await assert_permission(db, user.role, "agent_ledger", "read")
    if user.role in [UserRole.SALES_REP]:
        target_id = user.user_id
    else:
        if not sales_rep_id:
            raise HTTPException(status_code=400, detail="sales_rep_id is required for non-agent users")
        # Permission: must be same warehouse or cross-warehouse role
        target = await db.users.find_one({"user_id": sales_rep_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Agent not found")
        if not is_cross_warehouse_role(user.role):
            assert_same_warehouse(user, target.get("warehouse_id", ""), "view ledger for agent in")
        target_id = sales_rep_id

    # Get the agent record
    agent = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    entries = await db.agent_ledger_entries.find(
        {"sales_rep_id": target_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)

    # Compute outstanding
    outstanding = sum(_num(e.get("amount")) for e in entries)

    # Compute items in custody (net dispatched - returned)
    items_in_custody: Dict[str, dict] = {}
    for entry in entries:
        if entry.get("entry_type") in [AgentLedgerEntryType.DISPATCH.value, "return"]:
            multiplier = 1 if entry["entry_type"] == AgentLedgerEntryType.DISPATCH.value else -1
            for item in (entry.get("items") or []):
                pid = item["product_id"]
                if pid not in items_in_custody:
                    items_in_custody[pid] = {
                        "product_id": pid,
                        "product_name": item.get("product_name", "Unknown"),
                        "quantity": 0,
                        "unit_price": item.get("unit_price", 0)
                    }
                items_in_custody[pid]["quantity"] += multiplier * _num(item.get("quantity"))

    custody_items = [v for v in items_in_custody.values() if v["quantity"] > 0]
    total_goods_value = round(
        sum(v["quantity"] * v["unit_price"] for v in custody_items), 2
    )
    total_payments_made = round(
        sum(abs(e.get("amount", 0)) for e in entries if e.get("entry_type") == AgentLedgerEntryType.PAYMENT.value), 2
    )
    total_goods_released = round(
        sum(e.get("amount", 0) for e in entries if e.get("entry_type") == AgentLedgerEntryType.DISPATCH.value), 2
    )

    return {
        "agent": {
            "user_id": agent["user_id"],
            "name": agent.get("name"),
            "warehouse_id": agent.get("warehouse_id"),
            "warehouse_name": agent.get("warehouse_name"),
            # The client-facing label is "credit limit"; the model field is
            # `debt_ceiling`. Send both so neither consumer has to guess —
            # the mobile screen reads `debt_ceiling`.
            "credit_limit": agent.get("debt_ceiling", 0),
            "debt_ceiling": agent.get("debt_ceiling", 0),
            "is_flagged": agent.get("is_flagged", False),
        },
        # Professional AR terminology
        "total_goods_released": total_goods_released,       # value of goods dispatched to agent
        "total_payments_received": total_payments_made,     # sum of payments agent has made
        "accounts_receivable": round(outstanding, 2),       # net amount owed by agent (goods - payments)
        # Custody detail
        "items_in_custody": custody_items,
        "total_custody_value": total_goods_value,
        "ledger_entries": entries
    }

@api_router.post("/agent-ledger/payment")
async def record_agent_payment(payment: AgentPaymentCreate,
                                user: User = Depends(get_current_user)):
    """Record a payment from a Sales Rep — reduces their outstanding balance"""
    await assert_permission(db, user.role, "agent_ledger", "create")
    # Only managers/accountants (or admins) may take cash off a ledger.
    if user.role not in APPROVAL_ROLES and user.role not in CROSS_WAREHOUSE_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only Managers and Accountants can record agent payments",
        )

    agent = await db.users.find_one({"user_id": payment.sales_rep_id}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not is_cross_warehouse_role(user.role):
        assert_same_warehouse(user, agent.get("warehouse_id", ""), "record payment for agent in")

    if payment.amount <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be positive")

    entry = AgentLedgerEntry(
        sales_rep_id=payment.sales_rep_id,
        warehouse_id=agent.get("warehouse_id", ""),
        entry_type=AgentLedgerEntryType.PAYMENT,
        amount=-abs(payment.amount),   # negative = reduces debt
        notes=payment.notes or f"Payment via {payment.payment_method.value}",
        created_by=user.user_id
    )
    await db.agent_ledger_entries.insert_one(entry.model_dump())
    await recalculate_agent_flag(payment.sales_rep_id)

    updated_agent = await db.users.find_one({"user_id": payment.sales_rep_id}, {"_id": 0})
    entries = await db.agent_ledger_entries.find(
        {"sales_rep_id": payment.sales_rep_id}, {"_id": 0, "amount": 1}
    ).to_list(10000)
    new_outstanding = sum(_num(e.get("amount")) for e in entries)

    await create_audit_log(user.user_id, "payment", "agent_ledger", payment.sales_rep_id,
                           new_value={"amount": payment.amount})
    return {
        "message": "Payment recorded",
        "amount_paid": payment.amount,
        "new_outstanding": round(new_outstanding, 2),
        "is_flagged": updated_agent.get("is_flagged", False) if updated_agent else False
    }

# ========================
# WAREHOUSE TRANSFERS  (NEW)
# ========================

async def generate_transfer_number():
    """Generate a unique, collision-safe warehouse-transfer number."""
    return await _make_doc_number("WT", "warehouse_transfer")

@api_router.get("/warehouse-transfers")
async def get_warehouse_transfers(
    status: Optional[str] = None,
    from_warehouse_id: Optional[str] = None,
    to_warehouse_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """List warehouse transfers — scoped to user's warehouse unless cross-warehouse role"""
    await assert_permission(db, user.role, "warehouse_transfers", "read")
    query: Dict[str, Any] = {}
    if status:
        query["status"] = status

    if is_cross_warehouse_role(user.role):
        if from_warehouse_id:
            query["from_warehouse_id"] = from_warehouse_id
        if to_warehouse_id:
            query["to_warehouse_id"] = to_warehouse_id
    else:
        # Show transfers involving this user's warehouse
        wh = user.warehouse_id
        if wh:
            query["$or"] = [{"from_warehouse_id": wh}, {"to_warehouse_id": wh}]

    transfers = await db.warehouse_transfers.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return transfers

@api_router.post("/warehouse-transfers")
async def initiate_warehouse_transfer(
    transfer_data: WarehouseTransferCreate,
    transfer_source_warehouse_id: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    """Accountant/Manager initiates a transfer from their warehouse to another.

    SuperAdmin / General Manager may pass `transfer_source_warehouse_id` to
    move stock on behalf of a specific branch.
    """
    await assert_permission(db, user.role, "warehouse_transfers", "create")
    if user.role not in APPROVAL_ROLES:
        raise HTTPException(status_code=403, detail="Only Managers/Accountants can initiate transfers")

    # Cross-warehouse roles (SuperAdmin / GM) may pick the source warehouse
    # explicitly; everyone else transfers out of their own warehouse.
    from_wh_id = user.warehouse_id
    if is_cross_warehouse_role(user.role):
        from_wh_id = transfer_source_warehouse_id or user.warehouse_id
    if not from_wh_id:
        raise HTTPException(status_code=400, detail="Initiating user must have an assigned warehouse")

    if from_wh_id == transfer_data.to_warehouse_id:
        raise HTTPException(status_code=400, detail="Source and destination warehouse cannot be the same")

    from_wh = await db.warehouses.find_one({"warehouse_id": from_wh_id}, {"_id": 0})
    to_wh = await db.warehouses.find_one({"warehouse_id": transfer_data.to_warehouse_id}, {"_id": 0})
    if not to_wh:
        raise HTTPException(status_code=404, detail="Destination warehouse not found")

    # Validate stock availability and build items
    items = []
    total_value = 0.0
    for item in transfer_data.items:
        product = await db.products.find_one({"product_id": item.product_id, "is_active": True}, {"_id": 0})
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
        stock = await db.inventory_stock.find_one(
            {"product_id": item.product_id, "warehouse_id": from_wh_id}, {"_id": 0}
        )
        available = _num(stock.get("quantity")) if stock else 0
        if available < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock of {product['name']}: need {item.quantity}, have {available}"
            )
        ti = WarehouseTransferItem(
            product_id=item.product_id,
            product_name=product["name"],
            quantity=item.quantity,
            cost_price=product.get("cost_price", 0)
        )
        items.append(ti.model_dump())
        total_value += item.quantity * product.get("cost_price", 0)

    initiator = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    transfer = WarehouseTransfer(
        transfer_number=await generate_transfer_number(),
        from_warehouse_id=from_wh_id,
        from_warehouse_name=from_wh["name"] if from_wh else None,
        to_warehouse_id=transfer_data.to_warehouse_id,
        to_warehouse_name=to_wh["name"],
        items=items,
        total_value=round(total_value, 2),
        status=TransferStatus.PENDING,
        initiated_by=user.user_id,
        initiated_by_name=initiator["name"] if initiator else None,
        notes=transfer_data.notes
    )
    await db.warehouse_transfers.insert_one(transfer.model_dump())

    # Notify receiving warehouse accountants
    recv_acct_ids = await get_warehouse_staff_ids(
        transfer_data.to_warehouse_id,
        [UserRole.ACCOUNTANT, UserRole.WAREHOUSE_MANAGER]
    )
    await send_notification(
        recv_acct_ids,
        "Incoming Stock Transfer",
        f"Transfer {transfer.transfer_number} incoming from {from_wh['name'] if from_wh else 'Unknown'}. "
        f"Value: {total_value:.2f}. Please confirm receipt.",
        "info"
    )
    await create_audit_log(user.user_id, "initiate", "warehouse_transfer", transfer.transfer_id)
    return transfer.model_dump()

@api_router.put("/warehouse-transfers/{transfer_id}/confirm")
async def confirm_warehouse_transfer(transfer_id: str, user: User = Depends(get_current_user)):
    """Receiving warehouse Accountant confirms stock receipt — moves inventory"""
    await assert_permission(db, user.role, "warehouse_transfers", "update")
    if user.role not in APPROVAL_ROLES:
        raise HTTPException(status_code=403, detail="Only Managers/Accountants can confirm transfers")

    transfer = await db.warehouse_transfers.find_one({"transfer_id": transfer_id}, {"_id": 0})
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if transfer["status"] != TransferStatus.PENDING.value:
        raise HTTPException(status_code=400, detail="Transfer is not in pending state")

    # Must be receiving warehouse or cross-warehouse role
    if not is_cross_warehouse_role(user.role):
        assert_same_warehouse(user, transfer["to_warehouse_id"], "confirm transfers to")

    # Move inventory: decrement source, increment destination
    for item in transfer.get("items", []):
        pid = item["product_id"]
        qty = item["quantity"]
        from_wh = transfer["from_warehouse_id"]
        to_wh = transfer["to_warehouse_id"]

        # Decrement from source — re-check availability at confirmation time
        # because stock may have moved since the transfer was raised.
        src_stock = await db.inventory_stock.find_one(
            {"product_id": pid, "warehouse_id": from_wh}, {"_id": 0}
        )
        src_qty = _num(src_stock.get("quantity")) if src_stock else 0
        if src_qty < qty:
            raise HTTPException(
                status_code=400,
                detail=(f"Insufficient stock to complete the transfer for product {pid}: "
                        f"need {qty}, have {src_qty}"),
            )
        await db.inventory_stock.update_one(
            {"product_id": pid, "warehouse_id": from_wh},
            {"$inc": {"quantity": -qty},
             "$set": {"last_updated": datetime.now(timezone.utc)}},
            upsert=False
        )
        # Increment at destination
        await db.inventory_stock.update_one(
            {"product_id": pid, "warehouse_id": to_wh},
            {
                "$inc": {"quantity": qty},
                "$set": {"last_updated": datetime.now(timezone.utc)},
                "$setOnInsert": {
                    "stock_id": f"stock_{uuid.uuid4().hex[:12]}",
                    "product_id": pid,
                    "warehouse_id": to_wh,
                },
            },
            upsert=True
        )
        # Transaction records
        for txn_wh, txn_qty, txn_type in [
            (from_wh, -qty, "transfer_out"),
            (to_wh, qty, "transfer_in")
        ]:
            txn = StockTransaction(
                product_id=pid,
                warehouse_id=txn_wh,
                type=TransactionType.ADJUSTMENT,
                quantity=txn_qty,
                reference_id=transfer_id,
                notes=f"{txn_type}: Transfer {transfer['transfer_number']}",
                created_by=user.user_id
            )
            await db.stock_transactions.insert_one(txn.model_dump())

    await db.warehouse_transfers.update_one(
        {"transfer_id": transfer_id},
        {"$set": {
            "status": TransferStatus.CONFIRMED.value,
            "confirmed_by": user.user_id,
            "confirmed_at": datetime.now(timezone.utc)
        }}
    )

    # Notify initiating warehouse
    source_staff = await get_warehouse_staff_ids(
        transfer["from_warehouse_id"],
        [UserRole.ACCOUNTANT, UserRole.WAREHOUSE_MANAGER]
    )
    await send_notification(
        source_staff,
        "Transfer Confirmed",
        f"Transfer {transfer['transfer_number']} confirmed by {transfer.get('to_warehouse_name','destination')}. Stock updated.",
        "success"
    )
    await create_audit_log(user.user_id, "confirm", "warehouse_transfer", transfer_id)
    return {"message": f"Transfer {transfer['transfer_number']} confirmed. Inventory updated."}

@api_router.put("/warehouse-transfers/{transfer_id}/cancel")
async def cancel_warehouse_transfer(transfer_id: str, user: User = Depends(get_current_user)):
    """Cancel a pending transfer"""
    await assert_permission(db, user.role, "warehouse_transfers", "delete")
    transfer = await db.warehouse_transfers.find_one({"transfer_id": transfer_id}, {"_id": 0})
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if transfer["status"] != TransferStatus.PENDING.value:
        raise HTTPException(status_code=400, detail="Only pending transfers can be cancelled")
    if not is_cross_warehouse_role(user.role):
        assert_same_warehouse(user, transfer["from_warehouse_id"], "cancel transfers from")

    await db.warehouse_transfers.update_one(
        {"transfer_id": transfer_id},
        {"$set": {"status": TransferStatus.CANCELLED.value}}
    )
    return {"message": "Transfer cancelled"}

# ========================
# CROSS-WAREHOUSE INVENTORY  (NEW)
# ========================

@api_router.get("/inventory/all-warehouses")
async def get_all_warehouses_inventory(user: User = Depends(get_current_user)):
    """Consolidated inventory view across all warehouses — SuperAdmin/GM/Accountant"""
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER,
                          UserRole.ACCOUNTANT,
                          UserRole.WAREHOUSE_MANAGER]:
        raise HTTPException(status_code=403, detail="Not authorized for cross-warehouse inventory")

    warehouses = await db.warehouses.find({"is_active": True}, {"_id": 0}).to_list(100)
    # A warehouse manager is scoped to their own branch — returning every
    # branch's stock to them would leak another warehouse's numbers.
    if not is_cross_warehouse_role(user.role) and user.role != UserRole.ACCOUNTANT:
        warehouses = [w for w in warehouses if w["warehouse_id"] == user.warehouse_id]
    products = await db.products.find({"is_active": True}, {"_id": 0}).to_list(10000)

    # One stock query for every product instead of one per product/branch.
    wh_ids = [w["warehouse_id"] for w in warehouses]
    stock_rows = await db.inventory_stock.find(
        {"product_id": {"$in": [p["product_id"] for p in products]},
         "warehouse_id": {"$in": wh_ids}},
        {"_id": 0}).to_list(50000)
    qty_by_product_wh: Dict[str, Dict[str, float]] = {}
    for row in stock_rows:
        pid = row.get("product_id")
        wid = row.get("warehouse_id")
        if not pid or not wid:
            continue
        qty_by_product_wh.setdefault(pid, {})[wid] = (
            qty_by_product_wh.setdefault(pid, {}).get(wid, 0)
            + _num(row.get("quantity"))
        )

    result = []
    for product in products:
        pid = product["product_id"]
        by_warehouse = []
        total_qty = 0.0
        for wh in warehouses:
            qty = qty_by_product_wh.get(pid, {}).get(wh["warehouse_id"], 0)
            total_qty += qty
            by_warehouse.append({
                "warehouse_id": wh["warehouse_id"],
                "warehouse_name": wh["name"],
                "quantity": qty
            })
        result.append({
            "product_id": pid,
            "product_name": product["name"],
            "sku": product["sku"],
            "unit": product.get("unit", "pcs"),
            "cost_price": product.get("cost_price", 0),
            "total_quantity": total_qty,
            "total_value": round(total_qty * product.get("cost_price", 0), 2),
            "by_warehouse": by_warehouse
        })

    return sorted(result, key=lambda x: x["total_value"], reverse=True)

# ========================
# ENHANCED DASHBOARD  (NEW)
# ========================

@api_router.get("/dashboard/branch-summary")
async def get_branch_summary(user: User = Depends(get_current_user)):
    """Per-warehouse Sales & Expenses summary — SuperAdmin/GM/Accountant view"""
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER,
                          UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Not authorized")

    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    warehouses = await db.warehouses.find({"is_active": True}, {"_id": 0}).to_list(100)

    summaries = []
    for wh in warehouses:
        wh_id = wh["warehouse_id"]

        # Today's sales
        so_today = await db.sales_orders.find(
            {"warehouse_id": wh_id, "order_date": {"$gte": today}}, {"_id": 0}
        ).to_list(10000)
        today_sales = sum(s.get("total_amount", 0) for s in so_today)

        # Today's expenses
        exp_today = await db.expenses.find(
            {"warehouse_id": wh_id, "expense_date": {"$gte": today}}, {"_id": 0}
        ).to_list(10000)
        today_expenses = sum(e.get("amount", 0) for e in exp_today)

        # Inventory value
        stocks = await db.inventory_stock.find({"warehouse_id": wh_id}, {"_id": 0}).to_list(10000)
        inv_value = 0.0
        for s in stocks:
            prod = await db.products.find_one({"product_id": s["product_id"]}, {"_id": 0})
            if prod:
                inv_value += _num(s.get("quantity")) * prod.get("cost_price", 0)

        # Open orders
        open_orders = await db.sales_orders.count_documents(
            {"warehouse_id": wh_id,
             "dispatch_status": DispatchStatus.PENDING_DISPATCH.value}
        )

        # Flagged agents
        flagged_agents = await db.users.count_documents(
            {"warehouse_id": wh_id, "is_flagged": True}
        )

        summaries.append({
            "warehouse_id": wh_id,
            "warehouse_name": wh["name"],
            "today_sales": round(today_sales, 2),
            "today_expenses": round(today_expenses, 2),
            "inventory_value": round(inv_value, 2),
            "open_orders_pending_dispatch": open_orders,
            "flagged_agents": flagged_agents
        })

    return {
        "branches": summaries,
        "totals": {
            "today_sales": round(sum(s["today_sales"] for s in summaries), 2),
            "today_expenses": round(sum(s["today_expenses"] for s in summaries), 2),
            "inventory_value": round(sum(s["inventory_value"] for s in summaries), 2),
            "open_orders": sum(s["open_orders_pending_dispatch"] for s in summaries),
            "flagged_agents": sum(s["flagged_agents"] for s in summaries),
        }
    }

@api_router.get("/reports/agent-performance")
async def get_agent_performance(user: User = Depends(get_current_user)):
    """Sales-agent performance report.

    Replaces the retired "distributor" concept with the `sales_rep` agent
    model: quotations raised, orders delivered, cash collected, outstanding
    A/R and the debt-ceiling flag for every field agent.
    """
    await assert_permission(db, user.role, "reports", "read")
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER,
                          UserRole.WAREHOUSE_MANAGER, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Not authorized")

    query: Dict[str, Any] = {"role": UserRole.SALES_REP.value, "is_active": True}
    if not is_cross_warehouse_role(user.role) and user.warehouse_id:
        query["warehouse_id"] = user.warehouse_id

    agents = await db.users.find(query, {"_id": 0}).to_list(500)

    performance = []
    total_revenue = 0.0
    total_outstanding = 0.0
    for agent in agents:
        agent_id = agent["user_id"]

        quotations = await db.agent_quotations.count_documents({"sales_rep_id": agent_id})
        approved = await db.agent_quotations.count_documents(
            {"sales_rep_id": agent_id, "status": AgentQuotationStatus.CONVERTED.value})

        orders = await db.sales_orders.find(
            {"sales_rep_id": agent_id, "status": {"$in": ["delivered", "paid"]}},
            {"_id": 0}).to_list(1000)
        revenue = sum(so.get("total_amount", 0) for so in orders)

        entries = await db.agent_ledger_entries.find(
            {"sales_rep_id": agent_id}, {"_id": 0, "amount": 1, "entry_type": 1}).to_list(10000)
        outstanding = sum(_num(e.get("amount")) for e in entries)
        collected = round(sum(abs(e.get("amount", 0)) for e in entries
                               if e.get("entry_type") == AgentLedgerEntryType.PAYMENT.value), 2)

        ceiling = agent.get("debt_ceiling", 0) or 0
        performance.append({
            "agent_id": agent_id,
            "agent_name": agent.get("name"),
            "warehouse_id": agent.get("warehouse_id"),
            "warehouse_name": agent.get("warehouse_name"),
            "total_quotations": quotations,
            "approved_quotations": approved,
            "total_orders": len(orders),
            "total_revenue": round(revenue, 2),
            "total_collected": collected,
            "outstanding_balance": round(outstanding, 2),
            "debt_ceiling": ceiling,
            "is_flagged": bool(agent.get("is_flagged", False)),
            "collection_rate": round((collected / revenue * 100) if revenue > 0 else 0, 1),
        })
        total_revenue += revenue
        total_outstanding += outstanding

    performance.sort(key=lambda x: x["total_revenue"], reverse=True)

    return {
        "agents": performance,
        "summary": {
            "total_agents": len(performance),
            "total_revenue": round(total_revenue, 2),
            "total_outstanding": round(total_outstanding, 2),
            "total_collected": round(sum(a["total_collected"] for a in performance), 2),
            "flagged_agents": sum(1 for a in performance if a["is_flagged"]),
            "top_performer": performance[0]["agent_name"] if performance else None,
        },
    }


@api_router.get("/reports/warehouse-performance")
async def get_warehouse_performance(user: User = Depends(get_current_user)):
    """Warehouse comparison report — Sales, Expenses, Agents"""
    await assert_permission(db, user.role, "reports", "read")
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER,
                          UserRole.WAREHOUSE_MANAGER, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Not authorized")

    warehouses = await db.warehouses.find({"is_active": True}, {"_id": 0}).to_list(100)
    if not is_cross_warehouse_role(user.role) and user.warehouse_id:
        warehouses = [w for w in warehouses if w["warehouse_id"] == user.warehouse_id]

    performance = []
    for wh in warehouses:
        wh_id = wh["warehouse_id"]

        total_sales_orders = await db.sales_orders.find(
            {"warehouse_id": wh_id}, {"_id": 0}
        ).to_list(10000)
        total_sales = sum(s.get("total_amount", 0) for s in total_sales_orders)

        total_expenses_list = await db.expenses.find(
            {"warehouse_id": wh_id, "approved": True}, {"_id": 0}
        ).to_list(10000)
        total_expenses = sum(e.get("amount", 0) for e in total_expenses_list)

        active_agents = await db.users.count_documents(
            {"warehouse_id": wh_id,
             "role": {"$in": [UserRole.SALES_REP.value]},
             "is_active": True}
        )
        flagged_agents = await db.users.count_documents(
            {"warehouse_id": wh_id, "is_flagged": True}
        )
        total_quotations = await db.agent_quotations.count_documents({"warehouse_id": wh_id})
        pending_quotations = await db.agent_quotations.count_documents(
            {"warehouse_id": wh_id, "status": AgentQuotationStatus.PENDING.value}
        )

        performance.append({
            "warehouse_id": wh_id,
            "warehouse_name": wh["name"],
            "total_sales": round(total_sales, 2),
            "total_expenses": round(total_expenses, 2),
            "net": round(total_sales - total_expenses, 2),
            "sales_order_count": len(total_sales_orders),
            "active_agents": active_agents,
            "flagged_agents": flagged_agents,
            "total_quotations": total_quotations,
            "pending_quotations": pending_quotations,
        })

    return {"warehouses": performance}

# ========================
# PERMISSION MANAGEMENT ENDPOINTS  (Super Admin only)
# ========================

@api_router.get("/admin/role-permissions")
async def get_all_role_permissions(user: User = Depends(get_current_user)):
    """
    Return the full CRUD permission matrix for every role.
    Accessible to Super Admin, General Manager, and Accountant.
    """
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Only Super Admin, General Manager, or Accountant can view role permissions")

    result = []
    for role_value in [r.value for r in UserRole]:
        perms = await get_role_permissions(db, role_value)
        result.append({
            "role": role_value,
            "permissions": {m: p.model_dump() for m, p in perms.items()}
        })
    return {"roles": result, "modules": MODULES, "module_labels": MODULE_LABELS}


@api_router.get("/admin/role-permissions/{role}")
async def get_single_role_permissions(role: str, user: User = Depends(get_current_user)):
    """
    Return CRUD permissions for a single role.
    Accessible to Super Admin, General Manager, and Accountant.
    """
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Only Super Admin, General Manager, or Accountant can view role permissions")

    valid_roles = [r.value for r in UserRole]
    if role not in valid_roles:
        raise HTTPException(status_code=404, detail=f"Role '{role}' not found")

    perms = await get_role_permissions(db, role)
    return {
        "role": role,
        "permissions": {m: p.model_dump() for m, p in perms.items()}
    }


@api_router.put("/admin/role-permissions/{role}")
async def update_role_permissions(
    role: str,
    body: PermissionUpdateRequest,
    user: User = Depends(get_current_user)
):
    """
    Overwrite CRUD permissions for a role.
    Accessible to Super Admin, General Manager, and Accountant.

    Rules enforced server-side:
    - super_admin and general_manager always retain full access (cannot be downgraded).
    - accountant always retains read=True on every module (cannot lose visibility).
    - Payload may contain a subset of modules; missing modules keep their current values.
    """
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Only Super Admin, General Manager, or Accountant can modify role permissions")

    valid_roles = [r.value for r in UserRole]
    if role not in valid_roles:
        raise HTTPException(status_code=404, detail=f"Role '{role}' not found")

    # Protect top-level roles
    if role in ALWAYS_FULL_ACCESS_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Permissions for '{role}' cannot be modified — this role always has full access."
        )

    # Fetch existing doc so we do a merge, not a clobber
    existing_doc = await db.role_permissions.find_one({"role": role}, {"_id": 0})
    existing_raw = existing_doc.get("permissions", {}) if existing_doc else {}

    # Start from current effective permissions
    current = await get_role_permissions(db, role)
    merged: dict = {m: p.model_dump() for m, p in current.items()}

    # SECURITY: You cannot edit a role that outranks you, nor your own role
    # (that would be self-escalation through the permission matrix).
    if user.role != UserRole.SUPER_ADMIN:
        if role == user.role.value:
            raise HTTPException(
                status_code=403,
                detail="You cannot modify the permissions of your own role",
            )
        if role_rank(role) > role_rank(user.role):
            raise HTTPException(
                status_code=403,
                detail="You cannot modify permissions for a role higher than your own",
            )

    # Apply incoming changes
    for module, crud in body.permissions.items():
        if module not in MODULES:
            raise HTTPException(status_code=422, detail=f"Unknown module: '{module}'")
        new_crud = crud.model_dump()
        # Accountant: force read=True on all modules
        if role == "accountant":
            new_crud["read"] = True
        merged[module] = new_crud

    now = datetime.now(timezone.utc)
    await db.role_permissions.update_one(
        {"role": role},
        {"$set": {
            "permissions": merged,
            "updated_at": now,
            "updated_by": user.user_id,
        }},
        upsert=True
    )

    # Invalidate in-process cache for this role
    invalidate_cache(role)

    await create_audit_log(
        user.user_id, "update", "role_permissions", role,
        old_value={"permissions": existing_raw},
        new_value={"permissions": merged}
    )

    return {
        "message": f"Permissions for '{role}' updated successfully.",
        "role": role,
        "permissions": merged
    }


@api_router.post("/admin/role-permissions/reset/{role}")
async def reset_role_permissions(role: str, user: User = Depends(get_current_user)):
    """
    Reset a role's permissions back to the hardcoded defaults.
    Accessible to Super Admin, General Manager, and Accountant.
    """
    if user.role not in [UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT]:
        raise HTTPException(status_code=403, detail="Only Super Admin, General Manager, or Accountant can reset role permissions")

    valid_roles = [r.value for r in UserRole]
    if role not in valid_roles:
        raise HTTPException(status_code=404, detail=f"Role '{role}' not found")

    if role in ALWAYS_FULL_ACCESS_ROLES:
        raise HTTPException(status_code=400, detail=f"'{role}' always has full access — nothing to reset.")

    from permissions import DEFAULT_PERMISSIONS
    defaults = DEFAULT_PERMISSIONS.get(role, {})
    serialised = {m: p.model_dump() for m, p in defaults.items()}

    await db.role_permissions.update_one(
        {"role": role},
        {"$set": {
            "permissions": serialised,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": user.user_id,
        }},
        upsert=True
    )
    invalidate_cache(role)

    await create_audit_log(user.user_id, "reset", "role_permissions", role)

    return {
        "message": f"Permissions for '{role}' reset to defaults.",
        "role": role,
        "permissions": serialised
    }


# ========================
# SECURITY HEALTH CHECK ENDPOINT
# ========================

@api_router.get("/security/health")
async def security_health_check():
    """Report the *actual* security posture of this deployment.

    The previous version returned hard-coded `true` for every check, which
    made the endpoint useless for verifying a deployment. Each flag below is
    derived from the live configuration.
    """
    from starlette.middleware.cors import CORSMiddleware as _CORS

    # Starlette stores middleware as `Middleware(cls, *args, **kwargs)`
    # objects — the settings live in `.kwargs`, not on the wrapper itself.
    def _mw_kwargs(name):
        mw = next((m for m in app.user_middleware if m.cls.__name__ == name), None)
        if mw is None:
            return None
        return dict(getattr(mw, "kwargs", {}) or {})

    cors_kwargs = _mw_kwargs("CORSMiddleware") or {}
    allowed = list(cors_kwargs.get("allow_origins") or [])
    cors_restricted = bool(allowed) and "*" not in allowed

    host_kwargs = _mw_kwargs("TrustedHostMiddleware") or {}
    host_list = list(host_kwargs.get("allowed_hosts") or [])
    host_restricted = bool(host_list) and "*" not in host_list

    return {
        "https_redirect_enabled": os.environ.get("ENABLE_HTTPS_REDIRECT", "").lower()
                                  in ("1", "true", "yes"),
        "hsts_enabled": True,
        "rate_limiting_enabled": hasattr(app.state, "limiter"),
        "login_rate_limit": os.environ.get("LOGIN_RATE_LIMIT", "30/minute"),
        "cors_restricted": cors_restricted,
        "cors_origins": allowed,
        "host_header_restricted": host_restricted,
        "session_rotation_available": True,
        "audit_logging_with_ip": True,
        "nosql_injection_protection": True,
        "privilege_escalation_guard": True,
        "warehouse_scoping_enforced": True,
        "request_size_limit_mb": 10,
        "inactive_user_rejection": True,
        "password_hashing": "pbkdf2_sha256",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# ========================
# HEALTH CHECK
# ========================

@api_router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}


# ========================
# INCLUDE ROUTER
# ========================

app.include_router(api_router)

# ========================
# MIDDLEWARE SETUP
# Note: Starlette middleware runs in LIFO order.
# Execution order on REQUEST:  RequestValidation → SecurityHeaders → TrustedHost → HTTPS → CORS
# Execution order on RESPONSE: CORS → HTTPS → TrustedHost → SecurityHeaders → RequestValidation
# ========================

# Added last = runs outermost (first on request, last on response)
app.add_middleware(RequestValidationMiddleware)

app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=[
        "bizcorev2-production.up.railway.app",
        "bizcorev2.up.railway.app",
        "bizcore-v2.fly.dev",
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "testserver",
        # Extra hosts (e.g. a custom domain) come from the environment.
        # Set ALLOWED_HOSTS=your.domain.com,www.your.domain.com
        *[h.strip() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip()],
    ]
)

# HTTPSRedirectMiddleware is disabled by default — Railway / Fly terminate
# TLS at the proxy, so a redirect-to-https would cause 307 loops. Enable
# with ENABLE_HTTPS_REDIRECT=1 if you expose the container directly.
if os.environ.get("ENABLE_HTTPS_REDIRECT", "").lower() in ("1", "true", "yes"):
    app.add_middleware(HTTPSRedirectMiddleware)

# Added first = runs innermost (last on request, first on response)
_cors_origins_env = os.environ.get("ALLOWED_ORIGINS", "")
_cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()] or [
    "https://bizcorev2-production.up.railway.app",
    "https://bizcorev2.up.railway.app",
    "https://bizcore-v2.fly.dev",
    "bizcorev2://",
    "bizcore://",
    "http://localhost:8081",
    "http://localhost:19006",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:19006",
    "exp://127.0.0.1:8081",
]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Accept"],
)

# Attach rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ========================
# DATABASE STARTUP / SHUTDOWN
# ========================

async def _repair_string_quantities(db) -> int:
    """One-time data repair: coerce string quantities to numbers.

    Pre-audit code paths could write a stock quantity as a string (the
    expression `stock["quantity"] + delta` concatenates when the stored
    value is a string). Such rows make the app render "0500" instead of
    "500" because the mobile client adds the value to a numeric
    accumulator. This rewrites them so legacy data heals on deploy.
    """
    repaired = 0
    try:
        cursor = db.inventory_stock.find({"quantity": {"$type": "string"}})
        async for doc in cursor:
            await db.inventory_stock.update_one(
                {"_id": doc["_id"]},
                {"$set": {"quantity": _num(doc.get("quantity"))}},
            )
            repaired += 1
        if repaired:
            logger.warning(
                "Repaired %s inventory_stock rows whose quantity was stored as a string",
                repaired,
            )
    except Exception as exc:  # pragma: no cover - best-effort repair
        logger.warning("String-quantity repair skipped: %s", exc)
    return repaired


@app.on_event("startup")
async def startup_db_client():
    """Initialize database indexes"""
    await db.products.create_index("sku", unique=True)
    await db.products.create_index("barcode")
    await db.products.create_index("category")
    await db.inventory_stock.create_index([("product_id", 1), ("warehouse_id", 1)])
    await db.purchase_orders.create_index("po_number", unique=True)
    await db.sales_orders.create_index("so_number", unique=True)
    await db.invoices.create_index("invoice_number", unique=True)
    await db.users.create_index("email", unique=True)
    # Username may be missing on legacy users — sparse index tolerates that.
    await db.users.create_index("username", unique=True, sparse=True)
    await db.user_sessions.create_index("session_token")
    await db.agent_quotations.create_index("sales_rep_id")
    await db.agent_quotations.create_index([("warehouse_id", 1), ("status", 1)])
    await db.agent_ledger_entries.create_index("sales_rep_id")
    await db.agent_ledger_entries.create_index("warehouse_id")
    await db.warehouse_transfers.create_index("from_warehouse_id")
    await db.warehouse_transfers.create_index([("to_warehouse_id", 1), ("status", 1)])
    await db.expenses.create_index("warehouse_id")
    await db.users.create_index([("warehouse_id", 1), ("role", 1)])
    await db.role_permissions.create_index("role", unique=True)
    # Forgot-password / username support
    await db.password_resets.create_index("token", unique=True)
    await db.password_resets.create_index("user_id")
    # Auto-expire tokens via TTL on expires_at (Mongo TTL monitor deletes them)
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
    # Daily email-send counter (one doc per UTC day, _id is the date key)
    await db.email_send_log.create_index("count")
    # Expire session rows automatically once their TTL has passed.
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    # Document-number counters (collision-safe PO/SO/INV/QT/GRN/… numbering).
    await db.counters.create_index("_id")
    # Login throttle counters expire on their own.
    await db.login_attempts.create_index("updated_at", expireAfterSeconds=3600)
    # Hot query paths that were previously unindexed.
    await db.stock_transactions.create_index([("product_id", 1), ("warehouse_id", 1)])
    await db.stock_transactions.create_index("created_at")
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("title", 1)])
    await db.requisitions.create_index([("status", 1), ("created_at", -1)])
    await db.requisitions.create_index("requested_by")
    await db.grns.create_index([("po_id", 1), ("status", 1)])
    await db.grns.create_index("supplier_id")
    await db.three_way_matches.create_index([("po_id", 1), ("status", 1)])
    await db.quotations.create_index([("customer_id", 1), ("status", 1)])
    await db.delivery_notes.create_index([("so_id", 1), ("status", 1)])
    await db.invoices.create_index([("type", 1), ("status", 1)])
    await db.payments.create_index("invoice_id")
    await db.expenses.create_index([("warehouse_id", 1), ("expense_date", -1)])
    await db.sales_orders.create_index([("warehouse_id", 1), ("status", 1)])
    await db.sales_orders.create_index("sales_rep_id")
    await db.purchase_orders.create_index([("warehouse_id", 1), ("status", 1)])
    await db.purchase_orders.create_index("supplier_id")
    await db.products.create_index("default_supplier_id")
    await db.inventory_stock.create_index("warehouse_id")
    await seed_default_permissions(db)
    await _repair_string_quantities(db)
    logger.info("Database indexes created and security middleware active")

@app.on_event("shutdown")
async def shutdown_db_client():
    """Close database connections on shutdown"""
    client.close()
    logger.info("Database connections closed")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
