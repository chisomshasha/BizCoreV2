import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Colors,
  Card,
  Badge,
  LoadingScreen,
} from '../src/components/ThemedComponents';
import { formatCurrency } from '../src/config/clientConfig';
import api from '../src/utils/api';
import { useAuthStore } from '../src/store/authStore';

export default function FinancialReportsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  // Top echelon only — matches backend balance-sheet/trial-balance gates.
  const canView = ['super_admin', 'general_manager', 'accountant'].includes(user?.role ?? '');
  
  const [activeTab, setActiveTab] = useState<'balance' | 'trial'>('balance');
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [trialBalance, setTrialBalance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!canView) {
      router.back();
      return;
    }
    loadData();
  }, [canView]);

  const loadData = async () => {
    try {
      const [bsRes, tbRes] = await Promise.all([
        api.get('/reports/balance-sheet'),
        api.get('/reports/trial-balance'),
      ]);
      setBalanceSheet(bsRes.data);
      setTrialBalance(tbRes.data);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Financial Reports</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'balance' && styles.tabActive]}
          onPress={() => setActiveTab('balance')}
        >
          <Text style={[styles.tabText, activeTab === 'balance' && styles.tabTextActive]}>Balance Sheet</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'trial' && styles.tabActive]}
          onPress={() => setActiveTab('trial')}
        >
          <Text style={[styles.tabText, activeTab === 'trial' && styles.tabTextActive]}>Trial Balance</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        contentContainerStyle={styles.content}
      >
        {activeTab === 'balance' && balanceSheet && (
          <>
            {/* Assets Section */}
            <Card style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="wallet" size={20} color={Colors.success} />
                <Text style={styles.sectionTitle}>ASSETS</Text>
              </View>
              
              <Text style={styles.subSectionTitle}>Current Assets</Text>
              {(balanceSheet?.assets?.current_assets ?? []).map((item: any, idx: number) => (
                <View key={idx} style={styles.lineItem}>
                  <Text style={styles.lineLabel}>{item.name}</Text>
                  <Text style={styles.lineValue}>{formatCurrency(item.amount)}</Text>
                </View>
              ))}
              <View style={styles.subtotalRow}>
                <Text style={styles.subtotalLabel}>Total Current Assets</Text>
                <Text style={styles.subtotalValue}>{formatCurrency(balanceSheet?.assets?.total_current_assets ?? 0)}</Text>
              </View>

              <Text style={[styles.subSectionTitle, { marginTop: 16 }]}>Fixed Assets</Text>
              {(balanceSheet?.assets?.fixed_assets ?? []).map((item: any, idx: number) => (
                <View key={idx} style={styles.lineItem}>
                  <Text style={styles.lineLabel}>{item.name}</Text>
                  <Text style={styles.lineValue}>{formatCurrency(item.amount)}</Text>
                </View>
              ))}
              <View style={styles.subtotalRow}>
                <Text style={styles.subtotalLabel}>Total Fixed Assets</Text>
                <Text style={styles.subtotalValue}>{formatCurrency(balanceSheet?.assets?.total_fixed_assets ?? 0)}</Text>
              </View>

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>TOTAL ASSETS</Text>
                <Text style={styles.totalValue}>{formatCurrency(balanceSheet?.assets?.total_assets ?? 0)}</Text>
              </View>
            </Card>

            {/* Liabilities Section */}
            <Card style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="card" size={20} color={Colors.danger} />
                <Text style={styles.sectionTitle}>LIABILITIES</Text>
              </View>
              
              <Text style={styles.subSectionTitle}>Current Liabilities</Text>
              {(balanceSheet?.liabilities?.current_liabilities ?? []).map((item: any, idx: number) => (
                <View key={idx} style={styles.lineItem}>
                  <Text style={styles.lineLabel}>{item.name}</Text>
                  <Text style={styles.lineValue}>{formatCurrency(item.amount)}</Text>
                </View>
              ))}
              <View style={styles.subtotalRow}>
                <Text style={styles.subtotalLabel}>Total Current Liabilities</Text>
                <Text style={styles.subtotalValue}>{formatCurrency(balanceSheet?.liabilities?.total_current_liabilities ?? 0)}</Text>
              </View>

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>TOTAL LIABILITIES</Text>
                <Text style={styles.totalValue}>{formatCurrency(balanceSheet?.liabilities?.total_liabilities ?? 0)}</Text>
              </View>
            </Card>

            {/* Equity Section */}
            <Card style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="trending-up" size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>EQUITY</Text>
              </View>
              
              {(balanceSheet?.equity?.items ?? []).map((item: any, idx: number) => (
                <View key={idx} style={styles.lineItem}>
                  <Text style={styles.lineLabel}>{item.name}</Text>
                  <Text style={[styles.lineValue, item.amount < 0 && { color: Colors.danger }]}>
                    {formatCurrency(item.amount)}
                  </Text>
                </View>
              ))}

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>TOTAL EQUITY</Text>
                <Text style={[styles.totalValue, (balanceSheet?.equity?.total_equity ?? 0) < 0 && { color: Colors.danger }]}>
                  {formatCurrency(balanceSheet?.equity?.total_equity ?? 0)}
                </Text>
              </View>
            </Card>

            {/* Balance Check */}
            <Card style={StyleSheet.flatten([styles.balanceCard, balanceSheet?.is_balanced ? styles.balanced : styles.unbalanced])}>
              <Ionicons
                name={balanceSheet?.is_balanced ? 'checkmark-circle' : 'warning'}
                size={24}
                color={balanceSheet?.is_balanced ? Colors.success : Colors.warning}
              />
              <View style={styles.balanceInfo}>
                <Text style={styles.balanceLabel}>
                  {balanceSheet?.is_balanced ? 'Books are Balanced' : 'Balance Discrepancy'}
                </Text>
                <Text style={styles.balanceDetail}>
                  Assets: {formatCurrency(balanceSheet?.assets?.total_assets ?? 0)} | 
                  L+E: {formatCurrency(balanceSheet?.total_liabilities_and_equity ?? 0)}
                </Text>
              </View>
            </Card>
          </>
        )}

        {activeTab === 'trial' && trialBalance && (
          <>
            {/* Trial Balance Table */}
            <Card style={styles.trialCard}>
              <View style={styles.trialHeader}>
                <Text style={[styles.trialCol, { flex: 2 }]}>Account</Text>
                <Text style={styles.trialCol}>Debit</Text>
                <Text style={styles.trialCol}>Credit</Text>
              </View>

              <Text style={styles.trialSection}>Assets</Text>
              {(trialBalance?.assets ?? []).map((item: any, idx: number) => (
                <View key={idx} style={styles.trialRow}>
                  <Text style={[styles.trialCol, { flex: 2 }]}>{item.account}</Text>
                  <Text style={[styles.trialCol, item.debit > 0 && { color: Colors.success }]}>
                    {item.debit > 0 ? formatCurrency(item.debit) : '-'}
                  </Text>
                  <Text style={[styles.trialCol, item.credit > 0 && { color: Colors.danger }]}>
                    {item.credit > 0 ? formatCurrency(item.credit) : '-'}
                  </Text>
                </View>
              ))}

              <Text style={styles.trialSection}>Liabilities</Text>
              {(trialBalance?.liabilities ?? []).map((item: any, idx: number) => (
                <View key={idx} style={styles.trialRow}>
                  <Text style={[styles.trialCol, { flex: 2 }]}>{item.account}</Text>
                  <Text style={styles.trialCol}>{item.debit > 0 ? formatCurrency(item.debit) : '-'}</Text>
                  <Text style={[styles.trialCol, { color: Colors.danger }]}>
                    {item.credit > 0 ? formatCurrency(item.credit) : '-'}
                  </Text>
                </View>
              ))}

              <Text style={styles.trialSection}>Income</Text>
              {(trialBalance?.income ?? []).map((item: any, idx: number) => (
                <View key={idx} style={styles.trialRow}>
                  <Text style={[styles.trialCol, { flex: 2 }]}>{item.account}</Text>
                  <Text style={styles.trialCol}>{item.debit > 0 ? formatCurrency(item.debit) : '-'}</Text>
                  <Text style={[styles.trialCol, { color: Colors.success }]}>
                    {item.credit > 0 ? formatCurrency(item.credit) : '-'}
                  </Text>
                </View>
              ))}

              <Text style={styles.trialSection}>Expenses</Text>
              {(trialBalance?.expenses ?? []).map((item: any, idx: number) => (
                <View key={idx} style={styles.trialRow}>
                  <Text style={[styles.trialCol, { flex: 2 }]}>{item.account}</Text>
                  <Text style={[styles.trialCol, { color: Colors.danger }]}>
                    {item.debit > 0 ? formatCurrency(item.debit) : '-'}
                  </Text>
                  <Text style={styles.trialCol}>{item.credit > 0 ? formatCurrency(item.credit) : '-'}</Text>
                </View>
              ))}

              <Text style={styles.trialSection}>Equity</Text>
              {(trialBalance?.equity ?? []).map((item: any, idx: number) => (
                <View key={idx} style={styles.trialRow}>
                  <Text style={[styles.trialCol, { flex: 2 }]}>{item.account}</Text>
                  <Text style={styles.trialCol}>{item.debit > 0 ? formatCurrency(item.debit) : '-'}</Text>
                  <Text style={styles.trialCol}>{item.credit > 0 ? formatCurrency(item.credit) : '-'}</Text>
                </View>
              ))}

              {/* Totals */}
              <View style={styles.trialTotalRow}>
                <Text style={[styles.trialCol, { flex: 2, fontWeight: '700' }]}>TOTAL</Text>
                <Text style={[styles.trialCol, styles.trialTotal]}>{formatCurrency(trialBalance?.total_debit ?? 0)}</Text>
                <Text style={[styles.trialCol, styles.trialTotal]}>{formatCurrency(trialBalance?.total_credit ?? 0)}</Text>
              </View>
            </Card>

            {/* Balance Status */}
            <Card style={StyleSheet.flatten([styles.balanceCard, trialBalance?.is_balanced ? styles.balanced : styles.unbalanced])}>
              <Ionicons
                name={trialBalance?.is_balanced ? 'checkmark-circle' : 'warning'}
                size={24}
                color={trialBalance?.is_balanced ? Colors.success : Colors.warning}
              />
              <View style={styles.balanceInfo}>
                <Text style={styles.balanceLabel}>
                  {trialBalance?.is_balanced ? 'Trial Balance is Correct' : 'Trial Balance Mismatch'}
                </Text>
                <Text style={styles.balanceDetail}>
                  Debit: {formatCurrency(trialBalance?.total_debit ?? 0)} | Credit: {formatCurrency(trialBalance?.total_credit ?? 0)}
                </Text>
              </View>
            </Card>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  tab: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: Colors.card, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary },
  tabTextActive: { color: Colors.text, fontWeight: '700' },
  content: { padding: 16 },
  sectionCard: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  subSectionTitle: { fontSize: 12, fontWeight: '600', color: Colors.textMuted, marginBottom: 8, textTransform: 'uppercase' },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  lineLabel: { fontSize: 14, color: Colors.textSecondary },
  lineValue: { fontSize: 14, fontWeight: '500', color: Colors.text },
  subtotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, backgroundColor: Colors.cardAlt, marginHorizontal: -16, paddingHorizontal: 16, marginTop: 8 },
  subtotalLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  subtotalValue: { fontSize: 13, fontWeight: '700', color: Colors.text },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, marginTop: 12, borderTopWidth: 2, borderTopColor: Colors.primary },
  totalLabel: { fontSize: 14, fontWeight: '700', color: Colors.text },
  totalValue: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  balanceCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  balanced: { borderColor: Colors.success, backgroundColor: `${Colors.success}10` },
  unbalanced: { borderColor: Colors.warning, backgroundColor: `${Colors.warning}10` },
  balanceInfo: { flex: 1 },
  balanceLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  balanceDetail: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  trialCard: {},
  trialHeader: { flexDirection: 'row', backgroundColor: Colors.cardAlt, marginHorizontal: -16, paddingHorizontal: 16, paddingVertical: 12, marginTop: -16, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  trialCol: { flex: 1, fontSize: 12, fontWeight: '600', color: Colors.textMuted, textAlign: 'right' },
  trialSection: { fontSize: 12, fontWeight: '700', color: Colors.primary, marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
  trialRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  trialTotalRow: { flexDirection: 'row', paddingVertical: 12, marginTop: 12, borderTopWidth: 2, borderTopColor: Colors.primary },
  trialTotal: { fontWeight: '700', color: Colors.primary },
});
