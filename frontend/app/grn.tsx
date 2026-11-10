import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Colors,
  Card,
  Button,
  Badge,
  LoadingScreen,
  EmptyState,
} from '../src/components/ThemedComponents';
import { formatCurrency } from '../src/config/clientConfig';
import { useAuthStore } from '../src/store/authStore';
import { format } from 'date-fns';
import api from '../src/utils/api';

interface GRN {
  grn_id: string;
  grn_number: string;
  po_id: string;
  po_number: string;
  supplier_id: string;
  supplier_name?: string;
  warehouse_id: string;
  received_date: string;
  status: string;
  items: any[];
  total_amount: number;
  received_by?: string;
  notes?: string;
  created_at: string;
}

export default function GRNScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  // Matches backend grn:create — SuperAdmin, General Manager, Warehouse
  // Manager, Purchase Clerk (they receive goods against POs).
  const canCreateGRN = ['super_admin', 'general_manager', 'warehouse_manager', 'purchase_clerk'].includes(user?.role ?? '');
  
  const [grns, setGrns] = useState<GRN[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedGRN, setSelectedGRN] = useState<GRN | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  
  // Create form
  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [receiveItems, setReceiveItems] = useState<any[]>([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      await Promise.all([fetchGRNs(), fetchPOs()]);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchGRNs = async () => {
    try {
      const response = await api.get('/grn');
      setGrns(response.data);
    } catch (error) {
      console.error('Error fetching GRNs:', error);
    }
  };

  const fetchPOs = async () => {
    try {
      const response = await api.get('/purchase-orders');
      // Filter to ordered POs only
      setPurchaseOrders(response.data.filter((po: any) => po.status === 'ordered'));
    } catch (error) {
      console.error('Error fetching POs:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchGRNs();
    setRefreshing(false);
  };

  const selectPO = (po: any) => {
    setSelectedPO(po);
    setReceiveItems(po.items.map((item: any) => ({
      po_item_id: item.item_id,
      product_id: item.product_id,
      product_name: item.product_name,
      ordered_quantity: item.quantity,
      received_quantity: item.quantity,
      accepted_quantity: item.quantity,
      rejected_quantity: 0,
      rejection_reason: '',
    })));
  };

  const updateReceiveItem = (idx: number, field: string, value: any) => {
    const updated = [...receiveItems];
    updated[idx][field] = value;
    
    // Auto-calculate accepted
    if (field === 'received_quantity' || field === 'rejected_quantity') {
      const received = field === 'received_quantity' ? value : updated[idx].received_quantity;
      const rejected = field === 'rejected_quantity' ? value : updated[idx].rejected_quantity;
      updated[idx].accepted_quantity = Math.max(0, received - rejected);
    }
    
    setReceiveItems(updated);
  };

  const handleCreateGRN = async () => {
    if (!selectedPO) {
      Alert.alert('Error', 'Select a Purchase Order');
      return;
    }

    try {
      await api.post('/grn', {
        po_id: selectedPO.po_id,
        warehouse_id: selectedPO.warehouse_id,
        items: receiveItems.map(item => ({
          po_item_id: item.po_item_id,
          product_id: item.product_id,
          received_quantity: item.received_quantity,
          accepted_quantity: item.accepted_quantity,
          rejected_quantity: item.rejected_quantity,
          rejection_reason: item.rejection_reason,
        })),
        notes,
      });
      Alert.alert('Success', 'GRN created. Inventory updated.');
      setShowCreateModal(false);
      setSelectedPO(null);
      setReceiveItems([]);
      setNotes('');
      fetchGRNs();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create GRN');
    }
  };

  const handleUpdateStatus = async (grnId: string, status: string) => {
    try {
      await api.put(`/grn/${grnId}/status?status=${status}`);
      Alert.alert('Success', `GRN marked as ${status}`);
      fetchGRNs();
      setShowDetailModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed');
    }
  };

  const getStatusVariant = (status: string): 'success' | 'warning' | 'danger' | 'default' => {
    switch (status) {
      case 'received': return 'success';
      case 'partial': return 'warning';
      case 'rejected': return 'danger';
      default: return 'default';
    }
  };

  const filteredGRNs = statusFilter === 'all' ? grns : grns.filter(g => g.status === statusFilter);

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Goods Receipt Notes</Text>
        {canCreateGRN ? (
          <TouchableOpacity style={styles.addButton} onPress={() => setShowCreateModal(true)}>
            <Ionicons name="add" size={24} color={Colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {['all', 'pending', 'received', 'partial', 'rejected'].map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.filterText, statusFilter === s && styles.filterTextActive]}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        contentContainerStyle={styles.content}
      >
        {filteredGRNs.length === 0 ? (
          <EmptyState icon="receipt-outline" title="No GRNs" message="Create a GRN when goods are received" />
        ) : (
          filteredGRNs.map(grn => (
            <TouchableOpacity
              key={grn.grn_id}
              style={styles.grnCard}
              onPress={() => { setSelectedGRN(grn); setShowDetailModal(true); }}
            >
              <View style={styles.grnHeader}>
                <View style={styles.grnIcon}>
                  <Ionicons name="receipt" size={24} color={Colors.primary} />
                </View>
                <View style={styles.grnInfo}>
                  <Text style={styles.grnNumber}>{grn.grn_number}</Text>
                  <Text style={styles.grnPO}>PO: {grn.po_number}</Text>
                </View>
                <Badge text={grn.status} variant={getStatusVariant(grn.status)} />
              </View>
              <View style={styles.grnFooter}>
                <Text style={styles.grnSupplier}>{grn.supplier_name}</Text>
                <Text style={styles.grnTotal}>{formatCurrency(grn.total_amount)}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Create Modal */}
      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCreateModal(false)}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Receive Goods</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.label}>Select Purchase Order</Text>
            {purchaseOrders.length === 0 ? (
              <Text style={styles.emptyText}>No pending POs to receive</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {purchaseOrders.map(po => (
                  <TouchableOpacity
                    key={po.po_id}
                    style={[styles.poCard, selectedPO?.po_id === po.po_id && styles.poCardActive]}
                    onPress={() => selectPO(po)}
                  >
                    <Text style={styles.poNumber}>{po.po_number}</Text>
                    <Text style={styles.poSupplier}>{po.supplier_name}</Text>
                    <Text style={styles.poTotal}>{formatCurrency(po.total_amount)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {selectedPO && (
              <>
                <Text style={styles.sectionTitle}>Items to Receive</Text>
                {receiveItems.map((item, idx) => (
                  <Card key={idx} style={styles.receiveCard}>
                    <Text style={styles.itemName}>{item.product_name}</Text>
                    <Text style={styles.itemOrdered}>Ordered: {item.ordered_quantity}</Text>
                    <View style={styles.inputRow}>
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Received</Text>
                        <TextInput
                          style={styles.numInput}
                          value={String(item.received_quantity)}
                          onChangeText={(v) => updateReceiveItem(idx, 'received_quantity', parseFloat(v) || 0)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Rejected</Text>
                        <TextInput
                          style={styles.numInput}
                          value={String(item.rejected_quantity)}
                          onChangeText={(v) => updateReceiveItem(idx, 'rejected_quantity', parseFloat(v) || 0)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Accepted</Text>
                        <Text style={styles.acceptedValue}>{item.accepted_quantity}</Text>
                      </View>
                    </View>
                    {item.rejected_quantity > 0 && (
                      <TextInput
                        style={[styles.input, { marginTop: 8 }]}
                        value={item.rejection_reason}
                        onChangeText={(v) => updateReceiveItem(idx, 'rejection_reason', v)}
                        placeholder="Rejection reason"
                        placeholderTextColor={Colors.textMuted}
                      />
                    )}
                  </Card>
                ))}

                <Text style={styles.label}>Notes</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Receiving notes..."
                  placeholderTextColor={Colors.textMuted}
                  multiline
                />

                <Button title="Create GRN" onPress={handleCreateGRN} style={{ marginTop: 20 }} />
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Detail Modal */}
      <Modal visible={showDetailModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDetailModal(false)}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{selectedGRN?.grn_number}</Text>
            <View style={{ width: 24 }} />
          </View>
          {selectedGRN && (
            <ScrollView style={styles.modalContent}>
              <Card>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>PO Number</Text>
                  <Text style={styles.detailValue}>{selectedGRN.po_number}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Supplier</Text>
                  <Text style={styles.detailValue}>{selectedGRN.supplier_name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Badge text={selectedGRN.status} variant={getStatusVariant(selectedGRN.status)} />
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Total Value</Text>
                  <Text style={[styles.detailValue, { color: Colors.primary }]}>{formatCurrency(selectedGRN.total_amount)}</Text>
                </View>
              </Card>

              <Text style={styles.sectionTitle}>Received Items</Text>
              {selectedGRN.items.map((item: any, idx: number) => (
                <Card key={idx} style={styles.itemCard}>
                  <Text style={styles.itemName}>{item.product_name}</Text>
                  <View style={styles.itemStats}>
                    <View style={styles.itemStat}>
                      <Text style={styles.statLabel}>Ordered</Text>
                      <Text style={styles.statValue}>{item.ordered_quantity}</Text>
                    </View>
                    <View style={styles.itemStat}>
                      <Text style={styles.statLabel}>Received</Text>
                      <Text style={styles.statValue}>{item.received_quantity}</Text>
                    </View>
                    <View style={styles.itemStat}>
                      <Text style={styles.statLabel}>Accepted</Text>
                      <Text style={[styles.statValue, { color: Colors.success }]}>{item.accepted_quantity}</Text>
                    </View>
                    {item.rejected_quantity > 0 && (
                      <View style={styles.itemStat}>
                        <Text style={styles.statLabel}>Rejected</Text>
                        <Text style={[styles.statValue, { color: Colors.danger }]}>{item.rejected_quantity}</Text>
                      </View>
                    )}
                  </View>
                </Card>
              ))}

              {selectedGRN.status === 'pending' && canCreateGRN && (
                <Button
                  title="Mark as Received"
                  onPress={() => handleUpdateStatus(selectedGRN.grn_id, 'received')}
                  style={{ marginTop: 16 }}
                />
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  addButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: Colors.card, marginRight: 8, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { color: Colors.textSecondary, fontSize: 13 },
  filterTextActive: { color: Colors.text, fontWeight: '600' },
  content: { padding: 16 },
  grnCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  grnHeader: { flexDirection: 'row', alignItems: 'center' },
  grnIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: `${Colors.primary}20`, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  grnInfo: { flex: 1 },
  grnNumber: { fontSize: 16, fontWeight: '700', color: Colors.text },
  grnPO: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  grnFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  grnSupplier: { fontSize: 13, color: Colors.textMuted },
  grnTotal: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  modalContent: { flex: 1, padding: 16 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, marginTop: 16 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', padding: 20 },
  poCard: { padding: 16, borderRadius: 12, backgroundColor: Colors.card, marginRight: 12, borderWidth: 1, borderColor: Colors.border, minWidth: 150 },
  poCardActive: { borderColor: Colors.primary, backgroundColor: `${Colors.primary}15` },
  poNumber: { fontSize: 14, fontWeight: '700', color: Colors.text },
  poSupplier: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  poTotal: { fontSize: 14, fontWeight: '600', color: Colors.primary, marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginTop: 20, marginBottom: 8, textTransform: 'uppercase' },
  receiveCard: { marginBottom: 12 },
  itemName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  itemOrdered: { fontSize: 13, color: Colors.textMuted, marginTop: 4 },
  inputRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  inputGroup: { flex: 1 },
  inputLabel: { fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
  numInput: { backgroundColor: Colors.cardAlt, borderRadius: 8, padding: 10, color: Colors.text, fontSize: 14, textAlign: 'center' },
  acceptedValue: { backgroundColor: Colors.cardAlt, borderRadius: 8, padding: 10, color: Colors.success, fontSize: 14, textAlign: 'center', fontWeight: '700' },
  input: { backgroundColor: Colors.card, borderRadius: 8, padding: 12, color: Colors.text, fontSize: 14, borderWidth: 1, borderColor: Colors.border },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  detailLabel: { fontSize: 14, color: Colors.textSecondary },
  detailValue: { fontSize: 14, fontWeight: '500', color: Colors.text },
  itemCard: { marginBottom: 8 },
  itemStats: { flexDirection: 'row', marginTop: 8, gap: 16 },
  itemStat: { alignItems: 'center' },
  statLabel: { fontSize: 10, color: Colors.textMuted },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.text },
});
