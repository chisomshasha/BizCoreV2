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
import { formatCurrency } from '../src/config/clientConfig';
import { useAuthStore } from '../src/store/authStore';
import { format } from 'date-fns';
import api from '../src/utils/api';

interface ThreeWayMatch {
  match_id: string;
  po_id: string;
  po_number: string;
  grn_id: string;
  grn_number: string;
  invoice_id: string;
  invoice_number: string;
  supplier_id: string;
  supplier_name: string;
  status: string;
  po_total: number;
  grn_total: number;
  invoice_total: number;
  variance: number;
  variance_percent: number;
  discrepancies: any[];
  approved_by?: string;
  approved_at?: string;
  created_at: string;
}

export default function ThreeWayMatchScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  // Matches backend three_way_match:create/update — SuperAdmin, General
  // Manager, Warehouse Manager, Purchase Clerk (their verification step).
  const canManageMatch = ['super_admin', 'general_manager', 'warehouse_manager', 'purchase_clerk'].includes(user?.role ?? '');
  
  const [matches, setMatches] = useState<ThreeWayMatch[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [grns, setGrns] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<ThreeWayMatch | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  
  // Create form
  const [selectedPO, setSelectedPO] = useState('');
  const [selectedGRN, setSelectedGRN] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      await Promise.all([fetchMatches(), fetchPOs(), fetchGRNs(), fetchInvoices()]);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMatches = async () => {
    try {
      const response = await api.get('/three-way-match');
      setMatches(response.data);
    } catch (error) {
      console.error('Error fetching matches:', error);
    }
  };

  const fetchPOs = async () => {
    try {
      const response = await api.get('/purchase-orders');
      setPurchaseOrders(response.data);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const fetchGRNs = async () => {
    try {
      const response = await api.get('/grn');
      setGrns(response.data);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const fetchInvoices = async () => {
    try {
      const response = await api.get('/invoices');
      setInvoices(response.data.filter((inv: any) => inv.type === 'purchase'));
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMatches();
    setRefreshing(false);
  };

  const handleCreateMatch = async () => {
    if (!selectedPO || !selectedGRN || !selectedInvoice) {
      Alert.alert('Error', 'Select PO, GRN, and Invoice');
      return;
    }

    try {
      const response = await api.post(`/three-way-match?po_id=${selectedPO}&grn_id=${selectedGRN}&invoice_id=${selectedInvoice}`);
      Alert.alert('Success', `Match created with status: ${response.data.status.replace('_', ' ')}`);
      setShowCreateModal(false);
      setSelectedPO('');
      setSelectedGRN('');
      setSelectedInvoice('');
      fetchMatches();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create match');
    }
  };

  const handleApprove = async (matchId: string) => {
    try {
      await api.put(`/three-way-match/${matchId}/approve`);
      Alert.alert('Success', 'Match approved for payment');
      fetchMatches();
      setShowDetailModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed');
    }
  };

  const getStatusVariant = (status: string): 'success' | 'warning' | 'danger' | 'default' => {
    switch (status) {
      case 'full_match': return 'success';
      case 'partial_match': return 'warning';
      case 'discrepancy': return 'danger';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string): keyof typeof Ionicons.glyphMap => {
    switch (status) {
      case 'full_match': return 'checkmark-circle';
      case 'partial_match': return 'alert-circle';
      case 'discrepancy': return 'close-circle';
      default: return 'ellipse';
    }
  };

  const filteredMatches = statusFilter === 'all' ? matches : matches.filter(m => m.status === statusFilter);

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>3-Way Matching</Text>
        {canManageMatch ? (
          <TouchableOpacity style={styles.addButton} onPress={() => setShowCreateModal(true)}>
            <Ionicons name="add" size={24} color={Colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {/* Info Banner */}
      <Card style={styles.infoBanner}>
        <Ionicons name="information-circle" size={20} color={Colors.info} />
        <Text style={styles.infoText}>
          3-Way Matching compares Purchase Order, Goods Receipt, and Invoice to verify amounts before payment.
        </Text>
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {['all', 'unmatched', 'partial_match', 'full_match', 'discrepancy'].map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.filterText, statusFilter === s && styles.filterTextActive]}>
              {s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        contentContainerStyle={styles.content}
      >
        {filteredMatches.length === 0 ? (
          <EmptyState icon="git-compare-outline" title="No Matches" message="Create a match to verify documents" />
        ) : (
          filteredMatches.map(match => (
            <TouchableOpacity
              key={match.match_id}
              style={styles.matchCard}
              onPress={() => { setSelectedMatch(match); setShowDetailModal(true); }}
            >
              <View style={styles.matchHeader}>
                <View style={[styles.statusIcon, { backgroundColor: `${getStatusVariant(match.status) === 'success' ? Colors.success : getStatusVariant(match.status) === 'danger' ? Colors.danger : Colors.warning}20` }]}>
                  <Ionicons name={getStatusIcon(match.status)} size={24} color={getStatusVariant(match.status) === 'success' ? Colors.success : getStatusVariant(match.status) === 'danger' ? Colors.danger : Colors.warning} />
                </View>
                <View style={styles.matchInfo}>
                  <Text style={styles.matchSupplier}>{match.supplier_name}</Text>
                  <Text style={styles.matchDocs}>{match.po_number} • {match.grn_number} • {match.invoice_number}</Text>
                </View>
                <Badge text={match.status.replace('_', ' ')} variant={getStatusVariant(match.status)} />
              </View>
              <View style={styles.matchAmounts}>
                <View style={styles.amountItem}>
                  <Text style={styles.amountLabel}>PO</Text>
                  <Text style={styles.amountValue}>{formatCurrency(match.po_total)}</Text>
                </View>
                <View style={styles.amountItem}>
                  <Text style={styles.amountLabel}>GRN</Text>
                  <Text style={styles.amountValue}>{formatCurrency(match.grn_total)}</Text>
                </View>
                <View style={styles.amountItem}>
                  <Text style={styles.amountLabel}>Invoice</Text>
                  <Text style={styles.amountValue}>{formatCurrency(match.invoice_total)}</Text>
                </View>
              </View>
              {match.variance > 0 && (
                <View style={styles.varianceBanner}>
                  <Ionicons name="warning" size={16} color={Colors.warning} />
                  <Text style={styles.varianceText}>Variance: {formatCurrency(match.variance)} ({match.variance_percent}%)</Text>
                </View>
              )}
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
            <Text style={styles.modalTitle}>Create Match</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.label}>Select Purchase Order</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {purchaseOrders.map(po => (
                <TouchableOpacity
                  key={po.po_id}
                  style={[styles.selectCard, selectedPO === po.po_id && styles.selectCardActive]}
                  onPress={() => setSelectedPO(po.po_id)}
                >
                  <Text style={styles.selectTitle}>{po.po_number}</Text>
                  <Text style={styles.selectSub}>{po.supplier_name}</Text>
                  <Text style={styles.selectAmount}>{formatCurrency(po.total_amount)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Select GRN</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {grns.map(grn => (
                <TouchableOpacity
                  key={grn.grn_id}
                  style={[styles.selectCard, selectedGRN === grn.grn_id && styles.selectCardActive]}
                  onPress={() => setSelectedGRN(grn.grn_id)}
                >
                  <Text style={styles.selectTitle}>{grn.grn_number}</Text>
                  <Text style={styles.selectSub}>PO: {grn.po_number}</Text>
                  <Text style={styles.selectAmount}>{formatCurrency(grn.total_amount)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Select Invoice</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {invoices.map(inv => (
                <TouchableOpacity
                  key={inv.invoice_id}
                  style={[styles.selectCard, selectedInvoice === inv.invoice_id && styles.selectCardActive]}
                  onPress={() => setSelectedInvoice(inv.invoice_id)}
                >
                  <Text style={styles.selectTitle}>{inv.invoice_number}</Text>
                  <Text style={styles.selectSub}>{inv.status}</Text>
                  <Text style={styles.selectAmount}>{formatCurrency(inv.total_amount)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Button title="Create Match" onPress={handleCreateMatch} style={{ marginTop: 24 }} />
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
            <Text style={styles.modalTitle}>Match Details</Text>
            <View style={{ width: 24 }} />
          </View>
          {selectedMatch && (
            <ScrollView style={styles.modalContent}>
              <Card>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Supplier</Text>
                  <Text style={styles.detailValue}>{selectedMatch.supplier_name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Badge text={selectedMatch.status.replace('_', ' ')} variant={getStatusVariant(selectedMatch.status)} />
                </View>
              </Card>

              <Text style={styles.sectionTitle}>Document Comparison</Text>
              <Card style={styles.comparisonCard}>
                <View style={styles.compRow}>
                  <View style={styles.compCol}>
                    <Text style={styles.compLabel}>Purchase Order</Text>
                    <Text style={styles.compDoc}>{selectedMatch.po_number}</Text>
                    <Text style={styles.compAmount}>{formatCurrency(selectedMatch.po_total)}</Text>
                  </View>
                  <View style={styles.compCol}>
                    <Text style={styles.compLabel}>Goods Receipt</Text>
                    <Text style={styles.compDoc}>{selectedMatch.grn_number}</Text>
                    <Text style={styles.compAmount}>{formatCurrency(selectedMatch.grn_total)}</Text>
                  </View>
                  <View style={styles.compCol}>
                    <Text style={styles.compLabel}>Invoice</Text>
                    <Text style={styles.compDoc}>{selectedMatch.invoice_number}</Text>
                    <Text style={styles.compAmount}>{formatCurrency(selectedMatch.invoice_total)}</Text>
                  </View>
                </View>
              </Card>

              {selectedMatch.variance > 0 && (
                <Card style={styles.varianceCard}>
                  <View style={styles.varianceHeader}>
                    <Ionicons name="warning" size={20} color={Colors.warning} />
                    <Text style={styles.varianceTitle}>Variance Detected</Text>
                  </View>
                  <Text style={styles.varianceAmount}>{formatCurrency(selectedMatch.variance)}</Text>
                  <Text style={styles.variancePercent}>{selectedMatch.variance_percent}% difference</Text>
                </Card>
              )}

              {selectedMatch.discrepancies.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Discrepancies</Text>
                  {selectedMatch.discrepancies.map((d, idx) => (
                    <Card key={idx} style={styles.discrepancyCard}>
                      <Text style={styles.discType}>{d.type}</Text>
                      <Text style={styles.discDetail}>PO: {d.po_qty} | GRN: {d.grn_qty}</Text>
                      <Text style={styles.discDiff}>Difference: {d.difference}</Text>
                    </Card>
                  ))}
                </>
              )}

              {selectedMatch.status !== 'full_match' && !selectedMatch.approved_by && canManageMatch && (
                <Button
                  title="Approve for Payment"
                  onPress={() => handleApprove(selectedMatch.match_id)}
                  style={{ marginTop: 16 }}
                />
              )}

              {selectedMatch.approved_by && (
                <Card style={styles.approvedCard}>
                  <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
                  <Text style={styles.approvedText}>Approved for Payment</Text>
                  <Text style={styles.approvedDate}>{selectedMatch.approved_at ? format(new Date(selectedMatch.approved_at), 'MMM dd, yyyy') : ''}</Text>
                </Card>
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
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 16, marginTop: 12, backgroundColor: `${Colors.info}15`, borderColor: Colors.info, gap: 10 },
  infoText: { flex: 1, fontSize: 12, color: Colors.info, lineHeight: 16 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: Colors.card, marginRight: 8, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { color: Colors.textSecondary, fontSize: 12 },
  filterTextActive: { color: Colors.text, fontWeight: '600' },
  content: { padding: 16 },
  matchCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  matchHeader: { flexDirection: 'row', alignItems: 'center' },
  statusIcon: { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  matchInfo: { flex: 1 },
  matchSupplier: { fontSize: 16, fontWeight: '700', color: Colors.text },
  matchDocs: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  matchAmounts: { flexDirection: 'row', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  amountItem: { flex: 1, alignItems: 'center' },
  amountLabel: { fontSize: 10, color: Colors.textMuted },
  amountValue: { fontSize: 14, fontWeight: '700', color: Colors.text, marginTop: 2 },
  varianceBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: `${Colors.warning}15`, padding: 10, borderRadius: 8, marginTop: 12, gap: 8 },
  varianceText: { fontSize: 13, color: Colors.warning, fontWeight: '500' },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  modalContent: { flex: 1, padding: 16 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, marginTop: 16 },
  selectCard: { padding: 16, borderRadius: 12, backgroundColor: Colors.card, marginRight: 12, borderWidth: 1, borderColor: Colors.border, minWidth: 140 },
  selectCardActive: { borderColor: Colors.primary, backgroundColor: `${Colors.primary}15` },
  selectTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  selectSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  selectAmount: { fontSize: 14, fontWeight: '600', color: Colors.primary, marginTop: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  detailLabel: { fontSize: 14, color: Colors.textSecondary },
  detailValue: { fontSize: 14, fontWeight: '500', color: Colors.text },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginTop: 20, marginBottom: 8, textTransform: 'uppercase' },
  comparisonCard: { paddingVertical: 8 },
  compRow: { flexDirection: 'row' },
  compCol: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  compLabel: { fontSize: 10, color: Colors.textMuted },
  compDoc: { fontSize: 12, fontWeight: '600', color: Colors.text, marginTop: 4 },
  compAmount: { fontSize: 16, fontWeight: '700', color: Colors.primary, marginTop: 4 },
  varianceCard: { alignItems: 'center', marginTop: 12, backgroundColor: `${Colors.warning}10`, borderColor: Colors.warning },
  varianceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  varianceTitle: { fontSize: 14, fontWeight: '600', color: Colors.warning },
  varianceAmount: { fontSize: 28, fontWeight: '700', color: Colors.warning, marginTop: 8 },
  variancePercent: { fontSize: 13, color: Colors.textMuted },
  discrepancyCard: { marginBottom: 8, backgroundColor: `${Colors.danger}10`, borderColor: Colors.danger },
  discType: { fontSize: 13, fontWeight: '600', color: Colors.danger, textTransform: 'capitalize' },
  discDetail: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  discDiff: { fontSize: 12, color: Colors.danger, marginTop: 2 },
  approvedCard: { alignItems: 'center', marginTop: 16, backgroundColor: `${Colors.success}10`, borderColor: Colors.success },
  approvedText: { fontSize: 16, fontWeight: '700', color: Colors.success, marginTop: 8 },
  approvedDate: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
});
