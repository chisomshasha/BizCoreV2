import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Modal, Alert, ActivityIndicator, FlatList, StyleSheet, RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/utils/api';
import { useAuthStore } from '../src/store/authStore';
import { AgentQuotation, AgentQuotationStatus, Product, InventoryStock } from '../src/types';

const STATUS_COLOR: Record<AgentQuotationStatus, string> = {
  draft: '#6B7280', pending: '#F59E0B', approved: '#10B981',
  rejected: '#EF4444', converted: '#3B82F6',
};

export default function QuotationsScreen() {
  const { user, isAgent, isApprover, isCrossWarehouse, warehouseId } = useAuthStore();
  // Quotation approval is restricted to SuperAdmin, General Manager, and
  // Warehouse Manager only — narrower than the general isApprover flag,
  // which also includes Accountant (used elsewhere for warehouse transfers
  // and debt-ceiling management, but not quotation approval).
  const canApproveQuotation = user?.role === 'super_admin'
    || user?.role === 'general_manager'
    || user?.role === 'warehouse_manager';
  const [quotations, setQuotations] = useState<AgentQuotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'mine' | 'pending' | 'all'>('mine');

  // Create Quotation modal state
  const [showCreate, setShowCreate] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [cartItems, setCartItems] = useState<{ product: Product; quantity: string; unit_price: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Approval modal state
  const [showApprove, setShowApprove] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [approvalRemarks, setApprovalRemarks] = useState('');
  const [approving, setApproving] = useState(false);

  const fetchQuotations = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (activeTab === 'pending') params.status = 'pending';
      const res = await api.get('/agent-quotations', { params });
      setQuotations(res.data);
    } catch (e) {
      Alert.alert('Error', 'Failed to load quotations');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab]);

  useEffect(() => { fetchQuotations(); }, [fetchQuotations]);

  const fetchProducts = async () => {
    const res = await api.get('/products');
    setProducts(res.data);
    if (warehouseId) {
      const inv = await api.get('/inventory', { params: { warehouse_id: warehouseId } });
      const map: Record<string, number> = {};
      inv.data.forEach((s: InventoryStock) => { map[s.product_id] = Number(s.quantity) || 0; });
      setStockMap(map);
    }
  };

  const openCreate = async () => {
    setCartItems([]);
    await fetchProducts();
    setShowCreate(true);
  };

  const addToCart = (product: Product) => {
    if (cartItems.find(i => i.product.product_id === product.product_id)) return;
    setCartItems(prev => [...prev, { product, quantity: '1', unit_price: String(product.selling_price) }]);
  };

  const createAndSubmit = async () => {
    const items = cartItems.map(i => ({
      product_id: i.product.product_id,
      quantity: parseFloat(i.quantity),
      unit_price: parseFloat(i.unit_price),
    })).filter(i => i.quantity > 0);

    if (!items.length) { Alert.alert('Error', 'Add at least one item'); return; }
    setSubmitting(true);
    try {
      const create = await api.post('/agent-quotations', { items });
      await api.put(`/agent-quotations/${create.data.quotation_id}/submit`);
      Alert.alert('Success', 'Quotation submitted for approval');
      setShowCreate(false);
      fetchQuotations();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to submit');
    } finally { setSubmitting(false); }
  };

  const handleApproval = async () => {
    if (!showApprove) return;
    if (!approvalRemarks.trim()) { Alert.alert('Required', 'Approval remarks cannot be empty'); return; }
    setApproving(true);
    try {
      const endpoint = showApprove.action === 'approve'
        ? `/agent-quotations/${showApprove.id}/approve`
        : `/agent-quotations/${showApprove.id}/reject`;
      await api.put(endpoint, { approval_remarks: approvalRemarks.trim() });
      Alert.alert('Done', showApprove.action === 'approve' ? 'Quotation approved & Sales Order created' : 'Quotation rejected');
      setShowApprove(null);
      setApprovalRemarks('');
      fetchQuotations();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed');
    } finally { setApproving(false); }
  };

  const tabs = isAgent
    ? [{ key: 'mine', label: 'My Quotations' }]
    : isApprover
    ? [{ key: 'pending', label: 'Pending Approval' }, { key: 'all', label: 'All' }]
    : [];

  const filteredQts = activeTab === 'mine'
    ? quotations.filter(q => q.sales_rep_id === user?.user_id)
    : quotations;

  if (loading) return (
    <View style={s.center}><ActivityIndicator size="large" color="#3B82F6" /></View>
  );

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Quotations</Text>
        {isAgent && (
          <TouchableOpacity style={s.addBtn} onPress={openCreate}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.addBtnText}>New</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      {tabs.length > 1 && (
        <View style={s.tabBar}>
          {tabs.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[s.tab, activeTab === t.key && s.tabActive]}
              onPress={() => setActiveTab(t.key as any)}>
              <Text style={[s.tabText, activeTab === t.key && s.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* List */}
      <FlatList
        data={filteredQts}
        keyExtractor={q => q.quotation_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchQuotations(); }} />}
        ListEmptyComponent={<View style={s.center}><Text style={s.empty}>No quotations found</Text></View>}
        renderItem={({ item: q }) => (
          <View style={s.card}>
            <View style={s.cardRow}>
              <Text style={s.cardTitle}>{q.quotation_number}</Text>
              <View style={[s.badge, { backgroundColor: STATUS_COLOR[q.status] }]}>
                <Text style={s.badgeText}>{q.status.toUpperCase()}</Text>
              </View>
            </View>
            {!isAgent && (
              <Text style={s.cardSub}>Rep: {q.sales_rep_name} {q.agent_is_flagged ? '⚠️ FLAGGED' : ''}</Text>
            )}
            {q.agent_is_flagged && (
              <View style={s.flagBanner}>
                <Ionicons name="warning" size={14} color="#fff" />
                <Text style={s.flagText}>
                  Outstanding: {q.agent_outstanding?.toFixed(2)} / Ceiling: {q.agent_debt_ceiling?.toFixed(2)}
                </Text>
              </View>
            )}
            <Text style={s.cardSub}>{q.items.length} item(s) · Total: {q.total_amount?.toFixed(2)}</Text>
            {q.approval_remarks ? (
              <Text style={s.remarks}>Remarks: {q.approval_remarks}</Text>
            ) : null}

            {/* Approve/Reject buttons for pending — SuperAdmin/GM/Warehouse Manager only */}
            {canApproveQuotation && q.status === 'pending' && (
              <View style={s.actionRow}>
                <TouchableOpacity
                  style={[s.actionBtn, s.approveBtn]}
                  onPress={() => { setShowApprove({ id: q.quotation_id, action: 'approve' }); setApprovalRemarks(''); }}>
                  <Text style={s.actionBtnText}>✓ Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.actionBtn, s.rejectBtn]}
                  onPress={() => { setShowApprove({ id: q.quotation_id, action: 'reject' }); setApprovalRemarks(''); }}>
                  <Text style={s.actionBtnText}>✗ Reject</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />

      {/* Create Quotation Modal */}
      <Modal visible={showCreate} animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>New Quotation</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
          </View>
          <ScrollView>
            <Text style={s.sectionLabel}>SELECT PRODUCTS</Text>
            {products.map(p => {
              const avail = stockMap[p.product_id] ?? 0;
              const inCart = cartItems.find(c => c.product.product_id === p.product_id);
              return (
                <View key={p.product_id} style={s.productRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.productName}>{p.name}</Text>
                    <Text style={s.productSub}>Available: {avail} {p.unit}</Text>
                  </View>
                  {inCart ? (
                    <View style={s.qtyRow}>
                      <Text style={s.qtyLabel}>Qty:</Text>
                      <TextInput
                        style={s.qtyInput}
                        keyboardType="numeric"
                        value={inCart.quantity}
                        onChangeText={v => setCartItems(prev => prev.map(c =>
                          c.product.product_id === p.product_id ? { ...c, quantity: v } : c))}
                      />
                    </View>
                  ) : (
                    <TouchableOpacity style={s.addToCartBtn} onPress={() => addToCart(p)}
                      disabled={avail === 0}>
                      <Text style={s.addToCartText}>{avail === 0 ? 'No Stock' : '+ Add'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={[s.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={createAndSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Submit for Approval</Text>}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Approval Modal */}
      <Modal visible={!!showApprove} animationType="fade" transparent onRequestClose={() => setShowApprove(null)}>
        <View style={s.overlay}>
          <View style={s.approveModal}>
            <Text style={s.approveTitle}>
              {showApprove?.action === 'approve' ? '✓ Approve Quotation' : '✗ Reject Quotation'}
            </Text>
            <Text style={s.approveLabel}>Remarks (required):</Text>
            <TextInput
              style={s.remarksInput}
              multiline
              numberOfLines={4}
              placeholder="Enter approval/rejection remarks..."
              placeholderTextColor="#6B7280"
              value={approvalRemarks}
              onChangeText={setApprovalRemarks}
            />
            <View style={s.actionRow}>
              <TouchableOpacity style={[s.actionBtn, s.rejectBtn]} onPress={() => setShowApprove(null)}>
                <Text style={s.actionBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.actionBtn, showApprove?.action === 'approve' ? s.approveBtn : s.rejectBtn, approving && { opacity: 0.6 }]}
                onPress={handleApproval} disabled={approving}>
                {approving ? <ActivityIndicator color="#fff" size="small" /> :
                  <Text style={s.actionBtnText}>{showApprove?.action === 'approve' ? 'Confirm Approve' : 'Confirm Reject'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
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
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, gap: 4 },
  addBtnText: { color: '#fff', fontWeight: '600' },
  tabBar: { flexDirection: 'row', backgroundColor: '#1F2937', borderBottomWidth: 1, borderBottomColor: '#374151' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#3B82F6' },
  tabText: { color: '#9CA3AF', fontWeight: '500' },
  tabTextActive: { color: '#3B82F6' },
  card: { backgroundColor: '#1F2937', margin: 8, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#374151' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#F9FAFB' },
  cardSub: { color: '#9CA3AF', fontSize: 13, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  flagBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#7F1D1D',
    borderRadius: 6, padding: 6, marginTop: 6, gap: 6 },
  flagText: { color: '#FCA5A5', fontSize: 12, flex: 1 },
  remarks: { color: '#60A5FA', fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  approveBtn: { backgroundColor: '#10B981' },
  rejectBtn: { backgroundColor: '#EF4444' },
  actionBtnText: { color: '#fff', fontWeight: 'bold' },
  empty: { color: '#6B7280', fontSize: 15 },
  modal: { flex: 1, backgroundColor: '#111827' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, backgroundColor: '#1F2937', borderBottomWidth: 1, borderBottomColor: '#374151' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#F9FAFB' },
  sectionLabel: { color: '#6B7280', fontSize: 11, fontWeight: '600', margin: 12, marginBottom: 4 },
  productRow: { flexDirection: 'row', alignItems: 'center', padding: 12,
    borderBottomWidth: 1, borderBottomColor: '#1F2937' },
  productName: { color: '#F9FAFB', fontWeight: '600' },
  productSub: { color: '#9CA3AF', fontSize: 12 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyLabel: { color: '#9CA3AF' },
  qtyInput: { backgroundColor: '#1F2937', color: '#F9FAFB', width: 60,
    borderRadius: 6, padding: 6, borderWidth: 1, borderColor: '#374151', textAlign: 'center' },
  addToCartBtn: { backgroundColor: '#3B82F6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  addToCartText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  submitBtn: { backgroundColor: '#3B82F6', margin: 16, padding: 16, borderRadius: 10, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  approveModal: { backgroundColor: '#1F2937', borderRadius: 16, padding: 20 },
  approveTitle: { fontSize: 18, fontWeight: 'bold', color: '#F9FAFB', marginBottom: 16 },
  approveLabel: { color: '#9CA3AF', marginBottom: 8 },
  remarksInput: { backgroundColor: '#111827', color: '#F9FAFB', borderWidth: 1,
    borderColor: '#374151', borderRadius: 8, padding: 12, minHeight: 100,
    textAlignVertical: 'top', marginBottom: 16 },
});
