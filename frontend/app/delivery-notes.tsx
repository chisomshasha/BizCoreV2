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
import { format } from 'date-fns';
import api from '../src/utils/api';

interface DeliveryNote {
  delivery_id: string;
  delivery_number: string;
  so_id: string;
  so_number: string;
  /** Legacy alias of sales_rep_id (the distributor concept was retired). */
  distributor_id: string;
  distributor_name?: string;
  sales_rep_id?: string;
  sales_rep_name?: string;
  warehouse_id: string;
  items: any[];
  status: string;
  delivery_date?: string;
  notes?: string;
  created_at: string;
}

export default function DeliveryNotesScreen() {
  const router = useRouter();
  
  const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedNote, setSelectedNote] = useState<DeliveryNote | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      await fetchDeliveryNotes();
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDeliveryNotes = async () => {
    try {
      const response = await api.get('/delivery-notes');
      setDeliveryNotes(response.data);
    } catch (error) {
      console.error('Error fetching delivery notes:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDeliveryNotes();
    setRefreshing(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered': return Colors.success;
      case 'in_transit': return Colors.info;
      case 'cancelled': return Colors.danger;
      default: return Colors.warning;
    }
  };

  const handleUpdateStatus = async (deliveryId: string, newStatus: string) => {
    try {
      await api.put(`/delivery-notes/${deliveryId}/status?status=${newStatus}`);
      Alert.alert('Success', `Delivery marked as ${newStatus}`);
      fetchDeliveryNotes();
      setShowDetailModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update status');
    }
  };

  const filteredNotes = statusFilter === 'all'
    ? deliveryNotes
    : deliveryNotes.filter(dn => dn.status === statusFilter);

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
        <Text style={styles.title}>Delivery Notes</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Status Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterContainer}>
        {['all', 'pending', 'in_transit', 'delivered', 'cancelled'].map(status => (
          <TouchableOpacity
            key={status}
            style={[styles.filterChip, statusFilter === status && styles.filterChipActive]}
            onPress={() => setStatusFilter(status)}
          >
            <Text style={[styles.filterText, statusFilter === status && styles.filterTextActive]}>
              {status === 'all' ? 'All' : status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        contentContainerStyle={styles.content}
      >
        {filteredNotes.length === 0 ? (
          <EmptyState
            icon="car-outline"
            title="No Delivery Notes"
            message="Delivery notes will appear here when sales orders are ready for delivery"
          />
        ) : (
          filteredNotes.map(note => (
            <TouchableOpacity
              key={note.delivery_id}
              style={styles.noteCard}
              onPress={() => {
                setSelectedNote(note);
                setShowDetailModal(true);
              }}
            >
              <View style={styles.noteHeader}>
                <View style={styles.noteIcon}>
                  <Ionicons name="car" size={24} color={Colors.primary} />
                </View>
                <View style={styles.noteInfo}>
                  <Text style={styles.noteNumber}>{note.delivery_number}</Text>
                  <Text style={styles.soNumber}>SO: {note.so_number}</Text>
                </View>
                <Badge
                  text={note.status.replace('_', ' ')}
                  variant={note.status === 'delivered' ? 'success' : note.status === 'in_transit' ? 'info' : 'warning'}
                />
              </View>
              <View style={styles.noteFooter}>
                <View style={styles.noteDetail}>
                  <Ionicons name="person-outline" size={14} color={Colors.textMuted} />
                  <Text style={styles.noteDetailText}>{note.sales_rep_name || note.distributor_name || 'N/A'}</Text>
                </View>
                <View style={styles.noteDetail}>
                  <Ionicons name="cube-outline" size={14} color={Colors.textMuted} />
                  <Text style={styles.noteDetailText}>{note.items?.length || 0} items</Text>
                </View>
                <View style={styles.noteDetail}>
                  <Ionicons name="calendar-outline" size={14} color={Colors.textMuted} />
                  <Text style={styles.noteDetailText}>
                    {format(new Date(note.created_at), 'MMM dd')}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Detail Modal */}
      <Modal visible={showDetailModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDetailModal(false)}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{selectedNote?.delivery_number}</Text>
            <View style={{ width: 24 }} />
          </View>

          {selectedNote && (
            <ScrollView style={styles.modalContent}>
              <Card>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Sales Order</Text>
                  <Text style={styles.detailValue}>{selectedNote.so_number}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Customer</Text>
                  <Text style={styles.detailValue}>{selectedNote.sales_rep_name || selectedNote.distributor_name || 'N/A'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Badge
                    text={selectedNote.status.replace('_', ' ')}
                    variant={selectedNote.status === 'delivered' ? 'success' : 'warning'}
                  />
                </View>
                {selectedNote.delivery_date && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Delivered</Text>
                    <Text style={styles.detailValue}>
                      {format(new Date(selectedNote.delivery_date), 'MMM dd, yyyy HH:mm')}
                    </Text>
                  </View>
                )}
              </Card>

              <Text style={styles.sectionTitle}>Items</Text>
              {selectedNote.items?.map((item: any, idx: number) => (
                <Card key={idx} style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName}>{item.product_name || 'Product'}</Text>
                      <Text style={styles.itemQty}>Quantity: {item.quantity}</Text>
                    </View>
                  </View>
                </Card>
              ))}

              {selectedNote.notes && (
                <Card style={{ marginTop: 16 }}>
                  <Text style={styles.detailLabel}>Notes</Text>
                  <Text style={styles.notesText}>{selectedNote.notes}</Text>
                </Card>
              )}

              {/* Actions */}
              {selectedNote.status === 'pending' && (
                <Button
                  title="Mark In Transit"
                  variant="primary"
                  onPress={() => handleUpdateStatus(selectedNote.delivery_id, 'in_transit')}
                  style={{ marginTop: 20 }}
                />
              )}
              {selectedNote.status === 'in_transit' && (
                <Button
                  title="Mark Delivered"
                  variant="primary"
                  onPress={() => handleUpdateStatus(selectedNote.delivery_id, 'delivered')}
                  style={{ marginTop: 20 }}
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
  filterContainer: { paddingHorizontal: 16, paddingVertical: 12 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.card,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { color: Colors.textSecondary, fontSize: 14 },
  filterTextActive: { color: Colors.text, fontWeight: '600' },
  content: { padding: 16 },
  noteCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteHeader: { flexDirection: 'row', alignItems: 'center' },
  noteIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: `${Colors.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  noteInfo: { flex: 1 },
  noteNumber: { fontSize: 16, fontWeight: '700', color: Colors.text },
  soNumber: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  noteFooter: {
    flexDirection: 'row',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 16,
  },
  noteDetail: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  noteDetailText: { fontSize: 12, color: Colors.textMuted },
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
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  itemCard: { marginBottom: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '500', color: Colors.text },
  itemQty: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  notesText: { fontSize: 14, color: Colors.text, marginTop: 8, lineHeight: 20 },
});
