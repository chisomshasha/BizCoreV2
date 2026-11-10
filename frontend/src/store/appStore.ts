import { create } from 'zustand';
import api from '../utils/api';
import {
  DashboardStats,
  Activity,
  ChartDataPoint,
  TopProduct,
  Product,
  Supplier,
  Warehouse,
  InventoryStock,
  PurchaseOrder,
  SalesOrder,
  Invoice,
  Notification,
} from '../types';

interface AppState {
  // Dashboard
  dashboardStats: DashboardStats | null;
  recentActivity: Activity[];
  salesChart: ChartDataPoint[];
  topProducts: TopProduct[];
  
  // Data
  products: Product[];
  suppliers: Supplier[];
  warehouses: Warehouse[];
  inventory: InventoryStock[];
  purchaseOrders: PurchaseOrder[];
  salesOrders: SalesOrder[];
  invoices: Invoice[];
  notifications: Notification[];
  lowStockItems: any[];
  agents: any[];
  
  // Loading states
  isLoading: boolean;
  
  // Actions
  fetchDashboard: () => Promise<void>;
  fetchProducts: () => Promise<void>;
  fetchSuppliers: () => Promise<void>;
  fetchWarehouses: () => Promise<void>;
  fetchInventory: () => Promise<void>;
  fetchPurchaseOrders: () => Promise<void>;
  fetchSalesOrders: () => Promise<void>;
  fetchInvoices: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
  fetchLowStockItems: () => Promise<void>;

  // Agents (sales reps) — fetched lazily for sales order screens
  fetchAgents: () => Promise<void>;

  // CRUD
  createProduct: (data: any) => Promise<Product>;
  updateProduct: (id: string, data: any) => Promise<Product>;
  deleteProduct: (id: string) => Promise<void>;
  
  createSupplier: (data: any) => Promise<Supplier>;
  updateSupplier: (id: string, data: any) => Promise<Supplier>;
  deleteSupplier: (id: string) => Promise<void>;
  
  
  createWarehouse: (data: any) => Promise<Warehouse>;
  updateWarehouse: (id: string, data: any) => Promise<Warehouse>;
  deleteWarehouse: (id: string) => Promise<void>;
  
  createPurchaseOrder: (data: any) => Promise<PurchaseOrder>;
  updatePurchaseOrder: (id: string, data: any) => Promise<PurchaseOrder>;
  
  createSalesOrder: (data: any) => Promise<SalesOrder>;
  updateSalesOrder: (id: string, data: any) => Promise<SalesOrder>;
  
  adjustInventory: (data: any) => Promise<void>;
  
  // Notifications
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  dashboardStats: null,
  recentActivity: [],
  salesChart: [],
  topProducts: [],
  products: [],
  suppliers: [],
  warehouses: [],
  inventory: [],
  purchaseOrders: [],
  salesOrders: [],
  invoices: [],
  notifications: [],
  lowStockItems: [],
  agents: [],
  isLoading: false,

  // Dashboard
  fetchDashboard: async () => {
    try {
      set({ isLoading: true });
      const [stats, activity, chart, topProducts] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get('/dashboard/recent-activity'),
        api.get('/dashboard/sales-chart?days=7'),
        api.get('/dashboard/top-products'),
      ]);
      
      set({
        dashboardStats: stats.data,
        recentActivity: activity.data,
        salesChart: chart.data,
        topProducts: topProducts.data,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  // Products
  fetchProducts: async () => {
    try {
      const response = await api.get('/products');
      set({ products: response.data });
    } catch (error) {
      throw error;
    }
  },

  createProduct: async (data) => {
    const response = await api.post('/products', data);
    const newProduct = response.data;
    set((state) => ({ products: [...state.products, newProduct] }));
    return newProduct;
  },

  updateProduct: async (id, data) => {
    const response = await api.put(`/products/${id}`, data);
    const updated = response.data;
    set((state) => ({
      products: state.products.map((p) => (p.product_id === id ? updated : p)),
    }));
    return updated;
  },

  deleteProduct: async (id) => {
    await api.delete(`/products/${id}`);
    set((state) => ({
      products: state.products.filter((p) => p.product_id !== id),
    }));
  },

  // Suppliers
  fetchSuppliers: async () => {
    const response = await api.get('/suppliers');
    set({ suppliers: response.data });
  },

  createSupplier: async (data) => {
    const response = await api.post('/suppliers', data);
    const newSupplier = response.data;
    set((state) => ({ suppliers: [...state.suppliers, newSupplier] }));
    return newSupplier;
  },

  updateSupplier: async (id, data) => {
    const response = await api.put(`/suppliers/${id}`, data);
    const updated = response.data;
    set((state) => ({
      suppliers: state.suppliers.map((s) => (s.supplier_id === id ? updated : s)),
    }));
    return updated;
  },

  deleteSupplier: async (id) => {
    await api.delete(`/suppliers/${id}`);
    set((state) => ({
      suppliers: state.suppliers.filter((s) => s.supplier_id !== id),
    }));
  },

  fetchSalesOrders: async () => {
    const response = await api.get('/sales-orders');
    set({ salesOrders: response.data });
  },

  createSalesOrder: async (data) => {
    const response = await api.post('/sales-orders', data);
    const newSO = response.data;
    set((state) => ({ salesOrders: [newSO, ...state.salesOrders] }));
    return newSO;
  },

  updateSalesOrder: async (id, data) => {
    const response = await api.put(`/sales-orders/${id}`, data);
    const updated = response.data;
    set((state) => ({
      salesOrders: state.salesOrders.map((so) => (so.so_id === id ? updated : so)),
    }));
    return updated;
  },

  // Warehouses
  createWarehouse: async (data) => {
    const response = await api.post('/warehouses', data);
    const newWh = response.data;
    set((state) => ({ warehouses: [...state.warehouses, newWh] }));
    return newWh;
  },

  updateWarehouse: async (id, data) => {
    const response = await api.put(`/warehouses/${id}`, data);
    const updated = response.data;
    set((state) => ({
      warehouses: state.warehouses.map((w) => (w.warehouse_id === id ? updated : w)),
    }));
    return updated;
  },

  deleteWarehouse: async (id) => {
    await api.delete(`/warehouses/${id}`);
    set((state) => ({
      warehouses: state.warehouses.filter((w) => w.warehouse_id !== id),
    }));
  },

  // Purchase Orders
  createPurchaseOrder: async (data) => {
    const response = await api.post('/purchase-orders', data);
    const newPO = response.data;
    set((state) => ({ purchaseOrders: [newPO, ...state.purchaseOrders] }));
    return newPO;
  },

  updatePurchaseOrder: async (id, data) => {
    const response = await api.put(`/purchase-orders/${id}`, data);
    const updated = response.data;
    set((state) => ({
      purchaseOrders: state.purchaseOrders.map((po) => (po.po_id === id ? updated : po)),
    }));
    return updated;
  },

  // Invoices
  fetchInvoices: async () => {
    const response = await api.get('/invoices');
    set({ invoices: response.data });
  },

  // Inventory adjustment
  adjustInventory: async (data) => {
    await api.post('/inventory/adjust', data);
    await useAppStore.getState().fetchInventory();
  },

  // Notifications
  fetchNotifications: async () => {
    const response = await api.get('/notifications');
    set({ notifications: response.data });
  },

  markNotificationRead: async (notificationId: string) => {
    await api.put(`/notifications/${notificationId}/read`);
    set((state) => ({
      notifications: state.notifications.map((n: any) =>
        n.notification_id === notificationId ? { ...n, is_read: true } : n
      ),
    }));
  },

  markAllNotificationsRead: async () => {
    await api.put('/notifications/read-all');
    set((state) => ({
      notifications: state.notifications.map((n: any) => ({ ...n, is_read: true })),
    }));
  },

  // ---- Implemented below to satisfy the AppState interface ----
  fetchWarehouses: async () => {
    const response = await api.get('/warehouses');
    set({ warehouses: response.data || [] });
  },

  fetchInventory: async () => {
    const response = await api.get('/inventory');
    set({ inventory: response.data || [] });
  },

  fetchPurchaseOrders: async () => {
    const response = await api.get('/purchase-orders');
    set({ purchaseOrders: response.data || [] });
  },

  fetchLowStockItems: async () => {
    const response = await api.get('/products', { params: { low_stock: true } });
    set({ lowStockItems: response.data || [] });
  },

  fetchAgents: async () => {
    const response = await api.get('/users/agents');
    set({ agents: response.data || [] });
  },
}));
