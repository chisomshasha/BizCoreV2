import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import api from '../utils/api';

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  pendingChanges: any[];
  
  // Actions
  checkConnection: () => Promise<boolean>;
  setOnlineStatus: (status: boolean) => void;
  addPendingChange: (change: any) => Promise<void>;
  syncPendingChanges: () => Promise<void>;
  pullLatestData: (entityType: string) => Promise<any[]>;
  clearPendingChanges: () => Promise<void>;
  loadPendingChanges: () => Promise<void>;
}

const PENDING_CHANGES_KEY = 'bizcore_pending_changes';
const LAST_SYNC_KEY = 'bizcore_last_sync';

export const useSyncStore = create<SyncState>((set, get) => ({
  isOnline: true,
  isSyncing: false,
  lastSyncTime: null,
  pendingChanges: [],

  checkConnection: async () => {
    try {
      const state = await NetInfo.fetch();
      const connected = state.isConnected === true;
      const reachable = state.isInternetReachable !== false;
      const isOnline: boolean = connected && reachable;
      set({ isOnline });
      return isOnline;
    } catch {
      set({ isOnline: false });
      return false;
    }
  },

  setOnlineStatus: (status: boolean) => {
    set({ isOnline: status });
  },

  addPendingChange: async (change: any) => {
    const { pendingChanges } = get();
    const newChanges = [...pendingChanges, { ...change, timestamp: new Date().toISOString() }];
    set({ pendingChanges: newChanges });
    await AsyncStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(newChanges));
  },

  syncPendingChanges: async () => {
    const { pendingChanges, isOnline } = get();
    
    if (!isOnline || pendingChanges.length === 0) {
      return;
    }

    set({ isSyncing: true });

    try {
      // Group changes by entity type
      const changesByType: { [key: string]: any[] } = {};
      for (const change of pendingChanges) {
        const type = change.entity_type || 'unknown';
        if (!changesByType[type]) {
          changesByType[type] = [];
        }
        changesByType[type].push(change);
      }

      // Sync each type
      const successfulSyncs: string[] = [];
      for (const [entityType, changes] of Object.entries(changesByType)) {
        try {
          await api.post('/sync/push', {
            entity_type: entityType,
            local_changes: changes,
          });
          successfulSyncs.push(entityType);
        } catch (error) {
          console.error(`Failed to sync ${entityType}:`, error);
        }
      }

      // Remove successfully synced changes
      const remainingChanges = pendingChanges.filter(
        (change) => !successfulSyncs.includes(change.entity_type)
      );

      set({ pendingChanges: remainingChanges });
      await AsyncStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(remainingChanges));

      // Update last sync time
      const now = new Date().toISOString();
      set({ lastSyncTime: now });
      await AsyncStorage.setItem(LAST_SYNC_KEY, now);
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      set({ isSyncing: false });
    }
  },

  pullLatestData: async (entityType: string) => {
    const { isOnline } = get();
    
    if (!isOnline) {
      // Return cached data
      const cached = await AsyncStorage.getItem(`bizcore_cache_${entityType}`);
      return cached ? JSON.parse(cached) : [];
    }

    try {
      const lastSync = await AsyncStorage.getItem(`${LAST_SYNC_KEY}_${entityType}`);
      const response = await api.post('/sync/pull', {
        entity_type: entityType,
        last_sync: lastSync,
      });

      const { data, sync_time } = response.data;

      // Merge with existing cache
      const existingCache = await AsyncStorage.getItem(`bizcore_cache_${entityType}`);
      let allData = existingCache ? JSON.parse(existingCache) : [];

      // Update or add new items
      for (const item of data) {
        const idField = getIdField(entityType);
        const index = allData.findIndex((d: any) => d[idField] === item[idField]);
        if (index >= 0) {
          allData[index] = item;
        } else {
          allData.push(item);
        }
      }

      // Save to cache
      await AsyncStorage.setItem(`bizcore_cache_${entityType}`, JSON.stringify(allData));
      await AsyncStorage.setItem(`${LAST_SYNC_KEY}_${entityType}`, sync_time);

      return allData;
    } catch (error) {
      console.error(`Failed to pull ${entityType}:`, error);
      // Return cached data on error
      const cached = await AsyncStorage.getItem(`bizcore_cache_${entityType}`);
      return cached ? JSON.parse(cached) : [];
    }
  },

  clearPendingChanges: async () => {
    set({ pendingChanges: [] });
    await AsyncStorage.removeItem(PENDING_CHANGES_KEY);
  },

  loadPendingChanges: async () => {
    try {
      const stored = await AsyncStorage.getItem(PENDING_CHANGES_KEY);
      const lastSync = await AsyncStorage.getItem(LAST_SYNC_KEY);
      set({
        pendingChanges: stored ? JSON.parse(stored) : [],
        lastSyncTime: lastSync,
      });
    } catch {
      set({ pendingChanges: [] });
    }
  },
}));

function getIdField(entityType: string): string {
  const idFields: { [key: string]: string } = {
    products: 'product_id',
    suppliers: 'supplier_id',
    // The distributor entity was retired in favour of sales reps (agents).
    agent_quotations: 'quotation_id',
    agent_ledger: 'entry_id',
    warehouses: 'warehouse_id',
    purchase_orders: 'po_id',
    sales_orders: 'so_id',
    inventory: 'stock_id',
  };
  return idFields[entityType] || 'id';
}
