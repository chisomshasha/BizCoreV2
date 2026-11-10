import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Colors,
  Card,
  Badge,
  LoadingScreen,
  EmptyState,
} from '../src/components/ThemedComponents';
import { formatCurrency } from '../src/config/clientConfig';
import api from '../src/utils/api';
import { useAuthStore } from '../src/store/authStore';

const { width } = Dimensions.get('window');

export default function PerformanceDashboardScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  // Top echelon only — matches backend GET /reports/supplier-performance gate.
  const canView = ['super_admin', 'general_manager', 'accountant'].includes(user?.role ?? '');
  
  const [activeTab, setActiveTab] = useState<'suppliers' | 'agents'>('suppliers');
  const [supplierData, setSupplierData] = useState<any>(null);
  const [agentData, setAgentData] = useState<any>(null);
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
      // The retired "distributor" concept is now the sales-agent model.
      // The backend exposes it as /reports/agent-performance.
      const [supRes, agentRes] = await Promise.all([
        api.get('/reports/supplier-performance'),
        api.get('/reports/agent-performance').catch(() => ({ data: null })),
      ]);
      setSupplierData(supRes.data);
      setAgentData(agentRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return Colors.success;
    if (score >= 70) return Colors.warning;
    return Colors.danger;
  };

  const renderScoreBar = (score: number) => (
    <View style={styles.scoreBarContainer}>
      <View style={[styles.scoreBar, { width: `${score}%`, backgroundColor: getScoreColor(score) }]} />
    </View>
  );

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Performance</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'suppliers' && styles.tabActive]}
          onPress={() => setActiveTab('suppliers')}
        >
          <Ionicons name="business" size={18} color={activeTab === 'suppliers' ? Colors.text : Colors.textMuted} />
          <Text style={[styles.tabText, activeTab === 'suppliers' && styles.tabTextActive]}>Suppliers</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'agents' && styles.tabActive]}
          onPress={() => setActiveTab('agents')}
        >
          <Ionicons name="people" size={18} color={activeTab === 'agents' ? Colors.text : Colors.textMuted} />
          <Text style={[styles.tabText, activeTab === 'agents' && styles.tabTextActive]}>Sales Agents</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        contentContainerStyle={styles.content}
      >
        {activeTab === 'suppliers' && supplierData && (
          <>
            {/* Summary Cards */}
            <View style={styles.summaryRow}>
              <Card style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{supplierData?.summary?.total_suppliers ?? 0}</Text>
                <Text style={styles.summaryLabel}>Total Suppliers</Text>
              </Card>
              <Card style={styles.summaryCard}>
                <Text style={[styles.summaryValue, { color: Colors.success }]}>{supplierData?.summary?.avg_delivery_rate ?? 0}%</Text>
                <Text style={styles.summaryLabel}>Avg Delivery Rate</Text>
              </Card>
              <Card style={styles.summaryCard}>
                <Text style={[styles.summaryValue, { color: Colors.info }]}>{supplierData?.summary?.avg_quality_rate ?? 0}%</Text>
                <Text style={styles.summaryLabel}>Avg Quality Rate</Text>
              </Card>
            </View>

            {/* Top Performer */}
            {supplierData?.summary?.top_performer && (
              <Card style={styles.topCard}>
                <View style={styles.topBadge}>
                  <Ionicons name="trophy" size={16} color={Colors.warning} />
                </View>
                <Text style={styles.topLabel}>Top Performer</Text>
                <Text style={styles.topName}>{supplierData?.summary?.top_performer}</Text>
              </Card>
            )}

            {/* Supplier List */}
            <Text style={styles.sectionTitle}>Supplier Scorecard</Text>
            {(supplierData?.suppliers?.length ?? 0) === 0 ? (
              <EmptyState icon="business-outline" title="No Suppliers" message="Add suppliers to track performance" />
            ) : (
              (supplierData?.suppliers ?? []).map((sup: any) => (
                <Card key={sup.supplier_id} style={styles.partnerCard}>
                  <View style={styles.partnerHeader}>
                    <View style={styles.partnerInfo}>
                      <Text style={styles.partnerName}>{sup.supplier_name}</Text>
                      <Text style={styles.partnerStat}>{sup.total_orders} orders • {formatCurrency(sup.total_value)}</Text>
                    </View>
                    <View style={styles.scoreCircle}>
                      <Text style={[styles.scoreText, { color: getScoreColor(sup.overall_score) }]}>{sup.overall_score}</Text>
                    </View>
                  </View>

                  <View style={styles.metricsRow}>
                    <View style={styles.metric}>
                      <Text style={styles.metricLabel}>Delivery</Text>
                      <Text style={[styles.metricValue, { color: getScoreColor(sup.delivery_rate) }]}>{sup.delivery_rate}%</Text>
                      {renderScoreBar(sup.delivery_rate)}
                    </View>
                    <View style={styles.metric}>
                      <Text style={styles.metricLabel}>Quality</Text>
                      <Text style={[styles.metricValue, { color: getScoreColor(sup.quality_rate) }]}>{sup.quality_rate}%</Text>
                      {renderScoreBar(sup.quality_rate)}
                    </View>
                  </View>

                  <View style={styles.deliveryStats}>
                    <View style={styles.deliveryStat}>
                      <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                      <Text style={styles.deliveryStatText}>{sup.on_time_deliveries} on-time</Text>
                    </View>
                    <View style={styles.deliveryStat}>
                      <Ionicons name="time" size={14} color={Colors.danger} />
                      <Text style={styles.deliveryStatText}>{sup.late_deliveries} late</Text>
                    </View>
                  </View>
                </Card>
              ))
            )}
          </>
        )}

        {activeTab === 'agents' && agentData && (
          <>
            {/* Summary Cards */}
            <View style={styles.summaryRow}>
              <Card style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{agentData?.summary?.total_agents ?? 0}</Text>
                <Text style={styles.summaryLabel}>Sales Agents</Text>
              </Card>
              <Card style={styles.summaryCard}>
                <Text style={[styles.summaryValue, { color: Colors.success, fontSize: 16 }]}>{formatCurrency(agentData?.summary?.total_revenue ?? 0)}</Text>
                <Text style={styles.summaryLabel}>Total Revenue</Text>
              </Card>
              <Card style={styles.summaryCard}>
                <Text style={[styles.summaryValue, { color: Colors.warning, fontSize: 16 }]}>{formatCurrency(agentData?.summary?.total_outstanding ?? 0)}</Text>
                <Text style={styles.summaryLabel}>Outstanding</Text>
              </Card>
            </View>

            {/* Top Performer */}
            {agentData?.summary?.top_performer && (
              <Card style={styles.topCard}>
                <View style={styles.topBadge}>
                  <Ionicons name="trophy" size={16} color={Colors.warning} />
                </View>
                <Text style={styles.topLabel}>Top Revenue</Text>
                <Text style={styles.topName}>{agentData?.summary?.top_performer}</Text>
              </Card>
            )}

            {/* Agent List */}
            <Text style={styles.sectionTitle}>Sales Agent Scorecard</Text>
            {(agentData?.agents?.length ?? 0) === 0 ? (
              <EmptyState icon="people-outline" title="No Sales Agents" message="Create users with the Sales Rep role to track agent performance" />
            ) : (
              (agentData?.agents ?? []).map((agent: any) => (
                <Card key={agent.agent_id} style={styles.partnerCard}>
                  <View style={styles.partnerHeader}>
                    <View style={styles.partnerInfo}>
                      <Text style={styles.partnerName}>{agent.agent_name}</Text>
                      <Text style={styles.partnerTerritory}>{agent.warehouse_name || 'Unassigned'}</Text>
                    </View>
                    <View style={styles.revenueBox}>
                      <Text style={styles.revenueValue}>{formatCurrency(agent.total_revenue)}</Text>
                      <Text style={styles.revenueLabel}>Revenue</Text>
                    </View>
                  </View>

                  <View style={styles.statsGrid}>
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>{agent.total_orders}</Text>
                      <Text style={styles.statLabel}>Orders</Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>{agent.total_quotations}</Text>
                      <Text style={styles.statLabel}>Quotes</Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={[styles.statValue, { color: getScoreColor(agent.collection_rate) }]}>{agent.collection_rate}%</Text>
                      <Text style={styles.statLabel}>Collection</Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={[styles.statValue, { color: agent.outstanding_balance > 0 ? Colors.warning : Colors.success }]}>
                        {formatCurrency(agent.outstanding_balance)}
                      </Text>
                      <Text style={styles.statLabel}>Outstanding</Text>
                    </View>
                  </View>

                  <View style={styles.progressRow}>
                    <Text style={styles.progressLabel}>Collection Rate</Text>
                    {renderScoreBar(agent.collection_rate)}
                  </View>

                  {agent.is_flagged && (
                    <View style={styles.deliveryStats}>
                      <View style={styles.deliveryStat}>
                        <Ionicons name="warning" size={14} color={Colors.danger} />
                        <Text style={[styles.deliveryStatText, { color: Colors.danger }]}>
                          Debt ceiling reached ({formatCurrency(agent.debt_ceiling)})
                        </Text>
                      </View>
                    </View>
                  )}
                </Card>
              ))
            )}
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
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 8, backgroundColor: Colors.card, gap: 8, borderWidth: 1, borderColor: Colors.border },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '500', color: Colors.textSecondary },
  tabTextActive: { color: Colors.text, fontWeight: '700' },
  content: { padding: 16 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  summaryCard: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  summaryValue: { fontSize: 24, fontWeight: '700', color: Colors.text },
  summaryLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 4, textAlign: 'center' },
  topCard: { alignItems: 'center', marginBottom: 16, backgroundColor: `${Colors.warning}10`, borderColor: Colors.warning },
  topBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: `${Colors.warning}20`, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  topLabel: { fontSize: 12, color: Colors.textMuted },
  topName: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 12, textTransform: 'uppercase' },
  partnerCard: { marginBottom: 12 },
  partnerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  partnerInfo: { flex: 1 },
  partnerName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  partnerStat: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  partnerTerritory: { fontSize: 12, color: Colors.primary, marginTop: 4 },
  scoreCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.cardAlt, justifyContent: 'center', alignItems: 'center' },
  scoreText: { fontSize: 18, fontWeight: '700' },
  metricsRow: { flexDirection: 'row', gap: 16, marginTop: 16 },
  metric: { flex: 1 },
  metricLabel: { fontSize: 11, color: Colors.textMuted },
  metricValue: { fontSize: 16, fontWeight: '700', marginVertical: 4 },
  scoreBarContainer: { height: 4, backgroundColor: Colors.cardAlt, borderRadius: 2, overflow: 'hidden' },
  scoreBar: { height: '100%', borderRadius: 2 },
  deliveryStats: { flexDirection: 'row', gap: 16, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  deliveryStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deliveryStatText: { fontSize: 12, color: Colors.textMuted },
  revenueBox: { alignItems: 'flex-end' },
  revenueValue: { fontSize: 18, fontWeight: '700', color: Colors.success },
  revenueLabel: { fontSize: 10, color: Colors.textMuted },
  statsGrid: { flexDirection: 'row', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.text },
  statLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  progressRow: { marginTop: 12 },
  progressLabel: { fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
});
