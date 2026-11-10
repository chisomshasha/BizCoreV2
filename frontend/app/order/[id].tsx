import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  Colors,
  Card,
  Button,
  Badge,
  LoadingScreen,
} from '../../src/components/ThemedComponents';
import { useAppStore } from '../../src/store/appStore';
import { formatCurrency } from '../../src/config/clientConfig';
import { format } from 'date-fns';

export default function OrderDetailScreen() {
  const router = useRouter();
  const { id, type } = useLocalSearchParams<{ id: string; type: string }>();
  const {
    purchaseOrders,
    salesOrders,
    suppliers,
    agents,
    fetchPurchaseOrders,
    fetchSalesOrders,
    fetchSuppliers,
    fetchAgents,
  } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const isPurchase = type === 'purchase';

  useEffect(() => {
    loadData();
  }, [id, type]);

  const loadData = async () => {
    try {
      if (isPurchase) {
        await Promise.all([fetchPurchaseOrders(), fetchSuppliers()]);
      } else {
        // For sales orders, partner info comes from the sales rep (agent)
        await Promise.all([fetchSalesOrders(), fetchAgents()]);
      }
    } catch (error) {
      console.error('Error loading order:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const order: any = isPurchase
    ? purchaseOrders.find((o: any) => o.po_id === id || o._id === id)
    : salesOrders.find((o: any) => o.so_id === id || o._id === id);

  // For purchase orders, partner = supplier.
  // For sales orders, partner = sales rep (agent) — the rep that placed it.
  const partner = isPurchase
    ? suppliers.find((s: any) => s.supplier_id === order?.supplier_id || s._id === order?.supplier_id)
    : agents.find(
        (a: any) => a.user_id === order?.sales_rep_id || a._id === order?.sales_rep_id
      );

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'delivered':
      case 'goods_released':
        return Colors.success;
      case 'pending':
      case 'draft':
      case 'pending_approval':
        return Colors.warning;
      case 'cancelled':
        return Colors.danger;
      case 'processing':
      case 'shipped':
      case 'approved':
        return Colors.info;
      default:
        return Colors.textSecondary;
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Order Not Found</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Ionicons name="document-outline" size={64} color={Colors.textMuted} />
          <Text style={styles.emptyText}>Order not found</Text>
          <Button title="Go Back" onPress={() => router.back()} style={{ marginTop: 16 }} />
        </View>
      </SafeAreaView>
    );
  }

  const orderNumber = isPurchase ? order.po_number : order.so_number;
  const subtotal: number = order.subtotal ?? 0;
  const tax: number = order.tax_amount ?? 0;
  const total: number = order.total_amount ?? 0;
  const discount: number = 0; // new model has no per-order discount field

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {isPurchase ? 'Purchase Order' : 'Sales Order'}
        </Text>
        <TouchableOpacity
          style={styles.moreButton}
          onPress={() => Alert.alert('Options', 'More options coming soon')}
        >
          <Ionicons name="ellipsis-vertical" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Order Header Card */}
        <Card style={styles.orderCard}>
          <View style={styles.orderHeader}>
            <View style={styles.orderNumber}>
              <Text style={styles.orderNumberLabel}>Order #</Text>
              <Text style={styles.orderNumberValue}>{orderNumber}</Text>
            </View>
            <Badge
              text={order.status}
              variant={
                order.status === 'delivered' || order.status === 'goods_released'
                  ? 'success'
                  : order.status === 'cancelled'
                  ? 'danger'
                  : 'warning'
              }
            />
          </View>
          <View style={styles.orderDate}>
            <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
            <Text style={styles.orderDateText}>
              {format(new Date(order.order_date || order.created_at), 'MMM dd, yyyy')}
            </Text>
          </View>
        </Card>

        {/* Partner Info */}
        <Card style={styles.partnerCard}>
          <Text style={styles.sectionTitle}>
            {isPurchase ? 'Supplier' : 'Sales Rep'}
          </Text>
          <View style={styles.partnerInfo}>
            <View style={styles.partnerIcon}>
              <Ionicons
                name={isPurchase ? 'business-outline' : 'person-outline'}
                size={24}
                color={Colors.primary}
              />
            </View>
            <View style={styles.partnerDetails}>
              <Text style={styles.partnerName}>{partner?.name || 'Unknown'}</Text>
              {!isPurchase && order?.sales_rep_name && (
                <Text style={styles.partnerContact}>
                  {order.sales_rep_name}
                </Text>
              )}
              {isPurchase && partner?.contact_person && (
                <Text style={styles.partnerContact}>{partner.contact_person}</Text>
              )}
              {partner?.phone && (
                <Text style={styles.partnerPhone}>{partner.phone}</Text>
              )}
            </View>
          </View>
        </Card>

        {/* Order Items */}
        <Card style={styles.itemsCard}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          {order.items?.map((item: any, index: number) => (
            <View key={index} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.product_name || item.name || 'Product'}</Text>
                <Text style={styles.itemQuantity}>
                  Qty: {item.quantity} @ {formatCurrency(item.unit_price || item.price)}
                </Text>
              </View>
              <Text style={styles.itemTotal}>
                {formatCurrency(item.quantity * (item.unit_price || item.price))}
              </Text>
            </View>
          ))}
        </Card>

        {/* Order Summary */}
        <Card style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>{formatCurrency(subtotal)}</Text>
          </View>
          {tax > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tax</Text>
              <Text style={styles.summaryValue}>{formatCurrency(tax)}</Text>
            </View>
          )}
          {discount > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Discount</Text>
              <Text style={[styles.summaryValue, { color: Colors.success }]}>
                -{formatCurrency(discount)}
              </Text>
            </View>
          )}
          <View style={[styles.summaryRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(total)}</Text>
          </View>
        </Card>

        {/* Notes */}
        {order.notes && (
          <Card style={styles.notesCard}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesText}>{order.notes}</Text>
          </Card>
        )}

        {/* Actions */}
        <View style={styles.actionsContainer}>
          {order.status !== 'cancelled' && (
            <Button
              title="Update Status"
              variant="primary"
              onPress={() => Alert.alert('Update', 'Status update coming soon')}
              style={styles.actionButton}
            />
          )}
          <Button
            title="Print / Export"
            variant="secondary"
            onPress={() => Alert.alert('Export', 'PDF export coming soon')}
            style={styles.actionButton}
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
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
  moreButton: {
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
    marginHorizontal: 12,
  },
  orderCard: {
    margin: 16,
    marginBottom: 12,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderNumber: {},
  orderNumberLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  orderNumberValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  orderDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  orderDateText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  partnerCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  partnerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  partnerIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: `${Colors.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  partnerDetails: {
    flex: 1,
  },
  partnerName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  partnerContact: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  partnerPhone: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  itemsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
  itemQuantity: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  itemTotal: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  summaryCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 8,
    paddingTop: 12,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
  },
  notesCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  notesText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textMuted,
    marginTop: 12,
  },
});
