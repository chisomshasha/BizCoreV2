import React, { useEffect, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
import { Ionicons } from '@expo/vector-icons';
import {
  Colors,
  Card,
  Button,
  Input,
  Badge,
  LoadingScreen,
  EmptyState,
} from '../../src/components/ThemedComponents';
import { useAppStore } from '../../src/store/appStore';
import { PurchaseOrder, SalesOrder, OrderStatus } from '../../src/types';
import { formatCurrency as formatNaira } from '../../src/config/clientConfig';
import { format } from 'date-fns';
import api from '../../src/utils/api';

type OrderTab = 'purchase' | 'sales';

export default function OrdersScreen() {
  const router = useRouter();
  const {
    purchaseOrders,
    salesOrders,
    products,
    suppliers,
    warehouses,
    agents,
    isLoading,
    fetchPurchaseOrders,
    fetchSalesOrders,
    fetchProducts,
    fetchSuppliers,
    fetchWarehouses,
    fetchAgents,
    createPurchaseOrder,
    createSalesOrder,
    updatePurchaseOrder,
    updateSalesOrder,
  } = useAppStore();

  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<OrderTab>('purchase');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | SalesOrder | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');

  // Requisition conversion state
  const [fromRequisition, setFromRequisition] = useState(false);
  const [approvedRequisitions, setApprovedRequisitions] = useState<any[]>([]);
  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);

  // Form state for new order
  const [orderForm, setOrderForm] = useState({
    supplier_id: '',
    sales_rep_id: '',
    warehouse_id: '',
    notes: '',
    items: [] as { product_id: string; quantity: string; unit_price: string }[],
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadApprovedRequisitions = async () => {
    try {
      const res = await api.get('/requisitions', { params: { status: 'approved' } });
      setApprovedRequisitions(res.data || []);
    } catch (error) {
      console.error('Error loading requisitions:', error);
    }
  };

  const loadData = async () => {
    try {
      await Promise.all([
        fetchPurchaseOrders(),
        fetchSalesOrders(),
        fetchProducts(),
        fetchSuppliers(),
        fetchWarehouses(),
        fetchAgents(),
        loadApprovedRequisitions(),
      ]);
    } catch (error) {
      console.error('Error loading orders:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const resetForm = () => {
    setOrderForm({
      supplier_id: '',
      sales_rep_id: '',
      warehouse_id: '',
      notes: '',
      items: [],
    });
    setFromRequisition(false);
    setSelectedReqId(null);
  };

  const addItemToOrder = () => {
    setOrderForm((prev) => ({
      ...prev,
      items: [...prev.items, { product_id: '', quantity: '', unit_price: '' }],
    }));
  };

  const removeItemFromOrder = (index: number) => {
    setOrderForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const updateOrderItem = (index: number, field: string, value: string) => {
    setOrderForm((prev) => {
      const newItems = [...prev.items];
      newItems[index] = { ...newItems[index], [field]: value };
      return { ...prev, items: newItems };
    });
  };

  const updateOrderItemFields = (index: number, fields: Record<string, string>) => {
    setOrderForm((prev) => {
      const newItems = [...prev.items];
      newItems[index] = { ...newItems[index], ...fields };
      return { ...prev, items: newItems };
    });
  };

  const prefillFromRequisition = (req: any) => {
    const items = (req.items || []).map((item: any) => ({
      product_id: item.product_id,
      quantity: String(item.quantity || ''),
      unit_price: String(item.estimated_unit_price || ''),
    }));

    setOrderForm((prev) => ({
      ...prev,
      items,
      supplier_id: req.supplier_id || prev.supplier_id,
      notes: `Converted from ${req.requisition_number}. ${prev.notes || ''}`.trim(),
    }));
  };

  const handleCreateOrder = async () => {
    try {
      const validItems = orderForm.items.filter(
        (item) => item.product_id && item.quantity && item.unit_price
      );

      if (validItems.length === 0) {
        Alert.alert('Error', 'Please add at least one item');
        return;
      }
      if (!orderForm.warehouse_id) {
        Alert.alert('Error', 'Please select a warehouse');
        return;
      }

      if (activeTab === 'purchase') {
        if (!orderForm.supplier_id) {
          Alert.alert('Error', 'Please select a supplier');
          return;
        }

        const poData: any = {
          supplier_id: orderForm.supplier_id,
          warehouse_id: orderForm.warehouse_id,
          notes: orderForm.notes,
          items: validItems.map((item) => ({
            product_id: item.product_id,
            quantity: parseFloat(item.quantity),
            unit_price: parseFloat(item.unit_price),
          })),
        };

        if (fromRequisition && selectedReqId) {
          poData.requisition_id = selectedReqId;
        }

        await createPurchaseOrder(poData);
      } else {
        if (!orderForm.sales_rep_id) {
          Alert.alert('Error', 'Please select a Sales Representative');
          return;
        }
        await createSalesOrder({
          sales_rep_id: orderForm.sales_rep_id,
          warehouse_id: orderForm.warehouse_id,
          notes: orderForm.notes,
          items: validItems.map((item) => ({
            product_id: item.product_id,
            quantity: parseFloat(item.quantity),
            unit_price: parseFloat(item.unit_price),
          })),
        });
      }

      setShowAddModal(false);
      resetForm();
      Alert.alert('Success', `${activeTab === 'purchase' ? 'Purchase' : 'Sales'} order created`);
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create order');
    }
  };

  const handleUpdateStatus = async (newStatus: OrderStatus) => {
    if (!selectedOrder) return;
    try {
      if (activeTab === 'purchase') {
        await updatePurchaseOrder((selectedOrder as PurchaseOrder).po_id, { status: newStatus });
      } else {
        await updateSalesOrder((selectedOrder as SalesOrder).so_id, { status: newStatus });
      }
      setShowDetailModal(false);
      Alert.alert('Success', 'Order status updated');
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update status');
    }
  };

  const getStatusColor = (status: OrderStatus): 'default' | 'success' | 'warning' | 'danger' | 'info' => {
    switch (status) {
      case 'draft':
        return 'default';
      case 'ordered':
      case 'pending_approval':
        return 'info';
      case 'approved':
        return 'warning';
      case 'goods_released':
        return 'info';
      case 'received':
      case 'delivered':
      case 'paid':
        return 'success';
      case 'partial':
        return 'warning';
      case 'cancelled':
        return 'danger';
      default:
        return 'default';
    }
  };

  const getNextStatus = (currentStatus: OrderStatus): OrderStatus[] => {
    if (activeTab === 'purchase') {
      switch (currentStatus) {
        case 'draft':    return ['ordered', 'cancelled'];
        case 'ordered':  return ['received', 'cancelled'];
        case 'received': return ['paid'];
        default:         return [];
      }
    } else {
      switch (currentStatus) {
        case 'pending_approval': return ['approved', 'cancelled'];
        case 'approved':         return ['goods_released', 'cancelled'];
        case 'goods_released':   return ['delivered'];
        case 'delivered':        return ['paid'];
        default:                 return [];
      }
    }
  };

  const filteredOrders = activeTab === 'purchase'
    ? purchaseOrders.filter((o) => statusFilter === 'all' || o.status === statusFilter)
    : salesOrders.filter((o) => statusFilter === 'all' || o.status === statusFilter);

  if (isLoading && purchaseOrders.length === 0 && salesOrders.length === 0) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => {
            resetForm();
            setShowAddModal(true);
          }}
        >
          <Ionicons name="add" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'purchase' && styles.activeTab]}
          onPress={() => setActiveTab('purchase')}
        >
          <Ionicons
            name="arrow-down-circle"
            size={18}
            color={activeTab === 'purchase' ? Colors.text : Colors.textMuted}
          />
          <Text style={[styles.tabText, activeTab === 'purchase' && styles.activeTabText]}>
            Purchase
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'sales' && styles.activeTab]}
          onPress={() => setActiveTab('sales')}
        >
          <Ionicons
            name="arrow-up-circle"
            size={18}
            color={activeTab === 'sales' ? Colors.text : Colors.textMuted}
          />
          <Text style={[styles.tabText, activeTab === 'sales' && styles.activeTabText]}>
            Sales
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {(['all', 'draft', 'ordered', activeTab === 'purchase' ? 'received' : 'delivered', 'paid', 'cancelled'] as const).map((status) => (
          <TouchableOpacity
            key={status}
            style={[styles.filterChip, statusFilter === status && styles.filterChipActive]}
            onPress={() => setStatusFilter(status as any)}
          >
            <Text style={[styles.filterChipText, statusFilter === status && styles.filterChipTextActive]}>
              {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Orders List */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        contentContainerStyle={styles.content}
      >
        {filteredOrders.length === 0 ? (
          <EmptyState
            message={`No ${activeTab} orders found`}
            icon={activeTab === 'purchase' ? 'cube-outline' : 'cart-outline'}
          />
        ) : (
          filteredOrders.map((order) => {
            const isPurchase = 'po_id' in order;
            const orderId = isPurchase ? (order as PurchaseOrder).po_id : (order as SalesOrder).so_id;
            const orderNumber = isPurchase
              ? (order as PurchaseOrder).po_number
              : (order as SalesOrder).so_number;
            const partyName = isPurchase
              ? (order as PurchaseOrder).supplier_name
              : (order as SalesOrder).sales_rep_name;
            return (
              <TouchableOpacity
                key={orderId}
                style={styles.orderCard}
                onPress={() => {
                  setSelectedOrder(order);
                  setShowDetailModal(true);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.orderHeader}>
                  <View>
                    <Text style={styles.orderNumber}>{orderNumber}</Text>
                    <Text style={styles.orderParty}>{partyName || 'Unknown'}</Text>
                  </View>
                  <Badge text={order.status.toUpperCase()} variant={getStatusColor(order.status)} />
                </View>
                <View style={styles.orderDetails}>
                  <View style={styles.orderDetailItem}>
                    <Ionicons name="calendar-outline" size={14} color={Colors.textMuted} />
                    <Text style={styles.orderDetailText}>
                      {format(new Date(order.order_date), 'MMM dd, yyyy')}
                    </Text>
                  </View>
                  <View style={styles.orderDetailItem}>
                    <Ionicons name="cube-outline" size={14} color={Colors.textMuted} />
                    <Text style={styles.orderDetailText}>
                      {order.items?.length || 0} items
                    </Text>
                  </View>
                </View>
                <View style={styles.orderFooter}>
                  <Text style={styles.orderTotalLabel}>Total</Text>
                  <Text style={styles.orderTotalValue}>
                    {formatNaira(order.total_amount || 0)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Add Order Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                New {activeTab === 'purchase' ? 'Purchase' : 'Sales'} Order
              </Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Partner Selection */}
              {activeTab === 'purchase' ? (
                <>
                  {/* Create From toggle */}
                  <Text style={styles.inputLabel}>Create From</Text>
                  <View style={styles.pickerContainer}>
                    <TouchableOpacity
                      style={[styles.pickerOption, !fromRequisition && styles.pickerOptionActive]}
                      onPress={() => {
                        setFromRequisition(false);
                        setSelectedReqId(null);
                      }}
                    >
                      <Text style={[styles.pickerOptionText, !fromRequisition && styles.pickerOptionTextActive]}>
                        Direct Order
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pickerOption, fromRequisition && styles.pickerOptionActive]}
                      onPress={() => {
                        setFromRequisition(true);
                        loadApprovedRequisitions();
                      }}
                    >
                      <Text style={[styles.pickerOptionText, fromRequisition && styles.pickerOptionTextActive]}>
                        Approved Requisition
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Requisition selector */}
                  {fromRequisition && (
                    <>
                      <Text style={styles.inputLabel}>Select Requisition *</Text>
                      {approvedRequisitions.length === 0 ? (
                        <Text style={{ color: Colors.textMuted, fontSize: 13, marginBottom: 8 }}>
                          No approved requisitions found. Create one in the Requisitions screen first.
                        </Text>
                      ) : (
                        <View style={styles.pickerContainer}>
                          {approvedRequisitions.map((req) => (
                            <TouchableOpacity
                              key={req.requisition_id}
                              style={[
                                styles.pickerOption,
                                selectedReqId === req.requisition_id && styles.pickerOptionActive,
                              ]}
                              onPress={() => {
                                setSelectedReqId(req.requisition_id);
                                prefillFromRequisition(req);
                              }}
                            >
                              <Text
                                style={[
                                  styles.pickerOptionText,
                                  selectedReqId === req.requisition_id && styles.pickerOptionTextActive,
                                ]}
                              >
                                {req.requisition_number}
                              </Text>
                              <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 2 }}>
                                {req.requested_by_name || 'Unknown'} · {req.items?.length || 0} items
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </>
                  )}

                  {/* Supplier picker */}
                  <Text style={styles.inputLabel}>Supplier *</Text>
                  <View style={styles.pickerContainer}>
                    {suppliers.map((s) => (
                      <TouchableOpacity
                        key={s.supplier_id}
                        style={[
                          styles.pickerOption,
                          orderForm.supplier_id === s.supplier_id && styles.pickerOptionActive,
                        ]}
                        onPress={() => setOrderForm({ ...orderForm, supplier_id: s.supplier_id })}
                      >
                        <Text
                          style={[
                            styles.pickerOptionText,
                            orderForm.supplier_id === s.supplier_id && styles.pickerOptionTextActive,
                          ]}
                        >
                          {s.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.inputLabel}>Sales Order Note</Text>
                  <Text style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>
                    Sales Orders are normally created automatically when a manager approves an
                    agent quotation. Use the Quotations screen for the standard workflow.
                  </Text>

                  {/* Sales Rep picker (friendly name-based, not raw ID) */}
                  <Text style={styles.inputLabel}>Sales Representative *</Text>
                  {agents.length === 0 ? (
                    <Text style={{ color: Colors.textMuted, fontSize: 13, marginBottom: 8 }}>
                      No sales representatives found. Create one in the Users screen first.
                    </Text>
                  ) : (
                    <View style={styles.pickerContainer}>
                      {agents.map((a: any) => {
                        const isSelected = orderForm.sales_rep_id === a.user_id;
                        const isFlagged = a.is_flagged || false;
                        return (
                          <TouchableOpacity
                            key={a.user_id}
                            style={[
                              styles.pickerOption,
                              isSelected && styles.pickerOptionActive,
                              isFlagged && styles.pickerOptionFlagged,
                            ]}
                            onPress={() =>
                              setOrderForm({ ...orderForm, sales_rep_id: a.user_id })
                            }
                          >
                            <Text
                              style={[
                                styles.pickerOptionText,
                                isSelected && styles.pickerOptionTextActive,
                              ]}
                            >
                              {a.name}
                              {isFlagged ? ' ⚠️' : ''}
                            </Text>
                            {(a.outstanding_balance ?? 0) > 0 && (
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: isFlagged ? Colors.danger : Colors.textMuted,
                                  marginTop: 2,
                                }}
                              >
                                Outstanding: {formatNaira(a.outstanding_balance || 0)}
                              </Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </>
              )}

              {/* Warehouse Selection */}
              <Text style={styles.inputLabel}>Warehouse *</Text>
              <View style={styles.pickerContainer}>
                {warehouses.map((w) => (
                  <TouchableOpacity
                    key={w.warehouse_id}
                    style={[
                      styles.pickerOption,
                      orderForm.warehouse_id === w.warehouse_id && styles.pickerOptionActive,
                    ]}
                    onPress={() => setOrderForm({ ...orderForm, warehouse_id: w.warehouse_id })}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        orderForm.warehouse_id === w.warehouse_id && styles.pickerOptionTextActive,
                      ]}
                    >
                      {w.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Items */}
              <View style={styles.itemsHeader}>
                <Text style={styles.inputLabel}>Items</Text>
                <TouchableOpacity style={styles.addItemButton} onPress={addItemToOrder}>
                  <Ionicons name="add" size={18} color={Colors.primary} />
                  <Text style={styles.addItemText}>Add Item</Text>
                </TouchableOpacity>
              </View>
              {orderForm.items.map((item, index) => (
                <View key={index} style={styles.itemRow}>
                  <View style={styles.itemProductSelect}>
                    <Text style={styles.itemLabel}>Product</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.productScroll}
                    >
                      {products.slice(0, 10).map((p) => {
                        const isSelected = item.product_id === p.product_id;
                        return (
                          <TouchableOpacity
                            key={p.product_id}
                            style={[
                              styles.productChip,
                              isSelected && styles.productChipActive,
                            ]}
                            onPress={() => {
                              updateOrderItemFields(index, {
                                product_id: p.product_id,
                                unit_price: (activeTab === 'purchase' ? p.cost_price : p.selling_price).toString(),
                              });
                            }}
                          >
                            {isSelected && (
                              <Ionicons
                                name="checkmark-circle"
                                size={14}
                                color={Colors.text}
                                style={{ marginRight: 4 }}
                              />
                            )}
                            <Text
                              style={[
                                styles.productChipText,
                                isSelected && styles.productChipTextActive,
                              ]}
                              numberOfLines={1}
                            >
                              {p.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                  <View style={styles.itemInputRow}>
                    <View style={styles.itemInput}>
                      <Input
                        label="Qty"
                        value={item.quantity}
                        onChangeText={(text) => updateOrderItem(index, 'quantity', text)}
                        placeholder="0"
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.itemInput}>
                      <Input
                        label="Price"
                        value={item.unit_price}
                        onChangeText={(text) => updateOrderItem(index, 'unit_price', text)}
                        placeholder="0.00"
                        keyboardType="numeric"
                      />
                    </View>
                    <TouchableOpacity
                      style={styles.removeItemButton}
                      onPress={() => removeItemFromOrder(index)}
                    >
                      <Ionicons name="trash-outline" size={20} color={Colors.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <Input
                label="Notes"
                value={orderForm.notes}
                onChangeText={(text) => setOrderForm({ ...orderForm, notes: text })}
                placeholder="Add notes..."
                multiline
                numberOfLines={2}
              />
              <Button title="Create Order" onPress={handleCreateOrder} style={{ marginTop: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Order Detail Modal */}
      <Modal visible={showDetailModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Order Details</Text>
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            {selectedOrder && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.detailSection}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Order #</Text>
                    <Text style={styles.detailValue}>
                      {'po_number' in selectedOrder
                        ? selectedOrder.po_number
                        : selectedOrder.so_number}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>
                      {activeTab === 'purchase' ? 'Supplier' : 'Sales Rep'}
                    </Text>
                    <Text style={styles.detailValue}>
                      {'supplier_name' in selectedOrder
                        ? selectedOrder.supplier_name
                        : (selectedOrder as any).sales_rep_name}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Date</Text>
                    <Text style={styles.detailValue}>
                      {format(new Date(selectedOrder.order_date), 'MMM dd, yyyy')}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Status</Text>
                    <Badge
                      text={selectedOrder.status.toUpperCase()}
                      variant={getStatusColor(selectedOrder.status)}
                    />
                  </View>
                  {(selectedOrder as any).requisition_id && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>From Requisition</Text>
                      <Text style={styles.detailValue}>{(selectedOrder as any).requisition_id}</Text>
                    </View>
                  )}
                  {(selectedOrder as any).grn_number && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>GRN</Text>
                      <Text style={styles.detailValue}>{(selectedOrder as any).grn_number}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.sectionTitle}>Items</Text>
                {selectedOrder.items?.map((item, index) => (
                  <View key={index} style={styles.itemDetailRow}>
                    <View style={styles.itemDetailInfo}>
                      <Text style={styles.itemDetailName}>{item.product_name || 'Product'}</Text>
                      <Text style={styles.itemDetailMeta}>
                        {item.quantity} x {formatNaira(item.unit_price || 0)}
                      </Text>
                    </View>
                    <Text style={styles.itemDetailTotal}>
                      {formatNaira((item.quantity || 0) * (item.unit_price || 0))}
                    </Text>
                  </View>
                ))}
                <View style={styles.totalSection}>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Subtotal</Text>
                    <Text style={styles.totalValue}>
                      {formatNaira(selectedOrder.subtotal || 0)}
                    </Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Tax</Text>
                    <Text style={styles.totalValue}>
                      {formatNaira(selectedOrder.tax_amount || 0)}
                    </Text>
                  </View>
                  <View style={[styles.totalRow, styles.grandTotalRow]}>
                    <Text style={styles.grandTotalLabel}>Total</Text>
                    <Text style={styles.grandTotalValue}>
                      {formatNaira(selectedOrder.total_amount || 0)}
                    </Text>
                  </View>
                </View>
                {/* Full order record */}
                <Button
                  title="View Full Order"
                  variant="outline"
                  onPress={() => {
                    setShowDetailModal(false);
                    const orderId = 'po_number' in selectedOrder
                      ? (selectedOrder as PurchaseOrder).po_id
                      : (selectedOrder as SalesOrder).so_id;
                    router.push(`/order/${orderId}`);
                  }}
                  style={{ marginTop: 12 }}
                />
                {/* Status Actions */}
                {getNextStatus(selectedOrder.status).length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>Update Status</Text>
                    <View style={styles.statusActions}>
                      {getNextStatus(selectedOrder.status).map((status) => (
                        <Button
                          key={status}
                          title={status.charAt(0).toUpperCase() + status.slice(1)}
                          variant={status === 'cancelled' ? 'danger' : 'primary'}
                          onPress={() => handleUpdateStatus(status)}
                          style={{ flex: 1 }}
                        />
                      ))}
                    </View>
                  </>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  title: { fontSize: 28, fontWeight: '700', color: Colors.text },
  addButton: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 20, gap: 12, marginBottom: 16 },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  activeTab: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  activeTabText: { color: Colors.text },
  filterContainer: { marginBottom: 16 },
  filterContent: { paddingHorizontal: 20, gap: 8 },
  filterChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.text },
  content: { paddingHorizontal: 20 },
  orderCard: {
    backgroundColor: Colors.card, borderRadius: 16, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: Colors.border,
  },
  orderHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 12,
  },
  orderNumber: { fontSize: 16, fontWeight: '600', color: Colors.text },
  orderParty: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  orderDetails: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  orderDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderDetailText: { fontSize: 13, color: Colors.textMuted },
  orderFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  orderTotalLabel: { fontSize: 13, color: Colors.textSecondary },
  orderTotalValue: { fontSize: 18, fontWeight: '700', color: Colors.text },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: Colors.background, borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 20, maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '500', marginBottom: 8 },
  pickerContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  pickerOption: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: Colors.cardAlt, borderWidth: 1, borderColor: Colors.border,
    minWidth: 120,
  },
  pickerOptionActive: { backgroundColor: `${Colors.primary}20`, borderColor: Colors.primary },
  pickerOptionFlagged: { borderColor: Colors.danger, borderStyle: 'dashed' },
  pickerOptionText: { fontSize: 13, color: Colors.textSecondary },
  pickerOptionTextActive: { color: Colors.primary, fontWeight: '500' },
  itemsHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  addItemButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addItemText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
  itemRow: {
    backgroundColor: Colors.cardAlt, borderRadius: 12, padding: 12, marginBottom: 12,
  },
  itemProductSelect: { marginBottom: 12 },
  itemLabel: { fontSize: 12, color: Colors.textMuted, marginBottom: 8 },
  productScroll: { flexDirection: 'row' },
  productChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.card, marginRight: 8, borderWidth: 1, borderColor: Colors.border,
  },
  productChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  productChipText: { fontSize: 12, color: Colors.textSecondary, maxWidth: 100 },
  productChipTextActive: { color: Colors.text, fontWeight: '700', fontSize: 13 },
  itemInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  itemInput: { flex: 1 },
  removeItemButton: { padding: 12, marginBottom: 16 },
  detailSection: {
    backgroundColor: Colors.cardAlt, borderRadius: 12, padding: 16, marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  detailLabel: { fontSize: 14, color: Colors.textSecondary },
  detailValue: { fontSize: 14, fontWeight: '500', color: Colors.text },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: Colors.text, marginBottom: 12 },
  itemDetailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  itemDetailInfo: { flex: 1 },
  itemDetailName: { fontSize: 14, fontWeight: '500', color: Colors.text },
  itemDetailMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  itemDetailTotal: { fontSize: 14, fontWeight: '600', color: Colors.text },
  totalSection: {
    backgroundColor: Colors.cardAlt, borderRadius: 12, padding: 16,
    marginTop: 16, marginBottom: 20,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  totalLabel: { fontSize: 14, color: Colors.textSecondary },
  totalValue: { fontSize: 14, color: Colors.text },
  grandTotalRow: {
    borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 8, paddingTop: 12,
  },
  grandTotalLabel: { fontSize: 16, fontWeight: '600', color: Colors.text },
  grandTotalValue: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  statusActions: { flexDirection: 'row', gap: 12, marginBottom: 20 },
});
