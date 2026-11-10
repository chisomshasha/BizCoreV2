import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, StyleSheet, RefreshControl, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/utils/api';
import { useAuthStore } from '../src/store/authStore';
import { SalesOrder } from '../src/types';
import { formatCurrency } from '../src/config/clientConfig';

/**
 * Dispatch — last leg of the agent-quotation workflow.
 *
 * Sales Rep      → creates & submits a Quotation (see quotations.tsx)
 * SuperAdmin/GM/
 * Warehouse Mgr  → approves the Quotation (auto-converts to a Sales Order,
 *                  status = approved, dispatch_status = pending_dispatch)
 * Sales Clerk    → (this screen) releases the goods to the Sales Rep,
 *                  which debits the Agent Ledger and decrements stock
 * Sales Rep      → (this screen) confirms they received the goods
 *
 * Visible to: Sales Clerk, Warehouse Manager, SuperAdmin, General Manager
 * (can release goods), and Sales Rep (can confirm receipt of their own
 * orders only — see "Awaiting My Confirmation" tab).
 */
export default function DispatchScreen() {
  const { user, isAgent, warehouseId } = useAuthStore();
  const role = user?.role ?? '';
  const canRelease = ['sales_clerk', 'warehouse_manager', 'super_admin', 'general_manager'].includes(role);

  const [activeTab, setActiveTab] = useState<'pending_dispatch' | 'awaiting_confirmation'>(
    canRelease ? 'pending_dispatch' : 'awaiting_confirmation'
  );
  const [pendingOrders, setPendingOrders] = useState<SalesOrder[]>([]);
  const [releasedOrders, setReleasedOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const calls: Promise<any>[] = [];
      if (canRelease) {
        calls.push(api.get('/sales-orders/pending-dispatch'));
      } else {
        calls.push(Promise.resolve({ data: [] }));
      }
      // Goods-released orders awaiting the rep's confirmation. Sales Reps
      // see only their own; warehouse staff see their warehouse's queue.
      const params: Record<string, string> = { status: 'goods_released' };
      if (isAgent) params.sales_rep_id = user?.user_id || '';
      calls.push(api.get('/sales-orders', { params }));

      const [pendingRes, releasedRes] = await Promise.all(calls);
      setPendingOrders(pendingRes.data || []);
      setReleasedOrders(releasedRes.data || []);
    } catch (e) {
      Alert.alert('Error', 'Failed to load dispatch data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canRelease, isAgent, user?.user_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleReleaseGoods = (so: SalesOrder) => {
    Alert.alert(
      'Release Goods',
      `Release goods for ${so.so_number} to ${so.sales_rep_name || 'this rep'}? This will deduct stock and add a debit to their ledger.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Release',
          onPress: async () => {
            setActingOn(so.so_id);
            try {
              await api.put(`/sales-orders/${so.so_id}/release-goods`);
              Alert.alert('Released', `Goods for ${so.so_number} released successfully`);
              fetchData();
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.detail || 'Failed to release goods');
            } finally {
              setActingOn(null);
            }
          },
        },
      ]
    );
  };

  const handleConfirmDelivery = (so: SalesOrder) => {
    Alert.alert(
      'Confirm Receipt',
      `Confirm you have received the goods for ${so.so_number}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setActingOn(so.so_id);
            try {
              await api.put(`/sales-orders/${so.so_id}/confirm-delivery`);
              Alert.alert('Confirmed', `Delivery confirmed for ${so.so_number}`);
              fetchData();
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.detail || 'Failed to confirm delivery');
            } finally {
              setActingOn(null);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  const tabs = [
    ...(canRelease ? [{ key: 'pending_dispatch' as const, label: `Ready to Release (${pendingOrders.length})` }] : []),
    { key: 'awaiting_confirmation' as const, label: `Awaiting Confirmation (${releasedOrders.length})` },
  ];

  const data = activeTab === 'pending_dispatch' ? pendingOrders : releasedOrders;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Dispatch</Text>
        <Text style={s.headerSub}>Goods release & delivery confirmation</Text>
      </View>

      {tabs.length > 1 && (
        <View style={s.tabBar}>
          {tabs.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[s.tab, activeTab === t.key && s.tabActive]}
              onPress={() => setActiveTab(t.key)}
            >
              <Text style={[s.tabText, activeTab === t.key && s.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={data}
        keyExtractor={(so) => so.so_id}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor="#3B82F6" />
        }
        ListEmptyComponent={
          <View style={s.center}>
            <Text style={s.empty}>
              {activeTab === 'pending_dispatch' ? 'No orders ready for release' : 'Nothing awaiting confirmation'}
            </Text>
          </View>
        }
        renderItem={({ item: so }) => (
          <View style={s.card}>
            <View style={s.cardRow}>
              <Text style={s.cardTitle}>{so.so_number}</Text>
              <Text style={s.cardAmount}>{formatCurrency(so.total_amount)}</Text>
            </View>
            <Text style={s.cardSub}>Rep: {so.sales_rep_name || 'Unknown'}</Text>
            <Text style={s.cardSub}>{so.items?.length || 0} item(s)</Text>
            {so.source_quotation_id && (
              <Text style={s.cardMeta}>From quotation {so.source_quotation_id}</Text>
            )}

            <View style={s.itemsBlock}>
              {(so.items || []).map((item) => (
                <View key={item.item_id} style={s.itemLine}>
                  <Text style={s.itemName} numberOfLines={1}>{item.product_name || item.product_id}</Text>
                  <Text style={s.itemQty}>{item.quantity}</Text>
                  <Text style={s.itemPrice}>@ {formatCurrency(item.unit_price)}</Text>
                </View>
              ))}
            </View>

            {activeTab === 'pending_dispatch' && canRelease && (
              <TouchableOpacity
                style={[s.actionBtn, s.releaseBtn, actingOn === so.so_id && { opacity: 0.6 }]}
                onPress={() => handleReleaseGoods(so)}
                disabled={actingOn === so.so_id}
              >
                {actingOn === so.so_id
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.actionBtnText}>Release Goods</Text>}
              </TouchableOpacity>
            )}

            {activeTab === 'awaiting_confirmation' && (isAgent ? so.sales_rep_id === user?.user_id : true) && (
              <TouchableOpacity
                style={[s.actionBtn, s.confirmBtn, actingOn === so.so_id && { opacity: 0.6 }]}
                onPress={() => handleConfirmDelivery(so)}
                disabled={actingOn === so.so_id}
              >
                {actingOn === so.so_id
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.actionBtnText}>Confirm Receipt</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827', padding: 24 },
  empty: { color: '#6B7280', textAlign: 'center' },

  header: { padding: 16, paddingTop: 20, backgroundColor: '#1F2937', borderBottomWidth: 1, borderBottomColor: '#374151' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#F9FAFB' },
  headerSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  tabBar: { flexDirection: 'row', backgroundColor: '#1F2937', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#374151' },
  tabActive: { backgroundColor: '#3B82F6' },
  tabText: { color: '#9CA3AF', fontWeight: '500', fontSize: 12 },
  tabTextActive: { color: '#fff' },

  card: { backgroundColor: '#1F2937', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#374151' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { color: '#F9FAFB', fontWeight: '700', fontSize: 15 },
  cardAmount: { color: '#3B82F6', fontWeight: '700', fontSize: 14 },
  cardSub: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
  cardMeta: { color: '#6B7280', fontSize: 11, marginTop: 2 },

  itemsBlock: { backgroundColor: '#111827', borderRadius: 8, padding: 8, marginTop: 10, marginBottom: 10 },
  itemLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 4 },
  itemName: { color: '#D1D5DB', fontSize: 12, flex: 1 },
  itemQty: { color: '#9CA3AF', fontSize: 12, minWidth: 40, textAlign: 'right' },
  itemPrice: { color: '#6B7280', fontSize: 11, minWidth: 80, textAlign: 'right' },

  actionBtn: { paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  releaseBtn: { backgroundColor: '#3B82F6' },
  confirmBtn: { backgroundColor: '#10B981' },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
