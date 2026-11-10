/** Shared API payloads for the screen tests — shaped exactly like the real backend responses. */
const NOW = new Date().toISOString();

const PAYLOADS: Record<string, any> = {
  '/products': [
    { product_id: 'p1', sku: 'SKU-1', name: 'Tomato Paste', description: 'desc',
      category: 'finished', unit: 'tin', cost_price: 800, selling_price: 1500,
      reorder_level: 20, min_stock: 0, max_stock: 1000, barcode: 'BC1',
      is_active: true, created_at: NOW, updated_at: NOW },
  ],
  '/inventory': [
    { stock_id: 's1', product_id: 'p1', warehouse_id: 'wh_lagos', quantity: 40,
      last_updated: NOW, product_name: 'Tomato Paste', product_sku: 'SKU-1',
      warehouse_name: 'Lagos Main', cost_price: 800, reorder_level: 20 },
  ],
  '/inventory/by-warehouse': [
    { product_id: 'p1', product_name: 'Tomato Paste', sku: 'SKU-1', unit: 'tin',
      category: 'finished', cost_price: 800, reorder_level: 20, is_low_stock: false,
      by_warehouse: [
        { warehouse_id: 'wh_lagos', warehouse_name: 'Lagos Main', quantity: 40, value: 32000 },
        { warehouse_id: 'wh_abuja', warehouse_name: 'Abuja Branch', quantity: 0, value: 0 },
      ],
      total_quantity: 40, total_value: 32000 },
  ],
  '/inventory/all-warehouses': [
    { product_id: 'p1', product_name: 'Tomato Paste', sku: 'SKU-1', unit: 'tin',
      cost_price: 800, total_quantity: 40, total_value: 32000,
      by_warehouse: [
        { warehouse_id: 'wh_lagos', warehouse_name: 'Lagos Main', quantity: 40 },
        { warehouse_id: 'wh_abuja', warehouse_name: 'Abuja Branch', quantity: 0 },
      ] },
  ],
  '/inventory/low-stock': [
    { product_id: 'p1', name: 'Tomato Paste', sku: 'SKU-1', current_stock: 5, reorder_level: 20 },
  ],
  '/inventory/transactions': [],
  '/suppliers': [
    { supplier_id: 'sup1', name: 'Farm Fresh Ltd', contact_person: 'Ada',
      phone: '0800', email: 'a@b.ng', address: 'Ibadan', payment_terms_days: 30,
      rating: 4.5, is_active: true, created_at: NOW, updated_at: NOW },
  ],
  '/warehouses': [
    { warehouse_id: 'wh_lagos', name: 'Lagos Main', address: 'Ikeja', capacity: 100,
      is_active: true, created_at: NOW },
    { warehouse_id: 'wh_abuja', name: 'Abuja Branch', address: 'Wuse', capacity: 50,
      is_active: true, created_at: NOW },
  ],
  '/users': [
    { user_id: 'u1', username: 'rep', email: 'rep@b.ng', name: 'Rep One', role: 'sales_rep',
      warehouse_id: 'wh_lagos', warehouse_name: 'Lagos Main', is_active: true,
      debt_ceiling: 500000, is_flagged: false, phone: '0800', created_at: NOW, updated_at: NOW },
  ],
  '/users/agents': [
    { user_id: 'u1', name: 'Rep One', warehouse_id: 'wh_lagos',
      outstanding_balance: 12000, debt_ceiling: 500000, is_flagged: false },
  ],
  '/purchase-orders': [
    { po_id: 'po1', po_number: 'PO-202611-0001', supplier_id: 'sup1',
      supplier_name: 'Farm Fresh Ltd', warehouse_id: 'wh_lagos', order_date: NOW,
      status: 'draft', items: [{ item_id: 'i1', product_id: 'p1', product_name: 'Tomato Paste',
      quantity: 10, unit_price: 800 }], subtotal: 8000, tax_amount: 0,
      total_amount: 8000, created_at: NOW, updated_at: NOW },
  ],
  '/sales-orders': [
    { so_id: 'so1', so_number: 'SO-202611-0001', sales_rep_id: 'u1',
      sales_rep_name: 'Rep One', warehouse_id: 'wh_lagos', order_date: NOW,
      status: 'approved', dispatch_status: 'pending_dispatch',
      items: [{ item_id: 'i1', product_id: 'p1', product_name: 'Tomato Paste',
      quantity: 5, unit_price: 1500 }], subtotal: 7500, tax_amount: 0,
      total_amount: 7500, created_at: NOW, updated_at: NOW },
  ],
  '/sales-orders/pending-dispatch': [
    { so_id: 'so1', so_number: 'SO-202611-0001', sales_rep_name: 'Rep One',
      warehouse_id: 'wh_lagos', status: 'approved', dispatch_status: 'pending_dispatch',
      total_amount: 7500, created_at: NOW,
      items: [{ product_id: 'p1', product_name: 'Tomato Paste', quantity: 5, unit_price: 1500 }] },
  ],
  '/invoices': [
    { invoice_id: 'inv1', invoice_number: 'SI-202611-0001', type: 'sale',
      reference_id: 'so1', party_id: 'u1', party_name: 'Rep One', issue_date: NOW,
      due_date: NOW, subtotal: 7500, tax_amount: 0, total: 7500, paid_amount: 2500,
      status: 'partial', created_at: NOW },
  ],
  '/payments': [
    { payment_id: 'pay1', invoice_id: 'inv1', amount: 2500, payment_date: NOW,
      method: 'cash', transaction_ref: 'R1', created_at: NOW },
  ],
  '/expenses': [
    { expense_id: 'e1', category: 'travel', amount: 5000, description: 'Trip',
      vendor: 'Airtel', expense_date: NOW, payment_method: 'cash', approved: true,
      approved_by: 'u1', warehouse_id: 'wh_lagos', created_by: 'u1', created_at: NOW },
  ],
  '/accounts': [
    { account_id: 'a1', code: '1000', name: 'Cash', type: 'asset', balance: 0,
      is_active: true, created_at: NOW },
  ],
  '/requisitions': [
    { requisition_id: 'req1', requisition_number: 'REQ-202611-0001', requested_by: 'u1',
      requested_by_name: 'Rep One', department: 'Ops', priority: 'high', status: 'pending',
      items: [{ item_id: 'ri1', product_id: 'p1', product_name: 'Tomato Paste',
      quantity: 10, estimated_unit_price: 800 }], total_estimated: 8000,
      created_at: NOW, updated_at: NOW },
  ],
  '/quotations': [
    { quotation_id: 'q1', quotation_number: 'QT-202611-0001', customer_id: 'u1',
      customer_name: 'Rep One', status: 'draft',
      items: [{ item_id: 'qi1', product_id: 'p1', product_name: 'Tomato Paste',
      quantity: 3, unit_price: 1500, discount_percent: 0 }],
      subtotal: 4500, discount_amount: 0, tax_amount: 0, total_amount: 4500,
      valid_until: NOW, created_at: NOW },
  ],
  '/agent-quotations': [
    { quotation_id: 'aq1', quotation_number: 'AQT-202611-0001', sales_rep_id: 'u1',
      sales_rep_name: 'Rep One', warehouse_id: 'wh_lagos', warehouse_name: 'Lagos Main',
      status: 'pending', items: [{ item_id: 'i1', product_id: 'p1',
      product_name: 'Tomato Paste', quantity: 5, unit_price: 1500 }],
      total_amount: 7500, agent_is_flagged: false, agent_outstanding: 12000,
      agent_debt_ceiling: 500000, created_at: NOW, updated_at: NOW },
  ],
  '/agent-ledger': {
    agent: { user_id: 'u1', name: 'Rep One', warehouse_id: 'wh_lagos',
      warehouse_name: 'Lagos Main', credit_limit: 500000, debt_ceiling: 500000,
      is_flagged: false },
    total_goods_released: 7500, total_payments_received: 2500,
    accounts_receivable: 12000, items_in_custody: [], total_custody_value: 0,
    ledger_entries: [],
  },
  '/grn': [
    { grn_id: 'g1', grn_number: 'GRN-202611-0001', po_id: 'po1', po_number: 'PO-1',
      supplier_id: 'sup1', supplier_name: 'Farm Fresh Ltd', warehouse_id: 'wh_lagos',
      received_date: NOW, status: 'received',
      items: [{ item_id: 'gi1', po_item_id: 'i1', product_id: 'p1',
      product_name: 'Tomato Paste', ordered_quantity: 10, received_quantity: 10,
      accepted_quantity: 10, rejected_quantity: 0, unit_price: 800 }],
      total_amount: 8000, received_by: 'u1', created_at: NOW },
  ],
  '/three-way-match': [
    { match_id: 'm1', po_id: 'po1', po_number: 'PO-1', grn_id: 'g1', grn_number: 'GRN-1',
      invoice_id: 'inv1', invoice_number: 'SI-1', supplier_id: 'sup1',
      supplier_name: 'Farm Fresh Ltd', status: 'full_match', po_total: 8000,
      grn_total: 8000, invoice_total: 8000, variance: 0, variance_percent: 0,
      discrepancies: [], created_at: NOW },
  ],
  '/delivery-notes': [
    { delivery_id: 'd1', delivery_number: 'DN-202611-0001', so_id: 'so1',
      so_number: 'SO-1', distributor_id: 'u1', distributor_name: 'Rep One',
      sales_rep_id: 'u1', sales_rep_name: 'Rep One', warehouse_id: 'wh_lagos',
      items: [], status: 'pending', created_at: NOW },
  ],
  '/bom': [
    { bom_id: 'b1', finished_product_id: 'p1', finished_product_name: 'Tomato Paste',
      components: [{ raw_product_id: 'p_raw', raw_product_name: 'Tomatoes',
      quantity_required: 2, unit: 'kg' }], yield_quantity: 10, is_active: true,
      created_at: NOW },
  ],
  '/warehouse-transfers': [
    { transfer_id: 'wt1', transfer_number: 'WT-202611-0001', from_warehouse_id: 'wh_lagos',
      from_warehouse_name: 'Lagos Main', to_warehouse_id: 'wh_abuja',
      to_warehouse_name: 'Abuja Branch', items: [{ product_id: 'p1',
      product_name: 'Tomato Paste', quantity: 10, cost_price: 800 }],
      total_value: 8000, status: 'pending', initiated_by: 'u1',
      initiated_by_name: 'Rep One', created_at: NOW },
  ],
  '/notifications': [
    { notification_id: 'n1', title: 'New Order', message: 'You have a new order',
      type: 'info', is_read: false, created_at: NOW },
  ],
  '/audit-logs': [
    { log_id: 'l1', user_id: 'u1', action: 'create', entity_type: 'product',
      entity_id: 'p1', timestamp: NOW, user_name: 'Rep One', ip_address: '1.2.3.4' },
  ],
  '/dashboard/stats': {
    total_inventory_value: 32000, low_stock_count: 1, today_sales: 7500,
    today_purchases: 8000, cash_balance: 2500, pending_invoices: 1,
    total_products: 1, total_suppliers: 1, total_agents: 1, total_warehouses: 2,
  },
  '/dashboard/recent-activity': [
    { type: 'sales_order', title: 'SO-1', description: 'Created',
      amount: 7500, status: 'approved', timestamp: NOW },
  ],
  '/dashboard/sales-chart': [{ date: '2026-11-01', sales: 7500, purchases: 8000 }],
  '/dashboard/top-products': [
    { product_id: 'p1', name: 'Tomato Paste', sku: 'SKU-1', quantity_sold: 5, revenue: 7500 },
  ],
  '/dashboard/branch-summary': {
    branches: [{ warehouse_id: 'wh_lagos', warehouse_name: 'Lagos Main', today_sales: 7500,
      today_expenses: 500, inventory_value: 32000, open_orders_pending_dispatch: 1,
      flagged_agents: 0 }],
    totals: { today_sales: 7500, today_expenses: 500, inventory_value: 32000,
      open_orders: 1, flagged_agents: 0 },
  },
  '/reports/stock-summary': [
    { product_id: 'p1', product_name: 'Tomato Paste', sku: 'SKU-1', category: 'finished',
      warehouse_id: 'wh_lagos', warehouse_name: 'Lagos Main', quantity: 40, unit: 'tin',
      cost_price: 800, value: 32000, reorder_level: 20, is_low_stock: false },
  ],
  '/reports/inventory-valuation': {
    valuation_method: 'average', total_inventory_value: 32000, total_items: 40,
    total_skus: 1, items: [{ product_id: 'p1', product_name: 'Tomato Paste', sku: 'SKU-1',
      category: 'finished', warehouse_id: 'wh_lagos', warehouse_name: 'Lagos Main',
      quantity: 40, unit: 'tin', unit_cost: 800, total_value: 32000,
      selling_price: 1500, potential_revenue: 60000 }], top_5_by_value: [],
  },
  '/reports/profit-loss': {
    period: { start: '2026-11-01', end: '2026-11-30' },
    revenue: { total_sales: 7500, sales_count: 1 },
    cost_of_goods_sold: { total_cogs: 8000, purchase_count: 1 },
    gross_profit: -500, gross_margin_percent: -6.67,
    operating_expenses: { total: 500, by_category: { travel: 500 } },
    net_profit: -1000, net_margin_percent: -13.33,
  },
  '/reports/cash-flow': {
    period: { start: '2026-11-01', end: '2026-11-30' },
    cash_inflows: { total: 2500, count: 1, details: [] },
    cash_outflows: { total: 500, count: 1, details: [] },
    net_cash_flow: 2000,
  },
  '/reports/supplier-aging': {
    total_accounts_payable: 8000,
    aging_summary: { current: 8000, '1_30_days': 0, '31_60_days': 0, '61_90_days': 0, over_90_days: 0 },
    aging_details: {}, by_supplier: [],
  },
  '/reports/customer-aging': {
    total_accounts_receivable: 5000,
    aging_summary: { current: 5000, '1_30_days': 0, '31_60_days': 0, '61_90_days': 0, over_90_days: 0 },
    aging_details: {}, by_customer: [],
  },
  '/reports/purchase-analysis': {
    total_orders: 1, total_amount: 8000,
    by_supplier: [{ supplier_name: 'Farm Fresh Ltd', order_count: 1, total_amount: 8000 }],
  },
  '/reports/sales-analysis': {
    total_orders: 1, total_amount: 7500,
    by_sales_rep: [{ sales_rep_name: 'Rep One', order_count: 1, total_amount: 7500 }],
  },
  '/reports/supplier-performance': {
    suppliers: [{ supplier_id: 'sup1', supplier_name: 'Farm Fresh Ltd', total_orders: 1,
      total_value: 8000, on_time_deliveries: 1, late_deliveries: 0, delivery_rate: 100,
      quality_rate: 100, overall_score: 100, rating: 4.5 }],
    summary: { total_suppliers: 1, avg_delivery_rate: 100, avg_quality_rate: 100,
      top_performer: 'Farm Fresh Ltd' },
  },
  '/reports/agent-performance': {
    agents: [{ agent_id: 'u1', agent_name: 'Rep One', warehouse_id: 'wh_lagos',
      warehouse_name: 'Lagos Main', total_quotations: 1, approved_quotations: 1,
      total_orders: 1, total_revenue: 7500, total_collected: 2500,
      outstanding_balance: 12000, debt_ceiling: 500000, is_flagged: false,
      collection_rate: 33.3 }],
    summary: { total_agents: 1, total_revenue: 7500, total_outstanding: 12000,
      total_collected: 2500, flagged_agents: 0, top_performer: 'Rep One' },
  },
  '/reports/warehouse-performance': {
    warehouses: [{ warehouse_id: 'wh_lagos', warehouse_name: 'Lagos Main',
      total_sales: 7500, total_expenses: 500, net: 7000, sales_order_count: 1,
      active_agents: 1, flagged_agents: 0, total_quotations: 1, pending_quotations: 0 }],
  },
  '/reports/trial-balance': {
    report_date: NOW,
    assets: [{ account: 'Inventory', type: 'asset', debit: 32000, credit: 0 },
             { account: 'Accounts Receivable', type: 'asset', debit: 5000, credit: 0 }],
    liabilities: [{ account: 'Accounts Payable', type: 'liability', debit: 0, credit: 8000 }],
    equity: [{ account: 'Retained Earnings', type: 'equity', debit: 0, credit: 27500 }],
    income: [{ account: 'Sales Revenue', type: 'income', debit: 0, credit: 7500 }],
    expenses: [{ account: 'Cost of Goods Sold', type: 'expense', debit: 8000, credit: 0 }],
    total_debit: 45000, total_credit: 45000, is_balanced: true,
  },
  '/reports/balance-sheet': {
    report_date: NOW,
    assets: { current_assets: [{ name: 'Inventory', amount: 32000 }],
      total_current_assets: 32000, fixed_assets: [], total_fixed_assets: 0,
      total_assets: 37000 },
    liabilities: { current_liabilities: [{ name: 'Accounts Payable', amount: 8000 }],
      total_current_liabilities: 8000, long_term_liabilities: [], total_long_term_liabilities: 0,
      total_liabilities: 8000 },
    equity: { items: [{ name: 'Capital', amount: 29000 },
      { name: 'Retained Earnings', amount: 0 }], total_equity: 29000 },
    total_liabilities_and_equity: 37000, is_balanced: true,
  },
  '/admin/role-permissions': {
    roles: [
      { role: 'super_admin', permissions: { inventory: { create: true, read: true,
        update: true, delete: true } } },
      { role: 'viewer', permissions: { inventory: { create: false, read: true,
        update: false, delete: false } } },
    ],
    modules: ['products', 'inventory'], module_labels: { products: 'Products', inventory: 'Inventory' },
  },
  '/company': { company_id: 'c1', name: 'BizCore Foods Ltd', currency: 'NGN',
    fiscal_year_start: 1, created_at: NOW },
  '/sync/status': { server_time: NOW, entities: {} },
  '/barcode/BC1': { product: { product_id: 'p1', name: 'Tomato Paste', sku: 'SKU-1',
    unit: 'tin' }, total_stock: 40, stock_by_warehouse: [] },
};


function mockGetWith(url: string) {
  for (const key of Object.keys(PAYLOADS)) {
    if (url === key || url.startsWith(`${key}?`) || url.startsWith(`${key}/`)) {
      return PAYLOADS[key];
    }
  }
  return [];
}


export function resetMocks() {
  const { get, post, put, delete: del } = global.mockApi;
  get.mockClear(); post.mockClear(); put.mockClear(); del.mockClear();
  get.mockImplementation(async () => ({ data: [] }));
  post.mockImplementation(async () => ({ data: {} }));
  put.mockImplementation(async () => ({ data: {} }));
  del.mockImplementation(async () => ({ data: {} }));
}

export { PAYLOADS, mockGetWith };
