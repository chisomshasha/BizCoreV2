# BizCore - Business Management Application

## Product Requirements Document (PRD)

### Overview
BizCore is a comprehensive, mobile-first ERP-style business management application designed for SMEs in manufacturing, trading, or distribution. It provides real-time visibility into all critical business operations with role-based access control.

### Target Users
- Business Owners / Super Admins
- Department Managers
- Purchase Clerks
- Sales Executives
- Accountants
- Viewers (Read-only access)

### Core Modules

#### 1. Dashboard (Home Screen)
- KPI cards: Total Inventory Value, Low Stock Items, Today's Sales/Purchases, Cash Balance, Pending Invoices
- Charts: Sales vs Purchases (7/30 days), Top Products, Stock Trend
- Quick alerts: Low raw materials, Overdue payments
- Recent activity feed

#### 2. Admin Module
- User Management: Add/edit users, assign roles
- Role-based Access Control (RBAC)
- Company Profile settings
- Audit Logs

#### 3. Inventory Module
- Product Catalog (Raw Materials, Finished Goods, Packaging)
- Multi-warehouse stock management
- Stock movements tracking
- Low stock alerts
- Barcode support

#### 4. Suppliers Module
- Supplier Directory
- Performance tracking
- Contact integration

#### 5. Distributors Module
- Distributor/Customer Directory
- Territory/Region assignment
- Credit management

#### 6. Purchases Module
- Purchase Orders (PO)
- Status tracking (Draft → Ordered → Received → Paid)
- Goods Receipt Notes

#### 7. Sales Module
- Sales Orders (SO)
- Invoice generation
- Delivery tracking

#### 8. Finance Module
- Chart of Accounts
- Accounts Receivable/Payable
- Payment tracking
- Basic reports (P&L, Balance Sheet)

#### 9. Reports Module
- Stock Summary
- Purchase/Sales Analysis
- Supplier/Distributor performance
- Financial reports

### Technical Stack
- **Frontend**: Expo React Native (iOS/Android/Web)
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **Authentication**: Emergent Google OAuth

### Design Theme
- Dark professional theme
- Mobile-first responsive design
- Touch-friendly UI elements

### Database Collections
1. users
2. user_sessions
3. roles
4. companies
5. warehouses
6. products
7. inventory_stock
8. stock_transactions
9. suppliers
10. distributors
11. purchase_orders
12. purchase_order_items
13. sales_orders
14. sales_order_items
15. invoices
16. payments
17. chart_of_accounts
18. journal_entries
19. notifications
20. audit_logs
21. expenses
22. quotations
23. delivery_notes
24. bill_of_materials

### Implemented Features (Full List)

#### Core Modules ✅
- **Dashboard** - KPI cards, Sales vs Purchases chart, Top Products, Recent Activity, Low Stock Alerts
- **Inventory** - Product Catalog (Raw/Finished/Packaging), Multi-warehouse stock, Stock adjustments
- **Suppliers** - Directory, Contact info, Payment terms, Rating system
- **Distributors** - Directory, Territories, Commission %, Credit limits
- **Purchase Orders** - Create, Status workflow (Draft→Ordered→Received→Paid), Auto-inventory
- **Sales Orders** - Create, Status workflow (Draft→Ordered→Delivered→Paid), Auto-inventory
- **Warehouses** - Multi-location support

#### Finance Module ✅
- **Expenses** - Track expenses by category, approval workflow
- **Invoices** - Purchase & Sales invoices, payment status tracking
- **Payments** - Record payments against invoices
- **Profit & Loss Report** - Revenue, COGS, Gross Profit, Expenses, Net Profit
- **Cash Flow Report** - Inflows, Outflows, Net Cash Flow

#### Advanced Features ✅
- **Quotations** - Create quotes, track validity, convert to Sales Order
- **Delivery Notes** - Create from Sales Order, track delivery status
- **Bill of Materials (BOM)** - Define components for finished goods, production tracking
- **Audit Logs** - Track all changes with user info
- **Notifications** - System alerts for low stock, overdue payments

#### Reports Module ✅
- Stock Summary Report
- Inventory Valuation Report
- Purchase Analysis Report
- Sales Analysis Report
- Supplier Aging Report (Accounts Payable)
- Customer Aging Report (Accounts Receivable)
- Profit & Loss Statement
- Cash Flow Statement

#### Authentication & Security ✅
- Google OAuth via Emergent Auth
- Role-based Access Control (Super Admin, Manager, Clerk, etc.)
- Session management with JWT tokens
