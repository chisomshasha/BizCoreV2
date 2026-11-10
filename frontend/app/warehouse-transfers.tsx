import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Modal, Alert, ActivityIndicator, StyleSheet, FlatList, RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/utils/api';
import { useAuthStore } from '../src/store/authStore';
import { WarehouseTransfer, Warehouse, Product } from '../src/types';

const STATUS_COLOR: Record<string, string> = {
  pending: '#F59E0B', confirmed: '#10B981', cancelled: '#EF4444',
};

export default function WarehouseTransfersScreen() {
  const { user, isApprover, isCrossWarehouse, warehouseId } = useAuthStore();
  const [transfers, setTransfers] = useState<WarehouseTransfer[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [toWarehouse, setToWarehouse] = useState('');
  const [transferItems, setTransferItems] = useState<{ product_id: string; product_name: string; quantity: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchTransfers = useCallback(async () => {
    try {
      const res = await api.get('/warehouse-transfers');
      setTransfers(res.data);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchTransfers();
    api.get('/warehouses').then(r => setWarehouses(r.data));
    api.get('/products').then(r => setProducts(r.data));
  }, []);

  const otherWarehouses = warehouses.filter(w => w.warehouse_id !== warehouseId);

  const addItem = (p: Product) => {
    if (transferItems.find(i => i.product_id === p.product_id)) return;
    setTransferItems(prev => [...prev, { product_id: p.product_id, product_name: p.name, quantity: '1' }]);
  };

  const initiate = async () => {
    if (!toWarehouse) { Alert.alert('Required', 'Select destination warehouse'); return; }
    const items = transferItems.map(i => ({ product_id: i.product_id, quantity: parseFloat(i.quantity) }))
      .filter(i => i.quantity > 0);
    if (!items.length) { Alert.alert('Required', 'Add at least one item'); return; }
    setSubmitting(true);
    try {
      await api.post('/warehouse-transfers', { to_warehouse_id: toWarehouse, items, notes });
      Alert.alert('Success', 'Transfer initiated. Receiving warehouse will be notified.');
      setShowCreate(false);
      setTransferItems([]); setToWarehouse(''); setNotes('');
      fetchTransfers();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed');
    } finally { setSubmitting(false); }
  };

  const confirm = async (id: string, number: string) => {
    Alert.alert('Confirm Receipt', `Confirm you have received transfer ${number}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: async () => {
        try {
          await api.put(`/warehouse-transfers/${id}/confirm`);
          Alert.alert('Done', 'Transfer confirmed. Inventory updated.');
          fetchTransfers();
        } catch (e: any) { Alert.alert('Error', e?.response?.data?.detail || 'Failed'); }
      }},
    ]);
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#3B82F6" /></View>;

  const pendingIncoming = transfers.filter(
    t => t.status === 'pending' && t.to_warehouse_id === warehouseId
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Warehouse Transfers</Text>
        {isApprover && (
          <TouchableOpacity style={s.addBtn} onPress={() => setShowCreate(true)}>
            <Ionicons name="swap-horizontal" size={16} color="#fff" />
            <Text style={s.addBtnText}>New Transfer</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Pending incoming banner */}
      {pendingIncoming.length > 0 && (
        <View style={s.incomingBanner}>
          <Ionicons name="download" size={16} color="#60A5FA" />
          <Text style={s.incomingText}>{pendingIncoming.length} incoming transfer(s) awaiting your confirmation</Text>
        </View>
      )}

      <FlatList
        data={transfers}
        keyExtractor={t => t.transfer_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTransfers(); }} />}
        ListEmptyComponent={<View style={s.center}><Text style={s.empty}>No transfers found</Text></View>}
        renderItem={({ item: t }) => {
          const isIncoming = t.to_warehouse_id === warehouseId;
          const canConfirm = isIncoming && t.status === 'pending' && isApprover;
          return (
            <View style={s.card}>
              <View style={s.cardRow}>
                <Text style={s.cardTitle}>{t.transfer_number}</Text>
                <View style={[s.badge, { backgroundColor: STATUS_COLOR[t.status] }]}>
                  <Text style={s.badgeText}>{t.status.toUpperCase()}</Text>
                </View>
              </View>
              <View style={s.directionRow}>
                <Text style={s.dirText}>{t.from_warehouse_name || t.from_warehouse_id}</Text>
                <Ionicons name="arrow-forward" size={14} color="#9CA3AF" />
                <Text style={s.dirText}>{t.to_warehouse_name || t.to_warehouse_id}</Text>
              </View>
              <Text style={s.cardSub}>{t.items.length} item(s) · Value: {t.total_value?.toFixed(2)}</Text>
              {t.notes ? <Text style={s.cardSub}>Notes: {t.notes}</Text> : null}
              {canConfirm && (
                <TouchableOpacity style={s.confirmBtn} onPress={() => confirm(t.transfer_id, t.transfer_number)}>
                  <Ionicons name="checkmark-circle" size={16} color="#fff" />
                  <Text style={s.confirmBtnText}>Confirm Receipt</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      {/* Create Transfer Modal */}
      <Modal visible={showCreate} animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>New Stock Transfer</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
          </View>
          <ScrollView>
            <Text style={s.sectionLabel}>DESTINATION WAREHOUSE</Text>
            {otherWarehouses.map(w => (
              <TouchableOpacity key={w.warehouse_id}
                style={[s.whOption, toWarehouse === w.warehouse_id && s.whOptionActive]}
                onPress={() => setToWarehouse(w.warehouse_id)}>
                <Ionicons name={toWarehouse === w.warehouse_id ? 'radio-button-on' : 'radio-button-off'}
                  size={18} color={toWarehouse === w.warehouse_id ? '#3B82F6' : '#9CA3AF'} />
                <Text style={[s.whOptionText, toWarehouse === w.warehouse_id && { color: '#3B82F6' }]}>{w.name}</Text>
              </TouchableOpacity>
            ))}

            <Text style={s.sectionLabel}>PRODUCTS TO TRANSFER</Text>
            {transferItems.map((item, idx) => (
              <View key={item.product_id} style={s.transferItemRow}>
                <Text style={{ flex: 1, color: '#F9FAFB' }}>{item.product_name}</Text>
                <TextInput
                  style={s.qtyInput}
                  keyboardType="numeric"
                  value={item.quantity}
                  onChangeText={v => setTransferItems(prev => prev.map((p, i) => i === idx ? { ...p, quantity: v } : p))}
                />
                <TouchableOpacity onPress={() => setTransferItems(prev => prev.filter((_, i) => i !== idx))}>
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}

            <Text style={s.sectionLabel}>ADD PRODUCT</Text>
            {products.filter(p => !transferItems.find(i => i.product_id === p.product_id)).map(p => (
              <TouchableOpacity key={p.product_id} style={s.productRow} onPress={() => addItem(p)}>
                <Text style={{ color: '#F9FAFB', flex: 1 }}>{p.name}</Text>
                <Ionicons name="add-circle-outline" size={20} color="#3B82F6" />
              </TouchableOpacity>
            ))}

            <Text style={s.sectionLabel}>NOTES (OPTIONAL)</Text>
            <TextInput
              style={s.notesInput}
              multiline
              placeholder="Transfer reason..."
              placeholderTextColor="#6B7280"
              value={notes}
              onChangeText={setNotes}
            />
          </ScrollView>

          <TouchableOpacity style={[s.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={initiate} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> :
              <Text style={s.submitBtnText}>Initiate Transfer</Text>}
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, backgroundColor: '#1F2937', borderBottomWidth: 1, borderBottomColor: '#374151' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#F9FAFB' },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#3B82F6',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, gap: 6 },
  addBtnText: { color: '#fff', fontWeight: '600' },
  incomingBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E3A5F',
    padding: 10, gap: 8 },
  incomingText: { color: '#60A5FA', flex: 1 },
  card: { backgroundColor: '#1F2937', margin: 8, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#374151' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: '#F9FAFB' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  directionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  dirText: { color: '#60A5FA', fontWeight: '500' },
  cardSub: { color: '#9CA3AF', fontSize: 13, marginTop: 2 },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#10B981',
    marginTop: 10, padding: 10, borderRadius: 8, gap: 6, justifyContent: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: 'bold' },
  empty: { color: '#6B7280' },
  modal: { flex: 1, backgroundColor: '#111827' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, backgroundColor: '#1F2937', borderBottomWidth: 1, borderBottomColor: '#374151' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#F9FAFB' },
  sectionLabel: { color: '#6B7280', fontSize: 11, fontWeight: '600', margin: 12, marginBottom: 6 },
  whOption: { flexDirection: 'row', alignItems: 'center', padding: 12,
    borderBottomWidth: 1, borderBottomColor: '#1F2937', gap: 8 },
  whOptionActive: { backgroundColor: '#1E3A5F' },
  whOptionText: { color: '#F9FAFB', fontWeight: '500' },
  transferItemRow: { flexDirection: 'row', alignItems: 'center', padding: 10,
    borderBottomWidth: 1, borderBottomColor: '#1F2937', gap: 8 },
  productRow: { flexDirection: 'row', alignItems: 'center', padding: 10,
    borderBottomWidth: 1, borderBottomColor: '#1F2937' },
  qtyInput: { backgroundColor: '#1F2937', color: '#F9FAFB', width: 60,
    borderRadius: 6, padding: 6, borderWidth: 1, borderColor: '#374151', textAlign: 'center' },
  notesInput: { backgroundColor: '#1F2937', color: '#F9FAFB', margin: 12,
    borderWidth: 1, borderColor: '#374151', borderRadius: 8, padding: 12, minHeight: 80 },
  submitBtn: { backgroundColor: '#3B82F6', margin: 16, padding: 16, borderRadius: 10, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
