import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Modal, Alert, ActivityIndicator, StyleSheet, RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/utils/api';
import { useAuthStore } from '../src/store/authStore';
import { useRouter } from 'expo-router';
import { AgentLedgerSummary, User } from '../src/types';

/**
 * Agent Ledger — Accounts Receivable Dashboard
 *
 * Sales Rep view  : own AR summary (goods released, payments made, balance owed)
 * Manager view    : select any rep, review their AR position, record payments
 *
 * API response shape (from enhanced /agent-ledger endpoint):
 *   agent                  – rep profile + credit_limit
 *   total_goods_released   – cumulative value of goods dispatched
 *   total_payments_received– cumulative payments received from agent
 *   accounts_receivable    – net amount currently owed (goods – payments)
 *   items_in_custody       – current stock held by agent
 *   total_custody_value    – value of items_in_custody
 *   ledger_entries         – full transaction history
 */
export default function AgentLedgerScreen() {
  const router = useRouter();
  const { user, isAgent, isApprover } = useAuthStore();
  const [ledger, setLedger] = useState<AgentLedgerSummary | null>(null);
  const [agents, setAgents] = useState<User[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'bank' | 'transfer' | 'card'>('cash');
  const [paying, setPaying] = useState(false);

  const fetchLedger = useCallback(async (agentId?: string) => {
    try {
      const params = agentId ? { sales_rep_id: agentId } : {};
      const res = await api.get('/agent-ledger', { params });
      setLedger(res.data);
    } catch {
      Alert.alert('Error', 'Failed to load ledger');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchAgents = async () => {
    try {
      const res = await api.get('/users/agents');
      setAgents(res.data);
      if (res.data.length > 0 && !selectedAgent) {
        setSelectedAgent(res.data[0].user_id);
        fetchLedger(res.data[0].user_id);
      }
    } catch {}
  };

  useEffect(() => {
    if (isAgent) fetchLedger();
    else if (isApprover) fetchAgents();
  }, [isAgent, isApprover]);

  const handleRecordPayment = async () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { Alert.alert('Error', 'Enter a valid amount'); return; }
    setPaying(true);
    try {
      const res = await api.post('/agent-ledger/payment', {
        sales_rep_id: isAgent ? user?.user_id : selectedAgent,
        amount,
        payment_method: payMethod,
        notes: payNotes,
      });
      const newAR = res.data.new_outstanding?.toFixed(2);
      Alert.alert(
        'Payment Recorded',
        `Payment of ${amount.toFixed(2)} applied.\nUpdated A/R balance: ${newAR}`
      );
      setShowPayment(false);
      setPayAmount('');
      setPayNotes('');
      fetchLedger(selectedAgent || undefined);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to record payment');
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  const agent = ledger?.agent;
  // Use new API fields; fall back to old field names for backwards compat
  const accountsReceivable: number = (ledger as any)?.accounts_receivable
    ?? (ledger as any)?.outstanding_balance ?? 0;
  const totalGoodsReleased: number = (ledger as any)?.total_goods_released ?? 0;
  const totalPaymentsReceived: number = (ledger as any)?.total_payments_received ?? 0;
  const creditLimit: number = (agent as any)?.debt_ceiling ?? 0;

  const isOverLimit = creditLimit > 0 && accountsReceivable >= creditLimit;
  const creditUsedPct = creditLimit > 0
    ? Math.min(100, (accountsReceivable / creditLimit) * 100)
    : 0;

  const fmt = (n: number) => n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <ScrollView
      style={s.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); fetchLedger(selectedAgent || undefined); }}
          tintColor="#3B82F6"
        />
      }
    >
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Agent Ledger</Text>
          <Text style={s.headerSub}>Accounts Receivable</Text>
        </View>
        {isApprover && (
          <TouchableOpacity style={s.payBtn} onPress={() => setShowPayment(true)}>
            <Ionicons name="cash-outline" size={16} color="#fff" />
            <Text style={s.payBtnText}>Record Payment</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Agent selector for managers */}
      {isApprover && agents.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.agentScroll}>
          {agents.map(a => (
            <TouchableOpacity
              key={a.user_id}
              style={[s.agentChip, selectedAgent === a.user_id && s.agentChipActive]}
              onPress={() => { setSelectedAgent(a.user_id); fetchLedger(a.user_id); }}
            >
              <Text style={[s.agentChipText, selectedAgent === a.user_id && s.agentChipTextActive]}>
                {a.name}{(a as any).is_flagged ? ' ⚠️' : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {ledger && (
        <>
          {/* Credit limit breach alert */}
          {agent?.is_flagged && (
            <View style={s.alertBanner}>
              <Ionicons name="warning" size={18} color="#FCA5A5" />
              <Text style={s.alertText}>
                Credit limit reached — outstanding A/R equals or exceeds the approved limit.
                New orders will be blocked until the balance is reduced.
              </Text>
            </View>
          )}

          {/* Agent info strip */}
          {agent && (
            <View style={s.agentInfo}>
              <Text style={s.agentName}>{agent.name}</Text>
              <Text style={s.agentMeta}>
                {agent.warehouse_name ?? ''}{creditLimit > 0 ? `  •  Credit Limit: ₦${fmt(creditLimit)}` : ''}
              </Text>
              <TouchableOpacity
                style={s.profileBtn}
                onPress={() => router.push(`/partner/${agent.user_id}`)}
              >
                <Text style={s.profileBtnText}>View profile</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* AR Summary cards */}
          <View style={s.kpiRow}>
            <View style={[s.kpiCard, { borderTopColor: '#3B82F6' }]}>
              <Ionicons name="bag-check-outline" size={18} color="#3B82F6" style={s.kpiIcon} />
              <Text style={s.kpiLabel}>Goods Released</Text>
              <Text style={s.kpiValue}>₦{fmt(totalGoodsReleased)}</Text>
              <Text style={s.kpiSub}>Total dispatched to date</Text>
            </View>
            <View style={[s.kpiCard, { borderTopColor: '#10B981' }]}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#10B981" style={s.kpiIcon} />
              <Text style={s.kpiLabel}>Payments Received</Text>
              <Text style={[s.kpiValue, { color: '#10B981' }]}>₦{fmt(totalPaymentsReceived)}</Text>
              <Text style={s.kpiSub}>Total settled to date</Text>
            </View>
          </View>

          {/* Accounts Receivable — the headline number */}
          <View style={[s.arCard, isOverLimit && { borderColor: '#EF4444' }]}>
            <View style={s.arRow}>
              <Text style={s.arLabel}>Accounts Receivable (A/R)</Text>
              {isOverLimit && (
                <View style={s.overBadge}>
                  <Text style={s.overBadgeText}>OVER LIMIT</Text>
                </View>
              )}
            </View>
            <Text style={[s.arValue, isOverLimit && { color: '#EF4444' }]}>
              ₦{fmt(accountsReceivable)}
            </Text>
            <Text style={s.arSub}>Amount currently outstanding (unpaid)</Text>

            {/* Credit utilisation bar */}
            {creditLimit > 0 && (
              <View style={{ marginTop: 12 }}>
                <View style={s.barRow}>
                  <Text style={s.barLabel}>Credit Utilisation</Text>
                  <Text style={[s.barPct, { color: creditUsedPct >= 100 ? '#EF4444' : creditUsedPct >= 80 ? '#F59E0B' : '#10B981' }]}>
                    {creditUsedPct.toFixed(0)}%
                  </Text>
                </View>
                <View style={s.track}>
                  <View style={[s.fill, {
                    width: `${creditUsedPct}%` as any,
                    backgroundColor: creditUsedPct >= 100 ? '#EF4444' : creditUsedPct >= 80 ? '#F59E0B' : '#10B981'
                  }]} />
                </View>
                <Text style={s.barCaption}>
                  ₦{fmt(accountsReceivable)} of ₦{fmt(creditLimit)} used
                </Text>
              </View>
            )}
          </View>

          {/* Items currently in custody */}
          {ledger.items_in_custody.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>
                Stock in Custody ({ledger.items_in_custody.length} SKUs)
              </Text>
              <View style={s.tableHeader}>
                <Text style={[s.tableCell, s.tableCellFlex]}>Product</Text>
                <Text style={s.tableCell}>Qty</Text>
                <Text style={[s.tableCell, { textAlign: 'right' }]}>Value</Text>
              </View>
              {ledger.items_in_custody.map(item => (
                <View key={item.product_id} style={s.tableRow}>
                  <Text style={[s.tableCellValue, s.tableCellFlex]}>{item.product_name}</Text>
                  <Text style={s.tableCellValue}>{item.quantity}</Text>
                  <Text style={[s.tableCellValue, { color: '#3B82F6', textAlign: 'right' }]}>
                    ₦{fmt(item.quantity * item.unit_price)}
                  </Text>
                </View>
              ))}
              <View style={s.tableFooter}>
                <Text style={s.tableFooterLabel}>Total Custody Value</Text>
                <Text style={s.tableFooterValue}>₦{fmt(ledger.total_custody_value)}</Text>
              </View>
            </View>
          )}

          {/* Transaction history — detailed ledger table */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Transaction History</Text>
            {ledger.ledger_entries.length === 0 ? (
              <Text style={s.empty}>No transactions yet</Text>
            ) : (() => {
              // Build entries in chronological order for running balance
              const chronological = [...ledger.ledger_entries].reverse();
              let runningBalance = 0;
              const withBalance = chronological.map(entry => {
                runningBalance += entry.amount;
                return { ...entry, runningBalance };
              });
              // Display newest first
              const displayEntries = [...withBalance].reverse();

              return displayEntries.map(entry => {
                const isPayment = entry.entry_type === 'payment';
                const isReturn = entry.entry_type === 'return';
                const isDispatch = entry.entry_type === 'dispatch';

                // Aggregate items for dispatch/return entries
                const items: any[] = entry.items || [];
                const totalQtySupplied = isDispatch
                  ? items.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0)
                  : 0;
                const totalQtyReturned = isReturn
                  ? items.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0)
                  : 0;
                // Weighted-average unit price across items
                const avgUnitPrice = items.length > 0
                  ? items.reduce((s: number, i: any) => s + (Number(i.unit_price) || 0), 0) / items.length
                  : 0;

                const totalAmount = Math.abs(entry.amount);
                const amountPaid = isPayment ? totalAmount : 0;
                const balance = entry.runningBalance;

                const dotColor = isPayment ? '#10B981' : isReturn ? '#F59E0B' : '#3B82F6';
                const typeLabel = isPayment ? 'Payment Received'
                  : isReturn ? 'Goods Returned'
                  : 'Goods Released';

                return (
                  <View key={entry.entry_id} style={s.ledgerCard}>
                    {/* Row 1 — date + type badge */}
                    <View style={s.ledgerHeader}>
                      <View style={[s.typeBadge, { backgroundColor: dotColor + '22', borderColor: dotColor }]}>
                        <Text style={[s.typeBadgeText, { color: dotColor }]}>{typeLabel}</Text>
                      </View>
                      <Text style={s.ledgerDate}>
                        {new Date(entry.created_at).toLocaleDateString('en-NG', {
                          day: 'numeric', month: 'short', year: 'numeric'
                        })}
                      </Text>
                    </View>

                    {/* Details (notes / reference) */}
                    {entry.notes ? (
                      <Text style={s.ledgerDetails} numberOfLines={2}>{entry.notes}</Text>
                    ) : null}

                    {/* Item breakdown for dispatch/return */}
                    {items.length > 0 && (
                      <View style={s.itemsBlock}>
                        {items.map((item: any, idx: number) => (
                          <View key={idx} style={s.itemLine}>
                            <Text style={s.itemName} numberOfLines={1}>{item.product_name || item.product_id}</Text>
                            <Text style={s.itemQty}>{Number(item.quantity).toLocaleString()} {isReturn ? '(ret)' : ''}</Text>
                            <Text style={s.itemPrice}>@ ₦{fmt(Number(item.unit_price) || 0)}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Metrics grid */}
                    <View style={s.metricsGrid}>
                      {totalQtySupplied > 0 && (
                        <View style={s.metricCell}>
                          <Text style={s.metricLabel}>Qty Supplied</Text>
                          <Text style={s.metricValue}>{totalQtySupplied.toLocaleString()}</Text>
                        </View>
                      )}
                      {totalQtyReturned > 0 && (
                        <View style={s.metricCell}>
                          <Text style={s.metricLabel}>Qty Returned</Text>
                          <Text style={[s.metricValue, { color: '#F59E0B' }]}>{totalQtyReturned.toLocaleString()}</Text>
                        </View>
                      )}
                      {avgUnitPrice > 0 && (
                        <View style={s.metricCell}>
                          <Text style={s.metricLabel}>Unit Price</Text>
                          <Text style={s.metricValue}>₦{fmt(avgUnitPrice)}</Text>
                        </View>
                      )}
                      <View style={s.metricCell}>
                        <Text style={s.metricLabel}>Total Amount</Text>
                        <Text style={[s.metricValue, { color: isPayment ? '#10B981' : '#F9FAFB' }]}>
                          ₦{fmt(totalAmount)}
                        </Text>
                      </View>
                      <View style={s.metricCell}>
                        <Text style={s.metricLabel}>Amount Paid</Text>
                        <Text style={[s.metricValue, { color: amountPaid > 0 ? '#10B981' : '#6B7280' }]}>
                          ₦{fmt(amountPaid)}
                        </Text>
                      </View>
                      <View style={s.metricCell}>
                        <Text style={s.metricLabel}>Balance</Text>
                        <Text style={[s.metricValue, { color: balance <= 0 ? '#10B981' : balance > creditLimit * 0.8 ? '#EF4444' : '#F59E0B' }]}>
                          ₦{fmt(balance)}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              });
            })()}
          </View>
        </>
      )}

      {/* Record Payment Modal */}
      <Modal
        visible={showPayment}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPayment(false)}
      >
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Record Payment</Text>
            {accountsReceivable > 0 && (
              <View style={s.modalAR}>
                <Text style={s.modalARLabel}>Current A/R Balance</Text>
                <Text style={s.modalARValue}>₦{fmt(accountsReceivable)}</Text>
              </View>
            )}
            <Text style={s.inputLabel}>Payment Amount *</Text>
            <TextInput
              style={s.input}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#6B7280"
              value={payAmount}
              onChangeText={setPayAmount}
            />
            <Text style={s.inputLabel}>Payment Method</Text>
            <View style={s.methodRow}>
              {(['cash', 'bank', 'transfer', 'card'] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[s.methodBtn, payMethod === m && s.methodBtnActive]}
                  onPress={() => setPayMethod(m)}
                >
                  <Text style={[s.methodBtnText, payMethod === m && s.methodBtnTextActive]}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.inputLabel}>Reference / Notes</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. Bank transfer ref #..."
              placeholderTextColor="#6B7280"
              value={payNotes}
              onChangeText={setPayNotes}
            />
            <View style={s.modalBtns}>
              <TouchableOpacity style={[s.btn, s.btnCancel]} onPress={() => setShowPayment(false)}>
                <Text style={s.btnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, s.btnConfirm, paying && { opacity: 0.6 }]}
                onPress={handleRecordPayment}
                disabled={paying}
              >
                {paying
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.btnText}>Confirm</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingTop: 20, backgroundColor: '#1F2937',
    borderBottomWidth: 1, borderBottomColor: '#374151' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#F9FAFB' },
  headerSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  payBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#10B981',
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, gap: 6 },
  payBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  agentScroll: { backgroundColor: '#1F2937', paddingVertical: 10, paddingHorizontal: 12 },
  agentChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: '#374151', marginRight: 8 },
  agentChipActive: { backgroundColor: '#3B82F6' },
  agentChipText: { color: '#9CA3AF', fontWeight: '500', fontSize: 13 },
  agentChipTextActive: { color: '#fff' },

  alertBanner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#7F1D1D',
    margin: 12, borderRadius: 10, padding: 12, gap: 8 },
  alertText: { color: '#FCA5A5', flex: 1, fontSize: 13, lineHeight: 18 },

  agentInfo: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  agentName: { fontSize: 17, fontWeight: '700', color: '#F9FAFB' },
  profileBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  profileBtnText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '600',
  },
  agentMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  kpiRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 12 },
  kpiCard: { flex: 1, backgroundColor: '#1F2937', borderRadius: 12, padding: 14,
    borderTopWidth: 3 },
  kpiIcon: { marginBottom: 6 },
  kpiLabel: { color: '#9CA3AF', fontSize: 11, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 4 },
  kpiValue: { color: '#F9FAFB', fontSize: 16, fontWeight: 'bold' },
  kpiSub: { color: '#6B7280', fontSize: 11, marginTop: 2 },

  arCard: { backgroundColor: '#1F2937', margin: 12, borderRadius: 14, padding: 18,
    borderWidth: 1, borderColor: '#374151' },
  arRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 6 },
  arLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.5 },
  arValue: { color: '#F9FAFB', fontSize: 30, fontWeight: 'bold' },
  arSub: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  overBadge: { backgroundColor: '#EF4444', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6 },
  overBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  barRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barLabel: { color: '#9CA3AF', fontSize: 12 },
  barPct: { fontWeight: '700', fontSize: 12 },
  track: { height: 8, backgroundColor: '#374151', borderRadius: 4 },
  fill: { height: 8, borderRadius: 4 },
  barCaption: { color: '#6B7280', fontSize: 11, marginTop: 4 },

  section: { backgroundColor: '#1F2937', margin: 12, borderRadius: 12, padding: 14 },
  sectionTitle: { color: '#F9FAFB', fontWeight: 'bold', fontSize: 15, marginBottom: 10 },

  tableHeader: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1,
    borderBottomColor: '#374151', marginBottom: 4 },
  tableCell: { color: '#6B7280', fontSize: 11, fontWeight: '600', width: 70 },
  tableCellFlex: { flex: 1, width: 'auto' as any },
  tableRow: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1,
    borderBottomColor: '#1F2937' },
  tableCellValue: { color: '#D1D5DB', fontSize: 13, width: 70 },
  tableFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: '#374151' },
  tableFooterLabel: { color: '#9CA3AF', fontWeight: '600' },
  tableFooterValue: { color: '#3B82F6', fontWeight: 'bold', fontSize: 15 },

  entryRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#374151', gap: 10 },
  entryDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  entryType: { color: '#F9FAFB', fontWeight: '600', fontSize: 13 },
  entryNotes: { color: '#9CA3AF', fontSize: 12, marginTop: 1 },
  entryDate: { color: '#6B7280', fontSize: 11, marginTop: 2 },
  entryAmount: { fontWeight: 'bold', fontSize: 15, minWidth: 80, textAlign: 'right',
    marginLeft: 'auto' as any },
  empty: { color: '#6B7280', textAlign: 'center', padding: 24 },

  // Detailed ledger card styles
  ledgerCard: { borderWidth: 1, borderColor: '#374151', borderRadius: 10,
    marginBottom: 10, padding: 12, backgroundColor: '#111827' },
  ledgerHeader: { flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 6 },
  typeBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  typeBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  ledgerDate: { color: '#9CA3AF', fontSize: 12 },
  ledgerDetails: { color: '#9CA3AF', fontSize: 12, marginBottom: 8, lineHeight: 17 },
  itemsBlock: { backgroundColor: '#1F2937', borderRadius: 6, padding: 8, marginBottom: 8 },
  itemLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 4 },
  itemName: { color: '#D1D5DB', fontSize: 12, flex: 1 },
  itemQty: { color: '#9CA3AF', fontSize: 12, minWidth: 52, textAlign: 'right' },
  itemPrice: { color: '#6B7280', fontSize: 11, minWidth: 80, textAlign: 'right' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  metricCell: { minWidth: '30%', flex: 1, backgroundColor: '#1F2937',
    borderRadius: 7, padding: 8 },
  metricLabel: { color: '#6B7280', fontSize: 10, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  metricValue: { color: '#F9FAFB', fontWeight: '700', fontSize: 13 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#1F2937', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 36 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#F9FAFB', marginBottom: 12 },
  modalAR: { backgroundColor: '#111827', borderRadius: 10, padding: 12, marginBottom: 8,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalARLabel: { color: '#9CA3AF', fontSize: 13 },
  modalARValue: { color: '#F59E0B', fontWeight: 'bold', fontSize: 16 },
  inputLabel: { color: '#9CA3AF', fontSize: 13, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#111827', color: '#F9FAFB', borderWidth: 1, borderColor: '#374151',
    borderRadius: 10, padding: 13, fontSize: 15 },
  methodRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  methodBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center',
    backgroundColor: '#374151' },
  methodBtnActive: { backgroundColor: '#3B82F6' },
  methodBtnText: { color: '#9CA3AF', fontWeight: '500', fontSize: 13 },
  methodBtnTextActive: { color: '#fff' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 20 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnCancel: { backgroundColor: '#374151' },
  btnConfirm: { backgroundColor: '#10B981' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});
