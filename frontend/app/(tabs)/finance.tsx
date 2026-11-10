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
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PieChart } from 'react-native-gifted-charts';
import {
  Colors,
  Card,
  Button,
  Input,
  Badge,
  LoadingScreen,
  EmptyState,
} from '../../src/components/ThemedComponents';
import api from '../../src/utils/api';
import { formatCurrency as formatNaira } from '../../src/config/clientConfig';
import { format } from 'date-fns';

const { width } = Dimensions.get('window');

type FinanceTab = 'overview' | 'expenses' | 'invoices' | 'payments';

const expenseCategories = [
  { value: 'office', label: 'Office' },
  { value: 'travel', label: 'Travel' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'salary', label: 'Salary' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'other', label: 'Other' },
];

const paymentMethods = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
];

export default function FinanceScreen() {
  // Hooks must be called inside the component body. This call used to sit
  // at module scope, which made React throw "Invalid hook call" and crash
  // the whole Finance tab on mount.
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Data
  const [profitLoss, setProfitLoss] = useState<any>(null);
  const [cashFlow, setCashFlow] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  
  // Modals
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  
  // Form
  const [expenseForm, setExpenseForm] = useState({
    category: 'office',
    amount: '',
    description: '',
    vendor: '',
    payment_method: 'cash',
  });
  
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'cash',
    transaction_ref: '',
    notes: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [plRes, cfRes, expRes, invRes, payRes] = await Promise.all([
        api.get('/reports/profit-loss').catch(() => ({ data: null })),
        api.get('/reports/cash-flow').catch(() => ({ data: null })),
        api.get('/expenses').catch(() => ({ data: [] })),
        api.get('/invoices').catch(() => ({ data: [] })),
        api.get('/payments').catch(() => ({ data: [] })),
      ]);
      
      setProfitLoss(plRes.data);
      setCashFlow(cfRes.data);
      setExpenses(expRes.data || []);
      setInvoices(invRes.data || []);
      setPayments(payRes.data || []);
    } catch (error) {
      console.error('Error loading finance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleCreateExpense = async () => {
    if (!expenseForm.amount || !expenseForm.description) {
      Alert.alert('Error', 'Amount and description are required');
      return;
    }

    try {
      await api.post('/expenses', {
        ...expenseForm,
        amount: parseFloat(expenseForm.amount),
      });
      setShowExpenseModal(false);
      setExpenseForm({
        category: 'office',
        amount: '',
        description: '',
        vendor: '',
        payment_method: 'cash',
      });
      loadData();
      Alert.alert('Success', 'Expense recorded');
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create expense');
    }
  };

  const handleRecordPayment = async () => {
    if (!selectedInvoice || !paymentForm.amount) {
      Alert.alert('Error', 'Amount is required');
      return;
    }

    try {
      await api.post('/payments', {
        invoice_id: selectedInvoice.invoice_id,
        amount: parseFloat(paymentForm.amount),
        method: paymentForm.method,
        transaction_ref: paymentForm.transaction_ref,
        notes: paymentForm.notes,
      });
      setShowPaymentModal(false);
      setSelectedInvoice(null);
      setPaymentForm({ amount: '', method: 'cash', transaction_ref: '', notes: '' });
      loadData();
      Alert.alert('Success', 'Payment recorded');
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to record payment');
    }
  };

  const formatCurrency = (value: number) =>
    formatNaira(value || 0, { maximumFractionDigits: 0 });

  const getStatusColor = (status: string): 'success' | 'warning' | 'danger' | 'default' => {
    switch (status) {
      case 'paid':
        return 'success';
      case 'partial':
        return 'warning';
      case 'unpaid':
      case 'overdue':
        return 'danger';
      default:
        return 'default';
    }
  };

  // Expense pie chart data
  const expensePieData = profitLoss?.operating_expenses?.by_category
    ? Object.entries(profitLoss.operating_expenses.by_category).map(([key, value], index) => ({
        value: value as number,
        color: [
          Colors.primary,
          Colors.secondary,
          Colors.warning,
          Colors.danger,
          Colors.primaryLight,
          '#FF6B6B',
          '#4ECDC4',
          '#45B7D1',
        ][index % 8],
        text: key,
      }))
    : [];

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Finance</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowExpenseModal(true)}
        >
          <Ionicons name="add" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabContainer}
        contentContainerStyle={styles.tabContent}
      >
        {(['overview', 'expenses', 'invoices', 'payments'] as FinanceTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
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
        {activeTab === 'overview' && (
          <>
            {/* P&L Summary */}
            <Card style={styles.summaryCard}>
              <Text style={styles.cardTitle}>Profit & Loss Summary</Text>
              <View style={styles.plRow}>
                <View style={styles.plItem}>
                  <Text style={styles.plLabel}>Revenue</Text>
                  <Text style={[styles.plValue, { color: Colors.success }]}>
                    {formatCurrency(profitLoss?.revenue?.total_sales)}
                  </Text>
                </View>
                <View style={styles.plItem}>
                  <Text style={styles.plLabel}>COGS</Text>
                  <Text style={[styles.plValue, { color: Colors.warning }]}>
                    {formatCurrency(profitLoss?.cost_of_goods_sold?.total_cogs)}
                  </Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.plRow}>
                <View style={styles.plItem}>
                  <Text style={styles.plLabel}>Gross Profit</Text>
                  <Text style={styles.plValue}>
                    {formatCurrency(profitLoss?.gross_profit)}
                  </Text>
                </View>
                <View style={styles.plItem}>
                  <Text style={styles.plLabel}>Expenses</Text>
                  <Text style={[styles.plValue, { color: Colors.danger }]}>
                    {formatCurrency(profitLoss?.operating_expenses?.total)}
                  </Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.netProfitRow}>
                <Text style={styles.netProfitLabel}>Net Profit</Text>
                <Text
                  style={[
                    styles.netProfitValue,
                    { color: (profitLoss?.net_profit || 0) >= 0 ? Colors.success : Colors.danger },
                  ]}
                >
                  {formatCurrency(profitLoss?.net_profit)}
                </Text>
              </View>
            </Card>

            {/* Cash Flow */}
            <Card style={styles.summaryCard}>
              <Text style={styles.cardTitle}>Cash Flow</Text>
              <View style={styles.cashFlowRow}>
                <View style={[styles.cashFlowItem, { backgroundColor: `${Colors.success}20` }]}>
                  <Ionicons name="arrow-down-circle" size={24} color={Colors.success} />
                  <Text style={styles.cashFlowLabel}>Inflows</Text>
                  <Text style={[styles.cashFlowValue, { color: Colors.success }]}>
                    {formatCurrency(cashFlow?.cash_inflows?.total)}
                  </Text>
                </View>
                <View style={[styles.cashFlowItem, { backgroundColor: `${Colors.danger}20` }]}>
                  <Ionicons name="arrow-up-circle" size={24} color={Colors.danger} />
                  <Text style={styles.cashFlowLabel}>Outflows</Text>
                  <Text style={[styles.cashFlowValue, { color: Colors.danger }]}>
                    {formatCurrency(cashFlow?.cash_outflows?.total)}
                  </Text>
                </View>
              </View>
              <View style={styles.netCashRow}>
                <Text style={styles.netCashLabel}>Net Cash Flow</Text>
                <Text
                  style={[
                    styles.netCashValue,
                    { color: (cashFlow?.net_cash_flow || 0) >= 0 ? Colors.success : Colors.danger },
                  ]}
                >
                  {formatCurrency(cashFlow?.net_cash_flow)}
                </Text>
              </View>
            </Card>

            {/* Expense Breakdown */}
            {expensePieData.length > 0 && (
              <Card style={styles.summaryCard}>
                <Text style={styles.cardTitle}>Expense Breakdown</Text>
                <View style={styles.chartContainer}>
                  <PieChart
                    data={expensePieData}
                    donut
                    radius={80}
                    innerRadius={50}
                    centerLabelComponent={() => (
                      <View style={styles.chartCenter}>
                        <Text style={styles.chartCenterValue}>
                          {formatCurrency(profitLoss?.operating_expenses?.total)}
                        </Text>
                        <Text style={styles.chartCenterLabel}>Total</Text>
                      </View>
                    )}
                  />
                </View>
                <View style={styles.legendContainer}>
                  {expensePieData.map((item, index) => (
                    <View key={index} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                      <Text style={styles.legendText}>
                        {item.text}: {formatCurrency(item.value)}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            )}
          </>
        )}

        {activeTab === 'expenses' && (
          <>
            {expenses.length === 0 ? (
              <EmptyState message="No expenses recorded" icon="receipt-outline" />
            ) : (
              expenses.map((expense) => (
                <Card key={expense.expense_id} style={styles.itemCard}>
                  <View style={styles.itemHeader}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemTitle}>{expense.description}</Text>
                      <Text style={styles.itemSubtitle}>
                        {expense.category} | {expense.vendor || 'No vendor'}
                      </Text>
                    </View>
                    <View style={styles.itemAmount}>
                      <Text style={styles.amountValue}>
                        {formatCurrency(expense.amount)}
                      </Text>
                      <Badge
                        text={expense.approved ? 'Approved' : 'Pending'}
                        variant={expense.approved ? 'success' : 'warning'}
                      />
                    </View>
                  </View>
                  <View style={styles.itemFooter}>
                    <Text style={styles.itemDate}>
                      {format(new Date(expense.expense_date), 'MMM dd, yyyy')}
                    </Text>
                    <Text style={styles.itemMethod}>{expense.payment_method}</Text>
                  </View>
                </Card>
              ))
            )}
          </>
        )}

        {activeTab === 'invoices' && (
          <>
            {invoices.length === 0 ? (
              <EmptyState message="No invoices found" icon="document-text-outline" />
            ) : (
              invoices.map((invoice) => (
                <TouchableOpacity
                  key={invoice.invoice_id}
                  onPress={() => {
                    setSelectedInvoice(invoice);
                    setPaymentForm({
                      ...paymentForm,
                      amount: (invoice.total - (invoice.paid_amount || 0)).toString(),
                    });
                    setShowPaymentModal(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Card style={styles.itemCard}>
                    <View style={styles.itemHeader}>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle}>{invoice.invoice_number}</Text>
                        <Text style={styles.itemSubtitle}>
                          {invoice.party_name} | {invoice.type.toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.itemAmount}>
                        <Text style={styles.amountValue}>
                          {formatCurrency(invoice.total)}
                        </Text>
                        <Badge
                          text={invoice.status.toUpperCase()}
                          variant={getStatusColor(invoice.status)}
                        />
                      </View>
                    </View>
                    <View style={styles.itemFooter}>
                      <Text style={styles.itemDate}>
                        Due: {format(new Date(invoice.due_date), 'MMM dd, yyyy')}
                      </Text>
                      <Text style={styles.itemPaid}>
                        Paid: {formatCurrency(invoice.paid_amount || 0)}
                      </Text>
                    </View>
                  </Card>
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {activeTab === 'payments' && (
          <>
            {payments.length === 0 ? (
              <EmptyState message="No payments recorded" icon="card-outline" />
            ) : (
              payments.map((payment) => (
                <Card key={payment.payment_id} style={styles.itemCard}>
                  <View style={styles.itemHeader}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemTitle}>
                        Payment #{payment.payment_id.slice(-8)}
                      </Text>
                      <Text style={styles.itemSubtitle}>
                        {payment.method} | {payment.transaction_ref || 'No ref'}
                      </Text>
                    </View>
                    <Text style={[styles.amountValue, { color: Colors.success }]}>
                      {formatCurrency(payment.amount)}
                    </Text>
                  </View>
                  <Text style={styles.itemDate}>
                    {format(new Date(payment.payment_date), 'MMM dd, yyyy HH:mm')}
                  </Text>
                </Card>
              ))
            )}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Add Expense Modal */}
      <Modal visible={showExpenseModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Record Expense</Text>
              <TouchableOpacity onPress={() => setShowExpenseModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Category</Text>
              <View style={styles.categoryPicker}>
                {expenseCategories.map((cat) => (
                  <TouchableOpacity
                    key={cat.value}
                    style={[
                      styles.categoryOption,
                      expenseForm.category === cat.value && styles.categoryOptionActive,
                    ]}
                    onPress={() => setExpenseForm({ ...expenseForm, category: cat.value })}
                  >
                    <Text
                      style={[
                        styles.categoryOptionText,
                        expenseForm.category === cat.value && styles.categoryOptionTextActive,
                      ]}
                    >
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Input
                label="Amount *"
                value={expenseForm.amount}
                onChangeText={(text) => setExpenseForm({ ...expenseForm, amount: text })}
                placeholder="0.00"
                keyboardType="numeric"
              />
              <Input
                label="Description *"
                value={expenseForm.description}
                onChangeText={(text) => setExpenseForm({ ...expenseForm, description: text })}
                placeholder="Enter description"
              />
              <Input
                label="Vendor"
                value={expenseForm.vendor}
                onChangeText={(text) => setExpenseForm({ ...expenseForm, vendor: text })}
                placeholder="Enter vendor name"
              />
              <Text style={styles.inputLabel}>Payment Method</Text>
              <View style={styles.methodPicker}>
                {paymentMethods.map((method) => (
                  <TouchableOpacity
                    key={method.value}
                    style={[
                      styles.methodOption,
                      expenseForm.payment_method === method.value && styles.methodOptionActive,
                    ]}
                    onPress={() => setExpenseForm({ ...expenseForm, payment_method: method.value })}
                  >
                    <Text
                      style={[
                        styles.methodOptionText,
                        expenseForm.payment_method === method.value && styles.methodOptionTextActive,
                      ]}
                    >
                      {method.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Button title="Record Expense" onPress={handleCreateExpense} style={{ marginTop: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Record Payment Modal */}
      <Modal visible={showPaymentModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Record Payment</Text>
              <TouchableOpacity onPress={() => setShowPaymentModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            {selectedInvoice && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.invoiceInfo}>
                  <Text style={styles.invoiceInfoTitle}>{selectedInvoice.invoice_number}</Text>
                  <Text style={styles.invoiceInfoSubtitle}>{selectedInvoice.party_name}</Text>
                  <View style={styles.invoiceInfoRow}>
                    <Text style={styles.invoiceInfoLabel}>Total:</Text>
                    <Text style={styles.invoiceInfoValue}>
                      {formatCurrency(selectedInvoice.total)}
                    </Text>
                  </View>
                  <View style={styles.invoiceInfoRow}>
                    <Text style={styles.invoiceInfoLabel}>Paid:</Text>
                    <Text style={styles.invoiceInfoValue}>
                      {formatCurrency(selectedInvoice.paid_amount || 0)}
                    </Text>
                  </View>
                  <View style={styles.invoiceInfoRow}>
                    <Text style={styles.invoiceInfoLabel}>Outstanding:</Text>
                    <Text style={[styles.invoiceInfoValue, { color: Colors.danger }]}>
                      {formatCurrency(selectedInvoice.total - (selectedInvoice.paid_amount || 0))}
                    </Text>
                  </View>
                </View>
                <Input
                  label="Amount *"
                  value={paymentForm.amount}
                  onChangeText={(text) => setPaymentForm({ ...paymentForm, amount: text })}
                  placeholder="0.00"
                  keyboardType="numeric"
                />
                <Text style={styles.inputLabel}>Payment Method</Text>
                <View style={styles.methodPicker}>
                  {paymentMethods.map((method) => (
                    <TouchableOpacity
                      key={method.value}
                      style={[
                        styles.methodOption,
                        paymentForm.method === method.value && styles.methodOptionActive,
                      ]}
                      onPress={() => setPaymentForm({ ...paymentForm, method: method.value })}
                    >
                      <Text
                        style={[
                          styles.methodOptionText,
                          paymentForm.method === method.value && styles.methodOptionTextActive,
                        ]}
                      >
                        {method.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Input
                  label="Transaction Reference"
                  value={paymentForm.transaction_ref}
                  onChangeText={(text) => setPaymentForm({ ...paymentForm, transaction_ref: text })}
                  placeholder="Enter reference number"
                />
                <Input
                  label="Notes"
                  value={paymentForm.notes}
                  onChangeText={(text) => setPaymentForm({ ...paymentForm, notes: text })}
                  placeholder="Add notes"
                  multiline
                />
                <Button title="Record Payment" onPress={handleRecordPayment} style={{ marginTop: 16 }} />
              </ScrollView>
            )}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    marginBottom: 16,
  },
  tabContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  activeTab: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  activeTabText: {
    color: Colors.text,
  },
  content: {
    paddingHorizontal: 20,
  },
  summaryCard: {
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 16,
  },
  plRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  plItem: {
    flex: 1,
  },
  plLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  plValue: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },
  netProfitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  netProfitLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  netProfitValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  cashFlowRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cashFlowItem: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  cashFlowLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 8,
  },
  cashFlowValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  netCashRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  netCashLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  netCashValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  chartContainer: {
    alignItems: 'center',
    marginVertical: 16,
  },
  chartCenter: {
    alignItems: 'center',
  },
  chartCenterValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  chartCenterLabel: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  itemCard: {
    marginBottom: 12,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  itemSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  itemAmount: {
    alignItems: 'flex-end',
  },
  amountValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  itemFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  itemDate: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  itemMethod: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  itemPaid: {
    fontSize: 12,
    color: Colors.success,
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
  inputLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  categoryPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  categoryOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryOptionText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  categoryOptionTextActive: {
    color: Colors.text,
  },
  methodPicker: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  methodOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.cardAlt,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  methodOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  methodOptionText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  methodOptionTextActive: {
    color: Colors.text,
  },
  invoiceInfo: {
    backgroundColor: Colors.cardAlt,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  invoiceInfoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  invoiceInfoSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 12,
  },
  invoiceInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  invoiceInfoLabel: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  invoiceInfoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
});
