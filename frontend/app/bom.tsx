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
import api from '../src/utils/api';

interface BOM {
  bom_id: string;
  finished_product_id: string;
  finished_product_name?: string;
  components: {
    raw_product_id: string;
    raw_product_name?: string;
    quantity_required: number;
    unit?: string;
  }[];
  yield_quantity: number;
  notes?: string;
  is_active: boolean;
  created_at: string;
}

export default function BOMScreen() {
  const router = useRouter();
  const { products, fetchProducts } = useAppStore();
  const { user } = useAuthStore();
  // BOM creation and production runs are write actions — matches backend
  // bom:create/update, which only SuperAdmin, General Manager, and
  // Warehouse Manager hold. Purchase Clerk/Accountant/Viewer are read-only.
  const canManageBOM = ['super_admin', 'general_manager', 'warehouse_manager'].includes(user?.role ?? '');
  
  const [boms, setBoms] = useState<BOM[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showProduceModal, setShowProduceModal] = useState(false);
  const [selectedBOM, setSelectedBOM] = useState<BOM | null>(null);
  
  // Form state
  const [selectedProduct, setSelectedProduct] = useState('');
  const [components, setComponents] = useState<any[]>([]);
  const [yieldQty, setYieldQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [produceQty, setProduceQty] = useState('1');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      await Promise.all([fetchBOMs(), fetchProducts()]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBOMs = async () => {
    try {
      const response = await api.get('/bom');
      setBoms(response.data);
    } catch (error) {
      console.error('Error fetching BOMs:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBOMs();
    setRefreshing(false);
  };

  const finishedProducts = products.filter((p: any) => p.category === 'finished');
  const rawProducts = products.filter((p: any) => p.category === 'raw' || p.category === 'packaging');

  const handleCreateBOM = async () => {
    if (!selectedProduct || components.length === 0) {
      Alert.alert('Error', 'Please select a finished product and add components');
      return;
    }

    try {
      const payload = {
        finished_product_id: selectedProduct,
        components: components.map(c => ({
          raw_product_id: c.product_id,
          quantity_required: c.quantity,
        })),
        yield_quantity: parseFloat(yieldQty) || 1,
        notes,
      };

      await api.post('/bom', payload);
      Alert.alert('Success', 'Bill of Materials created successfully');
      setShowAddModal(false);
      resetForm();
      fetchBOMs();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create BOM');
    }
  };

  const handleProduce = async () => {
    if (!selectedBOM) return;

    const qty = parseInt(produceQty);
    if (qty <= 0) {
      Alert.alert('Error', 'Please enter a valid quantity');
      return;
    }

    try {
      await api.post(`/bom/${selectedBOM.bom_id}/produce`, { quantity: qty });
      Alert.alert('Success', `Produced ${qty} units successfully!\nRaw materials deducted and finished goods added to inventory.`);
      setShowProduceModal(false);
      setProduceQty('1');
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Production failed. Check raw material stock.');
    }
  };

  const resetForm = () => {
    setSelectedProduct('');
    setComponents([]);
    setYieldQty('1');
    setNotes('');
  };

  const addComponent = () => {
    setComponents([...components, { product_id: '', quantity: 1 }]);
  };

  const updateComponent = (index: number, field: string, value: any) => {
    const updated = [...components];
    updated[index][field] = value;
    setComponents(updated);
  };

  const removeComponent = (index: number) => {
    setComponents(components.filter((_, i) => i !== index));
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Bill of Materials</Text>
        {canManageBOM ? (
          <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
            <Ionicons name="add" size={24} color={Colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        contentContainerStyle={styles.content}
      >
        {/* Info Banner */}
        <Card style={styles.infoBanner}>
          <Ionicons name="information-circle" size={20} color={Colors.info} />
          <Text style={styles.infoText}>
            BOM defines the raw materials needed to produce finished goods. Use "Produce" to convert raw materials into finished products.
          </Text>
        </Card>

        {boms.length === 0 ? (
          <EmptyState
            icon="construct-outline"
            title="No Bill of Materials"
            message="Create a BOM to define how finished products are made from raw materials"
          />
        ) : (
          boms.map(bom => (
            <TouchableOpacity
              key={bom.bom_id}
              style={styles.bomCard}
              onPress={() => {
                setSelectedBOM(bom);
                setShowDetailModal(true);
              }}
            >
              <View style={styles.bomHeader}>
                <View style={styles.bomIcon}>
                  <Ionicons name="construct" size={24} color={Colors.primary} />
                </View>
                <View style={styles.bomInfo}>
                  <Text style={styles.bomName}>{bom.finished_product_name || 'Product'}</Text>
                  <Text style={styles.bomYield}>Yield: {bom.yield_quantity} units</Text>
                </View>
                <Badge text={bom.is_active ? 'Active' : 'Inactive'} variant={bom.is_active ? 'success' : 'secondary'} />
              </View>
              <View style={styles.bomFooter}>
                <View style={styles.bomDetail}>
                  <Ionicons name="layers-outline" size={14} color={Colors.textMuted} />
                  <Text style={styles.bomDetailText}>{bom.components.length} components</Text>
                </View>
                {canManageBOM && (
                  <TouchableOpacity
                    style={styles.produceBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      setSelectedBOM(bom);
                      setShowProduceModal(true);
                    }}
                  >
                    <Ionicons name="play-circle" size={16} color={Colors.success} />
                    <Text style={styles.produceBtnText}>Produce</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add BOM Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New BOM</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={styles.modalContent}>
            {/* Finished Product Selection */}
            <Text style={styles.label}>Finished Product</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectionRow}>
              {finishedProducts.map((prod: any) => (
                <TouchableOpacity
                  key={prod._id || prod.product_id}
                  style={[
                    styles.selectionChip,
                    selectedProduct === (prod._id || prod.product_id) && styles.selectionChipActive,
                  ]}
                  onPress={() => setSelectedProduct(prod._id || prod.product_id)}
                >
                  <Text style={[
                    styles.selectionChipText,
                    selectedProduct === (prod._id || prod.product_id) && styles.selectionChipTextActive,
                  ]}>
                    {prod.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {finishedProducts.length === 0 && (
              <Text style={styles.warningText}>No finished products found. Create products with category "finished" first.</Text>
            )}

            {/* Components */}
            <View style={styles.componentsHeader}>
              <Text style={styles.label}>Raw Material Components</Text>
              <TouchableOpacity onPress={addComponent}>
                <Ionicons name="add-circle" size={24} color={Colors.primary} />
              </TouchableOpacity>
            </View>

            {components.map((comp, index) => (
              <Card key={index} style={styles.componentCard}>
                <View style={styles.componentRow}>
                  <View style={styles.componentField}>
                    <Text style={styles.componentLabel}>Raw Material</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {rawProducts.map((prod: any) => (
                        <TouchableOpacity
                          key={prod._id || prod.product_id}
                          style={[
                            styles.rawChip,
                            comp.product_id === (prod._id || prod.product_id) && styles.rawChipActive,
                          ]}
                          onPress={() => updateComponent(index, 'product_id', prod._id || prod.product_id)}
                        >
                          <Text style={styles.rawChipText} numberOfLines={1}>{prod.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                  <TouchableOpacity onPress={() => removeComponent(index)} style={styles.removeBtn}>
                    <Ionicons name="trash-outline" size={20} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
                <View style={styles.qtyRow}>
                  <Text style={styles.componentLabel}>Quantity Required</Text>
                  <TextInput
                    style={styles.qtyInput}
                    value={String(comp.quantity)}
                    onChangeText={(v) => updateComponent(index, 'quantity', parseFloat(v) || 0)}
                    keyboardType="numeric"
                  />
                </View>
              </Card>
            ))}

            {/* Yield & Notes */}
            <Text style={styles.label}>Yield Quantity</Text>
            <TextInput
              style={styles.input}
              value={yieldQty}
              onChangeText={setYieldQty}
              keyboardType="numeric"
              placeholder="1"
              placeholderTextColor={Colors.textMuted}
            />

            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Production instructions..."
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={3}
            />

            <Button title="Create BOM" onPress={handleCreateBOM} style={{ marginTop: 20 }} />
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
            <Text style={styles.modalTitle}>BOM Details</Text>
            <View style={{ width: 24 }} />
          </View>

          {selectedBOM && (
            <ScrollView style={styles.modalContent}>
              <Card>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Finished Product</Text>
                  <Text style={styles.detailValue}>{selectedBOM.finished_product_name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Yield per Production</Text>
                  <Text style={styles.detailValue}>{selectedBOM.yield_quantity} units</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Badge text={selectedBOM.is_active ? 'Active' : 'Inactive'} variant={selectedBOM.is_active ? 'success' : 'secondary'} />
                </View>
              </Card>

              <Text style={styles.sectionTitle}>Components Required</Text>
              {selectedBOM.components.map((comp, idx) => (
                <Card key={idx} style={styles.compDetailCard}>
                  <View style={styles.compDetailRow}>
                    <View style={styles.compDetailInfo}>
                      <Ionicons name="cube-outline" size={20} color={Colors.primary} />
                      <Text style={styles.compDetailName}>{comp.raw_product_name || 'Raw Material'}</Text>
                    </View>
                    <Text style={styles.compDetailQty}>{comp.quantity_required} {comp.unit || 'units'}</Text>
                  </View>
                </Card>
              ))}

              {selectedBOM.notes && (
                <Card style={{ marginTop: 16 }}>
                  <Text style={styles.detailLabel}>Production Notes</Text>
                  <Text style={styles.notesText}>{selectedBOM.notes}</Text>
                </Card>
              )}

              {canManageBOM && (
                <Button
                  title="Start Production"
                  variant="primary"
                  onPress={() => {
                    setShowDetailModal(false);
                    setShowProduceModal(true);
                  }}
                  style={{ marginTop: 20 }}
                />
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Produce Modal */}
      <Modal visible={showProduceModal} animationType="slide" transparent>
        <View style={styles.produceModalOverlay}>
          <View style={styles.produceModalContent}>
            <Text style={styles.produceTitle}>Production Run</Text>
            <Text style={styles.produceSubtitle}>{selectedBOM?.finished_product_name}</Text>
            
            <Text style={styles.label}>Quantity to Produce</Text>
            <TextInput
              style={styles.input}
              value={produceQty}
              onChangeText={setProduceQty}
              keyboardType="numeric"
              placeholder="1"
              placeholderTextColor={Colors.textMuted}
            />

            <Text style={styles.produceNote}>
              This will deduct raw materials from inventory and add {parseInt(produceQty) * (selectedBOM?.yield_quantity || 1)} finished units.
            </Text>

            <View style={styles.produceActions}>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => {
                  setShowProduceModal(false);
                  setProduceQty('1');
                }}
                style={{ flex: 1 }}
              />
              <Button
                title="Produce"
                variant="primary"
                onPress={handleProduce}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { padding: 16 },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: `${Colors.info}15`,
    borderColor: Colors.info,
    gap: 10,
    marginBottom: 16,
  },
  infoText: { flex: 1, fontSize: 13, color: Colors.info, lineHeight: 18 },
  bomCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bomHeader: { flexDirection: 'row', alignItems: 'center' },
  bomIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: `${Colors.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  bomInfo: { flex: 1 },
  bomName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  bomYield: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  bomFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  bomDetail: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bomDetailText: { fontSize: 12, color: Colors.textMuted },
  produceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${Colors.success}20`,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  produceBtnText: { fontSize: 13, fontWeight: '600', color: Colors.success },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  modalContent: { flex: 1, padding: 16 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, marginTop: 16 },
  selectionRow: { marginBottom: 8 },
  selectionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.card,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectionChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  selectionChipText: { color: Colors.textSecondary, fontSize: 14 },
  selectionChipTextActive: { color: Colors.text, fontWeight: '600' },
  warningText: { fontSize: 12, color: Colors.warning, marginTop: 8 },
  componentsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  componentCard: { marginTop: 8 },
  componentRow: { flexDirection: 'row', alignItems: 'flex-start' },
  componentField: { flex: 1 },
  componentLabel: { fontSize: 12, color: Colors.textMuted, marginBottom: 4 },
  removeBtn: { padding: 8 },
  rawChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: Colors.cardAlt,
    marginRight: 6,
  },
  rawChipActive: { backgroundColor: Colors.primary },
  rawChipText: { fontSize: 12, color: Colors.text, maxWidth: 80 },
  qtyRow: { marginTop: 12 },
  qtyInput: {
    backgroundColor: Colors.cardAlt,
    borderRadius: 8,
    padding: 10,
    color: Colors.text,
    fontSize: 14,
    width: 100,
  },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 8,
    padding: 12,
    color: Colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  detailLabel: { fontSize: 14, color: Colors.textSecondary },
  detailValue: { fontSize: 14, fontWeight: '500', color: Colors.text },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginTop: 20, marginBottom: 8, textTransform: 'uppercase' },
  compDetailCard: { marginBottom: 8 },
  compDetailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  compDetailInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compDetailName: { fontSize: 15, fontWeight: '500', color: Colors.text },
  compDetailQty: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  notesText: { fontSize: 14, color: Colors.text, marginTop: 8, lineHeight: 20 },
  produceModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  produceModalContent: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 24,
  },
  produceTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  produceSubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 },
  produceNote: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginTop: 16 },
  produceActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
});
