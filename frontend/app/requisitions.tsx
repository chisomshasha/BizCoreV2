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
import { useAppStore } from '../src/store/appStore';
import { useAuthStore } from '../src/store/authStore';
import { formatCurrency } from '../src/config/clientConfig';
import { format } from 'date-fns';
import api from '../src/utils/api';

interface Requisition {
  requisition_id: string;
  requisition_number: string;
  requested_by: string;
  requested_by_name: string;
  department?: string;
  priority: string;
  required_date?: string;
  status: string;
  items: any[];
  total_estimated: number;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  converted_po_id?: string;
  notes?: string;
  created_at: string;
}

export default function RequisitionsScreen() {
  const router = useRouter();
  const { products, suppliers, warehouses, fetchProducts, fetchSuppliers, fetchWarehouses } = useAppStore();
  const { user } = useAuthStore();
  // Approve/Reject requisitions — matches backend hard gate: SuperAdmin,
  // General Manager, Warehouse Manager only (not Accountant, not the
  // Purchase Clerk who created it).
  const canApproveReq = ['super_admin', 'general_manager', 'warehouse_manager'].includes(user?.role ?? '');
  // Convert an approved requisition into a real Purchase Order — matches
  // backend purchase_orders:create permission.
  const canConvertToPO = ['super_admin', 'general_manager', 'warehouse_manager', 'purchase_clerk'].includes(user?.role ?? '');
  
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [selectedReq, setSelectedReq] = useState<Requisition | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  
  // Form
  const [department, setDepartment] = useState('');
  const [priority, setPriority] = useState('normal');
  const [items, setItems] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  
  // Convert form
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      await Promise.all([fetchRequisitions(), fetchProducts(), fetchSuppliers(), fetchWarehouses()]);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRequisitions = async () => {
    try {
      const response = await api.get('/requisitions');
      setRequisitions(response.data);
    } catch (error) {
      console.error('Error fetching requisitions:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRequisitions();
    setRefreshing(false);
  };

  const getStatusVariant = (status: string): 'success' | 'warning' | 'danger' | 'info' | 'default' => {
    switch (status) {
      case 'approved': return 'success';
      case 'rejected': return 'danger';
      case 'pending': return 'warning';
      case 'converted': return 'info';
      default: return 'default';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return Colors.danger;
      case 'high': return Colors.warning;
      case 'normal': return Colors.info;
      default: return Colors.textMuted;
    }
  };

  const handleCreate = async () => {
    if (items.length === 0) {
      Alert.alert('Error', 'Please add at least one item');
      return;
    }

    try {
      await api.post('/requisitions', {
        department,
        priority,
        items: items.map(i => ({
          product_id: i.product_id,
          quantity: i.quantity,
          estimated_unit_price: i.price,
          reason: i.reason,
        })),
        notes,
      });
      Alert.alert('Success', 'Requisition created');
      setShowAddModal(false);
      resetForm();
      fetchRequisitions();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create');
    }
  };

  const handleSubmit = async (reqId: string) => {
    try {
      await api.put(`/requisitions/${reqId}/submit`);
      Alert.alert('Success', 'Submitted for approval');
      fetchRequisitions();
      setShowDetailModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed');
    }
  };

  const handleApprove = async (reqId: string) => {
    try {
      await api.put(`/requisitions/${reqId}/approve`);
      Alert.alert('Success', 'Requisition approved');
      fetchRequisitions();
      setShowDetailModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed');
    }
  };

  const handleReject = async (reqId: string) => {
    Alert.prompt('Reject Requisition', 'Enter rejection reason:', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async (reason) => {
          try {
            await api.put(`/requisitions/${reqId}/reject?reason=${reason || ''}`);
            Alert.alert('Success', 'Requisition rejected');
            fetchRequisitions();
            setShowDetailModal(false);
          } catch (error: any) {
            Alert.alert('Error', error.response?.data?.detail || 'Failed');
          }
        },
      },
    ]);
  };

  const handleConvert = async () => {
    if (!selectedReq || !selectedSupplier || !selectedWarehouse) {
      Alert.alert('Error', 'Select supplier and warehouse');
      return;
    }

    try {
      await api.post(`/requisitions/${selectedReq.requisition_id}/convert-to-po?supplier_id=${selectedSupplier}&warehouse_id=${selectedWarehouse}`);
      Alert.alert('Success', 'Converted to Purchase Order');
      setShowConvertModal(false);
      setShowDetailModal(false);
      fetchRequisitions();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed');
    }
  };

  const resetForm = () => {
    setDepartment('');
    setPriority('normal');
    setItems([]);
    setNotes('');
  };

  const addItem = () => {
    setItems([...items, { product_id: '', quantity: 1, price: 0, reason: '' }]);
  };

  const updateItem = (idx: number, field: string, value: any) => {
    const updated = [...items];
    updated[idx][field] = value;
    if (field === 'product_id') {
      const prod = products.find((p: any) => (p._id || p.product_id) === value);
      if (prod) updated[idx].price = prod.cost_price;
    }
    setItems(updated);
  };

  const filteredReqs = statusFilter === 'all' ? requisitions : requisitions.filter(r => r.status === statusFilter);

  if (loading) return <LoadingScreen />;

  const canCreateRequisition = ['super_admin', 'general_manager', 'warehouse_manager', 'purchase_clerk'].includes(user?.role ?? '');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Purchase Requisitions</Text>
        {canCreateRequisition ? (
          <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
            <Ionicons name="add" size={24} color={Colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {['all', 'draft', 'pending', 'approved', 'rejected', 'converted'].map(s => (
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
        {filteredReqs.length === 0 ? (
          <EmptyState icon="document-attach-outline" title="No Requisitions" message="Create a requisition to request materials" />
        ) : (
          filteredReqs.map(req => (
            <TouchableOpacity
              key={req.requisition_id}
              style={styles.reqCard}
              onPress={() => { setSelectedReq(req); setShowDetailModal(true); }}
            >
              <View style={styles.reqHeader}>
                <View>
                  <Text style={styles.reqNumber}>{req.requisition_number}</Text>
                  <Text style={styles.reqBy}>{req.requested_by_name}</Text>
                </View>
                <Badge text={req.status} variant={getStatusVariant(req.status)} />
              </View>
              <View style={styles.reqMeta}>
                <View style={[styles.priorityBadge, { backgroundColor: `${getPriorityColor(req.priority)}20` }]}>
                  <Text style={[styles.priorityText, { color: getPriorityColor(req.priority) }]}>{req.priority}</Text>
                </View>
                <Text style={styles.reqItems}>{req.items.length} items</Text>
              </View>
              <View style={styles.reqFooter}>
                <Text style={styles.reqDate}>{format(new Date(req.created_at), 'MMM dd, yyyy')}</Text>
                <Text style={styles.reqTotal}>{formatCurrency(req.total_estimated)}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Requisition</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.label}>Department</Text>
            <TextInput style={styles.input} value={department} onChangeText={setDepartment} placeholder="e.g., Production" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.label}>Priority</Text>
            <View style={styles.priorityRow}>
              {['low', 'normal', 'high', 'urgent'].map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.priorityOption, priority === p && styles.priorityOptionActive]}
                  onPress={() => setPriority(p)}
                >
                  <Text style={[styles.priorityOptionText, priority === p && { color: Colors.text }]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.itemsHeader}>
              <Text style={styles.label}>Items</Text>
              <TouchableOpacity onPress={addItem}>
                <Ionicons name="add-circle" size={24} color={Colors.primary} />
              </TouchableOpacity>
            </View>

            {items.map((item, idx) => (
              <Card key={idx} style={styles.itemCard}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {products.slice(0, 10).map((p: any) => (
                    <TouchableOpacity
                      key={p._id || p.product_id}
                      style={[styles.prodChip, item.product_id === (p._id || p.product_id) && styles.prodChipActive]}
                      onPress={() => updateItem(idx, 'product_id', p._id || p.product_id)}
                    >
                      <Text style={styles.prodChipText} numberOfLines={1}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.itemInputs}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={String(item.quantity)}
                    onChangeText={(v) => updateItem(idx, 'quantity', parseInt(v) || 0)}
                    keyboardType="numeric"
                    placeholder="Qty"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={String(item.price)}
                    onChangeText={(v) => updateItem(idx, 'price', parseFloat(v) || 0)}
                    keyboardType="numeric"
                    placeholder="Price"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <TouchableOpacity onPress={() => setItems(items.filter((_, i) => i !== idx))}>
                    <Ionicons name="trash" size={20} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              </Card>
            ))}

            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Reason for request..."
              placeholderTextColor={Colors.textMuted}
              multiline
            />

            <Button title="Create Requisition" onPress={handleCreate} style={{ marginTop: 20 }} />
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
            <Text style={styles.modalTitle}>{selectedReq?.requisition_number}</Text>
            <View style={{ width: 24 }} />
          </View>
          {selectedReq && (
            <ScrollView style={styles.modalContent}>
              <Card>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Requested By</Text>
                  <Text style={styles.detailValue}>{selectedReq.requested_by_name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Department</Text>
                  <Text style={styles.detailValue}>{selectedReq.department || 'N/A'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Priority</Text>
                  <Badge text={selectedReq.priority} variant={selectedReq.priority === 'urgent' ? 'danger' : 'warning'} />
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Badge text={selectedReq.status} variant={getStatusVariant(selectedReq.status)} />
                </View>
              </Card>

              <Text style={styles.sectionTitle}>Items</Text>
              {selectedReq.items.map((item: any, idx: number) => (
                <Card key={idx} style={styles.itemDetailCard}>
                  <Text style={styles.itemName}>{item.product_name}</Text>
                  <View style={styles.itemDetailMeta}>
                    <Text style={styles.itemMeta}>Qty: {item.quantity}</Text>
                    <Text style={styles.itemMeta}>@ {formatCurrency(item.estimated_unit_price)}</Text>
                  </View>
                </Card>
              ))}

              <Card style={styles.totalCard}>
                <Text style={styles.totalLabel}>Estimated Total</Text>
                <Text style={styles.totalValue}>{formatCurrency(selectedReq.total_estimated)}</Text>
              </Card>

              {selectedReq.status === 'draft' && (
                <Button title="Submit for Approval" onPress={() => handleSubmit(selectedReq.requisition_id)} style={{ marginTop: 16 }} />
              )}
              {selectedReq.status === 'pending' && canApproveReq && (
                <View style={styles.actionsRow}>
                  <Button title="Approve" variant="primary" onPress={() => handleApprove(selectedReq.requisition_id)} style={{ flex: 1 }} />
                  <Button title="Reject" variant="secondary" onPress={() => handleReject(selectedReq.requisition_id)} style={{ flex: 1 }} />
                </View>
              )}
              {selectedReq.status === 'approved' && canConvertToPO && (
                <Button
                  title="Convert to PO"
                  variant="primary"
                  onPress={() => setShowConvertModal(true)}
                  style={{ marginTop: 16 }}
                />
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Convert Modal */}
      <Modal visible={showConvertModal} animationType="slide" transparent>
        <View style={styles.convertOverlay}>
          <View style={styles.convertContent}>
            <Text style={styles.convertTitle}>Convert to Purchase Order</Text>
            
            <Text style={styles.label}>Select Supplier</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {suppliers.map((s: any) => (
                <TouchableOpacity
                  key={s._id || s.supplier_id}
                  style={[styles.selectChip, selectedSupplier === (s._id || s.supplier_id) && styles.selectChipActive]}
                  onPress={() => setSelectedSupplier(s._id || s.supplier_id)}
                >
                  <Text style={styles.selectChipText}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Select Warehouse</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {warehouses.map((w: any) => (
                <TouchableOpacity
                  key={w._id || w.warehouse_id}
                  style={[styles.selectChip, selectedWarehouse === (w._id || w.warehouse_id) && styles.selectChipActive]}
                  onPress={() => setSelectedWarehouse(w._id || w.warehouse_id)}
                >
                  <Text style={styles.selectChipText}>{w.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.convertActions}>
              <Button title="Cancel" variant="secondary" onPress={() => setShowConvertModal(false)} style={{ flex: 1 }} />
              <Button title="Convert" onPress={handleConvert} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
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
  reqCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  reqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  reqNumber: { fontSize: 16, fontWeight: '700', color: Colors.text },
  reqBy: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  reqMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  priorityBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  priorityText: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  reqItems: { fontSize: 13, color: Colors.textMuted },
  reqFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  reqDate: { fontSize: 12, color: Colors.textMuted },
  reqTotal: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  modalContent: { flex: 1, padding: 16 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: Colors.card, borderRadius: 8, padding: 12, color: Colors.text, fontSize: 14, borderWidth: 1, borderColor: Colors.border },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  priorityRow: { flexDirection: 'row', gap: 8 },
  priorityOption: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: Colors.card, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  priorityOptionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  priorityOptionText: { fontSize: 13, color: Colors.textSecondary, textTransform: 'capitalize' },
  itemsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  itemCard: { marginTop: 8 },
  prodChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: Colors.cardAlt, marginRight: 6 },
  prodChipActive: { backgroundColor: Colors.primary },
  prodChipText: { fontSize: 12, color: Colors.text, maxWidth: 80 },
  itemInputs: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  detailLabel: { fontSize: 14, color: Colors.textSecondary },
  detailValue: { fontSize: 14, fontWeight: '500', color: Colors.text },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginTop: 20, marginBottom: 8, textTransform: 'uppercase' },
  itemDetailCard: { marginBottom: 8 },
  itemName: { fontSize: 15, fontWeight: '500', color: Colors.text },
  itemDetailMeta: { flexDirection: 'row', gap: 12, marginTop: 4 },
  itemMeta: { fontSize: 13, color: Colors.textSecondary },
  totalCard: { marginTop: 16, alignItems: 'center' },
  totalLabel: { fontSize: 14, color: Colors.textSecondary },
  totalValue: { fontSize: 28, fontWeight: '700', color: Colors.primary, marginTop: 4 },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  convertOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 },
  convertContent: { backgroundColor: Colors.card, borderRadius: 16, padding: 24 },
  convertTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: 16 },
  selectChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: Colors.cardAlt, marginRight: 8 },
  selectChipActive: { backgroundColor: Colors.primary },
  selectChipText: { fontSize: 14, color: Colors.text },
  convertActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
});
