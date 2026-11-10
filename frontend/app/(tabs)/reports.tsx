import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import {
  Colors,
  Card,
  Badge,
  LoadingScreen,
  EmptyState,
} from '../../src/components/ThemedComponents';
import api from '../../src/utils/api';
import { formatCurrency as formatNairaBase } from '../../src/config/clientConfig';

// Reports display whole-Naira amounts (no decimals), matching the rest of
// the app's report screens.
const formatCurrency = (value: number) =>
  formatNairaBase(value || 0, { maximumFractionDigits: 0 });

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  
  // Reports data
  const [stockSummary, setStockSummary] = useState<any[]>([]);
  const [purchaseAnalysis, setPurchaseAnalysis] = useState<any>(null);
  const [salesAnalysis, setSalesAnalysis] = useState<any>(null);
  const [supplierAging, setSupplierAging] = useState<any>(null);
  const [customerAging, setCustomerAging] = useState<any>(null);
  const [inventoryValuation, setInventoryValuation] = useState<any>(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [stock, purchase, sales] = await Promise.all([
        api.get('/reports/stock-summary').catch(() => ({ data: [] })),
        api.get('/reports/purchase-analysis').catch(() => ({ data: null })),
        api.get('/reports/sales-analysis').catch(() => ({ data: null })),
      ]);
      setStockSummary(stock.data || []);
      setPurchaseAnalysis(purchase.data);
      setSalesAnalysis(sales.data);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInitialData();
    setRefreshing(false);
  };

  const loadReport = async (reportType: string) => {
    setSelectedReport(reportType);
    try {
      let data;
      switch (reportType) {
        case 'supplier_aging':
          const supRes = await api.get('/reports/supplier-aging');
          data = supRes.data;
          setSupplierAging(data);
          break;
        case 'customer_aging':
          const custRes = await api.get('/reports/customer-aging');
          data = custRes.data;
          setCustomerAging(data);
          break;
        case 'inventory_valuation':
          const invRes = await api.get('/reports/inventory-valuation');
          data = invRes.data;
          setInventoryValuation(data);
          break;
        case 'profit_loss':
          const plRes = await api.get('/reports/profit-loss');
          data = plRes.data;
          break;
        case 'cash_flow':
          const cfRes = await api.get('/reports/cash-flow');
          data = cfRes.data;
          break;
        default:
          data = null;
      }
      setReportData(data);
    } catch (error) {
      console.error('Error loading report:', error);
      setReportData(null);
    }
  };

  const reportsList = [
    {
      id: 'stock_summary',
      title: 'Stock Summary',
      description: 'Current inventory levels and valuation',
      icon: 'cube-outline',
      color: Colors.primary,
    },
    {
      id: 'inventory_valuation',
      title: 'Inventory Valuation',
      description: 'Detailed inventory value by product',
      icon: 'calculator-outline',
      color: Colors.secondary,
    },
    {
      id: 'purchase_analysis',
      title: 'Purchase Analysis',
      description: 'Purchase orders by supplier',
      icon: 'arrow-down-circle-outline',
      color: Colors.warning,
    },
    {
      id: 'sales_analysis',
      title: 'Sales Analysis',
      description: 'Sales orders by sales agent',
      icon: 'arrow-up-circle-outline',
      color: Colors.success,
    },
    {
      id: 'supplier_aging',
      title: 'Supplier Aging',
      description: 'Accounts payable aging report',
      icon: 'business-outline',
      color: Colors.danger,
    },
    {
      id: 'customer_aging',
      title: 'Customer Aging',
      description: 'Accounts receivable aging report',
      icon: 'people-outline',
      color: Colors.primaryLight,
    },
    {
      id: 'profit_loss',
      title: 'Profit & Loss',
      description: 'Revenue, costs, and net profit',
      icon: 'trending-up-outline',
      color: Colors.success,
    },
    {
      id: 'cash_flow',
      title: 'Cash Flow',
      description: 'Cash inflows and outflows',
      icon: 'cash-outline',
      color: Colors.warning,
    },
  ];

  // Quick Stats
  const totalInventoryValue = stockSummary.reduce((sum, item) => sum + (item.value || 0), 0);
  const lowStockCount = stockSummary.filter(item => item.is_low_stock).length;

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Reports</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        contentContainerStyle={styles.content}
      >
        {/* Quick Stats */}
        <View style={styles.quickStats}>
          <Card style={styles.quickStatCard}>
            <Text style={styles.quickStatValue}>{formatCurrency(totalInventoryValue)}</Text>
            <Text style={styles.quickStatLabel}>Total Inventory Value</Text>
          </Card>
          <Card style={styles.quickStatCard}>
            <Text style={[styles.quickStatValue, { color: lowStockCount > 0 ? Colors.danger : Colors.success }]}>
              {lowStockCount}
            </Text>
            <Text style={styles.quickStatLabel}>Low Stock Items</Text>
          </Card>
        </View>

        {/* Purchase vs Sales Chart */}
        {purchaseAnalysis && salesAnalysis && (
          <Card style={styles.chartCard}>
            <Text style={styles.cardTitle}>Purchase vs Sales</Text>
            <View style={styles.comparisonRow}>
              <View style={styles.comparisonItem}>
                <Ionicons name="arrow-down-circle" size={24} color={Colors.warning} />
                <Text style={styles.comparisonLabel}>Purchases</Text>
                <Text style={[styles.comparisonValue, { color: Colors.warning }]}>
                  {formatCurrency(purchaseAnalysis.total_amount)}
                </Text>
                <Text style={styles.comparisonCount}>{purchaseAnalysis.total_orders} orders</Text>
              </View>
              <View style={styles.comparisonDivider} />
              <View style={styles.comparisonItem}>
                <Ionicons name="arrow-up-circle" size={24} color={Colors.success} />
                <Text style={styles.comparisonLabel}>Sales</Text>
                <Text style={[styles.comparisonValue, { color: Colors.success }]}>
                  {formatCurrency(salesAnalysis.total_amount)}
                </Text>
                <Text style={styles.comparisonCount}>{salesAnalysis.total_orders} orders</Text>
              </View>
            </View>
          </Card>
        )}

        {/* Reports List */}
        <Text style={styles.sectionTitle}>Available Reports</Text>
        {reportsList.map((report) => (
          <TouchableOpacity
            key={report.id}
            style={styles.reportItem}
            onPress={() => loadReport(report.id)}
            activeOpacity={0.7}
          >
            <View style={[styles.reportIcon, { backgroundColor: `${report.color}20` }]}>
              <Ionicons name={report.icon as any} size={24} color={report.color} />
            </View>
            <View style={styles.reportInfo}>
              <Text style={styles.reportTitle}>{report.title}</Text>
              <Text style={styles.reportDesc}>{report.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Report Detail Modal */}
      <Modal visible={!!selectedReport} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {reportsList.find(r => r.id === selectedReport)?.title || 'Report'}
              </Text>
              <TouchableOpacity onPress={() => setSelectedReport(null)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {selectedReport === 'stock_summary' && (
                <>
                  <View style={styles.reportSummary}>
                    <Text style={styles.reportSummaryLabel}>Total Value</Text>
                    <Text style={styles.reportSummaryValue}>{formatCurrency(totalInventoryValue)}</Text>
                  </View>
                  {stockSummary.map((item, index) => (
                    <View key={index} style={styles.reportRow}>
                      <View style={styles.reportRowInfo}>
                        <Text style={styles.reportRowTitle}>{item.product_name}</Text>
                        <Text style={styles.reportRowSubtitle}>{item.sku} | {item.warehouse_name}</Text>
                      </View>
                      <View style={styles.reportRowValue}>
                        <Text style={styles.reportRowAmount}>{formatCurrency(item.value)}</Text>
                        <Text style={styles.reportRowQty}>{item.quantity} {item.unit}</Text>
                        {item.is_low_stock && <Badge text="LOW" variant="danger" />}
                      </View>
                    </View>
                  ))}
                </>
              )}

              {selectedReport === 'inventory_valuation' && inventoryValuation && (
                <>
                  <View style={styles.reportSummary}>
                    <Text style={styles.reportSummaryLabel}>Total Inventory Value</Text>
                    <Text style={styles.reportSummaryValue}>{formatCurrency(inventoryValuation.total_inventory_value)}</Text>
                  </View>
                  <Text style={styles.reportSubtitle}>{inventoryValuation.total_skus} SKUs | {inventoryValuation.total_items} items</Text>
                  {inventoryValuation.items?.map((item: any, index: number) => (
                    <View key={index} style={styles.reportRow}>
                      <View style={styles.reportRowInfo}>
                        <Text style={styles.reportRowTitle}>{item.product_name}</Text>
                        <Text style={styles.reportRowSubtitle}>{item.sku} | {item.category}</Text>
                      </View>
                      <View style={styles.reportRowValue}>
                        <Text style={styles.reportRowAmount}>{formatCurrency(item.total_value)}</Text>
                        <Text style={styles.reportRowQty}>{item.quantity} x {formatCurrency(item.unit_cost)}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}

              {selectedReport === 'supplier_aging' && supplierAging && (
                <>
                  <View style={styles.reportSummary}>
                    <Text style={styles.reportSummaryLabel}>Total Payable</Text>
                    <Text style={[styles.reportSummaryValue, { color: Colors.danger }]}>
                      {formatCurrency(supplierAging.total_accounts_payable)}
                    </Text>
                  </View>
                  <View style={styles.agingBuckets}>
                    {Object.entries(supplierAging.aging_summary || {}).map(([bucket, amount]) => (
                      <View key={bucket} style={styles.agingBucket}>
                        <Text style={styles.agingBucketLabel}>
                          {bucket.replace(/_/g, ' ').replace('days', 'd')}
                        </Text>
                        <Text style={styles.agingBucketValue}>{formatCurrency(amount as number)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {selectedReport === 'customer_aging' && customerAging && (
                <>
                  <View style={styles.reportSummary}>
                    <Text style={styles.reportSummaryLabel}>Total Receivable</Text>
                    <Text style={[styles.reportSummaryValue, { color: Colors.success }]}>
                      {formatCurrency(customerAging.total_accounts_receivable)}
                    </Text>
                  </View>
                  <View style={styles.agingBuckets}>
                    {Object.entries(customerAging.aging_summary || {}).map(([bucket, amount]) => (
                      <View key={bucket} style={styles.agingBucket}>
                        <Text style={styles.agingBucketLabel}>
                          {bucket.replace(/_/g, ' ').replace('days', 'd')}
                        </Text>
                        <Text style={styles.agingBucketValue}>{formatCurrency(amount as number)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {selectedReport === 'profit_loss' && reportData && (
                <>
                  <View style={styles.plSection}>
                    <View style={styles.plRow}>
                      <Text style={styles.plLabel}>Revenue</Text>
                      <Text style={[styles.plValue, { color: Colors.success }]}>
                        {formatCurrency(reportData.revenue?.total_sales)}
                      </Text>
                    </View>
                    <View style={styles.plRow}>
                      <Text style={styles.plLabel}>Cost of Goods Sold</Text>
                      <Text style={styles.plValue}>
                        -{formatCurrency(reportData.cost_of_goods_sold?.total_cogs)}
                      </Text>
                    </View>
                    <View style={[styles.plRow, styles.plTotal]}>
                      <Text style={styles.plTotalLabel}>Gross Profit</Text>
                      <Text style={styles.plTotalValue}>{formatCurrency(reportData.gross_profit)}</Text>
                    </View>
                    <View style={styles.plRow}>
                      <Text style={styles.plLabel}>Operating Expenses</Text>
                      <Text style={[styles.plValue, { color: Colors.danger }]}>
                        -{formatCurrency(reportData.operating_expenses?.total)}
                      </Text>
                    </View>
                    <View style={[styles.plRow, styles.plTotal]}>
                      <Text style={styles.plTotalLabel}>Net Profit</Text>
                      <Text style={[
                        styles.plTotalValue,
                        { color: reportData.net_profit >= 0 ? Colors.success : Colors.danger }
                      ]}>
                        {formatCurrency(reportData.net_profit)}
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {selectedReport === 'cash_flow' && reportData && (
                <>
                  <View style={styles.cfSection}>
                    <View style={[styles.cfBox, { backgroundColor: `${Colors.success}20` }]}>
                      <Ionicons name="arrow-down-circle" size={32} color={Colors.success} />
                      <Text style={styles.cfLabel}>Cash Inflows</Text>
                      <Text style={[styles.cfValue, { color: Colors.success }]}>
                        {formatCurrency(reportData.cash_inflows?.total)}
                      </Text>
                    </View>
                    <View style={[styles.cfBox, { backgroundColor: `${Colors.danger}20` }]}>
                      <Ionicons name="arrow-up-circle" size={32} color={Colors.danger} />
                      <Text style={styles.cfLabel}>Cash Outflows</Text>
                      <Text style={[styles.cfValue, { color: Colors.danger }]}>
                        {formatCurrency(reportData.cash_outflows?.total)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.cfNetRow}>
                    <Text style={styles.cfNetLabel}>Net Cash Flow</Text>
                    <Text style={[
                      styles.cfNetValue,
                      { color: reportData.net_cash_flow >= 0 ? Colors.success : Colors.danger }
                    ]}>
                      {formatCurrency(reportData.net_cash_flow)}
                    </Text>
                  </View>
                </>
              )}

              {selectedReport === 'purchase_analysis' && purchaseAnalysis && (
                <>
                  <View style={styles.reportSummary}>
                    <Text style={styles.reportSummaryLabel}>Total Purchases</Text>
                    <Text style={styles.reportSummaryValue}>{formatCurrency(purchaseAnalysis.total_amount)}</Text>
                  </View>
                  <Text style={styles.reportSubtitle}>{purchaseAnalysis.total_orders} orders</Text>
                  {purchaseAnalysis.by_supplier?.map((supplier: any, index: number) => (
                    <View key={index} style={styles.reportRow}>
                      <View style={styles.reportRowInfo}>
                        <Text style={styles.reportRowTitle}>{supplier.supplier_name}</Text>
                        <Text style={styles.reportRowSubtitle}>{supplier.order_count} orders</Text>
                      </View>
                      <Text style={styles.reportRowAmount}>{formatCurrency(supplier.total_amount)}</Text>
                    </View>
                  ))}
                </>
              )}

              {selectedReport === 'sales_analysis' && salesAnalysis && (
                <>
                  <View style={styles.reportSummary}>
                    <Text style={styles.reportSummaryLabel}>Total Sales</Text>
                    <Text style={[styles.reportSummaryValue, { color: Colors.success }]}>
                      {formatCurrency(salesAnalysis.total_amount)}
                    </Text>
                  </View>
                  <Text style={styles.reportSubtitle}>{salesAnalysis.total_orders} orders</Text>
                  {salesAnalysis.by_sales_rep?.map((rep: any, index: number) => (
                    <View key={index} style={styles.reportRow}>
                      <View style={styles.reportRowInfo}>
                        <Text style={styles.reportRowTitle}>{rep.sales_rep_name || 'Unknown'}</Text>
                        <Text style={styles.reportRowSubtitle}>{rep.order_count} orders</Text>
                      </View>
                      <Text style={[styles.reportRowAmount, { color: Colors.success }]}>
                        {formatCurrency(rep.total_amount)}
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
  },
  content: {
    paddingHorizontal: 20,
  },
  quickStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  quickStatCard: {
    flex: 1,
    alignItems: 'center',
  },
  quickStatValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  quickStatLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
  },
  chartCard: {
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 16,
  },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  comparisonItem: {
    flex: 1,
    alignItems: 'center',
  },
  comparisonDivider: {
    width: 1,
    height: 60,
    backgroundColor: Colors.border,
    marginHorizontal: 16,
  },
  comparisonLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 8,
  },
  comparisonValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  comparisonCount: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  reportItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reportIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  reportInfo: {
    flex: 1,
  },
  reportTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  reportDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  reportSummary: {
    backgroundColor: Colors.cardAlt,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  reportSummaryLabel: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  reportSummaryValue: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 4,
  },
  reportSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  reportRowInfo: {
    flex: 1,
  },
  reportRowTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  reportRowSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  reportRowValue: {
    alignItems: 'flex-end',
  },
  reportRowAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  reportRowQty: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  agingBuckets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  agingBucket: {
    backgroundColor: Colors.cardAlt,
    padding: 12,
    borderRadius: 8,
    minWidth: '30%',
    flex: 1,
  },
  agingBucketLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'capitalize',
  },
  agingBucketValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 4,
  },
  plSection: {
    marginTop: 8,
  },
  plRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  plLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  plValue: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  plTotal: {
    backgroundColor: Colors.cardAlt,
    marginVertical: 8,
    padding: 12,
    borderRadius: 8,
    borderBottomWidth: 0,
  },
  plTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  plTotalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  cfSection: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  cfBox: {
    flex: 1,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  cfLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 8,
  },
  cfValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  cfNetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.cardAlt,
    padding: 16,
    borderRadius: 12,
  },
  cfNetLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  cfNetValue: {
    fontSize: 20,
    fontWeight: '700',
  },
});
